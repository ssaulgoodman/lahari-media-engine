/**
 * Claude text service — handles structured text + vision tasks.
 * Uses tool_use for guaranteed valid JSON output (no truncation, no schema violations).
 *
 * Opus: generateConceptOptions, brainstormStyleDirections, planScenes, writeShotPrompts, refineScript
 * Sonnet: summarizeMeaning, refineStyleDirection, analyzeImageStyle, refineFramePrompt, refineMotionPrompt, refreshChainedShotPrompt
 * Gemini still handles: audio analysis (transcribe, structure), image critique (vision), chat
 */
import Anthropic from '@anthropic-ai/sdk';
import { generateText } from './text-provider.js';
import {
  validateScriptStructure,
  buildCorrectivePrompt,
  assignDeterministicDurations,
  parseTimestamp as parseScriptTimestamp,
} from './script-validation.js';

const getClient = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Model choices — used by the consumers that stay on Claude direct (script
// writer's planScenes / refineScript / writeShotPrompts). Everything else
// routes through generateText() which picks the model from project.text_provider.
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';

// ─── Meaning Summary (Stage 3) ──────────────────────────────────────

export const summarizeMeaning = async (
  title: string,
  language: string,
  lyrics: string,
  context?: string,
  textProvider?: string,
): Promise<string> => {
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

  // Routed through generateText so the project's text provider picks the
  // model. useRefineModel: true → cheap sibling per provider (Sonnet 4.6 on
  // Claude, gpt-5.5 on OpenAI, gemini-3.1-flash on Gemini). Meaning summary
  // is a small analytical task; no need for the primary tier.
  const { text } = await generateText(textProvider, {
    userPrompt: prompt,
    maxTokens: 1024,
    useRefineModel: true,
  });
  return text;
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
  /** Project's text provider — picks Claude / OpenAI / Gemini at the call site. */
  textProvider?: string,
): Promise<{ concepts: any[]; prompt: string }> => {
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
    // Path B: Director has a specific vision — generate ONE concept.
    prompt = `You are a visionary music video director planning an Indian devotional music video. The visual medium is decided in a separate phase via the locked style reference — could be photographic, painterly, illustrated, miniature, mixed-media, or anything else — so do not write camera/lens/cinematography directions, color palette, or art style here. Focus on story, beats, and what visibly happens.

${songContext}

DIRECTOR'S BRIEF:
${directorBrief}
${userNote ? `\nADDITIONAL NOTE: ${userNote}\n` : ''}
Generate EXACTLY 1 concept that realizes the director's vision. Flesh out their idea into a complete concept — don't override their intent, expand on it. Fill in all structured fields so the production pipeline can work with it.

Return EXACTLY 1 concept in the concepts array.`;
  } else {
    prompt = `You are a visionary music video director planning an Indian devotional music video. The visual medium is decided in a separate phase via the locked style reference — could be photographic, painterly, illustrated, miniature, mixed-media, or anything else — so do not write camera/lens/cinematography directions, color palette, or art style here. Focus on story, beats, and what visibly happens.

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

Return EXACTLY 3 concepts in the concepts array.`;
  }

  // Concept gen uses the primary runtime model (Opus on Claude, GPT-5.5 on
  // OpenAI, Gemini 3 Pro on Gemini). Schema is enforced natively per vendor
  // via the jsonSchema parameter — Anthropic tools, OpenAI json_schema,
  // Gemini responseSchema. parsedJson lands typed.
  const { parsedJson } = await generateText(textProvider, {
    userPrompt: prompt,
    maxTokens: 4096,
    jsonSchema: {
      name: 'generate_concepts',
      description: 'Generate creative concept directions for a music video',
      schema: {
        type: 'object',
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
                conceptDirection: { type: 'string', description: 'Short creative label' },
                description: { type: 'string', description: '2-3 sentence expansion of the concept' },
              },
              required: ['title', 'deity', 'mood', 'theme', 'conceptDirection', 'description'],
            },
          },
        },
        required: ['concepts'],
      },
    },
  });
  return { concepts: parsedJson?.concepts || [], prompt };
};

// ─── Refine Locked Concept ─────────────────────────────────────────

export const refineConceptDirection = async (
  currentConcept: any,
  feedback: string,
  textProvider?: string,
): Promise<any> => {
  const prompt = `You are a visionary music video director planning an Indian devotional music video. The visual medium is decided in a separate phase via the locked style reference — could be photographic, painterly, illustrated, miniature, mixed-media, or anything else — so do not write camera/lens/cinematography directions, color palette, or art style here. Focus on story, beats, and what visibly happens.

CURRENT LOCKED CONCEPT:
- Title: ${currentConcept.title || ''}
- Deity: ${currentConcept.deity || ''}
- Mood: ${currentConcept.mood || ''}
- Theme: ${currentConcept.theme || ''}
- Direction: ${currentConcept.conceptDirection || ''}

DIRECTOR FEEDBACK:
${feedback}

Revise the concept incorporating the feedback. Keep the core identity intact — this is a refinement, not a replacement. Update only the fields that the feedback touches. If the feedback says "darker mood" just update mood, don't rewrite everything.

Visual style is decided in a separate phase — do NOT include art style or color palette.`;

  // Refine path → cheap sibling per provider via useRefineModel.
  const { parsedJson } = await generateText(textProvider, {
    userPrompt: prompt,
    maxTokens: 1024,
    useRefineModel: true,
    jsonSchema: {
      name: 'refine_concept',
      description: 'Return the refined concept with all fields',
      schema: {
        type: 'object',
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
              colorPalette: { type: 'string' },
            },
            required: ['artStyle', 'colorPalette'],
          },
        },
        required: ['title', 'deity', 'mood', 'theme', 'conceptDirection', 'visualSuggestions'],
      },
    },
  });
  if (!parsedJson) throw new Error('Concept refinement failed');
  return parsedJson;
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
                  duration: { type: 'number', description: 'Clip duration in seconds. Required for Seedance storyboard mode; ignored/recomputed for standard mode.' },
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

const formatConceptForScriptPrompt = (concept: any): string => {
  const lines = [
    `Deity/subject: ${concept?.deity || 'Unknown'}`,
    `Direction: ${concept?.conceptDirection || concept?.title || 'Untitled direction'}`,
    `Core idea: ${concept?.theme || ''}`,
    `Expanded brief: ${concept?.description || concept?.lyricsSummary || ''}`,
    `Mood: ${concept?.mood || ''}`,
  ];
  return lines.filter(line => !line.endsWith(': ')).join('\n');
};

// parseTimestamp moved to ./script-validation.ts (shared with openai/gemini
// planners). Re-export as local name to keep the rest of this file unchanged.
const parseTimestamp = parseScriptTimestamp;

export const planScenes = async (
  input: ScriptInput & { lyrics: string; meaning: string; musicalStructure: string; basePacing: number; minShotDuration?: number; userNote?: string; songType?: string; isNarrative?: boolean; isMeditative?: boolean; videoModel?: string }
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string }> => {
  const client = getClient();
  const pacing = input.basePacing || 15;
  const minDuration = input.minShotDuration || 4;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance');
  const seedanceMaxDuration = 15;

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

  const pacingGuidance = isSeedanceStoryboard
    ? `═══ SEEDANCE STORYBOARD PACING (CRITICAL — think through this before writing) ═══
Video model: ${input.videoModel}
In this mode, a Lahari "shot" is a storyboard clip, not one continuous camera take.
Each shot may contain internal edits, multiple angles, and beat hits, but it must still serve one clear story/music idea.

Target clip length: 15 seconds whenever the musical phrase can support a mini-scene.
Allowed practical range: 4-15 seconds. Use shorter clips for short phrases, transitions, refrains, or quick devotional responses.
For each scene, shot durations must add up to the scene duration exactly.
Good examples:
- 30s scene -> 15 + 15
- 28s scene -> 15 + 13
- 20s scene -> 10 + 10 or 15 + 5
- 12s scene -> 12

Write each shot.direction as an edited mini-sequence, not a single camera setup.
Good: "Villagers assemble around the grounded idol, then hands lift it onto the marigold palanquin"
Good: "The procession enters the lane, lamps ignite on doorsteps, and the idol passes through the crowd"
Bad: "Wide establishing shot of the field"
Bad: "Slow dolly toward the idol"

Do not create zero-second cuts or filler shots. Every shot must have duration > 0.
Do not include art style, color palette, rendering language, or architecture not present in the scene/environment.
═══════════════════════════════════════════════════════════════════════`
    : `═══ PACING RULES (CRITICAL — think through this before writing) ═══
Base shot length: ${pacing} seconds.
For each scene: number_of_shots = ceil(scene_duration / ${pacing})
Every shot is ${pacing}s except the LAST shot which gets the remainder.

Example: 21s scene at ${pacing}s → ceil(21/${pacing}) = ${Math.ceil(21 / pacing)} shots (${Array.from({length: Math.ceil(21 / pacing)}, (_, i) => i === Math.ceil(21 / pacing) - 1 ? `${21 - (Math.ceil(21 / pacing) - 1) * pacing}s` : `${pacing}s`).join(' + ')}).

Video model minimum clip length: ${minDuration}s. Shots shorter than this get padded — don't adjust shot count to avoid it.

BEFORE writing shots for each scene, calculate its duration and shot count. Write EXACTLY that many shots.
═══════════════════════════════════════════════════════════════════`;

  const prompt = `You are a music video director. Your job is to plan the STRUCTURE — cast, locations, scenes, and what happens in each shot. A cinematographer will later decide framing and camera work, so focus on WHAT HAPPENS, not how the camera moves.

${modeGuidance}
${songTypeSignal}

CONCEPT:
${formatConceptForScriptPrompt(input.concept)}

LYRICS:
${input.lyrics}

MEANING: ${input.meaning}

MUSICAL STRUCTURE: ${input.musicalStructure}

${pacingGuidance}
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
${isSeedanceStoryboard ? '- In Seedance storyboard mode, each shot.direction may describe 2-5 internal edited beats, but it must remain one cohesive clip idea. Include shot.duration for every shot.' : ''}
${input.isMeditative ? '\n- For meditative/devotional pieces: prefer revelation, invocation, darshan, ritual progression, symbolic manifestation, and contemplative presence over plot twists or problem-solution arcs.' : ''}
- Avoid mechanical alternation between two visual worlds unless the song truly demands it. Let some beats bridge the human and divine, or move from one into the other.
- Not every sacred name or attribute needs a literal illustration. Some should be felt through atmosphere, ritual action, emotional change, silence, or presence.
- Avoid generic mystical spectacle by default: floating symbols, cosmic particles, glowing script, abstract energy fields. Use overt visual effects only when they feel earned by the song.
- Build progression across the scene: invocation -> deepening presence -> surrender. Each shot should advance the same spiritual movement, not just restate it in a new image.

IMPORTANT — character and environment assignment:
- Every shot MUST have an environmentName from the environment list
- Every character who appears in a shot MUST be listed in castNames
- Do NOT skip character/environment assignment`;

  console.log(`[planScenes] Extended thinking + validation loop (pacing=${pacing}s, seedanceStoryboard=${!!isSeedanceStoryboard})`);

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

    // ═══ VALIDATE via shared helper ═══
    // Same validator is used by openai-script.ts and gemini-script.ts.
    // Validates shot counts (keyframe mode) or duration sums (Seedance mode)
    // plus cast/env name references and missing-direction checks.
    const errors = validateScriptStructure(candidate, {
      pacing,
      isSeedanceStoryboard: !!isSeedanceStoryboard,
      seedanceMaxDuration,
    });

    if (errors.length === 0) {
      data = candidate;
      console.log(`[planScenes] Validation passed on attempt ${attempt}`);
      break;
    }

    console.warn(`[planScenes] Attempt ${attempt} failed validation: ${errors.join('; ')}`);

    if (attempt >= maxAttempts) {
      console.error(`[planScenes] Failed validation after ${maxAttempts} attempts: ${errors.join('; ')}`);
      // Surface the actual validator errors. The shared validator catches
      // more than just shot-count mismatches (env/cast reference
      // hallucinations too); the previous "shot counts don't fit"
      // message misled on those failure modes.
      throw new Error(`Script generation failed validation after ${maxAttempts} attempts: ${errors.join('; ')}`);
    }

    // ═══ RETRY: Anthropic-native — send errors back via tool_result chain ═══
    // OpenAI/Gemini planners use different mechanisms for the same logical
    // step (previous_response_id / rebuild-prompt). Each provider owns its
    // own retry semantics; the validation function is shared.
    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: toolBlock.id, content: buildCorrectivePrompt(errors, { pacing, isSeedanceStoryboard: !!isSeedanceStoryboard, seedanceMaxDuration }) }
      ] },
    ];
  }

  if (!data) throw new Error('Script generation failed after all attempts');

  // ═══ Assign deterministic durations via shared helper ═══
  assignDeterministicDurations(data, { pacing, isSeedanceStoryboard: !!isSeedanceStoryboard });

  return { ...data, prompt };
};

// ─── Refine Script (surgical edit based on feedback) ──────────────

export const refineScript = async (
  currentScript: { cast: any[]; environments: any[]; scenes: any[] },
  feedback: string,
  context: { concept: any; videoMode: string; lyrics: string; meaning: string; musicalStructure: string; basePacing: number; minShotDuration?: number; videoModel?: string }
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string }> => {
  const client = getClient();
  const pacing = context.basePacing || 15;
  const minDuration = context.minShotDuration || 4;
  const isSeedanceStoryboard = context.videoModel?.startsWith('seedance');
  const seedanceMaxDuration = 15;

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
        duration: sh.duration,
        castNames: sh.castNames || sh.cast_names || [],
        environmentName: sh.environmentName || sh.environment_name || '',
      }))
    }))
  }, null, 2);

  const pacingGuidance = isSeedanceStoryboard
    ? `SEEDANCE STORYBOARD PACING:
Video model: ${context.videoModel}
In this mode, a Lahari "shot" is a storyboard clip, not one continuous camera take.
Each shot may contain internal edits, multiple angles, and beat hits, but it must still serve one clear story/music idea.

Allowed range: 4-${seedanceMaxDuration} seconds per shot.
For each scene, shot durations must add up to the scene duration exactly.
If you edit a scene, include duration for every shot in that scene. Preserve existing durations in untouched scenes.
Do not create zero-second cuts or filler shots.`
    : `SHOT BUDGET: Every shot = ${pacing} seconds. Shots per scene = ceil(scene_duration / ${pacing}). Last shot gets the remainder. This is a HARD CONSTRAINT — write EXACTLY ceil(duration/${pacing}) shots per scene.
Video model minimum clip length: ${minDuration}s. Shots shorter than this will be generated at ${minDuration}s and trimmed in the render timeline — this is fine, don't adjust your shot count to avoid it.`;

  const prompt = `You are a visionary music video director refining an existing devotional music video script based on the director's feedback. The visual medium is decided separately via the locked style reference — do not add cinematography, camera, or color-palette directions.

CONCEPT:
${formatConceptForScriptPrompt(context.concept)}

LYRICS:
${context.lyrics}

MEANING: ${context.meaning}

MUSICAL STRUCTURE: ${context.musicalStructure}

${pacingGuidance}

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
${isSeedanceStoryboard ? '6. In Seedance storyboard mode, each shot.direction may describe 2-5 internal edited beats, but it must remain one cohesive storyboard clip. Include shot.duration for every shot.' : ''}

CAST rules (same as original script):
- Description = physical appearance for image generation. 2-3 sentences.
- Include cultural context: "{name}, the {role} from {tradition}"
- No art style in descriptions

ENVIRONMENT rules:
- Description = physical space. 2 sentences. Cultural reference.
- No art style

Return the COMPLETE updated script using the plan_music_video tool — all scenes, not just the changed ones. The system replaces the old script entirely with your output.`;

  console.log(`[refineScript] Extended thinking + validation loop (pacing=${pacing}s, seedanceStoryboard=${!!isSeedanceStoryboard})`);

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

    // Validate via shared helper (same logic as planScenes + openai/gemini)
    const errors = validateScriptStructure(candidate, {
      pacing,
      isSeedanceStoryboard: !!isSeedanceStoryboard,
      seedanceMaxDuration,
    });

    if (errors.length === 0) {
      data = candidate;
      console.log(`[refineScript] Validation passed on attempt ${attempt}`);
      break;
    }

    console.warn(`[refineScript] Attempt ${attempt} failed: ${errors.join('; ')}`);

    if (attempt >= maxAttempts) {
      console.error(`[refineScript] Failed after ${maxAttempts} attempts: ${errors.join('; ')}`);
      // Same reasoning as planScenes throw — surface actual errors so
      // env/cast reference failures aren't hidden behind a shot-count msg.
      throw new Error(`Script refinement failed validation after ${maxAttempts} attempts: ${errors.join('; ')}`);
    }

    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: toolBlock.id, content: buildCorrectivePrompt(errors, { pacing, isSeedanceStoryboard: !!isSeedanceStoryboard, seedanceMaxDuration }) }
      ] },
    ];
  }

  if (!data) throw new Error('Script refinement failed');

  // Assign durations via shared helper
  assignDeterministicDurations(data, { pacing, isSeedanceStoryboard: !!isSeedanceStoryboard });

  return { ...data, prompt };
};

// ─── Write Shot Prompts (after all creative decisions locked) ───────

export const writeShotPrompts = async (
  shots: { id: string; direction: string; duration: number; castNames: string[]; sceneNarrative: string; sceneLyrics: string }[],
  context: { cast: { name: string; description: string }[]; concept: any; userNote?: string; songType?: string; isNarrative?: boolean; isMeditative?: boolean; videoModel?: string },
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

  const modelGuidance = context.videoModel?.startsWith('seedance') ? `
SEEDANCE 2.0 PROMPTING MODE:
- Think like a production storyboard: each motionPrompt should read as a timed action cue for this exact shot duration, not a loose mood sentence.
- Seedance follows explicit subject + motion + camera + timing well. Name the subject, the visible change, and the camera move in a clean order.
- Use each shot's listed duration when helpful: "Over 5s..." or "During the final second..." for holds, reveals, and beat hits.
- Lahari provides the finished song in render, and Segmind is called with generate_audio=false. Do NOT ask Seedance to generate music, voiceover, dialogue, or sound effects.
- You may reference the song rhythm visually: "on the vocal phrase", "on the drum accent", "as the line resolves", "with the chant pulse". Keep it visible and editorial.
- Keep camera choreography simple and physically plausible. Seedance rewards clear cuts, short moves, stable subjects, and consistency locks more than overloaded cinematic adjectives.
- If the start frame must stay consistent, say so positively: "maintain the same face, costume, and temple geometry while..."
- Avoid multi-shot language inside one Lahari shot unless the direction explicitly requires a transition. Lahari stitches separate clips later.` : `
VIDEO MODEL PROMPTING MODE:
- The model gets a start frame and the final song is added in render, so the motionPrompt should describe visible action and camera motion only.
- Do not request generated audio, dialogue, subtitles, or sound effects.`;

  const prompt = `You are an art director / shot writer. The script writer planned what happens in each shot — you decide how it looks on screen and how it moves. Your outputs go directly to an image model (visualPrompt) and a video model (motionPrompt).

WRITE PROMPTS THAT ARE RENDERABLE.

The visual medium (photographic, painterly, illustrated, miniature, mixed-media, anything else) is locked separately via the project's style reference image — the image renderer will see that ref and the prompt together. Describe what visibly happens and what the frame contains; do NOT dictate art style, color palette, rendering language, or "cinematic"/"film still" framing in words. The locked style reference is the ground truth for medium; words like "cinematic" pull stylized projects back toward realism.

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
Mood: ${context.concept.mood || 'devotional'}
Video model: ${context.videoModel || 'default'}

CHARACTERS:
${castList}
${userNoteBlock}${tailContext}
SHOTS TO WRITE:
${shotList}
${modelGuidance}
${meditativeGuidance}
For EACH shot, write using the write_shot_prompts tool:

- visualPrompt: The start frame. Brief but complete: camera position, shot scale, subject placement, spatial relationship, location, and one key visible detail. The model already has character/environment/style reference IMAGES — do not describe art style or color palette. Do allow functional lighting when it defines the frame ("lamplight catches the carved cheek", "the face emerges from shadow"). Preserve the shot's real geography. Do not invent corridors, arches, rooms, props, or layouts not implied by the shot direction or environment.
  ONLY include characters listed in that shot's Cast field.

- motionPrompt: One sentence. The video model already SEES the start frame. Say only what changes: character action, camera movement, environmental motion, and visible timing against the song when useful. Name the camera verb when it moves (push-in, pan, tracking, pull-back). Prefer the simplest truthful motion. A static hold is valid when the beat is carried by stillness.

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
  scriptSummary?: string,
  songType?: string,
  isNarrative?: boolean,
  isMeditative?: boolean,
  textProvider?: string,
): Promise<{ title: string; description: string }[]> => {
  const typeLabel = songType && songType !== 'unknown' ? songType : null;
  const traits = [
    isNarrative ? 'narrative' : null,
    isMeditative ? 'meditative' : null,
  ].filter(Boolean);
  const songTypeSignal = typeLabel || traits.length
    ? `SONG TYPE: ${[typeLabel, ...traits].filter(Boolean).join(', ')}`
    : '';

  const prompt = `You are a Director of Photography designing the visual language for an Indian devotional music video.

The audience is Indian. The imagery must feel culturally authentic, not generic fantasy.
These descriptions will be used as prompts for Gemini image generation.

SONG: ${concept.deity || 'Unknown'} — ${concept.theme || 'Unknown'}
Mood: ${concept.mood || 'Unknown'}
Language: ${concept.language || 'Unknown'}
${songTypeSignal}

LYRICS:
${(lyrics || '').substring(0, 3000)}

MEANING:
${(meaning || '').substring(0, 1500)}

${scriptSummary ? `SCRIPT OVERVIEW:\n${scriptSummary}` : ''}
${userNotes ? `USER DIRECTION: All 4 must be variations within this preference:\n${userNotes}` : ''}

Propose 4 distinct visual style directions using the propose_style_directions tool.

Each direction must produce a visibly different reference image: vary color temperature, medium/rendering approach, lighting behavior, and artistic/cultural reference.
Do not let all four directions collapse into warm, dark, temple-chiaroscuro variants.
Photographic, painterly, illustrated, miniature-inspired, or mixed-media directions are all welcome if specific and culturally respectful.

For each: a title (2-5 words) and description (2 short punchy sentences, concrete and compact).

Description covers ONLY transferable visual treatment: lighting, color palette, texture/medium, cultural references.
Do NOT describe characters, scenes, environments, or narrative.
These descriptions will be used as image generation prompts — be concrete, not literary.

QUALITY GUIDELINES for the image generation downstream:
- Avoid overly AI/CGI/fantasy look — every direction should feel grounded and intentional in its chosen medium (photographic, painterly, illustrated, miniature, mixed-media, etc.)
- Avoid excessive intricate details that muddy the image — every element should have clear intention
- If stylized, it should be tasteful and deliberate, not generic digital art or AI slop
- Think intentional reference image, not generic concept art`;

  const { parsedJson } = await generateText(textProvider, {
    userPrompt: prompt,
    maxTokens: 4096,
    jsonSchema: {
      name: 'propose_style_directions',
      description: 'Propose 4 visual style directions for the music video',
      schema: {
        type: 'object',
        properties: {
          directions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short evocative label (2-5 words)' },
                description: { type: 'string', description: '2 short punchy sentences, concrete and compact. Cover: lighting, color palette, texture/medium, cultural references. No characters — purely visual STYLE.' },
              },
              required: ['title', 'description'],
            },
          },
        },
        required: ['directions'],
      },
    },
  });
  if (!parsedJson?.directions) throw new Error('No style directions generated');
  return parsedJson.directions;
};

// ─── Refine a Style Direction (text-only) ───────────────────────────

export const refineStyleDirection = async (
  currentDescription: string,
  feedback: string,
  concept: any,
  textProvider?: string,
): Promise<{ title: string; description: string }> => {
  const prompt = `You are an elite DP refining a visual direction based on feedback.

CURRENT DIRECTION:
${currentDescription}

CONTEXT:
- Deity/Subject: ${concept.deity || 'Unknown'}
- Mood: ${concept.mood || 'Unknown'}

USER FEEDBACK:
${feedback}

Revise the direction incorporating the feedback. Keep it cohesive and internally consistent. The description will be used as an image generation prompt — be vivid and concrete. Focus on visual STYLE, MOOD, and ATMOSPHERE — no character descriptions.`;

  const { parsedJson } = await generateText(textProvider, {
    userPrompt: prompt,
    maxTokens: 1024,
    useRefineModel: true,
    jsonSchema: {
      name: 'refine_direction',
      description: 'Return the refined style direction',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short evocative label (2-5 words)' },
          description: { type: 'string', description: 'Revised visual direction. Vivid, concrete, style-focused.' },
        },
        required: ['title', 'description'],
      },
    },
  });
  if (!parsedJson) throw new Error('Refinement failed');
  return parsedJson as { title: string; description: string };
};

// ─── Enrich Style DNA (vision — analyzes locked style image) ─────────

// ─── Analyze Image Style (vision — user uploads reference) ───────────

export const analyzeImageStyle = async (
  imageBase64: string,
  mimeType: string,
  textProvider?: string,
): Promise<string> => {
  const prompt = `Analyze this image and describe its "Art Style" in detail. Return a concise prompt fragment (2-3 sentences) covering: lighting, color palette, texture/medium, composition, mood. Be concrete and specific — this will be used as an image generation style reference.

Return ONLY the style fragment text. No quotes, no JSON, no markdown.`;

  const { text } = await generateText(textProvider, {
    userPrompt: prompt,
    maxTokens: 512,
    useRefineModel: true,
    inputImages: [{ data: imageBase64, mimeType }],
  });
  return text || '';
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
  textProvider?: string;
}): Promise<{ visualPrompt: string }> => {
  const hasFailedImage = !!opts.failedImageBase64 && opts.failedImageBase64.length > 100;
  const hasRef = !!opts.referenceImageBase64;

  // Build inline-data image list in the same order as the legacy code so
  // the "Image 1: ... / Image 2: ..." numbering stays consistent.
  const inputImages: { data: string; mimeType: string; label?: string }[] = [];
  if (hasFailedImage) {
    inputImages.push({ data: opts.failedImageBase64!, mimeType: opts.failedImageMime || 'image/png' });
  }
  if (hasRef) {
    inputImages.push({ data: opts.referenceImageBase64!, mimeType: opts.referenceImageMime || 'image/png' });
  }

  const imageNote = hasFailedImage
    ? `Image 1: the result from the current prompt.${hasRef ? '\nImage 2: director\'s reference — incorporate what they want from this.' : ''}`
    : hasRef ? 'Image 1: director\'s reference — incorporate what they want from this.' : '';

  const prompt = `WHAT THE DIRECTOR WANTS CHANGED:
${opts.feedback}
${imageNote ? `\n${imageNote}` : ''}
CURRENT PROMPT:
${opts.currentPrompt}

Apply the director's feedback to the current prompt. Keep what works, change what they asked for. 1-3 sentences. This prompt goes to an image model — just describe what should be in the frame.`;

  const { parsedJson } = await generateText(opts.textProvider, {
    userPrompt: prompt,
    maxTokens: 1024,
    useRefineModel: true,
    inputImages,
    jsonSchema: {
      name: 'rewrite_frame_prompt',
      description: 'Apply director feedback to the frame prompt',
      schema: {
        type: 'object',
        properties: {
          visualPrompt: { type: 'string', description: 'Rewritten prompt. 1-3 sentences.' },
        },
        required: ['visualPrompt'],
      },
    },
  });
  if (!parsedJson) throw new Error('Refine returned no rewritten prompt');
  return parsedJson as { visualPrompt: string };
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
  textProvider?: string;
}): Promise<{ motionPrompt: string }> => {
  const inputImages: { data: string; mimeType: string }[] = [];
  const imageLabels: string[] = [];

  if (opts.startFrameBase64 && opts.startFrameBase64.length > 100) {
    inputImages.push({ data: opts.startFrameBase64, mimeType: opts.startFrameMime || 'image/png' });
    imageLabels.push('Start frame — the video animates from this');
  }
  if (opts.endFrameBase64) {
    inputImages.push({ data: opts.endFrameBase64, mimeType: opts.endFrameMime || 'image/png' });
    imageLabels.push('End frame — where the shot should land');
  }
  if (opts.referenceImageBase64) {
    inputImages.push({ data: opts.referenceImageBase64, mimeType: opts.referenceImageMime || 'image/png' });
    imageLabels.push("Director's reference");
  }

  const imageNote = imageLabels.length
    ? imageLabels.map((l, i) => `Image ${i + 1}: ${l}`).join('\n')
    : '';

  const prompt = `WHAT THE DIRECTOR WANTS CHANGED:
${opts.feedback}
${imageNote ? `\n${imageNote}` : ''}
WHAT HAPPENS IN THIS SHOT:
${opts.shotVisualPrompt}

CURRENT MOTION PROMPT:
${opts.currentMotionPrompt}

Apply the director's feedback to the motion prompt. This prompt goes to a video model alongside the start frame — it tells the model what to animate. 1-2 sentences, action + camera.`;

  const { parsedJson } = await generateText(opts.textProvider, {
    userPrompt: prompt,
    maxTokens: 1024,
    useRefineModel: true,
    inputImages,
    jsonSchema: {
      name: 'rewrite_motion_prompt',
      description: 'Apply director feedback to the motion prompt',
      schema: {
        type: 'object',
        properties: {
          motionPrompt: { type: 'string', description: 'Rewritten motion prompt. 1-2 sentences. Action + camera.' },
        },
        required: ['motionPrompt'],
      },
    },
  });
  if (!parsedJson) throw new Error('Refine returned no rewritten prompt');
  return parsedJson as { motionPrompt: string };
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
  textProvider?: string;
}): Promise<{ visualPrompt: string; motionPrompt: string }> => {
  const castNote = opts.characterNames.length ? `\nCharacters: ${opts.characterNames.join(', ')}` : '';
  const envNote = opts.environmentName ? `\nEnvironment: ${opts.environmentName}` : '';
  const directionNote = opts.shotDirection ? `\nSHOT INTENT: ${opts.shotDirection}` : '';

  const prompt = `The image is the last frame of the previous shot.

The next shot was drafted before this frame existed. Rewrite its prompts so they flow from what actually happened while honoring the shot's intent.
${directionNote}
DRAFT PROMPTS (rewrite these):
Visual: ${opts.currentVisualPrompt}
Motion: ${opts.currentMotionPrompt}
${castNote}${envNote}

Keep the shot intent. Rewrite so the first moment matches the frame — same characters, same state, natural continuation. Visual: 1-3 sentences. Motion: 1-2 sentences.`;

  const { parsedJson } = await generateText(opts.textProvider, {
    userPrompt: prompt,
    maxTokens: 1024,
    useRefineModel: true,
    inputImages: [{ data: opts.prevFrameBase64, mimeType: opts.prevFrameMime || 'image/png' }],
    jsonSchema: {
      name: 'rewrite_chained_shot',
      description: "Rewrite the next shot's prompts so it flows from the previous frame while honoring the shot intent.",
      schema: {
        type: 'object',
        properties: {
          visualPrompt: { type: 'string', description: 'Start-frame prompt. 1-3 sentences.' },
          motionPrompt: { type: 'string', description: 'Video instruction. 1-2 sentences.' },
        },
        required: ['visualPrompt', 'motionPrompt'],
      },
    },
  });
  if (!parsedJson) throw new Error('Did not return refreshed chained prompt');
  return parsedJson as { visualPrompt: string; motionPrompt: string };
};
