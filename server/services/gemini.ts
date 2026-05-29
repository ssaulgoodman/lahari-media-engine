/**
 * Gemini text/analysis service — runs server-side.
 * Handles: audio analysis (lyrics transcription, structure detection), shot critique, chat.
 * Concept generation, script planning, style brainstorm/refine/enrich, shot prompts → moved to claude.ts
 */
import { GoogleGenAI, Type } from '@google/genai';
import { requireProviderApiKey } from './byok/providerKeys.js';
import { generateText } from './text-provider.js';

const getAI = async () => new GoogleGenAI({ apiKey: await requireProviderApiKey('gemini') });

// ─── JSON Repair ────────────────────────────────────────────────────

const safeParseJSON = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.warn('[gemini] JSON parse failed, attempting repair...', (e as Error).message);

    // Strategy: find the last complete object/array boundary and close everything
    // First, try truncating to last `}` or `]` outside a string, then close remaining brackets
    for (let i = text.length - 1; i > text.length * 0.3; i--) {
      // Try cutting at this position and closing any open structures
      const candidate = text.substring(0, i + 1);

      // If we're inside a string, close it first
      let inString = false, escaped = false;
      for (let j = 0; j < candidate.length; j++) {
        const c = candidate[j];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '"') inString = !inString;
      }

      let attempt = candidate;
      if (inString) attempt += '"';

      // Count open braces/brackets
      let braces = 0, brackets = 0;
      inString = false; escaped = false;
      for (let j = 0; j < attempt.length; j++) {
        const c = attempt[j];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === '{') braces++;
        else if (c === '}') braces--;
        else if (c === '[') brackets++;
        else if (c === ']') brackets--;
      }

      // Close everything
      while (brackets > 0) { attempt += ']'; brackets--; }
      while (braces > 0) { attempt += '}'; braces--; }

      try {
        const result = JSON.parse(attempt);
        console.warn(`[gemini] JSON repaired (cut at ${i}/${text.length}) — some data at end may be missing.`);
        return result;
      } catch { continue; }
    }
    throw new Error('Failed to parse AI response. Output was too long and could not be recovered.');
  }
};

// ─── Audio Analysis (Phase 1: parallel lyrics + structure) ──────────

export const transcribeLyrics = async (
  audioBase64: string,
  mimeType: string,
  language?: string
): Promise<string> => {
  const ai = await getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [
      { inlineData: { mimeType, data: audioBase64 } },
      { text: `Transcribe the lyrics of this audio.
Language: ${language || 'Detect automatically'}.
Format: timestamp on the left, lyrics on the right. Like:

[0:00] First line of lyrics
[0:15] Second line of lyrics

Rules:
- Original language ONLY. No translations.
- One line per lyrical phrase with its approximate timestamp.
- Keep it clean and simple. No SRT format, no numbering, no metadata.
Return ONLY the transcription.` }
    ]},
    config: { maxOutputTokens: 8192 }
  });
  return response.text || '';
};

export const detectStructure = async (
  audioBase64: string,
  mimeType: string
): Promise<{ sections: any[] }> => {
  const ai = await getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [
      { inlineData: { mimeType, data: audioBase64 } },
      { text: `Analyze this audio and return a JSON object with one field:

1. "sections" — array of musical sections (max 10). Each: label (Intro/Verse/Chorus/Bridge/Interlude/Outro), startTime (M:SS), endTime (M:SS), energy (Low/Medium/High), 5-word description.

Return ONLY the JSON object.` }
    ]},
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 4096,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                startTime: { type: Type.STRING },
                endTime: { type: Type.STRING },
                energyLevel: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] },
                description: { type: Type.STRING }
              },
              required: ['label', 'startTime', 'endTime']
            }
          }
        },
        required: ['sections']
      }
    }
  });
  if (!response.text) return { sections: [] };
  const parsed = safeParseJSON(response.text);
  // Handle both new object format and legacy array format
  if (Array.isArray(parsed)) return { sections: parsed };
  return {
    sections: parsed.sections || parsed.musicalStructure || [],
  };
};


// ─── Frame Description (for shot continuity reconciliation) ─────────

/**
 * Describe what's shown in an extracted video frame — used to tell the next
 * shot what the previous shot actually ended with (subject pose, camera
 * position, lighting, action mid-beat). Kept short and factual.
 */
export const describeFrame = async (
  imageBase64: string,
  mimeType = 'image/png',
  providerKey?: string | null,
): Promise<string> => {
  const response = await generateText(providerKey, {
    userPrompt: `Describe this single video frame factually for shot continuity. 2-3 sentences max.
Focus on: subject position/pose/expression, camera framing + angle, lighting mood, what action is mid-motion.
Do NOT speculate about narrative or use flowery language. Write like a script supervisor noting continuity.`,
    inputImages: [{ data: imageBase64, mimeType }],
    useRefineModel: true,
    maxTokens: 300,
  });
  return (response.text || '').trim();
};
