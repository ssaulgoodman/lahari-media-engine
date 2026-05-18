import OpenAI from 'openai';
import { getRuntimePreset, PipelinePreset } from '../presets.js';
import {
  validateScriptStructure,
  buildCorrectivePrompt,
  assignDeterministicDurations,
  parseTimestamp,
} from './script-validation.js';
import { requireProviderApiKey } from './byok/providerKeys.js';

type PlanScenesInput = {
  concept: any;
  videoMode: string;
  lyrics: string;
  meaning: string;
  musicalStructure: string;
  basePacing: number;
  minShotDuration?: number;
  userNote?: string;
  songType?: string;
  isNarrative?: boolean;
  isMeditative?: boolean;
  videoModel?: string;
  preset?: PipelinePreset;
};

type ScriptPlan = { cast: any[]; environments: any[]; scenes: any[] };

const OPENAI_SCRIPT_MODEL = process.env.OPENAI_SCRIPT_MODEL || 'gpt-5.5';
const OPENAI_SCRIPT_REASONING_EFFORT = process.env.OPENAI_SCRIPT_REASONING_EFFORT || 'medium';

const getClient = async () => new OpenAI({ apiKey: await requireProviderApiKey('openai') });

const conceptSubject = (concept: any, fallback = 'Unknown'): string =>
  concept?.subject || concept?.primarySubject || concept?.deity || concept?.title || fallback;

const formatConceptForScriptPrompt = (concept: any): string => {
  const lines = [
    `Subject: ${conceptSubject(concept)}`,
    `Direction: ${concept?.conceptDirection || concept?.title || 'Untitled direction'}`,
    `Core idea: ${concept?.theme || ''}`,
    `Expanded brief: ${concept?.description || concept?.lyricsSummary || ''}`,
    `Mood: ${concept?.mood || ''}`,
  ];
  return lines.filter(line => !line.endsWith(': ')).join('\n');
};

const workflowSourceLabels = (preset: PipelinePreset) => {
  const isMusicVideo = preset.workflowKey === 'music_video';
  return {
    sourceBlock: isMusicVideo ? 'LYRICS / AUDIO SOURCE' : 'SCRIPT / SOURCE MATERIAL',
    structureBlock: isMusicVideo ? 'MUSICAL STRUCTURE' : 'SCENE / TIMING STRUCTURE',
  };
};

// parseTimestamp is now in ./script-validation.ts (shared with claude/gemini)

const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cast: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
      },
    },
    environments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
      },
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sectionLabel: { type: 'string' },
          startTime: { type: 'string' },
          endTime: { type: 'string' },
          narrativeDescription: { type: 'string' },
          shots: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                direction: { type: 'string' },
                duration: { type: 'number' },
                castNames: { type: 'array', items: { type: 'string' } },
                environmentName: { type: 'string' },
              },
              required: ['direction', 'duration', 'castNames', 'environmentName'],
            },
          },
        },
        required: ['sectionLabel', 'startTime', 'endTime', 'narrativeDescription', 'shots'],
      },
    },
  },
  required: ['cast', 'environments', 'scenes'],
};

const extractJsonText = (response: any): string => {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  const text = (response.output || [])
    .filter((item: any) => item.type === 'message')
    .flatMap((item: any) => item.content || [])
    .map((content: any) => content.text || content.output_text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) {
    const refusal = (response.output || [])
      .flatMap((item: any) => item.content || [])
      .map((content: any) => content.refusal)
      .filter(Boolean)
      .join('\n');
    throw new Error(refusal || 'OpenAI script planner returned no text');
  }
  return text;
};

// validatePlan moved to ./script-validation.ts (validateScriptStructure).
// Same logic — keeps openai/claude/gemini planners consistent. Removing the
// duplicate; calls below were updated to use the imported version.

const buildPrompt = (
  input: PlanScenesInput,
  errors?: string[],
): string => {
  const preset = input.preset || getRuntimePreset();
  const pacing = input.basePacing || 15;
  const minDuration = input.minShotDuration || 4;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance');
  const seedanceMaxDuration = 15;
  const labels = workflowSourceLabels(preset);
  const typeLabel = input.songType && input.songType !== 'unknown' ? input.songType : null;
  const traits = [
    input.isNarrative ? 'narrative' : null,
    input.isMeditative ? 'meditative' : null,
  ].filter(Boolean);
  const songTypeSignal = typeLabel || traits.length
    ? `SONG TYPE: ${[typeLabel, ...traits].filter(Boolean).join(', ')}`
    : '';

  const pacingGuidance = isSeedanceStoryboard
    ? `SEEDANCE STORYBOARD PACING:
- A ${preset.toolName} shot is one storyboard-controlled clip, not one continuous camera take.
- Each shot may contain internal cuts and angles, but it must be one clear story/music idea.
- Prefer 15s when the phrase supports a real mini-scene.
- Allowed range: 4-${seedanceMaxDuration}s. Use 4-8s only for short transitions, refrains, or quick responses.
- Shot durations inside each scene must add exactly to the scene duration.
- direction should be a practical edited beat sequence that a storyboard can show.`
    : `STANDARD PACING:
- Base shot length is ${pacing}s.
- For each scene, write exactly ceil(scene_duration / ${pacing}) shots.
- The app will assign deterministic durations later.
- Video model minimum clip length is ${minDuration}s.`;

  const retry = errors?.length
    ? `\nVALIDATION FAILED. Return a corrected full JSON plan. Fix exactly these issues:\n${errors.map((err) => `- ${err}`).join('\n')}\n`
    : '';

  return `You are the practical script planner for ${preset.toolName}, an AI video production tool.

Your job is production structure: cast, reusable locations, scenes, and what physically happens in each shot.
Write for assets that artists can actually generate and storyboard. Be concrete, calm, and shootable.

Do not write pompous poetry. Do not use vague phrases like "memory floods the space", "cosmic energy blooms", or "the universe awakens" unless you translate them into visible human action, environmental change, performance, or a simple physical image.
Do not include camera directions, lens choices, color palette, art style, rendering language, or overbuilt fantasy architecture in the script. Storyboard and cinematography steps happen later.
Avoid impossible crowds, dozens of extras, elaborate VFX, and prop chaos unless the song explicitly demands it.
${preset.script.sceneRules}

DIRECTOR STYLE: ${input.videoMode === 'cinematic' ? 'Cinematic - fewer stronger moments with continuity.' : 'Montage - rhythmic coverage, each shot is a clear beat.'}
${songTypeSignal}

CONCEPT:
${formatConceptForScriptPrompt(input.concept)}

${labels.sourceBlock}:
${input.lyrics}

MEANING:
${input.meaning}

${labels.structureBlock}:
${input.musicalStructure}

${pacingGuidance}
${input.userNote ? `\nDIRECTOR NOTE: ${input.userNote}\n` : ''}
${retry}
Return only JSON matching the schema.

CAST:
- Include only characters actually needed.
- Descriptions are neutral reusable reference identities: physical appearance, role, silhouette, wardrobe/costume, and distinguishing details. No action, no props in hands, no art style.
${preset.script.castRules}

ENVIRONMENTS:
- Descriptions are physical spaces only: landscape/architecture/scale/atmosphere. No art style.
${preset.script.environmentRules}

SCENES:
- Follow provided structure timestamps exactly.
- narrativeDescription is plain and concrete, 1-2 sentences.
- Every shot must have environmentName from your environment list.
- Every visible character must be in castNames.
- direction = what happens in the clip. In Seedance mode it can be 2-5 internal beats, but keep one coherent clip idea.`;
};

export const planScenesOpenAI = async (
  input: PlanScenesInput
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string; model: string }> => {
  const client = await getClient();
  const pacing = input.basePacing || 15;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance') || false;
  const seedanceMaxDuration = 15;
  const maxAttempts = 3;

  const initialPrompt = buildPrompt(input);
  let lastErrors: string[] = [];
  // OpenAI-native retry: after the first attempt, chain via
  // previous_response_id so the model retains its reasoning state on
  // server-side. Each retry sends just the corrective text — much cheaper
  // than rebuilding the full prompt and re-reasoning from scratch. Mirrors
  // the pattern in openai-image.ts edit mode.
  let previousResponseId: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const requestBody: any = {
      model: OPENAI_SCRIPT_MODEL,
      reasoning: { effort: OPENAI_SCRIPT_REASONING_EFFORT },
      text: {
        format: {
          type: 'json_schema',
          name: 'studio_music_video_script',
          strict: true,
          schema: SCRIPT_SCHEMA,
        },
      },
      max_output_tokens: 12000,
    };

    if (previousResponseId) {
      // Retry turn: short corrective input, server has prior reasoning.
      requestBody.previous_response_id = previousResponseId;
      requestBody.input = buildCorrectivePrompt(lastErrors, { pacing, isSeedanceStoryboard, seedanceMaxDuration });
    } else {
      requestBody.input = [
        { role: 'system', content: 'You return strict JSON for a music video production planner.' },
        { role: 'user', content: initialPrompt },
      ];
    }

    let response: any;
    try {
      response = await (client.responses.create as any)(requestBody);
    } catch (err: any) {
      // If we're chaining and the create call itself failed (e.g. server
      // dropped the previous response, TTL expired, transient API error),
      // drop the chain and rebuild on next attempt. First-attempt failures
      // (no chain yet) propagate — they're real auth/quota/network errors,
      // not chain corruption.
      if (previousResponseId) {
        console.warn(`[planScenesOpenAI] Chained retry failed (${err?.message || err}); dropping chain, will rebuild prompt on next attempt`);
        previousResponseId = null;
        lastErrors = [`OpenAI chained retry error: ${err?.message || String(err)}`];
        continue;
      }
      throw err;
    }
    previousResponseId = response?.id || null;

    let candidate: ScriptPlan;
    try {
      candidate = JSON.parse(extractJsonText(response));
    } catch (err: any) {
      lastErrors = [`OpenAI returned invalid JSON: ${err.message}`];
      continue;
    }

    if (!candidate.environments) candidate.environments = [];
    lastErrors = validateScriptStructure(candidate, { pacing, isSeedanceStoryboard, seedanceMaxDuration });

    if (lastErrors.length === 0) {
      assignDeterministicDurations(candidate, { pacing, isSeedanceStoryboard });
      console.log(`[planScenesOpenAI] Validation passed on attempt ${attempt}`);
      return { ...candidate, prompt: initialPrompt, model: OPENAI_SCRIPT_MODEL };
    }

    console.warn(`[planScenesOpenAI] Attempt ${attempt} failed: ${lastErrors.join('; ')}`);
  }

  throw new Error(`OpenAI script generation failed validation after ${maxAttempts} attempts: ${lastErrors.join('; ')}`);
};

// ─── Refine Script (OpenAI GPT-5.5) ─────────────────────────────────
//
// Mirrors claude.ts → refineScript but uses OpenAI Responses API with
// previous_response_id for retries. Same shared validator + duration
// assignment.

type RefineScriptInput = {
  currentScript: { cast: any[]; environments: any[]; scenes: any[] };
  feedback: string;
  concept: any;
  videoMode: string;
  lyrics: string;
  meaning: string;
  musicalStructure: string;
  basePacing: number;
  minShotDuration?: number;
  videoModel?: string;
  preset?: PipelinePreset;
};

const buildRefinePrompt = (input: RefineScriptInput): string => {
  const preset = input.preset || getRuntimePreset();
  const labels = workflowSourceLabels(preset);
  const pacing = input.basePacing || 15;
  const minDuration = input.minShotDuration || 4;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance');
  const seedanceMaxDuration = 15;

  const currentJson = JSON.stringify({
    cast: input.currentScript.cast.map((c: any) => ({ name: c.name, description: c.description })),
    environments: input.currentScript.environments.map((e: any) => ({ name: e.name, description: e.description })),
    scenes: input.currentScript.scenes.map((s: any) => ({
      sectionLabel: s.sectionLabel || s.section_label,
      startTime: s.startTime || s.start_time,
      endTime: s.endTime || s.end_time,
      narrativeDescription: s.narrativeDescription || s.narrative_description,
      shots: (s.shots || []).map((sh: any) => ({
        direction: sh.direction || sh.visual_prompt || '',
        duration: sh.duration,
        castNames: sh.castNames || sh.cast_names || [],
        environmentName: sh.environmentName || sh.environment_name || '',
      })),
    })),
  }, null, 2);

  const pacingGuidance = isSeedanceStoryboard
    ? `SEEDANCE STORYBOARD PACING:
A ${preset.toolName} shot is one storyboard-controlled clip, not one continuous take.
Allowed range: 4-${seedanceMaxDuration}s per shot. Durations must add exactly to the scene duration.
If you edit a scene, include duration for every shot. Preserve existing durations in untouched scenes.`
    : `SHOT BUDGET: Every shot = ${pacing}s. Shots per scene = ceil(scene_duration / ${pacing}). Last shot gets remainder. HARD CONSTRAINT.
Video model minimum clip length: ${minDuration}s — shorter shots are generated at model floor and trimmed in render.`;

  return `You are the practical script editor for ${preset.toolName}. Refine an existing video script based on director feedback. Visual medium is decided separately via the locked style reference — do not add cinematography, camera, or color-palette directions.

CONCEPT:
${formatConceptForScriptPrompt(input.concept)}

${labels.sourceBlock}:
${input.lyrics}

MEANING: ${input.meaning}

${labels.structureBlock}: ${input.musicalStructure}

${pacingGuidance}

═══════════════════════════════════════
CURRENT SCRIPT (your starting point):
═══════════════════════════════════════
${currentJson}

═══════════════════════════════════════
DIRECTOR'S FEEDBACK:
═══════════════════════════════════════
${input.feedback}

═══════════════════════════════════════

SURGICAL REFINEMENT. Not a rewrite.

1. PRESERVE what works. Unchanged scenes come back IDENTICAL — same narratives, shots, cast assignments, environments.
2. SCOPE changes to what feedback asks for.
3. RESPECT existing cast and environment names — they are IDs. Don't rename. Add new ones only if feedback requires.
4. MAINTAIN musical structure. Section labels and timestamps are fixed.
5. Every shot MUST have castNames + environmentName.
${isSeedanceStoryboard ? '6. Seedance mode: shot.direction may describe 2-5 internal beats but one cohesive clip. Include shot.duration.' : ''}

Return the COMPLETE updated script (strict JSON) — every scene, not just the changed ones.`;
};

export const refineScriptOpenAI = async (
  input: RefineScriptInput
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string; model: string }> => {
  const client = await getClient();
  const pacing = input.basePacing || 15;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance') || false;
  const seedanceMaxDuration = 15;
  const maxAttempts = 3;

  const initialPrompt = buildRefinePrompt(input);
  let lastErrors: string[] = [];
  let previousResponseId: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const requestBody: any = {
      model: OPENAI_SCRIPT_MODEL,
      reasoning: { effort: OPENAI_SCRIPT_REASONING_EFFORT },
      text: {
        format: {
          type: 'json_schema',
          name: 'lahari_music_video_script',
          strict: true,
          schema: SCRIPT_SCHEMA,
        },
      },
      max_output_tokens: 12000,
    };

    if (previousResponseId) {
      requestBody.previous_response_id = previousResponseId;
      requestBody.input = buildCorrectivePrompt(lastErrors, { pacing, isSeedanceStoryboard, seedanceMaxDuration });
    } else {
      requestBody.input = [
        { role: 'system', content: 'You return strict JSON for a music video production planner.' },
        { role: 'user', content: initialPrompt },
      ];
    }

    let response: any;
    try {
      response = await (client.responses.create as any)(requestBody);
    } catch (err: any) {
      // Same chain-fallback as planScenesOpenAI — if the chained retry's
      // create call fails (TTL, server-side state lost), drop the chain
      // and rebuild on next attempt. First-attempt failures propagate.
      if (previousResponseId) {
        console.warn(`[refineScriptOpenAI] Chained retry failed (${err?.message || err}); dropping chain, will rebuild prompt on next attempt`);
        previousResponseId = null;
        lastErrors = [`OpenAI chained retry error: ${err?.message || String(err)}`];
        continue;
      }
      throw err;
    }
    previousResponseId = response?.id || null;

    let candidate: ScriptPlan;
    try {
      candidate = JSON.parse(extractJsonText(response));
    } catch (err: any) {
      lastErrors = [`OpenAI returned invalid JSON: ${err.message}`];
      continue;
    }

    if (!candidate.environments) candidate.environments = [];
    lastErrors = validateScriptStructure(candidate, { pacing, isSeedanceStoryboard, seedanceMaxDuration });

    if (lastErrors.length === 0) {
      assignDeterministicDurations(candidate, { pacing, isSeedanceStoryboard });
      console.log(`[refineScriptOpenAI] Validation passed on attempt ${attempt}`);
      return { ...candidate, prompt: initialPrompt, model: OPENAI_SCRIPT_MODEL };
    }

    console.warn(`[refineScriptOpenAI] Attempt ${attempt} failed: ${lastErrors.join('; ')}`);
  }

  throw new Error(`OpenAI script refinement failed after ${maxAttempts} attempts: ${lastErrors.join('; ')}`);
};

// ─── Write Shot Prompts (OpenAI GPT-5.5) ───────────────────────────
//
// Per-shot visual + motion prompt writer. No scene-level math validation
// (unlike planScenes/refineScript); the only constraint is that all shot
// IDs in the response match the IDs we sent. Strict json_schema enforces
// the shape. If the model returns wrong IDs, we throw — single retry isn't
// usually worth it for this stage (the prompt sends the full ID list and
// asks for an exact match; failures are rare).

type WriteShotPromptsInput = {
  shots: { id: string; direction: string; duration: number; castNames: string[]; sceneNarrative: string; sceneLyrics: string }[];
  cast: { name: string; description: string }[];
  concept: any;
  userNote?: string;
  songType?: string;
  isNarrative?: boolean;
  isMeditative?: boolean;
  videoModel?: string;
  preset?: PipelinePreset;
  previousBatchTail?: { id: string; visualPrompt: string; motionPrompt: string }[];
};

const WRITE_SHOT_PROMPTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          visualPrompt: { type: 'string' },
          motionPrompt: { type: 'string' },
          continuityFrom: { type: 'string', enum: ['cut', 'prev_shot'] },
        },
        required: ['id', 'visualPrompt', 'motionPrompt', 'continuityFrom'],
      },
    },
  },
  required: ['shots'],
};

const buildWriteShotPromptsText = (input: WriteShotPromptsInput): string => {
  const preset = input.preset || getRuntimePreset();
  const isMusicVideo = preset.workflowKey === 'music_video';
  const shotList = input.shots.map((s, i) =>
    `Shot ${i + 1} [${s.id}]: "${s.direction}" | ${s.duration}s | Cast: ${s.castNames.join(', ') || 'none'} | Scene: ${s.sceneNarrative} | ${isMusicVideo ? 'Lyric/audio cue' : 'Source beat'}: ${s.sceneLyrics || (isMusicVideo ? 'instrumental' : 'not specified')}`
  ).join('\n');

  const castList = input.cast.map(c => `${c.name}: ${c.description}`).join('\n');

  const tailContext = input.previousBatchTail?.length
    ? `\nPREVIOUS SHOTS (read-only context for continuity — do NOT rewrite these):\n${input.previousBatchTail.map(t => `[${t.id}]: visual: "${t.visualPrompt}" | motion: "${t.motionPrompt}"`).join('\n')}\n`
    : '';

  const userNoteBlock = input.userNote ? `\nUSER DIRECTION (apply to this rewrite): ${input.userNote}\n` : '';
  const typeLabel = input.songType && input.songType !== 'unknown' ? input.songType : null;
  const traits = [input.isNarrative ? 'narrative' : null, input.isMeditative ? 'meditative' : null].filter(Boolean);
  const songTypeSignal = typeLabel || traits.length
    ? `SONG TYPE: ${[typeLabel, ...traits].filter(Boolean).join(', ')}`
    : '';

  const meditativeGuidance = input.isMeditative ? `
PATIENT / CONTEMPLATIVE PACING:
- Favor stillness, patience, and negative space.
- A still face, a tightening hand, or a small environmental change can carry weight.
- Show emotional presence through atmosphere and reaction, not VFX.` : '';

  const timingReference = isMusicVideo
    ? 'song rhythm visually ("on the vocal phrase", "as the line resolves")'
    : 'source timing visually ("on the dialogue beat", "as the action lands")';

  const modelGuidance = input.videoModel?.startsWith('seedance') ? `
SEEDANCE 2.0 PROMPTING:
- motionPrompt = timed action cue for this exact shot duration.
- Name subject + visible change + camera move in clean order.
- Use duration when helpful ("over 5s...", "during the final second...").
- The app mixes final audio in render. Do NOT request generated audio.
- Reference ${timingReference} only.
- Simple, physically plausible camera.
- If start frame must stay consistent: "maintain the same face, costume, geometry while...".` : `
VIDEO MODEL PROMPTING:
- Model gets a start frame; final audio is added in render. motionPrompt describes visible action + camera only.
- Do NOT request generated audio, dialogue, subtitles, or SFX.`;

  return `You are an art director / shot writer. The script writer planned what happens in each shot — you decide how it looks on screen and how it moves. Your outputs go directly to an image model (visualPrompt) and a video model (motionPrompt).

WRITE PROMPTS THAT ARE RENDERABLE.

The visual medium (photographic, painterly, illustrated, miniature, mixed-media, anything else) is locked separately via the project's style reference image — the image renderer will see that ref and the prompt together. Describe what visibly happens and what the frame contains; do NOT dictate art style, color palette, rendering language, or "cinematic"/"film still" framing in words.

Every sentence must describe something visible or animateable. No metaphor, no inner emotion. Avoid "seems to", "as if", or invisible causes. Describe the visible effect directly.

But do not become schematic. Avoid "left half", "right half", "split-focus", "perfect symmetry" unless the shot truly depends on that arrangement.

Translate emotion into physical evidence: a still face, a hand tightening, a light settling, dust or rain moving through space, a body freezing before it answers, distance between two figures.

${songTypeSignal}
Mood: ${input.concept?.mood || 'unspecified'}
Video model: ${input.videoModel || 'default'}
Preset rules:
${preset.studio.shotPromptRules}

CHARACTERS:
${castList}
${userNoteBlock}${tailContext}
SHOTS TO WRITE:
${shotList}
${modelGuidance}
${meditativeGuidance}

For EACH shot:
- id: must match the [id] above EXACTLY.
- visualPrompt: the start frame. Brief: camera position, shot scale, subject placement, spatial relationship, location, one key visible detail. ONLY characters listed in that shot's Cast. Don't invent geography.
- motionPrompt: one sentence. What changes — character action, camera movement, environmental motion. Name camera verb if it moves (push-in, pan, tracking, pull-back). Simplest truthful motion. A static hold is valid.
- continuityFrom: 'cut' (default) or 'prev_shot' (when this shot directly intensifies/reveals/sustains the previous moment). First shot of a scene is ALWAYS 'cut'.

Match the IDs exactly. Return one entry per shot.`;
};

export const writeShotPromptsOpenAI = async (
  input: WriteShotPromptsInput
): Promise<{ shots: { id: string; visualPrompt: string; motionPrompt: string; continuityFrom: 'cut' | 'prev_shot' }[]; prompt: string; model: string }> => {
  const client = await getClient();
  const prompt = buildWriteShotPromptsText(input);

  const response = await (client.responses.create as any)({
    model: OPENAI_SCRIPT_MODEL,
    reasoning: { effort: OPENAI_SCRIPT_REASONING_EFFORT },
    text: {
      format: {
        type: 'json_schema',
        name: 'studio_shot_prompts',
        strict: true,
        schema: WRITE_SHOT_PROMPTS_SCHEMA,
      },
    },
    max_output_tokens: 12000,
    input: [
      { role: 'system', content: `You return strict JSON for a ${input.preset?.toolName || 'video'} shot writer.` },
      { role: 'user', content: prompt },
    ],
  });

  const parsed = JSON.parse(extractJsonText(response));
  const outputShots = parsed.shots || [];

  // Validate IDs match exactly (preserves the same guard claude.ts implies
  // via tool_use schema). Drop unknowns and warn if any expected shot is
  // missing — the route handler treats unknowns as fatal.
  const expectedIds = new Set(input.shots.map((s) => s.id));
  const returnedIds = new Set(outputShots.map((s: any) => s.id));
  const missing = [...expectedIds].filter((id) => !returnedIds.has(id));
  if (missing.length) {
    throw new Error(`OpenAI shot writer skipped shot IDs: ${missing.join(', ')}`);
  }
  const filtered = outputShots.filter((s: any) => expectedIds.has(s.id));

  return { shots: filtered, prompt, model: OPENAI_SCRIPT_MODEL };
};
