import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { REFINE_USER_NOTE_POLICY, clip, conceptSubject } from './_shared.js';

type RefineStylePromptInput = {
  currentDescription: string;
  /** Optional current title; included in inputs if present. */
  currentTitle?: string;
  feedback: string;
  concept: any;
  preset: PipelinePreset;
};

const CORE_TASK = `Revise the current style direction text using the director's feedback.

This is a surgical refinement, not a replacement. Preserve the direction's core identity. Update only the aspects the feedback addresses; leave the rest of the description intact.`;

// User-note policy is shared (_shared.ts). Style-refine-specific tail:
// medium-guard conflicts get translated to safe analogues; don't propose
// a different direction.
const USER_NOTE_TAIL = `Do not propose a different direction. If the note asks for a medium that conflicts with TASTE (e.g. live-action when the project is anime), refuse the conflicting part and translate the intent to the closest medium-safe analogue.`;

const OUTPUT_CONTRACT = `Return the revised direction as JSON:
- title: short evocative label, 2-5 words (revise only if the feedback addresses the title or shifts the direction's identity)
- description: 2 compact sentences describing palette, line or medium treatment, rendering, lighting, texture, and mood. Vivid and concrete — this will be used as an image-generation prompt.

Hard rules:
- Description is style/treatment only. No character names, no scene beats, no plot.
- Stay inside the medium described in TASTE.`;

const formatInputs = (input: RefineStylePromptInput): string => {
  const lines: string[] = [
    `Subject: ${conceptSubject(input.concept)}`,
  ];
  if (input.concept?.mood) lines.push(`Mood: ${clip(input.concept.mood, 160)}`);
  if (input.concept?.theme) lines.push(`Theme: ${clip(input.concept.theme, 500)}`);

  const currentBlock: string[] = [];
  if (input.currentTitle) currentBlock.push(`Title: ${clip(input.currentTitle, 80)}`);
  currentBlock.push(clip(input.currentDescription, 2000));
  lines.push(`\nCurrent direction:\n${currentBlock.join('\n')}`);

  return lines.join('\n');
};

export const buildRefineStylePrompt = (input: RefineStylePromptInput): string => composePrompt({
  coreTask: CORE_TASK,
  inputs: formatInputs(input),
  presetTaste: input.preset.style.rules,
  userNotePolicy: `${REFINE_USER_NOTE_POLICY}\n\n${USER_NOTE_TAIL}`,
  outputContract: OUTPUT_CONTRACT,
  userNote: input.feedback,
});
