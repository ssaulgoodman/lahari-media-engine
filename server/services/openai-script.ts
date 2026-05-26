import OpenAI from 'openai';
import { getRuntimePreset, PipelinePreset } from '../presets.js';
import {
  validateScriptStructure,
  buildCorrectivePrompt,
  assignDeterministicDurations,
} from './script-validation.js';
import { requireProviderApiKey } from './byok/providerKeys.js';
import { buildPlanScenesPrompt } from '../prompts/planScenes.js';
import { buildRefineScriptPrompt } from '../prompts/refineScript.js';
import { buildWriteShotPromptsPrompt } from '../prompts/shotPrompts.js';

type PlanScenesInput = {
  concept: any;
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
  projectOverride?: string | null;
  preset?: PipelinePreset;
};

type ScriptPlan = { cast: any[]; environments: any[]; scenes: any[] };

const OPENAI_SCRIPT_MODEL = process.env.OPENAI_SCRIPT_MODEL || 'gpt-5.5';
const OPENAI_SCRIPT_REASONING_EFFORT = process.env.OPENAI_SCRIPT_REASONING_EFFORT || 'medium';

const getClient = async () => new OpenAI({ apiKey: await requireProviderApiKey('openai') });

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
  const retry = errors?.length
    ? `\nVALIDATION FAILED. Return a corrected full JSON plan. Fix exactly these issues:\n${errors.map((err) => `- ${err}`).join('\n')}\n`
    : '';
  return `${buildPlanScenesPrompt({ ...input, preset })}
${retry}`;
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
          name: 'studio_script_plan',
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
        { role: 'system', content: 'You return strict JSON for a video production planner.' },
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
  lyrics: string;
  meaning: string;
  musicalStructure: string;
  basePacing: number;
  minShotDuration?: number;
  videoModel?: string;
  projectOverride?: string | null;
  preset?: PipelinePreset;
};

const buildRefinePrompt = (input: RefineScriptInput): string => {
  const preset = input.preset || getRuntimePreset();
  return buildRefineScriptPrompt({
    currentScript: input.currentScript,
    feedback: input.feedback,
    concept: input.concept,
    sourceText: input.lyrics,
    meaning: input.meaning,
    musicalStructure: input.musicalStructure,
    basePacing: input.basePacing,
    minShotDuration: input.minShotDuration,
    videoModel: input.videoModel,
    projectOverride: input.projectOverride,
    preset,
  });
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
          name: 'studio_script_refine',
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
        { role: 'system', content: 'You return strict JSON for a video production planner.' },
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
  projectOverride?: string | null;
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
  return buildWriteShotPromptsPrompt({ ...input, preset });
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
