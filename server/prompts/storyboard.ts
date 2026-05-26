import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { REFINE_USER_NOTE_POLICY, clip, workflowContextFor } from './_shared.js';

type BuildStoryboardPlannerPromptInput = {
  sourceBrief: string;
  currentPrompt?: string;
  currentCutPlan?: string;
  artistNote?: string;
  hasArtistReference?: boolean;
  hasPreviousStoryboardRef?: boolean;
  previousCutPlanTail?: string;
  projectOverride?: string;
  preset: PipelinePreset;
};

const WRITE_CORE_TASK = `Plan one storyboard board and cut plan for a two-step storyboard workflow.

The first output, storyboardPrompt, is the prompt that the storyboard image model will read. The second output, cutPlanText, is the matching panel-beat list that the video model will read later. The panel actions must appear in both outputs: the image model needs them inline to know what to draw, and the video model needs them as a clean beat list.`;

const REFINE_CORE_TASK = `Refine one saved storyboard render prompt and cut plan using the director's feedback.

This is a surgical rewrite of storyboard production text, not a new shot. Preserve the shot intent, locked references, panel count/layout where still valid, and continuity unless the director note explicitly changes them.`;

// User-note policy is shared (_shared.ts). Storyboard-specific tail:
// addressable fields are panel-level; preserve locked refs and cut-plan logic.
const USER_NOTE_TAIL = `Addressable fields: panel actions, layout, emphasis, continuity details. Preserve the shot's source brief, locked style, cast identity, environment, and current cut-plan logic unless the note directly changes them. Never violate the no-text-in-panels rule.`;

const formatInputs = (input: BuildStoryboardPlannerPromptInput): string => {
  const parts: string[] = [];
  if (input.currentPrompt) parts.push(`Current storyboard render prompt:\n${clip(input.currentPrompt, 2500)}`);
  if (input.currentCutPlan) parts.push(`Current cut plan:\n${clip(input.currentCutPlan, 1800)}`);
  parts.push(`Source brief:\n${clip(input.sourceBrief, 5000)}`);
  if (input.hasArtistReference) {
    parts.push('Artist reference: an attached image is available. Use it only to understand the requested refinement, composition, gesture, board layout, or mood. Do not copy unrelated identity/style details from it.');
  }
  if (input.hasPreviousStoryboardRef) {
    parts.push('Previous storyboard reference: an attached image labeled "Previous shot storyboard (continuity)" is available. Read its last panel as the handoff state for this shot; match character positions, screen direction, and lighting from there without copying the composition wholesale.');
  }
  if (input.previousCutPlanTail) {
    parts.push(`Previous shot cut plan tail:\n${clip(input.previousCutPlanTail, 1800)}\nContinue from that visual state. Do not re-establish location, character positions, or camera if the previous shot just covered them.`);
  }
  return parts.join('\n\n');
};

const presetTasteFor = (input: BuildStoryboardPlannerPromptInput): string => [
  input.preset.style.rules,
  input.preset.studio.storyboardRules,
  input.projectOverride ? `Project storyboard recipe override:\n${clip(input.projectOverride, 2500)}` : '',
].filter(Boolean).join('\n\n');

const OUTPUT_CONTRACT = `Return only JSON with keys:
{
  "storyboardPrompt": "complete image-model prompt with the panel layout, subject/setting context, per-panel action descriptions inline, explicit inter-panel consistency demand, and no-text-in-panels rule",
  "cutPlanText": "Panel N — <action> per panel, one line each"
}

storyboardPrompt hard rules:
- Include the panel layout: grid spec, 16:9 panels, borders/background.
- Include one-line subject/shot context.
- Include per-panel action descriptions, one short sentence per panel, in order. Format: "Panel 1: <framing> — <action>".
- Include an explicit inter-panel consistency demand: style reference controls medium/lighting/palette; character refs control identity/costume/silhouette; environment refs control physical space.
- Include the no-text-in-panels rule: no captions, numbers, labels, arrows, speech bubbles, subtitles, readable text, logos, or watermarks.
- Keep it lean, roughly under 330 words. No contract bullet lists, animation rules, emotional-arc prose, quality boilerplate, or "cinematic film still" language.

cutPlanText hard rules:
- Same panel beats as storyboardPrompt.
- One line per panel.
- Format exactly: "Panel N — <action>".
- No timestamps, no camera-jargon fields.`;

export const buildStoryboardPlannerPrompt = (input: BuildStoryboardPlannerPromptInput): string => composePrompt({
  coreTask: input.artistNote?.trim() ? REFINE_CORE_TASK : WRITE_CORE_TASK,
  workflowContext: workflowContextFor(input.preset),
  inputs: formatInputs(input),
  presetTaste: presetTasteFor(input),
  userNotePolicy: input.artistNote?.trim() ? `${REFINE_USER_NOTE_POLICY}\n\n${USER_NOTE_TAIL}` : undefined,
  outputContract: OUTPUT_CONTRACT,
  userNote: input.artistNote,
});
