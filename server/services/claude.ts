/**
 * Claude text service — handles structured text + vision tasks.
 * Uses tool_use for guaranteed valid JSON output (no truncation, no schema violations).
 *
 * Handles: planScenes, writeShotPrompts, brainstormStyleDirections, refineStyleDirection,
 *          enrichStyleDNA, analyzeImageStyle
 * Gemini still handles: audio analysis, image critique (vision), chat
 */
import Anthropic from '@anthropic-ai/sdk';

const getClient = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Model choice — opus for quality, sonnet for speed/cost
const MODEL = 'claude-sonnet-4-6';

// ─── Script Planning ────────────────────────────────────────────────

export interface ScriptInput {
  concept: any;
  videoMode: string;
}

// Parse "M:SS" or "MM:SS" to seconds
const parseTimestamp = (t: string): number => {
  if (!t || !t.includes(':')) return 0;
  const parts = t.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
};

export const planScenes = async (
  input: ScriptInput & { lyrics: string; meaning: string; musicalStructure: string; basePacing: number }
): Promise<{ cast: any[]; environments: any[]; scenes: any[] }> => {
  const client = getClient();
  const pacing = input.basePacing || 8;

  const prompt = `You are a music video director. Plan the narrative structure for this song.

LYRICS:
${input.lyrics}

MEANING: ${input.meaning}

MUSICAL STRUCTURE: ${input.musicalStructure}

CONCEPT: ${input.concept.deity || 'Unknown'} — ${input.concept.theme}. Mood: ${input.concept.mood}. ${input.concept.conceptDirection || ''}

VIDEO MODE: ${input.videoMode}

CLIP LENGTH: Each video clip is ${pacing} seconds. You do NOT decide shot durations — they are fixed at ${pacing}s. You decide the creative content of each shot.

For each scene, I'll tell you how many shots to write based on the scene's duration. Fill each shot slot with a creative direction (5-10 words). Image and video prompts will be written later with full visual context.

Use the plan_music_video tool. Follow the musical structure — one scene per section.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    tools: [{
      name: 'plan_music_video',
      description: 'Plan the full music video structure — cast + environments + scenes + shots',
      input_schema: {
        type: 'object' as const,
        properties: {
          cast: {
            type: 'array',
            description: 'All characters needed for this video',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Character name (e.g. "Goddess Mahalakshmi")' },
                description: { type: 'string', description: 'PHYSICAL appearance only — face, body, costume, ornaments. 2 sentences. No art style.' }
              },
              required: ['name', 'description']
            }
          },
          environments: {
            type: 'array',
            description: 'All distinct environments/locations needed for this video',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Environment name (e.g. "Vaikuntha Palace", "Cosmic Ocean")' },
                description: { type: 'string', description: 'PHYSICAL description of the environment — architecture, landscape, lighting, atmosphere. 2 sentences. No art style.' }
              },
              required: ['name', 'description']
            }
          },
          scenes: {
            type: 'array',
            description: 'One scene per musical section, following the structure exactly',
            items: {
              type: 'object',
              properties: {
                sectionLabel: { type: 'string', description: 'Musical section name (e.g. "Intro", "Verse 1", "Chorus")' },
                startTime: { type: 'string', description: 'Start timestamp (e.g. "0:00")' },
                endTime: { type: 'string', description: 'End timestamp (e.g. "0:30")' },
                narrativeDescription: { type: 'string', description: 'What happens in this scene. One sentence.' },
                shots: {
                  type: 'array',
                  description: 'Individual shots — one per clip slot. Number of shots = ceil(scene duration / clip length).',
                  items: {
                    type: 'object',
                    properties: {
                      direction: { type: 'string', description: '5-10 word creative idea (e.g. "deity reveals cosmic form")' },
                      castNames: { type: 'array', items: { type: 'string' }, description: 'Names of cast members in this shot' },
                      environmentName: { type: 'string', description: 'Name of the environment for this shot (must match an environment name from the environments list)' }
                    },
                    required: ['direction', 'castNames']
                  }
                }
              },
              required: ['sectionLabel', 'startTime', 'endTime', 'narrativeDescription', 'shots']
            }
          }
        },
        required: ['cast', 'environments', 'scenes']
      }
    }],
    tool_choice: { type: 'tool', name: 'plan_music_video' },
    messages: [{ role: 'user', content: prompt }]
  });

  // Extract tool_use result — guaranteed valid JSON
  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('Claude did not return tool_use response');
  }

  const data = toolBlock.input as { cast: any[]; environments: any[]; scenes: any[] };
  if (!data.environments) data.environments = [];

  // Assign deterministic durations based on pacing
  for (const scene of data.scenes) {
    const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
    const shotCount = scene.shots.length;
    if (shotCount === 0) continue;

    // All shots get full pacing, last shot gets remainder
    for (let i = 0; i < shotCount; i++) {
      if (i < shotCount - 1) {
        scene.shots[i].duration = pacing;
      } else {
        // Last shot: whatever is left
        const usedTime = (shotCount - 1) * pacing;
        scene.shots[i].duration = Math.max(1, sceneDuration - usedTime);
      }
    }
  }

  return data;
};

// ─── Write Shot Prompts (after all creative decisions locked) ───────

export const writeShotPrompts = async (
  shots: { id: string; direction: string; duration: number; castNames: string[]; sceneNarrative: string; sceneLyrics: string }[],
  context: { styleDNA: string; cast: { name: string; description: string }[]; concept: any; lyrics: string }
): Promise<{ id: string; visualPrompt: string; motionPrompt: string }[]> => {
  const client = getClient();

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

Use the write_shot_prompts tool. Return one entry per shot. Match the IDs exactly.`;

  // Build tool schema with exact shot IDs
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16384,
    tools: [{
      name: 'write_shot_prompts',
      description: 'Write visual and motion prompts for each shot',
      input_schema: {
        type: 'object' as const,
        properties: {
          shots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Shot ID — must match exactly' },
                visualPrompt: { type: 'string', description: 'What we see. 1-2 sentences. Characters + environment + action.' },
                motionPrompt: { type: 'string', description: 'Camera + character movement. 1 sentence.' }
              },
              required: ['id', 'visualPrompt', 'motionPrompt']
            }
          }
        },
        required: ['shots']
      }
    }],
    tool_choice: { type: 'tool', name: 'write_shot_prompts' },
    messages: [{ role: 'user', content: prompt }]
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('Claude did not return tool_use response');
  }

  return (toolBlock.input as any).shots;
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
  const client = getClient();

  const prompt = `You are an elite Director of Photography who has won Cannes, BAFTA, and Academy Awards.

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

Propose exactly 4 completely different but each internally cohesive VISUAL STYLE DIRECTIONS for this music video. Each should feel like a different film — different DP, different era, different artistic movement.

Use the propose_style_directions tool.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [{
      name: 'propose_style_directions',
      description: 'Propose 4 visual style directions for the music video',
      input_schema: {
        type: 'object' as const,
        properties: {
          directions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short evocative label (2-5 words, e.g. "Baroque Candlelight")' },
                description: { type: 'string', description: 'Rich visual direction (3-4 sentences). Include: lighting quality, color palette, texture/medium, composition style, cultural/artistic references, camera feel. This will be used as an image generation prompt — be vivid and concrete. No character descriptions — purely visual STYLE, MOOD, ATMOSPHERE.' }
              },
              required: ['title', 'description']
            }
          }
        },
        required: ['directions']
      }
    }],
    tool_choice: { type: 'tool', name: 'propose_style_directions' },
    messages: [{ role: 'user', content: prompt }]
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') throw new Error('No style directions generated');
  return (toolBlock.input as any).directions;
};

// ─── Refine a Style Direction (text-only) ───────────────────────────

export const refineStyleDirection = async (
  currentDescription: string,
  feedback: string,
  concept: any
): Promise<{ title: string; description: string }> => {
  const client = getClient();

  const prompt = `You are an elite DP refining a visual direction based on feedback.

CURRENT DIRECTION:
${currentDescription}

CONTEXT:
- Deity/Subject: ${concept.deity || 'Unknown'}
- Mood: ${concept.mood || 'Unknown'}

USER FEEDBACK:
${feedback}

Revise the direction incorporating the feedback. Keep it cohesive and internally consistent. The description will be used as an image generation prompt — be vivid and concrete. Focus on visual STYLE, MOOD, and ATMOSPHERE — no character descriptions.

Use the refine_direction tool.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [{
      name: 'refine_direction',
      description: 'Return the refined style direction',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: 'Short evocative label (2-5 words)' },
          description: { type: 'string', description: 'Revised visual direction (3-4 sentences). Vivid, concrete, style-focused.' }
        },
        required: ['title', 'description']
      }
    }],
    tool_choice: { type: 'tool', name: 'refine_direction' },
    messages: [{ role: 'user', content: prompt }]
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') throw new Error('Refinement failed');
  return toolBlock.input as { title: string; description: string };
};

// ─── Enrich Style DNA (vision — analyzes locked style image) ─────────

export const enrichStyleDNA = async (
  imageBase64: string,
  mimeType: string,
  shortDescription: string
): Promise<string> => {
  const client = getClient();

  const mediaType = mimeType.startsWith('image/') ? mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' : 'image/png';

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: `You are an expert prompt engineer for AI image generation models.

The user selected this image as their style reference. They described it as: "${shortDescription}"

Analyze this image and write a STYLE PROMPT FRAGMENT — a single dense paragraph (100-150 words) that captures the exact visual style so it can be injected into image generation prompts to reproduce this look consistently.

Write it as a flowing, natural description — NOT with headers, bullet points, or structured sections. Every word should be a concrete visual instruction.

Cover in natural prose: lighting quality and color temperature, dominant color palette, texture and medium (film grain, paint, digital), composition tendencies, mood and atmosphere, and any cultural/artistic references.

Return ONLY the style fragment text. No quotes, no JSON, no markdown.` }
      ]
    }]
  });

  const textBlock = response.content.find((b: any) => b.type === 'text');
  return (textBlock && textBlock.type === 'text' ? textBlock.text : null) || shortDescription;
};

// ─── Analyze Image Style (vision — user uploads reference) ───────────

export const analyzeImageStyle = async (imageBase64: string, mimeType: string): Promise<string> => {
  const client = getClient();

  const mediaType = mimeType.startsWith('image/') ? mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' : 'image/png';

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: `Analyze this image and describe its "Art Style" in detail. Return a concise prompt fragment (2-3 sentences) covering: lighting, color palette, texture/medium, composition, mood. Be concrete and specific — this will be used as an image generation style reference.

Return ONLY the style fragment text. No quotes, no JSON, no markdown.` }
      ]
    }]
  });

  const textBlock = response.content.find((b: any) => b.type === 'text');
  return (textBlock && textBlock.type === 'text' ? textBlock.text : null) || 'Cinematic, high contrast.';
};

