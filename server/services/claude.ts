/**
 * Claude text service — handles structured text + vision tasks.
 * Uses tool_use for guaranteed valid JSON output (no truncation, no schema violations).
 *
 * Sonnet: summarizeMeaning, planScenes, writeShotPrompts, refineStyleDirection, enrichStyleDNA, analyzeImageStyle
 * Opus: generateConceptOptions, brainstormStyleDirections
 * Gemini still handles: audio analysis (transcribe, structure), image critique (vision), chat
 */
import Anthropic from '@anthropic-ai/sdk';

const getClient = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Model choices
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-6';

// ─── Meaning Summary (Stage 3) ──────────────────────────────────────

export const summarizeMeaning = async (
  title: string,
  language: string,
  lyrics: string,
  context?: string
): Promise<string> => {
  const client = getClient();

  const prompt = `Song: ${title} (${language})
${context ? `Context: ${context}` : ''}

LYRICS:
${lyrics}

Summarize the meaning of this song.

Cover:
1. What is the song about? (2-3 sentences)
2. Who is it addressed to?
3. Emotional arc
4. Cultural/spiritual context

Under 150 words. Write in English.`;

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  const textBlock = response.content.find((b: any) => b.type === 'text');
  return (textBlock && textBlock.type === 'text' ? textBlock.text : null) || '';
};

// ─── Concept Generation (Stage 4) ───────────────────────────────────

export const generateConceptOptions = async (
  title: string,
  language: string,
  lyrics: string,
  meaning: string,
  musicalStructure: any[],
  context?: string,
  userNote?: string
): Promise<{ concepts: any[]; prompt: string }> => {
  const client = getClient();

  const prompt = `You are a visionary film director specializing in Indian mythological and devotional cinema.

SONG: ${title} (${language})
${context ? `CONTEXT: ${context}` : ''}

LYRICS:
${(lyrics || '').substring(0, 4000)}

MEANING:
${meaning}

MUSICAL STRUCTURE:
${JSON.stringify((musicalStructure || []).slice(0, 8), null, 2)}
${userNote ? `\nDIRECTOR NOTE (must follow): ${userNote}\n` : ''}
Generate EXACTLY 3 creative directions for a music video:
1. Traditional/classical — rooted in culture, devotional storytelling
2. Modern/contemporary — fresh visual language, cinematic realism
3. Bold/experimental — unexpected, artistic, boundary-pushing

For each direction provide:
- title: 2-4 word creative title
- deity: the primary divine figure
- mood: one distinct emotional keyword (different per direction)
- theme: the core narrative idea (1 sentence)
- conceptDirection: traditional / modern / experimental
- visualSuggestions: { artStyle, colorPalette }

Use the generate_concepts tool. Return EXACTLY 3 concepts.`;

  const response = await client.messages.create({
    model: OPUS,
    max_tokens: 4096,
    tools: [{
      name: 'generate_concepts',
      description: 'Generate 3 creative concept directions for a music video',
      input_schema: {
        type: 'object' as const,
        properties: {
          concepts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Song title' },
                language: { type: 'string', description: 'Detected language' },
                deity: { type: 'string', description: 'Primary divine figure' },
                mood: { type: 'string', description: 'Emotional keyword — unique per concept' },
                theme: { type: 'string', description: 'Core narrative idea (1 sentence)' },
                lyricsSummary: { type: 'string', description: 'Brief meaning summary' },
                conceptDirection: { type: 'string', description: 'Short label for this direction' },
                visualSuggestions: {
                  type: 'object',
                  properties: {
                    physicalDescription: { type: 'string', description: 'How the deity/subject looks' },
                    artStyle: { type: 'string', description: 'Art direction for this concept' },
                    colorPalette: { type: 'string', description: 'Color palette for this concept' }
                  },
                  required: ['artStyle', 'colorPalette']
                }
              },
              required: ['title', 'deity', 'mood', 'theme', 'conceptDirection', 'visualSuggestions']
            }
          }
        },
        required: ['concepts']
      }
    }],
    tool_choice: { type: 'tool', name: 'generate_concepts' },
    messages: [{ role: 'user', content: prompt }]
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') throw new Error('No concepts generated');
  return { concepts: (toolBlock.input as any).concepts || [], prompt };
};

// ─── Script Planning (Stage 5) ──────────────────────────────────────

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
  input: ScriptInput & { lyrics: string; meaning: string; musicalStructure: string; basePacing: number; userNote?: string }
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string }> => {
  const client = getClient();
  const pacing = input.basePacing || 8;

  const prompt = `You are a music video director planning a ${input.videoMode} for a devotional song.

CONCEPT: ${input.concept.deity || 'Unknown'} — ${input.concept.theme}
Mood: ${input.concept.mood}
${input.concept.conceptDirection || ''}

LYRICS:
${input.lyrics}

MEANING: ${input.meaning}

MUSICAL STRUCTURE: ${input.musicalStructure}

CLIP LENGTH: All shots are fixed at ${pacing} seconds. You decide creative content, not duration.
${input.userNote ? `\nDIRECTOR NOTE (must follow): ${input.userNote}\n` : ''}
Plan the full music video using the plan_music_video tool.

CAST rules:
- Include the deity and key mythological figures by their proper names
- Description = physical appearance for image generation: face, skin tone, build, costume, ornaments, weapons/props. 2-3 sentences.
- Include cultural context: "{name}, the {role} from {tradition}" — e.g. "Kolasura, an asura king from Vaishnavite mythology"
- No art style in descriptions — just what the character looks like

ENVIRONMENT rules:
- Only 2-3 key locations that define the visual world
- Description = physical space: architecture, landscape, scale, lighting conditions, atmosphere. 2 sentences.
- Include cultural reference: "inspired by {source}" — e.g. "inspired by Chola-era temple architecture"
- No art style — just the place itself

SCENE rules:
- One scene per musical section
- narrativeDescription: what happens, 1-2 sentences
- Each shot: direction (5-10 word creative idea), castNames (from cast list), environmentName (from environment list)`;

  const response = await client.messages.create({
    model: SONNET,
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
                description: { type: 'string', description: 'Physical appearance + cultural identity for image generation. 2-3 sentences. Start with who they are in mythology. No art style.' }
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
                description: { type: 'string', description: 'Physical space + cultural reference. 2 sentences. No art style.' }
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
                narrativeDescription: { type: 'string', description: 'What happens in this scene. 1-2 sentences.' },
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

  return { ...data, prompt };
};

// ─── Write Shot Prompts (after all creative decisions locked) ───────

export const writeShotPrompts = async (
  shots: { id: string; direction: string; duration: number; castNames: string[]; sceneNarrative: string; sceneLyrics: string }[],
  context: { styleDNA: string; cast: { name: string; description: string }[]; concept: any; lyrics: string },
  previousBatchTail?: { id: string; visualPrompt: string; motionPrompt: string }[]
): Promise<{ id: string; visualPrompt: string; motionPrompt: string; continuityFrom: 'cut' | 'prev_shot' }[]> => {
  const client = getClient();

  const shotList = shots.map((s, i) =>
    `Shot ${i + 1} [${s.id}]: "${s.direction}" | ${s.duration}s | Cast: ${s.castNames.join(', ') || 'none'} | Scene: ${s.sceneNarrative} | Lyrics: ${s.sceneLyrics || 'instrumental'}`
  ).join('\n');

  const castList = context.cast.map(c => `${c.name}: ${c.description}`).join('\n');

  // If we have tail from previous batch, include as read-only context
  const tailContext = previousBatchTail?.length
    ? `\nPREVIOUS SHOTS (read-only context for continuity — do NOT rewrite these):\n${previousBatchTail.map(t => `[${t.id}]: visual: "${t.visualPrompt}" | motion: "${t.motionPrompt}"`).join('\n')}\n`
    : '';

  const prompt = `You are a cinematographer writing shot-by-shot prompts for a devotional music video.

STYLE DNA (for context, do NOT include in prompts):
${context.styleDNA}

CHARACTERS:
${castList}

CONCEPT: ${context.concept.deity || ''} — ${context.concept.theme}. Mood: ${context.concept.mood}.
${tailContext}
SHOTS:
${shotList}

For EACH shot, write using the write_shot_prompts tool:

- visualPrompt: What we SEE in the frame. 1-2 sentences.
  Include: composition, character physical details (from cast list), environment, action/pose.
  Reference characters by their mythological identity.
  Do NOT include art style, lighting, or color — the style system handles that.

- motionPrompt: How the camera and characters MOVE. 1 sentence.
  Example: "Slow dolly in as Mahalakshmi raises her abhaya mudra, lotus petals drift across frame"

- continuityFrom: How this shot relates to the one before it.
  - 'cut' = HARD CUT. This shot is visually independent — different angle/subject/framing/environment, or the first shot of a scene. Most shots should be 'cut'.
  - 'prev_shot' = CONTINUOUS. This shot visually flows from the previous one — same subject in same/adjacent framing, camera continuation, or an unbroken motion beat. Only mark 'prev_shot' when the cut is genuinely invisible.

  Use 'prev_shot' sparingly — music videos are mostly hard cuts. The first shot of a scene is ALWAYS 'cut'.

Match the IDs exactly.`;

  // Build tool schema with exact shot IDs
  const response = await client.messages.create({
    model: SONNET,
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
                motionPrompt: { type: 'string', description: 'Camera + character movement. 1 sentence.' },
                continuityFrom: { type: 'string', enum: ['cut', 'prev_shot'], description: "'cut' for hard cut (default, most shots), 'prev_shot' for continuous flow from previous shot" }
              },
              required: ['id', 'visualPrompt', 'motionPrompt', 'continuityFrom']
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

  const prompt = `You are a Director of Photography designing the visual language for an Indian devotional music video.

The audience is Indian. The imagery must feel culturally authentic, not generic fantasy.
These descriptions will be used as prompts for Gemini image generation.

SONG: ${concept.deity || 'Unknown'} — ${concept.theme || 'Unknown'}
Mood: ${concept.mood || 'Unknown'}
Language: ${concept.language || 'Unknown'}

LYRICS:
${(lyrics || '').substring(0, 3000)}

MUSICAL STRUCTURE:
${JSON.stringify((musicalStructure || []).slice(0, 8), null, 2)}

MEANING:
${(meaning || '').substring(0, 1500)}

${scriptSummary ? `SCRIPT OVERVIEW:\n${scriptSummary}` : ''}
${userNotes ? `USER DIRECTION: All 4 must be variations within this preference:\n${userNotes}` : ''}

Propose 4 distinct visual style directions using the propose_style_directions tool.

Each direction should feel like a different film — different DP, era, artistic movement.

For each: a title (2-5 words) and description (2 short punchy sentences, keyword-heavy).

Description covers ONLY transferable visual treatment: lighting, color palette, texture/medium, cultural references.
Do NOT describe characters, scenes, environments, or narrative.
These descriptions will be used as image generation prompts — be concrete, not literary.

QUALITY GUIDELINES for the image generation downstream:
- Avoid overly AI/CGI/fantasy look — should feel cinematic and grounded
- Avoid excessive intricate details that muddy the image — every element should have clear intention
- If stylized, it should be tasteful and deliberate, not generic digital art
- Think film stills, not concept art`;

  const response = await client.messages.create({
    model: OPUS,
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
                description: { type: 'string', description: '2 short punchy sentences, keyword-heavy. Cover: lighting, color palette, texture/medium, cultural references. No characters — purely visual STYLE.' }
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
    model: SONNET,
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

  const systemPrompt = `Analyze this locked style reference image.

The user chose it based on this direction: "${shortDescription}"

Write a STYLE DNA fragment — 30-50 words of dense keywords and short phrases. NOT prose. This fragment gets injected into every image generation prompt downstream, so it must be pure transferable visual treatment.

Format: keyword phrases separated by commas. Like an image generation prompt, not a paragraph.

Include: lighting type, color temperature, dominant palette colors, texture/medium, grain, mood keyword, artistic reference if clear.

Do NOT include: the subject/character, the scene/environment/architecture, narrative, composition, camera angle.

Example output:
warm amber chiaroscuro, deep burgundy-gold palette, oil painting texture, visible brushwork, film grain, sacred stillness, Caravaggio lighting, Tanjore gold leaf finish

Return ONLY the keywords. No quotes, no JSON, no markdown.`;

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: systemPrompt }
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
    model: SONNET,
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

// ─── Refine Shot Prompt (vision + rewrite) ──────────────────────────

/**
 * Claude sees the failed image, the current prompt, and the user's feedback,
 * then rewrites the visual prompt to fix the issues. Full rewrite, not append.
 */
export const refineShotPrompt = async (opts: {
  currentVisualPrompt: string;
  currentMotionPrompt: string;
  feedback: string;
  failedImageBase64: string;
  failedImageMime: string;
  styleDNA: string;
  characterDescriptions: string[];
}): Promise<{ visualPrompt: string; motionPrompt: string }> => {
  const client = getClient();

  const mediaType = opts.failedImageMime.startsWith('image/')
    ? opts.failedImageMime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    : 'image/png';

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 1024,
    tools: [{
      name: 'rewrite_shot_prompt',
      description: 'Rewrite the shot prompt to fix the issues identified in the feedback',
      input_schema: {
        type: 'object' as const,
        properties: {
          visualPrompt: { type: 'string', description: 'Rewritten visual prompt. 1-3 sentences. What we see in the frame.' },
          motionPrompt: { type: 'string', description: 'Motion prompt (adjust only if the feedback requires it, otherwise keep the original).' }
        },
        required: ['visualPrompt', 'motionPrompt']
      }
    }],
    tool_choice: { type: 'tool', name: 'rewrite_shot_prompt' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: opts.failedImageBase64 } },
        { type: 'text', text: `You are a cinematographer fixing a shot that didn't come out right.

THE IMAGE ABOVE is the failed attempt. Study it carefully.

CURRENT PROMPT (what produced this image):
Visual: ${opts.currentVisualPrompt}
Motion: ${opts.currentMotionPrompt}

DIRECTOR FEEDBACK (what's wrong):
${opts.feedback}

STYLE DNA: ${opts.styleDNA}

CHARACTERS IN SCENE:
${opts.characterDescriptions.join('\n') || 'None specified'}

REWRITE the visual prompt to fix the issues. Techniques to consider:
- Face not crisp → specify "sharp facial detail, close-up framing" or "medium close-up"
- Lighting too flat → specify lighting direction: "strong rim light from behind", "warm key light from left"
- Wrong composition → specify camera: "low angle looking up", "bird's eye view", "tight close-up"
- Style drift → reinforce the style DNA terms explicitly
- Character doesn't match → add specific physical details from the character description
- Too AI/generic → add grounding details: specific textures, materials, atmospheric effects

Do NOT just append the feedback. REWRITE the prompt from scratch, keeping what worked and fixing what didn't. Keep it 1-3 sentences — direct and visual.

Only change the motion prompt if the feedback specifically mentions movement or camera motion.` }
      ]
    }]
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('Claude did not return rewritten prompt');
  }

  return toolBlock.input as { visualPrompt: string; motionPrompt: string };
};

