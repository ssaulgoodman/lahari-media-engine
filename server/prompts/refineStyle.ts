import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip, conceptSubject, workflowContextFor } from './_shared.js';

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

const USER_NOTE_POLICY = `USER NOTE contains the director's feedback. Apply it surgically:
- Touch only the fields and qualities the note addresses.
- Preserve identity-defining elements not mentioned in the note.
- Do not propose a different direction. Do not regenerate from scratch.
- If the note conflicts with the medium guard in TASTE (e.g. asks for a photographic or live-action medium when the project is anime), refuse the conflicting part and translate the intent to the closest medium-safe analogue. For anime, that means treating a "Polaroid" or "live-action" request as a printed-photo-inspired color/texture treatment still rendered as a drawn anime frame.`;

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
  workflowContext: workflowContextFor(input.preset),
  inputs: formatInputs(input),
  presetTaste: input.preset.style.rules,
  userNotePolicy: USER_NOTE_POLICY,
  outputContract: OUTPUT_CONTRACT,
  userNote: input.feedback,
});
