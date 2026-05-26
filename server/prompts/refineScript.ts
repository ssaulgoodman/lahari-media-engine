import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { REFINE_USER_NOTE_POLICY, clip, conceptSubject, workflowContextFor } from './_shared.js';

type RefineScriptPromptInput = {
  currentScript: {
    cast: any[];
    environments: any[];
    scenes: any[];
  };
  feedback: string;
  concept: any;
  /** Lyrics (music_led) OR script excerpt (scripted_narrative). */
  sourceText: string;
  meaning: string;
  /** Pre-formatted structure summary string. */
  musicalStructure: string;
  /** Base shot duration (seconds). preset.defaults.pacing default. */
  basePacing: number;
  /** Video model minimum clip length (seconds). 4s for Veo Standard, 8s for Veo Fast. */
  minShotDuration?: number;
  /** Project's selected video model. */
  videoModel?: string;
  preset: PipelinePreset;
};

const CORE_TASK = `Refine the existing production script using the director's feedback.

This is SURGICAL refinement, not rewriting from scratch. Think editor, not new writer. Preserve what works; scope changes to what the feedback asks for; respect existing cast and environments (they may already have locked reference images); maintain source structure (section labels and timestamps are fixed).

The visual medium is decided separately via the locked style reference. Do not add cinematography, camera, or color-palette directions to the script.`;

// User-note policy is shared (_shared.ts). Script-refine-specific tail:
// section labels and entity names are IDs in the downstream system —
// never rename existing cast/environments and never modify section labels
// or timestamps.
const USER_NOTE_TAIL = `Section labels and timestamps are fixed source structure — do not modify them. Existing cast and environment names are IDs downstream — never rename them; you may add new ones if the feedback requires new characters or locations. Every shot MUST have castNames and environmentName.`;

const formatConcept = (concept: any): string => {
  const lines = [
    `Subject: ${conceptSubject(concept)}`,
    `Direction: ${concept?.conceptDirection || concept?.title || 'Untitled direction'}`,
    `Core idea: ${concept?.theme || ''}`,
    `Expanded brief: ${concept?.description || concept?.lyricsSummary || ''}`,
    `Mood: ${concept?.mood || ''}`,
  ];
  return lines.filter((line) => !line.endsWith(': ')).join('\n');
};

const formatCurrentScript = (currentScript: RefineScriptPromptInput['currentScript']): string => {
  return JSON.stringify({
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
      })),
    })),
  }, null, 2);
};

const buildPacingGuidance = (input: RefineScriptPromptInput): string => {
  const pacing = input.basePacing || 15;
  const minDuration = input.minShotDuration || 4;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance');
  const seedanceMaxDuration = 15;

  if (isSeedanceStoryboard) {
    return `SEEDANCE STORYBOARD PACING:
Video model: ${input.videoModel}
In this mode, a "${input.preset.toolName}" shot is a storyboard clip, not one continuous camera take. Each shot may contain internal edits, multiple angles, and beat hits, but must still serve one clear story/music idea.

Allowed range: 4-${seedanceMaxDuration} seconds per shot.
For each scene, shot durations must add up to the scene duration exactly.
If you edit a scene, include duration for every shot in that scene. Preserve existing durations in untouched scenes.
Do not create zero-second cuts or filler shots.`;
  }

  return `SHOT BUDGET: Every shot = ${pacing} seconds. Shots per scene = ceil(scene_duration / ${pacing}). Last shot gets the remainder. This is a HARD CONSTRAINT — write EXACTLY ceil(duration/${pacing}) shots per scene.
Video model minimum clip length: ${minDuration}s. Shots shorter than this will be generated at ${minDuration}s and trimmed in the render timeline — this is fine, don't adjust your shot count to avoid it.`;
};

const sourceBlockLabel = (preset: PipelinePreset): string =>
  preset.workflowKey === 'music_led' ? 'LYRICS / AUDIO SOURCE' : 'SCRIPT / SOURCE MATERIAL';

const structureBlockLabel = (preset: PipelinePreset): string =>
  preset.workflowKey === 'music_led' ? 'MUSICAL STRUCTURE' : 'SCENE / TIMING STRUCTURE';

const formatInputs = (input: RefineScriptPromptInput): string => {
  const sections = [
    `CONCEPT:\n${formatConcept(input.concept)}`,
    `${sourceBlockLabel(input.preset)}:\n${clip(input.sourceText, 4000)}`,
    `MEANING:\n${clip(input.meaning, 1500)}`,
    `${structureBlockLabel(input.preset)}:\n${clip(input.musicalStructure, 2000)}`,
    buildPacingGuidance(input),
    `═══════════════════════════════════════
CURRENT SCRIPT (your starting point):
═══════════════════════════════════════
${formatCurrentScript(input.currentScript)}`,
  ];
  return sections.join('\n\n');
};

const buildOutputContract = (input: RefineScriptPromptInput): string => {
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance');
  const seedanceLine = isSeedanceStoryboard
    ? `\n- In Seedance storyboard mode, each shot.direction may describe 2-5 internal edited beats, but it must remain one cohesive storyboard clip. Include shot.duration for every shot.`
    : '';

  return `Return the COMPLETE updated script using the plan_music_video tool — all scenes, not just the changed ones. The system replaces the old script entirely with your output.

Hard rules:
- PRESERVE what works. Unchanged scenes return identical to their input.
- RESPECT existing cast and environment names — they are IDs downstream.
- MAINTAIN source structure (section labels and timestamps are fixed).
- Every shot MUST have castNames AND environmentName.${seedanceLine}

CAST rules:
- Description = physical appearance for image generation. 2-3 sentences.
- No art-style language in descriptions.

ENVIRONMENT rules:
- Description = physical space. 2 sentences.
- No art-style language.`;
};

export const buildRefineScriptPrompt = (input: RefineScriptPromptInput): string => composePrompt({
  coreTask: CORE_TASK,
  workflowContext: workflowContextFor(input.preset),
  inputs: formatInputs(input),
  userNotePolicy: `${REFINE_USER_NOTE_POLICY}\n\n${USER_NOTE_TAIL}`,
  outputContract: buildOutputContract(input),
  userNote: input.feedback,
});
