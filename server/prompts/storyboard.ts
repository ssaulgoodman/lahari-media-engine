import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { REFINE_USER_NOTE_POLICY, clip } from './_shared.js';

type BuildStoryboardPlannerPromptInput = {
  sourceBrief: string;
  currentPrompt?: string;
  currentCutPlan?: string;
  artistNote?: string;
  hasArtistReference?: boolean;
  hasPreviousStoryboardRef?: boolean;
  previousCutPlanTail?: string;
  styleNotes?: string;
  projectOverride?: string;
  preset: PipelinePreset;
};

const WRITE_CORE_TASK = `Plan one storyboard board and cut plan for a two-step storyboard workflow.

The first output, storyboardPrompt, is the shot's renderable board-planning text. It should use the project's canonical graph names for cast and environments, then focus on panel blocking, action, staging, composition, geography, camera logic, and continuity. The canonical Mirage storyboard is a black-and-white sketch planning sheet, not final production art. Do not restate character appearance, costume, style, or environment design when locked references exist; the render step binds those names to attached images and converts them into sketch guidance. The second output, cutPlanText, is the matching panel-beat list that the video model will read later.`;

const REFINE_CORE_TASK = `Refine one saved storyboard render prompt and cut plan using the director's feedback.

This is a surgical rewrite of storyboard planning text, not a new shot. Preserve the shot intent, locked references, panel count/layout where still valid, and continuity unless the director note explicitly changes them. Keep the canonical black-and-white sketch planning sheet contract unless the director explicitly asks for a final-style storyboard override.`;

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

const OUTPUT_CONTRACT = `Return only JSON with keys:
{
  "storyboardPrompt": "complete image-model prompt for a black-and-white sketch planning sheet with panel layout, one-line shot setup using canonical cast/environment names, per-panel blocking/action descriptions inline, continuity between panels, and no-text-in-panels rule",
  "cutPlanText": "Panel N — <action> per panel, one line each"
}

storyboardPrompt hard rules:
- Include the panel layout: choose a 2x2, 2x3, or 3x3 grid (4, 6, or 9 panels); use 16:9 panels with borders/background. Do not use 3-panel boards.
- Use the canonical sketch-board style: pure white paper (#FFFFFF), strict black-and-white ink/pencil linework, optional gray shading only. No color, cream tint, sepia, watercolor, colored wardrobe/skin/props, photorealism, final color grading, or final-render texture.
- Include one-line shot setup using canonical graph names only, e.g. "The Boss and The Knife Orchid in the Red Den Room." Do not describe their hair, outfit, face, prop design, room architecture, or art style unless the shot specifically changes it.
- Include per-panel blocking/action descriptions, one short sentence per panel, in order. Format: "Panel 1: <framing/staging> — <visible action>".
- Keep identity, costume, style, and environment continuity implicit through the canonical names. The renderer will attach and bind the matching reference images later, stripping their color and final-render texture into sketch guidance.
- If style language is needed, use only "hand-drawn pen-and-pencil sketch planning sheet"; do not introduce a new genre, medium, palette, lighting scheme, or finish that could clash with the sketch-board contract.
- Include the no-text-in-panels rule: no captions, numbers, labels, arrows, speech bubbles, subtitles, readable text, logos, or watermarks.
- Keep it lean, roughly under 220 words. No character design prose, environment design prose, contract bullet lists, animation rules, emotional-arc prose, quality boilerplate, or "cinematic film still" language.

cutPlanText hard rules:
- Same panel beats as storyboardPrompt.
- One line per panel.
- Format exactly: "Panel N — <action>".
- No timestamps, no camera-jargon fields.`;

export const buildStoryboardPlannerPrompt = (input: BuildStoryboardPlannerPromptInput): string => composePrompt({
  coreTask: input.artistNote?.trim() ? REFINE_CORE_TASK : WRITE_CORE_TASK,
  inputs: formatInputs(input),
  styleNotes: input.styleNotes,
  projectOverride: input.projectOverride || undefined,
  userNotePolicy: input.artistNote?.trim() ? `${REFINE_USER_NOTE_POLICY}\n\n${USER_NOTE_TAIL}` : undefined,
  outputContract: OUTPUT_CONTRACT,
  userNote: input.artistNote,
});
