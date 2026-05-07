import OpenAI from 'openai';

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
};

type ScriptPlan = { cast: any[]; environments: any[]; scenes: any[] };

const OPENAI_SCRIPT_MODEL = process.env.OPENAI_SCRIPT_MODEL || 'gpt-5.5';
const OPENAI_SCRIPT_REASONING_EFFORT = process.env.OPENAI_SCRIPT_REASONING_EFFORT || 'medium';

const getClient = () => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const parseTimestamp = (t: string): number => {
  if (!t || !t.includes(':')) return 0;
  const parts = t.split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts[0] * 60 + (parts[1] || 0);
};

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

const validatePlan = (
  candidate: ScriptPlan,
  opts: { pacing: number; isSeedanceStoryboard: boolean; seedanceMaxDuration: number }
): string[] => {
  const errors: string[] = [];
  if (!Array.isArray(candidate.cast)) errors.push('cast must be an array.');
  if (!Array.isArray(candidate.environments)) errors.push('environments must be an array.');
  if (!Array.isArray(candidate.scenes)) errors.push('scenes must be an array.');
  if (errors.length) return errors;

  const envNames = new Set(candidate.environments.map((env: any) => env.name).filter(Boolean));
  const castNames = new Set(candidate.cast.map((member: any) => member.name).filter(Boolean));

  for (const scene of candidate.scenes) {
    const label = scene.sectionLabel || 'Untitled scene';
    const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
    if (sceneDuration <= 0) continue;
    if (!Array.isArray(scene.shots) || scene.shots.length === 0) {
      errors.push(`Scene "${label}" has no shots.`);
      continue;
    }

    for (const [idx, shot] of scene.shots.entries()) {
      if (!shot.direction?.trim()) errors.push(`Scene "${label}" shot ${idx + 1} has no direction.`);
      if (!shot.environmentName?.trim()) {
        errors.push(`Scene "${label}" shot ${idx + 1} has no environmentName.`);
      } else if (envNames.size && !envNames.has(shot.environmentName)) {
        errors.push(`Scene "${label}" shot ${idx + 1} uses environment "${shot.environmentName}" that is not in environments.`);
      }
      for (const name of shot.castNames || []) {
        if (castNames.size && !castNames.has(name)) errors.push(`Scene "${label}" shot ${idx + 1} uses cast "${name}" that is not in cast.`);
      }
    }

    if (opts.isSeedanceStoryboard) {
      const durations = scene.shots.map((shot: any) => Number(shot.duration || 0));
      durations.forEach((duration: number, idx: number) => {
        if (duration <= 0) errors.push(`Scene "${label}" shot ${idx + 1} has invalid duration ${duration}.`);
        if (duration > 0 && duration < 4) errors.push(`Scene "${label}" shot ${idx + 1} is ${duration}s, below Seedance min 4s.`);
        if (duration > opts.seedanceMaxDuration) errors.push(`Scene "${label}" shot ${idx + 1} is ${duration}s, above Seedance max ${opts.seedanceMaxDuration}s.`);
      });
      const total = durations.reduce((sum: number, duration: number) => sum + duration, 0);
      if (Math.abs(total - sceneDuration) > 0.01) {
        errors.push(`Scene "${label}" (${scene.startTime}-${scene.endTime}, ${sceneDuration}s): shot durations add to ${total}s, must add exactly to ${sceneDuration}s.`);
      }
    } else {
      const expectedShots = Math.max(1, Math.ceil(sceneDuration / opts.pacing));
      if (scene.shots.length !== expectedShots) {
        errors.push(`Scene "${label}" (${scene.startTime}-${scene.endTime}, ${sceneDuration}s): wrote ${scene.shots.length} shots but expected ${expectedShots}.`);
      }
    }
  }

  return errors;
};

const buildPrompt = (
  input: PlanScenesInput,
  errors?: string[],
): string => {
  const pacing = input.basePacing || 8;
  const minDuration = input.minShotDuration || 4;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance');
  const seedanceMaxDuration = 15;
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
- A Lahari shot is one storyboard-controlled clip, not one continuous camera take.
- Each shot may contain internal cuts and angles, but it must be one clear story/music idea.
- Prefer 15s when the phrase supports a real mini-scene.
- Allowed range: 4-${seedanceMaxDuration}s. Use 4-8s only for short transitions or quick devotional responses.
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

  return `You are the practical script planner for Lahari, an AI music-video tool for devotional songs.

Your job is production structure: cast, reusable locations, scenes, and what physically happens in each shot.
Write for assets that artists can actually generate and storyboard. Be concrete, calm, and shootable.

Do not write pompous poetry. Do not use vague phrases like "divine grace flows", "cosmic energy blooms", or "the universe awakens" unless you translate them into visible human action, ritual action, or a simple physical image.
Do not include camera directions, lens choices, color palette, art style, rendering language, or overbuilt fantasy architecture in the script. Storyboard and cinematography steps happen later.
Avoid impossible crowds, dozens of extras, elaborate VFX, and prop chaos unless the song explicitly demands it.

DIRECTOR STYLE: ${input.videoMode === 'cinematic' ? 'Cinematic - fewer stronger moments with continuity.' : 'Montage - rhythmic coverage, each shot is a clear beat.'}
${songTypeSignal}

CONCEPT: ${input.concept.deity || 'Unknown'} - ${input.concept.theme || ''}
Mood: ${input.concept.mood || ''}
${input.concept.conceptDirection || ''}

LYRICS:
${input.lyrics}

MEANING:
${input.meaning}

MUSICAL STRUCTURE:
${input.musicalStructure}

${pacingGuidance}
${input.userNote ? `\nDIRECTOR NOTE: ${input.userNote}\n` : ''}
${retry}
Return only JSON matching the schema.

CAST:
- Include only characters actually needed.
- Include the deity and key human figures by proper names.
- Descriptions are neutral reusable reference identities: physical appearance, cultural identity, costume, ornaments. No action, no props in hands, no art style.

ENVIRONMENTS:
- Use 2-3 reusable locations unless the song truly needs more.
- Descriptions are physical spaces only: landscape/architecture/scale/atmosphere. No art style.

SCENES:
- Follow musical structure timestamps exactly.
- narrativeDescription is plain and concrete, 1-2 sentences.
- Every shot must have environmentName from your environment list.
- Every visible character must be in castNames.
- direction = what happens in the clip. In Seedance mode it can be 2-5 internal beats, but keep one coherent clip idea.`;
};

export const planScenesOpenAI = async (
  input: PlanScenesInput
): Promise<{ cast: any[]; environments: any[]; scenes: any[]; prompt: string; model: string }> => {
  const client = getClient();
  const pacing = input.basePacing || 8;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance') || false;
  const seedanceMaxDuration = 15;
  const maxAttempts = 3;

  let prompt = buildPrompt(input);
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await (client.responses.create as any)({
      model: OPENAI_SCRIPT_MODEL,
      input: [
        { role: 'system', content: 'You return strict JSON for a music video production planner.' },
        { role: 'user', content: prompt },
      ],
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
    });

    let candidate: ScriptPlan;
    try {
      candidate = JSON.parse(extractJsonText(response));
    } catch (err: any) {
      lastErrors = [`OpenAI returned invalid JSON: ${err.message}`];
      prompt = buildPrompt(input, lastErrors);
      continue;
    }

    if (!candidate.environments) candidate.environments = [];
    lastErrors = validatePlan(candidate, { pacing, isSeedanceStoryboard, seedanceMaxDuration });
    if (lastErrors.length === 0) {
      for (const scene of candidate.scenes) {
        const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
        if (sceneDuration <= 0 || !scene.shots?.length) continue;
        const shotCount = scene.shots.length;
        for (let i = 0; i < shotCount; i++) {
          if (isSeedanceStoryboard && Number(scene.shots[i].duration || 0) > 0) {
            scene.shots[i].duration = Number(scene.shots[i].duration);
          } else if (i < shotCount - 1) {
            scene.shots[i].duration = pacing;
          } else {
            const usedTime = (shotCount - 1) * pacing;
            scene.shots[i].duration = Math.max(1, sceneDuration - usedTime);
          }
        }
      }
      return { ...candidate, prompt, model: OPENAI_SCRIPT_MODEL };
    }

    prompt = buildPrompt(input, lastErrors);
  }

  throw new Error(`OpenAI script generation failed validation after ${maxAttempts} attempts: ${lastErrors.join('; ')}`);
};
