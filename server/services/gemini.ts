/**
 * Gemini text/analysis service — runs server-side.
 * Handles: audio analysis, lyrics transcription, structure detection, concept generation,
 * script planning, shot critique, style analysis, chat.
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
): Promise<any[]> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [
      { inlineData: { mimeType, data: audioBase64 } },
      { text: `Identify the musical sections of this audio. Keep it SHORT — max 10 sections.
For each: label (Intro/Verse/Chorus/Bridge/Interlude/Outro), startTime (M:SS), endTime (M:SS), energy (Low/Medium/High), and a 5-word description.
Return ONLY a JSON array.` }
    ]},
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 4096,
      responseSchema: {
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
    }
  });
  if (!response.text) return [];
  const parsed = safeParseJSON(response.text);
  // Handle both array and wrapped object responses
  return Array.isArray(parsed) ? parsed : (parsed.musicalStructure || []);
};

// ─── Audio Meaning Summary ───────────────────────────────────────────

export const summarizeMeaning = async (
  audioBase64: string,
  mimeType: string,
  language?: string
): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [
      { inlineData: { mimeType, data: audioBase64 } },
      { text: `Listen to this audio and provide a brief meaning/summary.
${language ? `Language: ${language}.` : ''}
Cover:
1. What is this song about? (2-3 sentences)
2. Who is it addressed to? (deity, beloved, nature, etc.)
3. Emotional arc (how does the mood shift through the song?)
4. Cultural/spiritual context if apparent

Keep it under 150 words. Write in plain English even if the song is in another language.` }
    ]},
    config: { maxOutputTokens: 2048 }
  });
  return response.text || '';
};

// ─── Phase 2: Concept Options (returns 2-3 creative directions) ─────

export const generateConceptOptions = async (
  lyrics: string,
  musicalStructure: any[],
  metadata?: { title?: string; context?: string; language?: string }
): Promise<any[]> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [
      { text: `You are a visionary film director specializing in devotional music videos.

SONG METADATA:
- Title: ${metadata?.title || 'Unknown'}
- Language: ${metadata?.language || 'Unknown (Indian Classical Context likely)'}
- Deity/Context: ${metadata?.context || 'Infer from lyrics below'}

TRANSCRIBED LYRICS:
${lyrics ? lyrics.substring(0, 4000) : 'Not available — infer from metadata.'}

MUSICAL STRUCTURE:
${JSON.stringify(musicalStructure.slice(0, 8), null, 2)}

TASK:
You MUST generate EXACTLY 3 creative concept directions for a music video. Not 1, not 2 — exactly 3.
Each concept MUST be dramatically different from the others. Push the creative boundaries:
- Concept 1: A traditional/classical approach
- Concept 2: A modern/contemporary reinterpretation
- Concept 3: A bold/experimental artistic vision

For EACH of the 3 concepts provide ALL of these fields:
- title: The song title (same for all 3)
- language: Detected language
- deity: The deity/subject
- mood: Overall emotional tone for THIS concept (must differ across concepts)
- theme: 1-2 sentence thematic narrative for THIS concept
- lyricsSummary: Brief summary of lyrical meaning (same for all 3)
- conceptDirection: A short evocative label (e.g. "Ethereal Dreamscape", "Neo-Mythology", "Sacred Geometry")
- visualSuggestions:
  - physicalDescription: How the deity/subject looks in THIS style
  - artStyle: Specific art direction for THIS concept (must differ across concepts)
  - colorPalette: Distinct color palette for THIS concept

CRITICAL: The concepts array MUST contain exactly 3 items. Return ONLY JSON.` }
    ]},
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 16384,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          concepts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                language: { type: Type.STRING },
                deity: { type: Type.STRING },
                mood: { type: Type.STRING },
                theme: { type: Type.STRING },
                lyricsSummary: { type: Type.STRING },
                conceptDirection: { type: Type.STRING },
                visualSuggestions: {
                  type: Type.OBJECT,
                  properties: {
                    physicalDescription: { type: Type.STRING },
                    artStyle: { type: Type.STRING },
                    colorPalette: { type: Type.STRING }
                  },
                  required: ['physicalDescription', 'artStyle', 'colorPalette']
                }
              },
              required: ['title', 'deity', 'mood', 'theme', 'conceptDirection', 'visualSuggestions']
            }
          }
        }
      }
    }
  });
  if (!response.text) throw new Error('No concepts generated');
  const parsed = safeParseJSON(response.text);
  return parsed.concepts || [];
};

// ─── Script Planning ────────────────────────────────────────────────

export interface ScriptInput {
  concept: any;
  videoMode: string;
}

export const planScenes = async (
  input: ScriptInput & { lyrics: string; meaning: string; musicalStructure: string }
): Promise<any> => {
  const ai = getAI();

  const prompt = `
  You are a music video director. Plan the narrative structure for this song.

  LYRICS:
  ${input.lyrics}

  MEANING: ${input.meaning}

  MUSICAL STRUCTURE: ${input.musicalStructure}

  CONCEPT: ${input.concept.deity || 'Unknown'} — ${input.concept.theme}. Mood: ${input.concept.mood}. ${input.concept.conceptDirection || ''}

  OUTPUT TWO THINGS:

  1. CAST — all characters needed for this video.
     - name: character name (e.g. "Goddess Mahalakshmi")
     - description: PHYSICAL appearance only — face, body, costume, ornaments. 2 sentences. No art style.

  2. SCENES — follow the musical structure. One scene per section.
     Per scene: sectionLabel, startTime, endTime, narrativeDescription (1 sentence).
     Per shot: direction (5-10 words — the creative idea, e.g. "deity reveals cosmic form"), duration (seconds), castNames.

  The direction field is just a short creative note. Image and video prompts will be written in a later step with full visual context. Do NOT write detailed descriptions — just the idea.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          cast: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ['name', 'description']
            }
          },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sectionLabel: { type: Type.STRING },
                startTime: { type: Type.STRING },
                endTime: { type: Type.STRING },
                narrativeDescription: { type: Type.STRING },
                shots: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      duration: { type: Type.NUMBER },
                      direction: { type: Type.STRING },
                      castNames: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!response.text) throw new Error('Failed to plan scenes');
  return safeParseJSON(response.text);
};

// ─── Write Shot Prompts (after all creative decisions locked) ───────

export const writeShotPrompts = async (
  shots: { id: string; direction: string; duration: number; castNames: string[]; sceneNarrative: string; sceneLyrics: string }[],
  context: { styleDNA: string; cast: { name: string; description: string }[]; concept: any; lyrics: string }
): Promise<{ id: string; visualPrompt: string; motionPrompt: string }[]> => {
  const ai = getAI();

  const shotList = shots.map((s, i) =>
    `Shot ${i + 1} [${s.id}]: "${s.direction}" | ${s.duration}s | Cast: ${s.castNames.join(', ') || 'none'} | Scene: ${s.sceneNarrative} | Lyrics: ${s.sceneLyrics || 'instrumental'}`
  ).join('\n');

  const castList = context.cast.map(c => `${c.name}: ${c.description}`).join('\n');

  const prompt = `You are a cinematographer writing shot-by-shot prompts for a music video.

LOCKED VISUAL STYLE:
${context.styleDNA}

CHARACTERS:
${castList}

CONCEPT: ${context.concept.deity || ''} — ${context.concept.theme}. Mood: ${context.concept.mood}.

SHOTS TO WRITE PROMPTS FOR:
${shotList}

For EACH shot, write:
- visualPrompt: What we SEE in the frame. Composition, characters, environment, action. 1-2 sentences. Include character physical details from the cast list. Do NOT include art style/lighting/color — the style system adds that.
- motionPrompt: How the camera and characters MOVE. 1 sentence. Example: "Slow dolly in as deity raises blessing hand, flower petals drift across frame"

Return a JSON array with {id, visualPrompt, motionPrompt} per shot. Match the IDs exactly.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [{ text: prompt }] },
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            visualPrompt: { type: Type.STRING },
            motionPrompt: { type: Type.STRING }
          },
          required: ['id', 'visualPrompt', 'motionPrompt']
        }
      }
    }
  });

  if (!response.text) throw new Error('Failed to write shot prompts');
  return safeParseJSON(response.text);
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

  contents.push({ text: `You are a meticulous Art Director reviewing this generated image for a devotional music video.

SCORING RUBRIC (0-10):
  9-10: Publication ready. Style is spot-on, characters are recognizable, composition is compelling.
  7-8:  Strong result with minor issues — slight color drift, a small costume detail off, minor composition weakness.
  5-6:  Mediocre. Noticeable style mismatch, character inconsistency, or weak composition. Needs rework.
  3-4:  Poor. Major problems — wrong style, unrecognizable characters, bad anatomy, or broken composition.
  0-2:  Failed. Completely off-brief or technically broken.

EVALUATE THESE CRITERIA (weighted):

1. STYLE ADHERENCE (40%): Does the image match the locked visual style? Compare lighting, color palette, texture, and artistic medium against the style DNA. Do NOT default to "photorealism" — judge against whatever the locked style actually is (painterly, illustrative, cinematic, etc).

2. PROMPT FIDELITY (30%): Does the image faithfully depict what was described in the prompt? Check composition, setting, action, and atmosphere.

3. CHARACTER CONSISTENCY (${hasRefs ? '20%' : '0% — no references provided, skip this'}): ${hasRefs ? 'Do the characters match their reference images? Check face structure, skin tone, costume/ornaments, and iconographic attributes (crown, weapons, jewelry). Minor pose differences are fine — identity must be preserved.' : 'N/A'}

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

// ─── Style Analysis from uploaded image ─────────────────────────────

export const analyzeImageStyle = async (imageBase64: string, mimeType: string): Promise<string> => {
  const ai = getAI();
  const prompt = `Analyze this image and describe its "Art Style" in detail... Return concise prompt fragment.`;
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }] }
  });
  return response.text || 'Cinematic, high contrast.';
};

// ─── Style Brainstorming (text-only, no images) ─────────────────────

export const brainstormStyleDirections = async (
  lyrics: string,
  musicalStructure: any[],
  meaning: string,
  concept: any,
  userNotes?: string,
  scriptSummary?: string
): Promise<{ title: string; description: string }[]> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [
      { text: `You are an elite Director of Photography who has won Cannes, BAFTA, and Academy Awards.

SONG CONTEXT:
- Title: ${concept.title || 'Unknown'}
- Deity/Subject: ${concept.deity || 'Unknown'}
- Mood: ${concept.mood || 'Unknown'}
- Theme: ${concept.theme || 'Unknown'}
- Language: ${concept.language || 'Unknown'}

LYRICS:
${(lyrics || '').substring(0, 3000)}

MUSICAL STRUCTURE:
${JSON.stringify((musicalStructure || []).slice(0, 8), null, 2)}

MEANING & EMOTIONAL ARC:
${(meaning || '').substring(0, 1500)}

${userNotes ? `USER'S STYLE PREFERENCE: ${userNotes}\nUse this as a strong creative signal. All 4 directions should be variations WITHIN this preference, not random genres that ignore it.` : ''}

${scriptSummary ? `SCRIPT OVERVIEW (the video's narrative structure):\n${scriptSummary}\n\nUse this to understand what kinds of scenes need to be rendered — the style must work for ALL of these scenes.` : ''}

TASK:
Propose exactly 4 completely different but each internally cohesive VISUAL STYLE DIRECTIONS for this music video.

Each direction should feel like a different film — different DP, different era, different artistic movement. Be specific and evocative.

For each direction provide:
- title: A short evocative label (2-5 words, e.g. "Baroque Candlelight", "Watercolor Dreams", "Sacred Geometry")
- description: A rich, specific visual direction (3-4 sentences). Include: lighting quality, color palette, texture/medium, composition style, cultural/artistic references, camera feel. This description will be used DIRECTLY as an image generation prompt, so make it vivid and concrete. Do NOT include character descriptions — focus purely on the visual STYLE, MOOD, and ATMOSPHERE.

The 4 directions MUST be meaningfully different from each other — different eras, mediums, moods, cultural touchpoints. Not just "the same thing with different filters."

Return ONLY JSON.` }
    ]},
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 4096,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          directions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ['title', 'description']
            }
          }
        }
      }
    }
  });
  if (!response.text) throw new Error('No style directions generated');
  const parsed = safeParseJSON(response.text);
  return parsed.directions || [];
};

// ─── Refine a Style Direction (text-only) ───────────────────────────

export const refineStyleDirection = async (
  currentDescription: string,
  feedback: string,
  concept: any
): Promise<{ title: string; description: string }> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [
      { text: `You are an elite DP refining a visual direction based on feedback.

CURRENT DIRECTION:
${currentDescription}

CONTEXT:
- Deity/Subject: ${concept.deity || 'Unknown'}
- Mood: ${concept.mood || 'Unknown'}

USER FEEDBACK:
${feedback}

Revise the direction incorporating the feedback. Keep it cohesive and internally consistent.
The description will be used as an image generation prompt — be vivid and concrete.
Focus on visual STYLE, MOOD, and ATMOSPHERE — no character descriptions.

Return ONLY JSON.` }
    ]},
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 1024,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING }
        },
        required: ['title', 'description']
      }
    }
  });
  if (!response.text) throw new Error('Refinement failed');
  return safeParseJSON(response.text);
};

// ─── Enrich Style DNA (deep analysis of locked style image) ─────────

export const enrichStyleDNA = async (
  imageBase64: string,
  mimeType: string,
  shortDescription: string
): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [
      { inlineData: { mimeType, data: imageBase64 } },
      { text: `You are an expert prompt engineer for AI image generation models.

The user selected this image as their style reference. They described it as: "${shortDescription}"

Analyze this image and write a STYLE PROMPT FRAGMENT — a single dense paragraph (100-150 words) that captures the exact visual style so it can be injected into image generation prompts to reproduce this look consistently.

Write it as a flowing, natural description — NOT with headers, bullet points, or structured sections. Every word should be a concrete visual instruction.

Cover in natural prose: lighting quality and color temperature, dominant color palette, texture and medium (film grain, paint, digital), composition tendencies, mood and atmosphere, and any cultural/artistic references.

Example of the desired output format:
"Warm candlelit Renaissance oil painting aesthetic with deep chiaroscuro shadows and rich burgundy-gold palette. Soft diffused key light from upper left, heavy vignetting, shallow depth of field with creamy bokeh. Textures of aged canvas and craquelure visible. Saturated jewel tones — ruby, amber, deep emerald. Mood of intimate sacred stillness. References Caravaggio and Rembrandt lighting with Indian miniature painting's ornate detail."

Return ONLY the style fragment text. No quotes, no JSON, no markdown.` }
    ]},
    config: { maxOutputTokens: 1024 }
  });
  return response.text || shortDescription;
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
