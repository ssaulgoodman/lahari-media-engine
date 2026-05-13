/**
 * Shared validation + deterministic-duration logic for the script writer.
 *
 * Three provider implementations (Anthropic Claude Opus, OpenAI GPT-5.5,
 * Google Gemini 3 Pro) all need to:
 *   1. Validate the model's returned script structure (shot counts/durations
 *      match scene durations).
 *   2. Assign final per-shot durations after validation passes.
 *
 * Both pieces are pure data transforms — no AI. Extracting here so each
 * provider's planner file just runs its native retry mechanism and calls
 * into these for the actual math. Avoids the "unified abstraction" trap.
 *
 * Validator merges the stricter checks that previously lived in
 * openai-script.ts (cast/env name reference checks, missing-direction
 * checks, etc.) with the duration/shot-count checks that lived in claude.ts.
 * Now both providers get the strict version.
 */

export type ScriptPlan = {
  cast?: any[];
  environments?: any[];
  scenes?: any[];
  [k: string]: any;
};

export type ValidateOpts = {
  /** Base pacing in seconds (e.g. 15). Used for keyframe-mode shot count. */
  pacing: number;
  /** When true: Seedance-style validation — durations must sum exactly. */
  isSeedanceStoryboard: boolean;
  /** Max per-shot duration in Seedance mode (default 15). */
  seedanceMaxDuration?: number;
};

/** Parse "M:SS" or "MM:SS" to seconds. Empty / malformed → 0. */
export const parseTimestamp = (t: string): number => {
  if (!t || !t.includes(':')) return 0;
  const parts = t.split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts[0] * 60 + (parts[1] || 0);
};

/**
 * Validate a script plan. Returns array of human-readable error messages
 * (empty when valid). The errors are designed to be sent back to the model
 * verbatim as corrective feedback — they name the scene, the actual count
 * vs expected, and the math.
 */
export const validateScriptStructure = (
  candidate: ScriptPlan,
  opts: ValidateOpts
): string[] => {
  const seedanceMaxDuration = opts.seedanceMaxDuration ?? 15;
  const errors: string[] = [];

  if (!Array.isArray(candidate.cast)) errors.push('cast must be an array.');
  if (!Array.isArray(candidate.environments)) errors.push('environments must be an array.');
  if (!Array.isArray(candidate.scenes)) errors.push('scenes must be an array.');
  if (errors.length) return errors;

  const envNames = new Set((candidate.environments || []).map((env: any) => env.name).filter(Boolean));
  const castNames = new Set((candidate.cast || []).map((member: any) => member.name).filter(Boolean));

  for (const scene of candidate.scenes || []) {
    const label = scene.sectionLabel || 'Untitled scene';
    const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
    if (sceneDuration <= 0) continue;

    if (!Array.isArray(scene.shots) || scene.shots.length === 0) {
      errors.push(`Scene "${label}" has no shots.`);
      continue;
    }

    // Per-shot identity checks (cast/env name references).
    for (const [idx, shot] of scene.shots.entries()) {
      if (!shot.direction?.trim()) errors.push(`Scene "${label}" shot ${idx + 1} has no direction.`);
      if (!shot.environmentName?.trim()) {
        errors.push(`Scene "${label}" shot ${idx + 1} has no environmentName.`);
      } else if (envNames.size && !envNames.has(shot.environmentName)) {
        errors.push(`Scene "${label}" shot ${idx + 1} uses environment "${shot.environmentName}" that is not in environments.`);
      }
      for (const name of shot.castNames || []) {
        if (castNames.size && !castNames.has(name)) {
          errors.push(`Scene "${label}" shot ${idx + 1} uses cast "${name}" that is not in cast.`);
        }
      }
    }

    if (opts.isSeedanceStoryboard) {
      // Seedance mode: model picks durations, validator enforces range + sum.
      const durations = scene.shots.map((shot: any) => Number(shot.duration || 0));
      durations.forEach((duration: number, idx: number) => {
        if (duration <= 0) errors.push(`Scene "${label}" shot ${idx + 1} has invalid duration ${duration}. Durations must be > 0.`);
        if (duration > 0 && duration < 4) errors.push(`Scene "${label}" shot ${idx + 1} is ${duration}s, below Seedance min 4s.`);
        if (duration > seedanceMaxDuration) errors.push(`Scene "${label}" shot ${idx + 1} is ${duration}s, above Seedance max ${seedanceMaxDuration}s.`);
      });
      const total = durations.reduce((sum: number, duration: number) => sum + duration, 0);
      if (Math.abs(total - sceneDuration) > 0.01) {
        errors.push(`Scene "${label}" (${scene.startTime}-${scene.endTime}, ${sceneDuration}s): shot durations add to ${total}s, must add exactly to ${sceneDuration}s.`);
      }
    } else {
      // Keyframe mode: model picks count, validator enforces ceil math.
      const expectedShots = Math.max(1, Math.ceil(sceneDuration / opts.pacing));
      if (scene.shots.length !== expectedShots) {
        errors.push(`Scene "${label}" (${scene.startTime}-${scene.endTime}, ${sceneDuration}s): ${scene.shots.length} shots but ceil(${sceneDuration}/${opts.pacing}) = ${expectedShots} expected.`);
      }
    }
  }

  return errors;
};

/**
 * Build a corrective-feedback string for the model from validation errors.
 * Each provider's retry loop calls this and sends the string back to the
 * model via its native mechanism (tool_result for Anthropic,
 * previous_response_id chain for OpenAI, rebuilt prompt for Gemini).
 */
export const buildCorrectivePrompt = (
  errors: string[],
  opts: { pacing: number; isSeedanceStoryboard: boolean; seedanceMaxDuration?: number }
): string => {
  const seedanceMaxDuration = opts.seedanceMaxDuration ?? 15;
  const tail = opts.isSeedanceStoryboard
    ? `Remember: Seedance storyboard shots must each be 4-${seedanceMaxDuration}s and durations must add exactly to each scene duration.`
    : `Remember: shots per scene = ceil(scene_duration / ${opts.pacing}). Recount and fix.`;
  return `VALIDATION FAILED. Fix these issues and resubmit:\n\n${errors.join('\n')}\n\n${tail}`;
};

/**
 * Assign final per-shot durations in place after validation passes.
 *
 * Keyframe mode: every shot gets `pacing` seconds; last shot in each scene
 * gets the remainder so durations sum exactly. Model doesn't pick durations
 * in this mode — its job is just to produce the right number of shots.
 *
 * Seedance storyboard mode: keep what the model wrote (validator already
 * enforced range + sum). Fall back to pacing-style assignment if the model
 * left durations empty (legacy projects).
 */
export const assignDeterministicDurations = (
  data: ScriptPlan,
  opts: { pacing: number; isSeedanceStoryboard: boolean }
): void => {
  for (const scene of data.scenes || []) {
    const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
    if (sceneDuration <= 0 || !scene.shots?.length) continue;
    const shotCount = scene.shots.length;
    for (let i = 0; i < shotCount; i++) {
      if (opts.isSeedanceStoryboard && Number(scene.shots[i].duration || 0) > 0) {
        // Keep the model's duration in Seedance mode.
        scene.shots[i].duration = Number(scene.shots[i].duration);
      } else if (i < shotCount - 1) {
        scene.shots[i].duration = opts.pacing;
      } else {
        // Last shot gets the remainder so the scene total is exact.
        const usedTime = (shotCount - 1) * opts.pacing;
        scene.shots[i].duration = Math.max(1, sceneDuration - usedTime);
      }
    }
  }
};
