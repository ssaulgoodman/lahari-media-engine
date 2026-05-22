import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip, workflowContextFor } from './_shared.js';

type LookPromptInput = {
  entity: { name: string; description: string };
  styleIdx?: number;
  userRefIdx?: number;
  styleDescription?: string | null;
  preset: PipelinePreset;
};

const SHARED_OUTPUT_CONTRACT = `One single image. No collage, no grid, no multiple panels. No text, no watermark.`;

const formatStyleReference = (input: LookPromptInput): string => {
  if (!input.styleIdx) return '';

  const lines = [
    `Style reference image: Image ${input.styleIdx}`,
    'The style image is the visual authority for medium, rendering, line treatment, palette, texture, lighting, and finish.',
  ];
  const styleIntent = clip(input.styleDescription, 900);
  if (styleIntent) {
    lines.push(`Style intent note: ${styleIntent}`);
    lines.push('Use the style intent note only to clarify what to extract from the style image. If the text and image disagree, follow the image.');
  }
  return lines.join('\n');
};

const formatUserReference = (input: LookPromptInput, kind: 'character' | 'environment'): string => {
  if (!input.userRefIdx) return '';

  if (kind === 'character') {
    return `Director character reference: Image ${input.userRefIdx}
Match its identity cues: face, costume, silhouette, key iconography. The style reference remains the source of truth for how to render them.`;
  }

  return `Director environment reference: Image ${input.userRefIdx}
Match its geography, architecture, layout, and mood. The style reference remains the source of truth for how to render it.`;
};

export const buildCharacterLookPrompt = (input: LookPromptInput): string => {
  const inputs = [
    formatStyleReference(input),
    formatUserReference(input, 'character'),
    `Character: ${input.entity.name}`,
    `Character description: ${clip(input.entity.description, 1200) || 'No description provided.'}`,
  ].filter(Boolean).join('\n\n');

  return composePrompt({
    coreTask: `Generate one reusable character reference portrait.

This image becomes the character's visual reference across many shots. Design the character clearly enough that future images can preserve identity, silhouette, wardrobe, proportions, and facial structure.`,
    workflowContext: workflowContextFor(input.preset),
    inputs,
    presetTaste: [
      input.preset.style.rules,
      input.preset.looks.characterRules,
      input.preset.looks.qualityRules,
    ].filter(Boolean).join('\n\n'),
    outputContract: `${SHARED_OUTPUT_CONTRACT}

Mid-shot portrait: upper body and face clearly visible.
Neutral pose: hands relaxed at sides or naturally resting.
Do not show the character holding anything, performing an action, or interacting with objects.
Plain or softly blurred background; no scene-specific props.
Focus on face, expression baseline, costume, hairstyle, silhouette, proportions, and distinguishing details.`,
  });
};

export const buildEnvironmentLookPrompt = (input: LookPromptInput): string => {
  const inputs = [
    formatStyleReference(input),
    formatUserReference(input, 'environment'),
    `Environment: ${input.entity.name}`,
    `Environment description: ${clip(input.entity.description, 1200) || 'No description provided.'}`,
  ].filter(Boolean).join('\n\n');

  return composePrompt({
    coreTask: `Generate one reusable environment reference image.

This image becomes the location's visual reference across many shots. Design the space clearly enough that future images can preserve layout, architecture, materials, lighting, atmosphere, and geography.`,
    workflowContext: workflowContextFor(input.preset),
    inputs,
    presetTaste: [
      input.preset.style.rules,
      input.preset.looks.environmentRules,
      input.preset.looks.qualityRules,
    ].filter(Boolean).join('\n\n'),
    outputContract: `${SHARED_OUTPUT_CONTRACT}

Full reusable environment reference: the whole space is visible and readable.
No characters or figures unless scale absolutely requires tiny neutral figures.
Avoid scene-specific action. Show the location as a production reference, not a storyboard frame.`,
  });
};
