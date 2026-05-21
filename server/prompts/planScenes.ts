import type { PipelinePreset } from '../presets.js';
import { getPresetWorkflow } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip, conceptSubject, workflowContextFor } from './_shared.js';

type PlanScenesPromptInput = {
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
  preset: PipelinePreset;
};

const formatConcept = (concept: any): string => [
  `Subject: ${conceptSubject(concept)}`,
  `Direction: ${concept?.conceptDirection || concept?.title || 'Untitled direction'}`,
  concept?.theme ? `Core idea: ${clip(concept.theme, 500)}` : '',
  concept?.description || concept?.lyricsSummary ? `Expanded brief: ${clip(concept.description || concept.lyricsSummary, 1200)}` : '',
  concept?.mood ? `Mood: ${clip(concept.mood, 120)}` : '',
].filter(Boolean).join('\n');

const formatShotExamples = (preset: PipelinePreset): string => {
  const good = preset.script.shotExamples.good.map((example) => `- Good: "${example}"`).join('\n');
  const bad = preset.script.shotExamples.bad.map((example) => `- Bad: "${example}"`).join('\n');
  return [good, bad].filter(Boolean).join('\n');
};

const formatSourceSignals = (input: PlanScenesPromptInput): string => {
  const traits = [
    input.songType && input.songType !== 'unknown' ? input.songType : null,
    input.isNarrative ? 'narrative' : null,
    input.isMeditative ? 'meditative' : null,
  ].filter(Boolean);

  return [
    traits.length ? `Audio classification: ${traits.join(', ')}` : '',
    `Lyrics / audio source:\n${clip(input.lyrics, 5000)}`,
    input.meaning ? `Meaning / intent:\n${clip(input.meaning, 1600)}` : '',
    `Musical structure:\n${clip(input.musicalStructure, 3000)}`,
  ].filter(Boolean).join('\n\n');
};

const pacingGuidance = (input: PlanScenesPromptInput): string => {
  const pacing = input.basePacing || input.preset.defaults.pacing || 15;
  const minDuration = input.minShotDuration || 4;
  const isSeedanceStoryboard = input.videoModel?.startsWith('seedance');

  if (isSeedanceStoryboard) {
    return `Seedance storyboard pacing:
- A studio shot is a storyboard-controlled clip, not one continuous camera take.
- Each shot may contain internal edits, multiple angles, and beat hits, but it must still serve one clear story/music idea.
- Prefer 15 seconds when the musical phrase supports a real mini-scene.
- Allowed practical range: 4-15 seconds.
- Use shorter clips for short phrases, transitions, refrains, reactions, action fragments, or quick beat responses.
- For each scene, shot durations must add up to the scene duration exactly.
- Write each shot.direction as an edited mini-sequence, not a single camera setup.`;
  }

  const count = Math.ceil(21 / pacing);
  const durations = Array.from({ length: count }, (_, i) =>
    i === count - 1 ? `${21 - (count - 1) * pacing}s` : `${pacing}s`
  ).join(' + ');

  return `Pacing:
- Base shot length: ${pacing} seconds.
- For each scene: number_of_shots = ceil(scene_duration / ${pacing}).
- Every shot is ${pacing}s except the last shot, which gets the remainder.
- Example: 21s scene at ${pacing}s -> ${count} shots (${durations}).
- Video model minimum clip length: ${minDuration}s. Shots shorter than this get padded by generation/render; do not distort the structure to avoid it.`;
};

const CORE_TASK = `Plan the production structure for a music-led video.

Create cast, environments, scenes, and shot directions. A later prompt decides visual framing and camera language, so focus on what happens: visible action, performance, emotional movement, scene progression, and musical response.`;

const USER_NOTE_POLICY = `If USER NOTE is present, treat it as a hard creative constraint inside the tool contract, source material, and TASTE rules.

All returned structure should satisfy the note. If the note conflicts with timing, source meaning, or production constraints, preserve the source/contract and translate the note into the closest valid structural intent.`;

const OUTPUT_CONTRACT = `Return the plan using the plan_music_video tool.

Hard rules:
- Cast descriptions are reusable physical identities for reference generation. No scene-specific actions, no props in hands unless identity-critical, no art style.
- Environment descriptions are reusable physical spaces: layout, architecture, landscape, scale, lighting, atmosphere. No art style.
- One scene per musical section. Follow provided timestamps exactly.
- Every shot has environmentName from the environment list.
- Every visible character in a shot is listed in castNames.
- Shot direction describes what happens in the moment, not framing/camera movement.
- Avoid generic spectacle by default: floating symbols, cosmic particles, glowing script, abstract energy fields, or unrelated VFX.
- Build progression across the scene. Each shot advances the emotional, narrative, performance, or musical movement.`;

export const buildPlanScenesPrompt = (input: PlanScenesPromptInput): string => {
  const presetTaste = [
    input.preset.source.rules,
    getPresetWorkflow(input.preset).shotPlanRules,
    pacingGuidance(input),
    `Cast rules:\n${input.preset.script.castRules}`,
    `Environment rules:\n${input.preset.script.environmentRules}`,
    `Scene rules:\n${input.preset.script.sceneRules}`,
    `Shot examples:\n${formatShotExamples(input.preset)}`,
  ].filter(Boolean).join('\n\n');

  const inputs = [
    `Concept:\n${formatConcept(input.concept)}`,
    formatSourceSignals(input),
  ].filter(Boolean).join('\n\n');

  return composePrompt({
    coreTask: CORE_TASK,
    workflowContext: workflowContextFor(input.preset),
    inputs,
    presetTaste,
    userNotePolicy: USER_NOTE_POLICY,
    outputContract: OUTPUT_CONTRACT,
    userNote: input.userNote,
  });
};
