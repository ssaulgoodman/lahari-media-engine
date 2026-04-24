/**
 * Claude text service — handles structured text + vision tasks.
 * Uses tool_use for guaranteed valid JSON output (no truncation, no schema violations).
 *
 * Opus: generateConceptOptions, brainstormStyleDirections, planScenes, writeShotPrompts, refineScript
 * Sonnet: summarizeMeaning, refineStyleDirection, analyzeImageStyle, refineFramePrompt, refineMotionPrompt, refreshChainedShotPrompt
 * Gemini still handles: audio analysis (transcribe, structure), image critique (vision), chat
 */
import Anthropic from '@anthropic-ai/sdk';

const getClient = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Model choices
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';

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
  userNote?: string,
  /** If provided, generates ONE concept matching the director's vision instead of 3 preset directions. */
  directorBrief?: string,
  /** Gemini's classification: chant, stotra, bhajan, kirtan, film-song, narrative, unknown. */
  songType?: string,
  isNarrative?: boolean,
  isMeditative?: boolean,
): Promise<{ concepts: any[]; prompt: string }> => {
  const client = getClient();

  const typeLabel = songType && songType !== 'unknown' ? songType : null;
  const traits = [
    isNarrative ? 'narrative (has dramatic arc)' : null,
    isMeditative ? 'meditative (contemplative, inward)' : null,
  ].filter(Boolean);
  const songTypeSignal = typeLabel || traits.length
    ? `SONG TYPE (from audio analysis): ${[typeLabel, ...traits].filter(Boolean).join(', ')}`
    : '';

  const structureSummary = (musicalStructure || []).slice(0, 8).map((s: any) =>
    `${s.label || 'Section'} [${s.startTime}–${s.endTime}]${s.energyLevel ? ` (${s.energyLevel})` : ''}${s.description ? `: ${s.description}` : ''}`
  ).join('\n');

  const songContext = `SONG: ${title} (${language})
${context ? `CONTEXT: ${context}` : ''}
${songTypeSignal}
${structureSummary ? `\nMUSICAL STRUCTURE:\n${structureSummary}` : ''}

LYRICS:
${(lyrics || '').substring(0, 4000)}

MEANING:
${meaning}`;

  let prompt: string;

  if (directorBrief) {
    // Path B: Director has a specific vision — generate ONE concept that realizes it
    prompt = `You are a visionary film director specializing in Indian mythological and devotional cinema.

${songContext}

DIRECTOR'S BRIEF:
${directorBrief}
${userNote ? `\nADDITIONAL NOTE: ${userNote}\n` : ''}
Generate EXACTLY 1 concept that realizes the director's vision. Flesh out their idea into a complete concept — don't override their intent, expand on it. Fill in all structured fields so the production pipeline can work with it.

Use the generate_concepts tool. Return EXACTLY 1 concept in the array.`;
  } else {
    prompt = `You are a visionary film director specializing in Indian mythological and devotional cinema.

${songContext}
${userNote ? `\nDIRECTOR NOTE (must follow): ${userNote}\n` : ''}
Generate EXACTLY 3 creative directions for a music video. Each should offer a genuinely different visual approach, but all must respect the song's nature — read the SONG TYPE and MEANING carefully.

For each direction provide:
- title: 2-4 word creative title
- deity: the primary divine figure
- mood: one distinct emotional keyword (different per direction)
- theme: the core narrative idea (1 sentence)
- conceptDirection: a short creative label for this direction (e.g. "intimate darshan", "cosmic invocation", "earthen ritual" — NOT generic labels like "traditional" or "modern")
- description: 2-3 sentences expanding the concept — what the viewer sees, the emotional arc, the world of this video

Visual style is decided in a separate phase — do NOT include art style, color palette, or cinematography here. Focus purely on narrative direction and concept.

Use the generate_concepts tool. Return EXACTLY 3 concepts.`;
  }

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
                conceptDirection: { type: 'string', description: 'Short creative label (e.g. "intimate darshan", "cosmic invocation")' },
                description: { type: 'string', description: '2-3 sentence expansion of the concept — what the viewer sees, the emotional arc' },
              },
              required: ['title', 'deity', 'mood', 'theme', 'conceptDirection', 'description']
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

// ─── Refine Locked Concept ─────────────────────────────────────────

export const refineConceptDirection = async (
  currentConcept: any,
  feedback: string
): Promise<any> => {
  const client = getClient();

  const prompt = `You are a visionary film director specializing in Indian mythological and devotional cinema.

CURRENT LOCKED CONCEPT:
- Title: ${currentConcept.title || ''}
- Deity: ${currentConcept.deity || ''}
- Mood: ${currentConcept.mood || ''}
- Theme: ${currentConcept.theme || ''}
- Direction: ${currentConcept.conceptDirection || ''}

DIRECTOR FEEDBACK:
${feedback}

Revise the concept incorporating the feedback. Keep the core identity intact — this is a refinement, not a replacement. Update only the fields that the feedback touches. If the feedback says "darker mood" just update mood, don't rewrite everything.

Visual style is decided in a separate phase — do NOT include art style or color palette.

Use the refine_concept tool.`;

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 1024,
    tools: [{
      name: 'refine_concept',
      description: 'Return the refined concept with all fields',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' },
          deity: { type: 'string' },
          mood: { type: 'string' },
          theme: { type: 'string' },
          conceptDirection: { type: 'string' },
          visualSuggestions: {
            type: 'object',
            properties: {
              physicalDescription: { type: 'string' },
              artStyle: { type: 'string' },
              colorPalette: { type: 'string' }
            },
            required: ['artStyle', 'colorPalette']
          }
        },
        required: ['title', 'deity', 'mood', 'theme', 'conceptDirection', 'visualSuggestions']
      }
    }],
    tool_choice: { type: 'tool', name: 'refine_concept' },
    messages: [{ role: 'user', content: prompt }]
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') throw new Error('Concept refinement failed');
  return toolBlock.input;
};

// ─── Script Planning (Stage 5) ──────────────────────────────────────

// Shared tool schema for planScenes + refineScript
const SCRIPT_TOOL = {
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
              description: 'Individual shots — one per clip slot.',
              items: {
                type: 'object',
                properties: {
                  direction: { type: 'string', description: '5-10 word creative idea' },
                  castNames: { type: 'array', items: { type: 'string' }, description: 'Names of cast members in this shot' },
                  environmentName: { type: 'string', description: 'Environment name (must match from environments list)' }
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
};

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
  input: ScriptInput & { lyrics: string; meaning: string; musicalStructure: string; basePacing: number; minShotDuration?: number; userNote?: string; songType?: string; isNarrative?: boolean; isMeditative?: boolean }
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string }> => {
  const client = getClient();
  const pacing = input.basePacing || 8;
  const minDuration = input.minShotDuration || 4;

  // Song type signal
  const typeLabel = input.songType && input.songType !== 'unknown' ? input.songType : null;
  const traits = [
    input.isNarrative ? 'narrative' : null,
    input.isMeditative ? 'meditative' : null,
  ].filter(Boolean);
  const songTypeSignal = typeLabel || traits.length
    ? `SONG TYPE: ${[typeLabel, ...traits].filter(Boolean).join(', ')}`
    : '';

  const modeGuidance = input.videoMode === 'cinematic'
    ? `DIRECTOR STYLE: Cinematic — fewer, more sustained moments. Stronger continuity between shots, deeper immersion. Each scene builds and breathes.`
    : `DIRECTOR STYLE: Montage — rhythmic, many discrete moments. Broader coverage of the emotional and spiritual world. Each shot is its own beat.`;

  const prompt = `You are a music video director. Your job is to plan the STRUCTURE — cast, locations, scenes, and what happens in each shot. A cinematographer will later decide framing and camera work, so focus on WHAT HAPPENS, not how the camera moves.

${modeGuidance}
${songTypeSignal}

CONCEPT: ${input.concept.deity || 'Unknown'} — ${input.concept.theme}
Mood: ${input.concept.mood}
${input.concept.conceptDirection || ''}

LYRICS:
${input.lyrics}

MEANING: ${input.meaning}

MUSICAL STRUCTURE: ${input.musicalStructure}

═══ PACING RULES (CRITICAL — think through this before writing) ═══
Base shot length: ${pacing} seconds.
For each scene: number_of_shots = ceil(scene_duration / ${pacing})
Every shot is ${pacing}s except the LAST shot which gets the remainder.

Example: 21s scene at ${pacing}s → ceil(21/${pacing}) = ${Math.ceil(21 / pacing)} shots (${Array.from({length: Math.ceil(21 / pacing)}, (_, i) => i === Math.ceil(21 / pacing) - 1 ? `${21 - (Math.ceil(21 / pacing) - 1) * pacing}s` : `${pacing}s`).join(' + ')}).

Video model minimum clip length: ${minDuration}s. Shots shorter than this get padded — don't adjust shot count to avoid it.

BEFORE writing shots for each scene, calculate its duration and shot count. Write EXACTLY that many shots.
═══════════════════════════════════════════════════════════════════
${input.userNote ? `\nDIRECTOR NOTE (must follow): ${input.userNote}\n` : ''}
Plan the full music video using the plan_music_video tool.

CAST rules:
- Include the deity and key figures by their proper names
- Description = REUSABLE physical identity: face, skin tone, build, costume, ornaments, crown/headpiece, jewelry. 2-3 sentences.
- Do NOT include actions, props in hands, or scene-specific details — this generates a neutral reference portrait reused across shots
- Include cultural context: "{name}, the {role} from {tradition}"
- No art style — just what the character looks like

ENVIRONMENT rules:
- Only 2-3 key locations that define the visual world
- Description = physical space: architecture, landscape, scale, lighting, atmosphere. 2 sentences.
- Include cultural reference: "inspired by {source}"
- No art style — just the place itself

SCENE rules:
- One scene per musical section — follow the musical structure timestamps exactly
- narrativeDescription: what happens in this scene, 1-2 sentences
- Each shot needs a direction: WHAT HAPPENS in this moment (the narrative beat, the action, the emotional shift). NOT camera directions — those come later.
  Good: "Ganesha receives the offering, his expression softens"
  Good: "Devotee prostrates before the idol, hands trembling"
  Good: "Each sacred name reveals a different facet of Ganesha's presence in the temple space"
  Good: "The devotee's offering becomes the bridge between human longing and divine grace"
  Bad: "Slow dolly in on Ganesha" (that's camera work, not direction)
  Bad: "Wide establishing shot of temple" (that's framing, not action)
${input.isMeditative ? '\n- For meditative/devotional pieces: prefer revelation, invocation, darshan, ritual progression, symbolic manifestation, and contemplative presence over plot twists or problem-solution arcs.' : ''}
- Avoid mechanical alternation between two visual worlds unless the song truly demands it. Let some beats bridge the human and divine, or move from one into the other.
- Not every sacred name or attribute needs a literal illustration. Some should be felt through atmosphere, ritual action, emotional change, silence, or presence.
- Avoid generic mystical spectacle by default: floating symbols, cosmic particles, glowing script, abstract energy fields. Use overt visual effects only when they feel earned by the song.
- Build progression across the scene: invocation -> deepening presence -> surrender. Each shot should advance the same spiritual movement, not just restate it in a new image.

IMPORTANT — character and environment assignment:
- Every shot MUST have an environmentName from the environment list
- Every character who appears in a shot MUST be listed in castNames
- Do NOT skip character/environment assignment`;

  console.log(`[planScenes] Extended thinking + validation loop (pacing=${pacing}s)`);

  // ═══ CALL 1: Extended thinking — Claude reasons through pacing math then outputs ═══
  let messages: any[] = [{ role: 'user', content: prompt }];
  let data: { cast: any[]; environments: any[]; scenes: any[] } | null = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await client.messages.create({
      model: OPUS,
      max_tokens: 16384,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' } as any,
      tools: [SCRIPT_TOOL],
      messages,
    });

    const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('Claude did not return tool_use response');
    }

    const candidate = toolBlock.input as { cast: any[]; environments: any[]; scenes: any[] };
    if (!candidate.environments) candidate.environments = [];

    // ═══ VALIDATE: Check shot counts fit scene durations ═══
    const errors: string[] = [];
    for (const scene of candidate.scenes) {
      const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
      if (sceneDuration <= 0) continue;
      const expectedShots = Math.max(1, Math.ceil(sceneDuration / pacing));
      if ((scene.shots?.length || 0) !== expectedShots) {
        errors.push(`Scene "${scene.sectionLabel}" (${scene.startTime}–${scene.endTime}, ${sceneDuration}s): you wrote ${scene.shots.length} shots but ceil(${sceneDuration}/${pacing}) = ${expectedShots} shots expected.`);
      }
      if ((scene.shots?.length || 0) === 0) {
        errors.push(`Scene "${scene.sectionLabel}" has no shots.`);
      }
    }

    if (errors.length === 0) {
      data = candidate;
      console.log(`[planScenes] Validation passed on attempt ${attempt}`);
      break;
    }

    console.warn(`[planScenes] Attempt ${attempt} failed validation: ${errors.join('; ')}`);

    if (attempt >= maxAttempts) {
      console.error(`[planScenes] Failed validation after ${maxAttempts} attempts: ${errors.join('; ')}`);
      throw new Error(`Script generation failed — shot counts don't fit scene durations after ${maxAttempts} attempts. Try regenerating or adjust pacing.`);
    }

    // ═══ RETRY: Send validation errors back in the same conversation ═══
    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: toolBlock.id, content: `VALIDATION FAILED. Fix these issues and resubmit:\n\n${errors.join('\n')}\n\nRemember: shots per scene = ceil(scene_duration / ${pacing}). Recount and fix.` }
      ] },
    ];
  }

  if (!data) throw new Error('Script generation failed after all attempts');

  // ═══ Assign deterministic durations ═══
  for (const scene of data.scenes) {
    const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
    if (sceneDuration <= 0 || !scene.shots?.length) continue;
    const shotCount = scene.shots.length;
    for (let i = 0; i < shotCount; i++) {
      if (i < shotCount - 1) {
        scene.shots[i].duration = pacing;
      } else {
        const usedTime = (shotCount - 1) * pacing;
        scene.shots[i].duration = Math.max(1, sceneDuration - usedTime);
      }
    }
  }

  return { ...data, prompt };
};

// ─── Refine Script (surgical edit based on feedback) ──────────────

export const refineScript = async (
  currentScript: { cast: any[]; environments: any[]; scenes: any[] },
  feedback: string,
  context: { concept: any; videoMode: string; lyrics: string; meaning: string; musicalStructure: string; basePacing: number; minShotDuration?: number }
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string }> => {
  const client = getClient();
  const pacing = context.basePacing || 8;
  const minDuration = context.minShotDuration || 4;

  const currentJson = JSON.stringify({
    cast: currentScript.cast.map((c: any) => ({ name: c.name, description: c.description })),
    environments: currentScript.environments.map((e: any) => ({ name: e.name, description: e.description })),
    scenes: currentScript.scenes.map((s: any) => ({
      sectionLabel: s.sectionLabel || s.section_label,
      startTime: s.startTime || s.start_time,
      endTime: s.endTime || s.end_time,
      narrativeDescription: s.narrativeDescription || s.narrative_description,
      shots: (s.shots || []).map((sh: any) => ({
        direction: sh.direction || sh.visual_prompt || '',
        castNames: sh.castNames || sh.cast_names || [],
        environmentName: sh.environmentName || sh.environment_name || '',
      }))
    }))
  }, null, 2);

  const prompt = `You are a visionary music video director specializing in Indian mythological and devotional cinema. You are refining an existing script based on the director's feedback.

CONCEPT: ${context.concept.deity || 'Unknown'} — ${context.concept.theme}
Mood: ${context.concept.mood}
${context.concept.conceptDirection || ''}

LYRICS:
${context.lyrics}

MEANING: ${context.meaning}

MUSICAL STRUCTURE: ${context.musicalStructure}

SHOT BUDGET: Every shot = ${pacing} seconds. Shots per scene = ceil(scene_duration / ${pacing}). Last shot gets the remainder. This is a HARD CONSTRAINT — write EXACTLY ceil(duration/${pacing}) shots per scene.
Video model minimum clip length: ${minDuration}s. Shots shorter than this will be generated at ${minDuration}s and trimmed in the render timeline — this is fine, don't adjust your shot count to avoid it.

═══════════════════════════════════════
CURRENT SCRIPT (your starting point):
═══════════════════════════════════════
${currentJson}

═══════════════════════════════════════
DIRECTOR'S FEEDBACK:
═══════════════════════════════════════
${feedback}

═══════════════════════════════════════

Your job is SURGICAL REFINEMENT, not rewriting from scratch. Think of yourself as an editor, not a new writer.

REFINEMENT PRINCIPLES:
1. PRESERVE what works. If the director says "fix scene 4", scenes 1-3 and 5+ must come back IDENTICAL — same narratives, same shots, same cast assignments, same environments.
2. SCOPE your changes to what the feedback asks for. "More intimate in scene 4" means rethink scene 4's shots — don't touch the cast list or environments unless the feedback requires it.
3. RESPECT the existing cast and environments. These may already have locked reference images. Do NOT rename characters or environments — their names are IDs in the system. You may add new ones if the feedback requires new characters or locations.
4. MAINTAIN musical structure. Section labels and timestamps are fixed — they come from the audio analysis. Do not change them.
5. Every shot MUST have castNames (characters visible) and environmentName (location). This is critical — the video model uses these to send reference images for consistency.

CAST rules (same as original script):
- Description = physical appearance for image generation. 2-3 sentences.
- Include cultural context: "{name}, the {role} from {tradition}"
- No art style in descriptions

ENVIRONMENT rules:
- Description = physical space. 2 sentences. Cultural reference.
- No art style

Return the COMPLETE updated script using the plan_music_video tool — all scenes, not just the changed ones. The system replaces the old script entirely with your output.`;

  console.log(`[refineScript] Extended thinking + validation loop (pacing=${pacing}s)`);

  let messages: any[] = [{ role: 'user', content: prompt }];
  let data: { cast: any[]; environments: any[]; scenes: any[] } | null = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await client.messages.create({
      model: OPUS,
      max_tokens: 16384,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' } as any,
      tools: [SCRIPT_TOOL],
      messages,
    });

    const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('Claude did not return tool_use response');
    }

    const candidate = toolBlock.input as { cast: any[]; environments: any[]; scenes: any[] };
    if (!candidate.environments) candidate.environments = [];

    // Validate shot counts
    const errors: string[] = [];
    for (const scene of candidate.scenes) {
      const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
      if (sceneDuration <= 0) continue;
      const expectedShots = Math.max(1, Math.ceil(sceneDuration / pacing));
      if ((scene.shots?.length || 0) !== expectedShots) {
        errors.push(`Scene "${scene.sectionLabel}" (${sceneDuration}s): ${scene.shots.length} shots but ceil(${sceneDuration}/${pacing}) = ${expectedShots} expected.`);
      }
    }

    if (errors.length === 0) {
      data = candidate;
      console.log(`[refineScript] Validation passed on attempt ${attempt}`);
      break;
    }

    console.warn(`[refineScript] Attempt ${attempt} failed: ${errors.join('; ')}`);

    if (attempt >= maxAttempts) {
      console.error(`[refineScript] Failed after ${maxAttempts} attempts: ${errors.join('; ')}`);
      throw new Error(`Script refinement failed — shot counts don't fit scene durations after ${maxAttempts} attempts. Try again.`);
    }

    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: toolBlock.id, content: `VALIDATION FAILED:\n${errors.join('\n')}\n\nShots per scene = ceil(scene_duration / ${pacing}). Fix and resubmit.` }
      ] },
    ];
  }

  if (!data) throw new Error('Script refinement failed');

  // Assign durations
  for (const scene of data.scenes) {
    const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
    if (sceneDuration <= 0 || !scene.shots?.length) continue;
    const shotCount = scene.shots.length;
    for (let i = 0; i < shotCount; i++) {
      if (i < shotCount - 1) {
        scene.shots[i].duration = pacing;
      } else {
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
  context: { cast: { name: string; description: string }[]; concept: any; userNote?: string; songType?: string; isNarrative?: boolean; isMeditative?: boolean },
  previousBatchTail?: { id: string; visualPrompt: string; motionPrompt: string }[]
): Promise<{ shots: { id: string; visualPrompt: string; motionPrompt: string; continuityFrom: 'cut' | 'prev_shot' }[]; prompt: string }> => {
  const client = getClient();

  const shotList = shots.map((s, i) =>
    `Shot ${i + 1} [${s.id}]: "${s.direction}" | ${s.duration}s | Cast: ${s.castNames.join(', ') || 'none'} | Scene: ${s.sceneNarrative} | Lyrics: ${s.sceneLyrics || 'instrumental'}`
  ).join('\n');

  const castList = context.cast.map(c => `${c.name}: ${c.description}`).join('\n');

  const tailContext = previousBatchTail?.length
    ? `\nPREVIOUS SHOTS (read-only context for continuity — do NOT rewrite these):\n${previousBatchTail.map(t => `[${t.id}]: visual: "${t.visualPrompt}" | motion: "${t.motionPrompt}"`).join('\n')}\n`
    : '';

  const userNoteBlock = context.userNote
    ? `\nUSER DIRECTION (apply to this rewrite): ${context.userNote}\n`
    : '';

  // Song type signal
  const typeLabel = context.songType && context.songType !== 'unknown' ? context.songType : null;
  const traits = [
    context.isNarrative ? 'narrative' : null,
    context.isMeditative ? 'meditative' : null,
  ].filter(Boolean);
  const songTypeSignal = typeLabel || traits.length
    ? `SONG TYPE: ${[typeLabel, ...traits].filter(Boolean).join(', ')}`
    : '';

  const meditativeGuidance = context.isMeditative ? `
MEDITATIVE CINEMATOGRAPHY:
- Favor stillness, patience, and negative space. Let the frame breathe.
- Resist the urge to fill every shot with spectacle. A still face, a trembling hand, a single flame can carry more weight than divine radiance.
- Show sacred presence through atmosphere and reaction, not only through literal divine manifestation.
- When the divine appears, keep it grounded — earned through the devotee's state, not inserted as a visual effect.` : '';

  const prompt = `You are a cinematographer. The director planned what happens in each shot — you decide how it looks on screen and how it moves. Your outputs go directly to an image model (visualPrompt) and a video model (motionPrompt).

WRITE CINEMATIC PROMPTS THAT ARE RENDERABLE.

These prompts are for image and video models, so every sentence must describe something visible or animateable. Do not write poetry, metaphor, or inner emotion directly. Avoid phrases like "seems to", "as if", or invisible causes such as grace, breath, presence, warmth, or devotion. Describe the visible effect directly.

But do not become schematic. Avoid layout jargon like "left half", "right half", "split-focus", or "perfect symmetry" unless the shot truly depends on that exact arrangement.

Translate emotion into physical evidence:
- a still face
- a hand tightening
- a flame settling
- moisture on stone
- a body lowering into prostration
- distance between two figures

EXAMPLES — the boundary between renderable and not:

GOOD visualPrompt:
"Medium side shot: the devotee sits cross-legged before the stone murti, placing a brass lamp on the floor between them. The murti is mostly in shadow, with only the lower belly and trunk catching the lamplight."

GOOD visualPrompt:
"Low wide shot from the shrine floor: the devotee lies in full prostration in the foreground, forehead touching stone, while the Ganesha murti rises behind him in stillness. The brass lamp burns between them."

GOOD motionPrompt:
"Static hold as the devotee lowers his forehead to the floor; only the lamp flame moves."

GOOD motionPrompt:
"Slow push-in toward the murti's cheek as a bead of moisture begins to slide down the carved stone."

BAD visualPrompt:
"The devotee surrenders his ego before the timeless grace of the divine." — emotional interpretation, not renderable.

BAD visualPrompt:
"A symmetrical split-focus composition with the devotee on the left third and the murti on the right third." — schematic layout jargon unless the shot truly needs it.

BAD motionPrompt:
"The camera slowly dollies in to heighten the sacred atmosphere." — generic movement and non-visual rationale.

BAD motionPrompt:
"Golden divine energy fills the sanctum as cosmic particles swirl around Ganesha." — mystical VFX not grounded in the shot direction.

${songTypeSignal}
Mood: ${context.concept.mood || 'Cinematic'}

CHARACTERS:
${castList}
${userNoteBlock}${tailContext}
SHOTS TO WRITE:
${shotList}
${meditativeGuidance}
For EACH shot, write using the write_shot_prompts tool:

- visualPrompt: The start frame. Brief but complete: camera position, shot scale, subject placement, spatial relationship, location, and one key visible detail. The model already has character/environment/style reference IMAGES — do not describe art style or color palette. Do allow functional lighting when it defines the frame ("lamplight catches the carved cheek", "the face emerges from shadow"). Preserve the shot's real geography. Do not invent corridors, arches, rooms, props, or layouts not implied by the shot direction or environment.
  ONLY include characters listed in that shot's Cast field.

- motionPrompt: One sentence. The video model already SEES the start frame. Say only what changes: character action, camera movement, or environmental motion. Name the camera verb when it moves (push-in, pan, tracking, pull-back). Prefer the simplest truthful motion. A static hold is valid when the beat is carried by stillness.

- continuityFrom: 'cut' or 'prev_shot'.
  Use 'prev_shot' when this shot directly intensifies, reveals, or sustains the previous shot's final moment — a gaze becoming a close-up, stillness cracking into recognition, a slow reveal continuing across an edit point.
  Use 'cut' when the shot begins a new beat, scale, angle, or emotional step.
  The first shot of a scene is ALWAYS 'cut'.

BEFORE RETURNING, CHECK THE SEQUENCE:
- No invented geography (corridors, archways, courtyards not in the direction)
- No repeated camera verb across consecutive shots
- No schematic composition shortcuts unless truly necessary (symmetrical two-shot, split-focus, left-third/right-third)
- No mystical VFX unless explicitly described in the shot direction
- At least consider 'prev_shot' for direct intensifications — don't default to all cuts
- Every shot must advance the devotional arc, not just restate the previous beat

Match the IDs exactly.`;

  // Build tool schema with exact shot IDs
  const response = await client.messages.create({
    model: OPUS,
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
                visualPrompt: { type: 'string', description: 'Start frame for image model. 1-2 sentences. Composition + character pose + environment.' },
                motionPrompt: { type: 'string', description: 'Video instruction for video model. 1-2 sentences. What happens during the shot — action, camera, change.' },
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

  return { shots: (toolBlock.input as any).shots, prompt };
};

// ─── Style Brainstorming (text-only, no images) ─────────────────────

export const brainstormStyleDirections = async (
  lyrics: string,
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
// ─── Refine Frame Prompt (first frame or end frame) ──────────────────
//
// The image model generated a bad frame. The director says what's wrong.
// Claude rewrites the prompt so the next generation fixes it.

export const refineFramePrompt = async (opts: {
  currentPrompt: string;
  feedback: string;
  failedImageBase64?: string;
  failedImageMime?: string;
  referenceImageBase64?: string;
  referenceImageMime?: string;
}): Promise<{ visualPrompt: string }> => {
  const client = getClient();
  const contentBlocks: any[] = [];

  // Failed image — what went wrong
  const hasFailedImage = opts.failedImageBase64 && opts.failedImageBase64.length > 100;
  if (hasFailedImage) {
    const mediaType = (opts.failedImageMime?.startsWith('image/') ? opts.failedImageMime : 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: opts.failedImageBase64 } });
  }

  // Director's reference image
  if (opts.referenceImageBase64 && opts.referenceImageMime) {
    const refMediaType = (opts.referenceImageMime.startsWith('image/') ? opts.referenceImageMime : 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: refMediaType, data: opts.referenceImageBase64 } });
  }

  const imageNote = hasFailedImage
    ? `Image 1: the result from the current prompt.${opts.referenceImageBase64 ? '\nImage 2: director\'s reference — incorporate what they want from this.' : ''}`
    : opts.referenceImageBase64 ? 'Image 1: director\'s reference — incorporate what they want from this.' : '';

  contentBlocks.push({
    type: 'text', text: `WHAT THE DIRECTOR WANTS CHANGED:
${opts.feedback}
${imageNote ? `\n${imageNote}` : ''}
CURRENT PROMPT:
${opts.currentPrompt}

Apply the director's feedback to the current prompt. Keep what works, change what they asked for. 1-3 sentences. This prompt goes to an image model — just describe what should be in the frame.`
  });

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 1024,
    tools: [{
      name: 'rewrite_frame_prompt',
      description: 'Apply director feedback to the frame prompt',
      input_schema: {
        type: 'object' as const,
        properties: {
          visualPrompt: { type: 'string', description: 'Rewritten prompt. 1-3 sentences.' },
        },
        required: ['visualPrompt']
      }
    }],
    tool_choice: { type: 'tool', name: 'rewrite_frame_prompt' },
    messages: [{ role: 'user', content: contentBlocks }]
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') throw new Error('Claude did not return rewritten prompt');
  return toolBlock.input as { visualPrompt: string };
};

// ─── Refine Video Prompt (motion/action) ──────────────────────────────
//
// The director wants to change what happens during the shot.
// Claude rewrites the motion prompt — the instruction sent to Veo
// alongside the start frame image.

export const refineMotionPrompt = async (opts: {
  currentMotionPrompt: string;
  shotVisualPrompt: string;
  feedback: string;
  startFrameBase64?: string;
  startFrameMime?: string;
  endFrameBase64?: string;
  endFrameMime?: string;
  referenceImageBase64?: string;
  referenceImageMime?: string;
}): Promise<{ motionPrompt: string }> => {
  const client = getClient();
  const contentBlocks: any[] = [];
  const imageLabels: string[] = [];

  // Start frame — what Veo animates from
  if (opts.startFrameBase64 && opts.startFrameBase64.length > 100) {
    const mediaType = (opts.startFrameMime?.startsWith('image/') ? opts.startFrameMime : 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: opts.startFrameBase64 } });
    imageLabels.push('Start frame — the video animates from this');
  }

  // End frame — where the shot lands
  if (opts.endFrameBase64 && opts.endFrameMime) {
    const mediaType = (opts.endFrameMime.startsWith('image/') ? opts.endFrameMime : 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: opts.endFrameBase64 } });
    imageLabels.push('End frame — where the shot should land');
  }

  // Director's reference
  if (opts.referenceImageBase64 && opts.referenceImageMime) {
    const mediaType = (opts.referenceImageMime.startsWith('image/') ? opts.referenceImageMime : 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: opts.referenceImageBase64 } });
    imageLabels.push('Director\'s reference');
  }

  const imageNote = imageLabels.length > 0
    ? imageLabels.map((l, i) => `Image ${i + 1}: ${l}`).join('\n')
    : '';

  contentBlocks.push({
    type: 'text', text: `WHAT THE DIRECTOR WANTS CHANGED:
${opts.feedback}
${imageNote ? `\n${imageNote}` : ''}
WHAT HAPPENS IN THIS SHOT:
${opts.shotVisualPrompt}

CURRENT MOTION PROMPT:
${opts.currentMotionPrompt}

Apply the director's feedback to the motion prompt. This prompt goes to a video model alongside the start frame — it tells the model what to animate. 1-2 sentences, action + camera.`
  });

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 1024,
    tools: [{
      name: 'rewrite_motion_prompt',
      description: 'Apply director feedback to the motion prompt',
      input_schema: {
        type: 'object' as const,
        properties: {
          motionPrompt: { type: 'string', description: 'Rewritten motion prompt. 1-2 sentences. Action + camera.' },
        },
        required: ['motionPrompt']
      }
    }],
    tool_choice: { type: 'tool', name: 'rewrite_motion_prompt' },
    messages: [{ role: 'user', content: contentBlocks }]
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') throw new Error('Claude did not return rewritten prompt');
  return toolBlock.input as { motionPrompt: string };
};

// ─── Refresh Chained Shot Prompt from Prev Frame (vision) ────────────

/**
 * When a prev_shot's video lands, Claude sees the actual last frame and
 * rewrites the next shot's visual + motion prompts so the continuity is
 * grounded in what really happened on screen — not the blind draft from
 * write-shot-prompts. One call, no separate describe step.
 */
export const refreshChainedShotPrompt = async (opts: {
  prevFrameBase64: string;
  prevFrameMime: string;
  shotDirection: string;
  currentVisualPrompt: string;
  currentMotionPrompt: string;
  characterNames: string[];
  environmentName?: string;
}): Promise<{ visualPrompt: string; motionPrompt: string }> => {
  const client = getClient();
  const mediaType = opts.prevFrameMime.startsWith('image/')
    ? opts.prevFrameMime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    : 'image/png';

  const castNote = opts.characterNames.length ? `\nCharacters: ${opts.characterNames.join(', ')}` : '';
  const envNote = opts.environmentName ? `\nEnvironment: ${opts.environmentName}` : '';
  const directionNote = opts.shotDirection ? `\nSHOT INTENT: ${opts.shotDirection}` : '';

  const response = await client.messages.create({
    model: SONNET,
    max_tokens: 1024,
    tools: [{
      name: 'rewrite_chained_shot',
      description: 'Rewrite the next shot\'s prompts so it flows from the previous frame while honoring the shot intent.',
      input_schema: {
        type: 'object' as const,
        properties: {
          visualPrompt: { type: 'string', description: 'Start-frame prompt. 1-3 sentences. Must flow from the frame shown.' },
          motionPrompt: { type: 'string', description: 'Video instruction. 1-2 sentences. Action + camera from the frame shown.' }
        },
        required: ['visualPrompt', 'motionPrompt']
      }
    }],
    tool_choice: { type: 'tool', name: 'rewrite_chained_shot' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: opts.prevFrameBase64 } },
        { type: 'text', text: `The image is the last frame of the previous shot.

The next shot was drafted before this frame existed. Rewrite its prompts so they flow from what actually happened while honoring the shot's intent.
${directionNote}
DRAFT PROMPTS (rewrite these):
Visual: ${opts.currentVisualPrompt}
Motion: ${opts.currentMotionPrompt}
${castNote}${envNote}

Keep the shot intent. Rewrite so the first moment matches the frame — same characters, same state, natural continuation. Visual: 1-3 sentences. Motion: 1-2 sentences.` }
      ]
    }]
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('Claude did not return refreshed chained prompt');
  }
  return toolBlock.input as { visualPrompt: string; motionPrompt: string };
};
