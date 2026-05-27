import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip } from './_shared.js';

type VisualizeStylePromptInput = {
  /** Locked style direction text — the description to render. */
  styleDescription: string;
  /** Project subject from the locked concept (e.g. "the bride", "the boy with the broken radio"). */
  subject: string;
  /** Optional artist-supplied generation prompt; if set, the artist edited the prompt. */
  generationPrompt?: string;
  styleNotes?: string;
  preset: PipelinePreset;
};

const CORE_TASK = `Generate one reusable visual style reference frame for this project.

The frame should demonstrate the style system clearly — lighting behavior, color palette, texture or medium, rendering approach, atmosphere — using a simple motif, anonymous figure, prop vignette, environment detail, or production-design element that belongs to the project. Keep the composition concrete and readable enough that the visual treatment is easy to reuse downstream.

This is not a character design sheet, storyboard panel, poster, collage, or title card. It can feel like a clean production still, anonymous character-style frame, or background-detail frame, but it should not depict a specific plot beat.`;

const OUTPUT_CONTRACT = `Output the final reference image. High production value. No text. No watermark. No captions.`;

// No userNotePolicy: the locked direction text IS the input. There is no
// separate free-form user note in this flow; any artist nudge goes through
// the refine-style-direction tool before re-visualizing.

const formatInputs = (input: VisualizeStylePromptInput): string => {
  const lines = [
    `Project world: ${input.preset.style.subjectPrompt(input.subject)}`,
    `\nStyle direction to render:\n${clip(input.styleDescription, 1500)}`,
  ];
  return lines.join('\n');
};

export const buildVisualizeStylePrompt = (input: VisualizeStylePromptInput): string => {
  // Artist-edited prompts skip composer assembly and ship as-is. This
  // mirrors the existing imagen.ts behavior where `generationPrompt`
  // bypasses `buildStylePrompt`.
  if (input.generationPrompt) return input.generationPrompt;

  return composePrompt({
    coreTask: CORE_TASK,
    inputs: formatInputs(input),
    styleNotes: input.styleNotes,
    outputContract: OUTPUT_CONTRACT,
  });
};
