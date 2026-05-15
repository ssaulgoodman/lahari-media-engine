/**
 * Gemini text/analysis service — runs server-side.
 * Handles: audio analysis (lyrics transcription, structure detection), shot critique, chat.
 * Concept generation, script planning, style brainstorm/refine/enrich, shot prompts → moved to claude.ts
 */
import { GoogleGenAI, Type } from '@google/genai';

const getAI = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

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
  const ai = getAI();
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
): Promise<{ sections: any[]; songType: string; isNarrative: boolean; isMeditative: boolean }> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [
      { inlineData: { mimeType, data: audioBase64 } },
      { text: `Analyze this audio and return a JSON object with four fields:

1. "sections" — array of musical sections (max 10). Each: label (Intro/Verse/Chorus/Bridge/Interlude/Outro), startTime (M:SS), endTime (M:SS), energy (Low/Medium/High), 5-word description.

2. "songType" — classify what you HEAR. One of: ballad, rap, pop, rock, electronic, cinematic, ambient, spoken_word, unknown.
   - ballad: lyrical song with clear verses and emotional progression
   - rap: rhythmic spoken or rapped vocal performance
   - pop: produced song with hook/refrain structure
   - rock: band-driven song with prominent drums/guitars or comparable live energy
   - electronic: synth/electronic production is the dominant musical identity
   - cinematic: score-like, orchestral, trailer-like, or soundtrack-driven
   - ambient: minimal, atmospheric, low-change soundscape
   - spoken_word: narration, monologue, dialogue, or poetry is dominant
   - unknown: doesn't fit the above

3. "isNarrative" — true if the audio tells a story or has a dramatic arc with distinct emotional shifts. false if it's repetitive or maintains a steady mood.

4. "isMeditative" — true if the song is contemplative, steady, inward-focused. false if it's energetic, dynamic, or dramatic.

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
          },
          songType: { type: Type.STRING, enum: ['ballad', 'rap', 'pop', 'rock', 'electronic', 'cinematic', 'ambient', 'spoken_word', 'unknown'] },
          isNarrative: { type: Type.BOOLEAN },
          isMeditative: { type: Type.BOOLEAN }
        },
        required: ['sections', 'songType', 'isNarrative', 'isMeditative']
      }
    }
  });
  if (!response.text) return { sections: [], songType: 'unknown', isNarrative: false, isMeditative: false };
  const parsed = safeParseJSON(response.text);
  // Handle both new object format and legacy array format
  if (Array.isArray(parsed)) return { sections: parsed, songType: 'unknown', isNarrative: false, isMeditative: false };
  return {
    sections: parsed.sections || parsed.musicalStructure || [],
    songType: parsed.songType || 'unknown',
    isNarrative: parsed.isNarrative ?? false,
    isMeditative: parsed.isMeditative ?? false,
  };
};


// ─── Shot Critique ──────────────────────────────────────────────────

export const critiqueShotImage = async (
  imageBase64: string,
  referenceImages: { name: string; imageBase64: string }[],
  compiledPrompt: string,
  styleDNA: string
): Promise<{ score: number; reasoning: string; isConsistent: boolean; suggestions: string }> => {
  const ai = getAI();

  const hasRefs = referenceImages.length > 0;

  const contents: any[] = [
    { text: 'GENERATED IMAGE — judge this:' },
    { inlineData: { mimeType: 'image/png', data: imageBase64 } },
    { text: `THE PROMPT THAT PRODUCED THIS IMAGE:\n${compiledPrompt}` },
    { text: `THE PROJECT'S LOCKED VISUAL STYLE:\n${styleDNA}` }
  ];

  if (hasRefs) {
    contents.push({ text: 'CHARACTER REFERENCES — the ground truth for what these characters should look like:' });
    referenceImages.forEach(ref => {
      contents.push({ text: `${ref.name}:` });
      contents.push({ inlineData: { mimeType: 'image/png', data: ref.imageBase64 } });
    });
  }

  contents.push({ text: `You are a meticulous Art Director reviewing this generated image for an AI video project.

SCORING RUBRIC (0-10):
  9-10: Publication ready. Style is spot-on, characters are recognizable, composition is compelling.
  7-8:  Strong result with minor issues — slight color drift, a small costume detail off, minor composition weakness.
  5-6:  Mediocre. Noticeable style mismatch, character inconsistency, or weak composition. Needs rework.
  3-4:  Poor. Major problems — wrong style, unrecognizable characters, bad anatomy, or broken composition.
  0-2:  Failed. Completely off-brief or technically broken.

EVALUATE THESE CRITERIA (weighted):

1. STYLE ADHERENCE (40%): Does the image match the locked visual style? Compare lighting, color palette, texture, and artistic medium against the style DNA. Do NOT default to "photorealism" — judge against whatever the locked style actually is (painterly, illustrative, cinematic, etc).

2. PROMPT FIDELITY (30%): Does the image faithfully depict what was described in the prompt? Check composition, setting, action, and atmosphere.

3. CHARACTER CONSISTENCY (${hasRefs ? '20%' : '0% — no references provided, skip this'}): ${hasRefs ? 'Do the characters match their reference images? Check face structure, body proportions, wardrobe, accessories, and distinctive design details. Minor pose differences are fine — identity must be preserved.' : 'N/A'}

4. TECHNICAL QUALITY (${hasRefs ? '10%' : '30%'}): Check for artifacts, anatomical errors (extra fingers, distorted faces), unnatural lighting, or visual noise.

Return your assessment as JSON. The "suggestions" field should contain SPECIFIC, ACTIONABLE fixes for the next attempt — e.g. "darken the background to deep indigo, add more gold ornamental detail to the crown, use warmer skin tones" — not vague notes like "improve quality".` });

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: contents },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          reasoning: { type: Type.STRING },
          isConsistent: { type: Type.BOOLEAN },
          suggestions: { type: Type.STRING }
        }
      }
    }
  });

  if (!response.text) return { score: 5, reasoning: 'Critique failed — no response', isConsistent: false, suggestions: 'Retry with more contrast and sharper character details' };
  return safeParseJSON(response.text);
};

// ─── Frame Description (for shot continuity reconciliation) ─────────

/**
 * Describe what's shown in an extracted video frame — used to tell the next
 * shot what the previous shot actually ended with (subject pose, camera
 * position, lighting, action mid-beat). Kept short and factual.
 */
export const describeFrame = async (imageBase64: string, mimeType = 'image/png'): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        { text: `Describe this single video frame factually for shot continuity. 2-3 sentences max.
Focus on: subject position/pose/expression, camera framing + angle, lighting mood, what action is mid-motion.
Do NOT speculate about narrative or use flowery language. Write like a script supervisor noting continuity.` }
      ]
    }
  });
  return (response.text || '').trim();
};

// ─── Chat ───────────────────────────────────────────────────────────

export const chatWithDirector = async (
  analysisContext: string,
  userMessage: string,
  history: { role: string; text: string }[]
): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [
      ...history.map(m => ({ role: m.role as 'user' | 'model', parts: [{ text: m.text }] })),
      { role: 'user', parts: [{ text: `Context: ${analysisContext}\n\nUser Message: ${userMessage}. (Provide advice on prompts)` }] }
    ]
  });
  return response.text || 'I can help guide you.';
};
