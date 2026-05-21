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
import { getRuntimePreset, PipelinePreset } from '../presets.js';
import {
  validateScriptStructure,
  buildCorrectivePrompt,
  assignDeterministicDurations,
  parseTimestamp as parseScriptTimestamp,
} from './script-validation.js';
import { requireProviderApiKey } from './byok/providerKeys.js';
import { buildStyleBrainstormPrompt as buildComposedStyleBrainstormPrompt } from '../prompts/styleBrainstorm.js';
import { buildRefineStylePrompt } from '../prompts/refineStyle.js';
import { buildGenerateConceptPrompt, buildRefineConceptPrompt } from '../prompts/concept.js';
import { buildParseScriptPrompt } from '../prompts/parseScript.js';
import { buildPlanScenesPrompt } from '../prompts/planScenes.js';
import { buildRefineScriptPrompt } from '../prompts/refineScript.js';
import { buildWriteShotPromptsPrompt } from '../prompts/shotPrompts.js';

const getClient = async () => new Anthropic({ apiKey: await requireProviderApiKey('anthropic') });

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
  preset: PipelinePreset = getRuntimePreset(),
): Promise<{ concepts: any[]; prompt: string }> => {
  const prompt = buildGenerateConceptPrompt({
    title,
    language,
    sourceText: lyrics,
    meaning,
    musicalStructure,
    context,
    songType,
    isNarrative,
    isMeditative,
    directorBrief,
    userNote,
    preset,
  });

  // Concept gen uses the primary runtime model (Opus on Claude, GPT-5.5 on
  // OpenAI, Gemini 3 Pro on Gemini). Schema is enforced natively per vendor
  // via the jsonSchema parameter — Anthropic tools, OpenAI json_schema,
  // Gemini responseSchema. parsedJson lands typed.
  const { parsedJson } = await generateText(textProvider, {
    userPrompt: prompt,
    maxTokens: 4096,
    jsonSchema: {
      name: 'generate_concepts',
      description: `Generate creative concept directions for ${preset.toolName}`,
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
                subject: { type: 'string', description: preset.concept.subjectDescription },
                primarySubject: { type: 'string', description: 'Legacy-compatible alias for subject' },
                mood: { type: 'string', description: 'Emotional keyword — unique per concept' },
                theme: { type: 'string', description: 'Core narrative idea (1 sentence)' },
                lyricsSummary: { type: 'string', description: 'Brief meaning summary' },
                conceptDirection: { type: 'string', description: 'Short creative label' },
                description: { type: 'string', description: '2-3 sentence expansion of the concept' },
              },
              required: ['title', 'subject', 'mood', 'theme', 'conceptDirection', 'description'],
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
  preset: PipelinePreset = getRuntimePreset(),
): Promise<any> => {
  const prompt = buildRefineConceptPrompt({
    currentConcept,
    feedback,
    preset,
  });

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
          subject: { type: 'string' },
          primarySubject: { type: 'string' },
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
        required: ['title', 'subject', 'mood', 'theme', 'conceptDirection'],
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
  description: 'Plan the full music-led video structure — cast + environments + scenes + shots',
  input_schema: {
    type: 'object' as const,
    properties: {
      cast: {
        type: 'array',
        description: 'All characters needed for this video',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Character, performer, object, group, or recurring figure name (e.g. "Lead singer", "Girl in red coat", "Mirror dancer")' },
            description: { type: 'string', description: 'Reusable physical identity for reference generation. 2-3 sentences. Face/body/wardrobe/silhouette/role. No art style and no scene-specific action.' }
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
            name: { type: 'string', description: 'Reusable environment or location name (e.g. "Night rooftop", "Empty train platform", "Flooded rehearsal room")' },
            description: { type: 'string', description: 'Physical space and continuity details. 2 sentences. Layout, scale, architecture/landscape, lighting, atmosphere. No art style.' }
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

// Helpers `formatConceptForScriptPrompt`, `formatShotExamples`, and
// `workflowSourceLabels` were removed when planScenes/parseScript/refineScript/
// writeShotPrompts migrated to composePrompt (T9.5–T9.8). Each prompt builder
// now owns its own input formatting, so this file no longer needs them.
// `server/services/openai-script.ts` still has its own copies; they retire when
// T9.11 retires the OpenAI fat templates.

// parseTimestamp moved to ./script-validation.ts (shared with openai/gemini
// planners). Re-export as local name to keep the rest of this file unchanged.
const parseTimestamp = parseScriptTimestamp;

type ScriptFirstPlan = { title?: string; logline?: string; cast: any[]; environments: any[]; scenes: any[]; prompt: string };

const formatTimestamp = (seconds: number): string => {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

const normalizeScriptFirstTiming = (scenes: any[], pacing: number): any[] => {
  let cursor = 0;
  return (scenes || []).map((scene, sIdx) => {
    const shots = (scene.shots || []).map((shot: any) => ({
      ...shot,
      duration: Math.max(1, Number(shot.duration || pacing)),
    }));
    const sceneDuration = shots.reduce((sum: number, shot: any) => sum + Number(shot.duration || pacing), 0) || pacing;
    const startTime = scene.startTime || formatTimestamp(cursor);
    const endTime = scene.endTime || formatTimestamp(cursor + sceneDuration);
    cursor += Math.max(0, parseTimestamp(endTime) - parseTimestamp(startTime)) || sceneDuration;
    return {
      ...scene,
      sectionLabel: scene.sectionLabel || scene.label || `Scene ${sIdx + 1}`,
      startTime,
      endTime,
      narrativeDescription: scene.narrativeDescription || scene.description || '',
      shots,
    };
  });
};

export const parseAnimeScriptToPlan = async (input: {
  scriptText: string;
  title?: string;
  directorBrief?: string;
  targetDuration?: number;
  preset?: PipelinePreset;
}): Promise<ScriptFirstPlan> => {
  const client = await getClient();
  const preset = input.preset || getRuntimePreset('anime_default');
  const pacing = preset.defaults.pacing || 6;
  const targetDuration = input.targetDuration && input.targetDuration > 0
    ? input.targetDuration
    : undefined;

  const prompt = buildParseScriptPrompt({
    scriptText: input.scriptText,
    title: input.title,
    directorBrief: input.directorBrief,
    targetDuration,
    pacing,
    preset,
  });

  const response = await client.messages.create({
    model: OPUS,
    max_tokens: 16384,
    tools: [{
      name: 'parse_scripted_narrative',
      description: 'Parse a script-first narrative project into cast, environments, scenes, and shots.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' },
          logline: { type: 'string' },
          cast: SCRIPT_TOOL.input_schema.properties.cast,
          environments: SCRIPT_TOOL.input_schema.properties.environments,
          scenes: SCRIPT_TOOL.input_schema.properties.scenes,
        },
        required: ['cast', 'environments', 'scenes'],
      },
    }],
    tool_choice: { type: 'tool', name: 'parse_scripted_narrative' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') throw new Error('Script parser did not return a plan');
  const parsed = toolBlock.input as any;
  return {
    title: parsed.title,
    logline: parsed.logline,
    cast: parsed.cast || [],
    environments: parsed.environments || [],
    scenes: normalizeScriptFirstTiming(parsed.scenes || [], pacing),
    prompt,
  };
};

export const planScenes = async (
  input: ScriptInput & { lyrics: string; meaning: string; musicalStructure: string; basePacing: number; minShotDuration?: number; userNote?: string; songType?: string; isNarrative?: boolean; isMeditative?: boolean; videoModel?: string; preset?: PipelinePreset }
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string }> => {
  const client = await getClient();
  const preset = input.preset || getRuntimePreset();
  const pacing = input.basePacing || 15;
  const minDuration = input.minShotDuration || 4;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance');
  const seedanceMaxDuration = 15;
  const prompt = buildPlanScenesPrompt({ ...input, basePacing: pacing, minShotDuration: minDuration, preset });

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
  context: { concept: any; videoMode: string; lyrics: string; meaning: string; musicalStructure: string; basePacing: number; minShotDuration?: number; videoModel?: string; preset?: PipelinePreset }
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string }> => {
  const client = await getClient();
  const preset = context.preset || getRuntimePreset();
  const pacing = context.basePacing || 15;
  const isSeedanceStoryboard = context.videoModel?.startsWith('seedance');
  const seedanceMaxDuration = 15;

  const prompt = buildRefineScriptPrompt({
    currentScript,
    feedback,
    concept: context.concept,
    sourceText: context.lyrics,
    meaning: context.meaning,
    musicalStructure: context.musicalStructure,
    basePacing: context.basePacing,
    minShotDuration: context.minShotDuration,
    videoModel: context.videoModel,
    preset,
  });

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
  context: { cast: { name: string; description: string }[]; concept: any; userNote?: string; songType?: string; isNarrative?: boolean; isMeditative?: boolean; videoModel?: string; preset?: PipelinePreset },
  previousBatchTail?: { id: string; visualPrompt: string; motionPrompt: string }[]
): Promise<{ shots: { id: string; visualPrompt: string; motionPrompt: string; continuityFrom: 'cut' | 'prev_shot' }[]; prompt: string }> => {
  const client = await getClient();
  const preset = context.preset || getRuntimePreset();

  const prompt = buildWriteShotPromptsPrompt({
    shots,
    cast: context.cast,
    concept: context.concept,
    userNote: context.userNote,
    songType: context.songType,
    isNarrative: context.isNarrative,
    isMeditative: context.isMeditative,
    videoModel: context.videoModel,
    previousBatchTail,
    preset,
  });

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

export const buildStyleBrainstormPrompt = (
  lyrics: string,
  meaning: string,
  concept: any,
  userNotes?: string,
  scriptSummary?: string,
  songType?: string,
  isNarrative?: boolean,
  isMeditative?: boolean,
  preset: PipelinePreset = getRuntimePreset(),
): string => {
  return buildComposedStyleBrainstormPrompt({
    sourceText: lyrics,
    meaning,
    concept,
    userNote: userNotes,
    scriptSummary,
    songType,
    isNarrative,
    isMeditative,
    preset,
  });
};

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
  preset: PipelinePreset = getRuntimePreset(),
): Promise<{ directions: { title: string; description: string }[]; prompt: string }> => {
  const prompt = buildStyleBrainstormPrompt(
    lyrics,
    meaning,
    concept,
    userNotes,
    scriptSummary,
    songType,
    isNarrative,
    isMeditative,
    preset,
  );
  const { parsedJson } = await generateText(textProvider, {
    userPrompt: prompt,
    maxTokens: 4096,
    jsonSchema: {
      name: 'propose_style_directions',
      description: 'Propose 4 visual style directions for the project',
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
  return { directions: parsedJson.directions, prompt };
};

// ─── Refine a Style Direction (text-only) ───────────────────────────

export const refineStyleDirection = async (
  currentDescription: string,
  feedback: string,
  concept: any,
  textProvider?: string,
  preset: PipelinePreset = getRuntimePreset(),
): Promise<{ title: string; description: string }> => {
  const prompt = buildRefineStylePrompt({
    currentDescription,
    feedback,
    concept,
    preset,
  });

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
