import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip, workflowContextFor } from './_shared.js';

type VisualizeStylePromptInput = {
  /** Locked style direction text — the description to render. */
  styleDescription: string;
  /** Project subject from the locked concept (e.g. "the bride", "the boy with the broken radio"). */
  subject: string;
  /** Optional artist-supplied generation prompt; if set, the artist edited the prompt. */
  generationPrompt?: string;
  preset: PipelinePreset;
};

const CORE_TASK = `Generate one reusable visual style reference frame for this project.

The frame should demonstrate the style system clearly — lighting behavior, color palette, texture or medium, rendering approach, atmosphere — using a motif, prop, environment detail, or production-design element that belongs to the project. Keep the composition clean enough that the visual treatment is easy to read and reuse downstream.

Do not produce a character portrait, storyboard frame, poster, collage, or narrative scene. The output is a style swatch, not a story beat.`;

const OUTPUT_CONTRACT = `Output the final reference image. High production value. No text. No watermark. No captions.`;

// No userNotePolicy: the locked direction text IS the input. There is no
// separate free-form user note in this flow; any artist nudge goes through
// the refine-style-direction tool before re-visualizing.

const formatInputs = (input: VisualizeStylePromptInput): string => {
  const lines = [
    `Subject: ${input.preset.style.subjectPrompt(input.subject)}`,
    `\nStyle direction to render:\n${clip(input.styleDescription, 1500)}`,
  ];
  return lines.join('\n');
};

export const buildVisualizeStylePrompt = (input: VisualizeStylePromptInput): string => {
  // Artist-edited prompts skip composer assembly and ship as-is. This
  // mirrors the existing imagen.ts behavior where `generationPrompt`
  // bypasses `buildStylePrompt`.
  if (input.generationPrompt) return input.generationPrompt;

  const presetTaste = [
    input.preset.style.rules,
    input.preset.looks.qualityRules,
  ].filter(Boolean).join('\n\n');

  return composePrompt({
    coreTask: CORE_TASK,
    workflowContext: workflowContextFor(input.preset),
    inputs: formatInputs(input),
    presetTaste,
    outputContract: OUTPUT_CONTRACT,
  });
};
