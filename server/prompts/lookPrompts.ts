import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip } from './_shared.js';

type LookPromptInput = {
  entity: { name: string; description: string };
  styleIdx?: number;
  userRefIdx?: number;
  styleDescription?: string | null;
  projectOverride?: string | null;
  preset: PipelinePreset;
};

const SHARED_OUTPUT_CONTRACT = `One isolated reference image. No collage, grid, text, watermark, or multiple panels.`;

export const isLegacyLookPrompt = (prompt?: string | null): boolean => {
  const text = typeof prompt === 'string' ? prompt : '';
  // The "composed by Mirage's composer" marker is OUTPUT CONTRACT — every
  // composer-built prompt has it (required field on ComposePromptParts).
  // Prior heuristic used CONTEXT, which was removed when workflowContext
  // was deleted from the composer; that made new env/cast prompts look
  // legacy and triggered spurious rebuilds.
  const isComposedByComposer = text.includes('\nOUTPUT CONTRACT\n');
  return text.includes('Generate ONE character reference portrait. Match the visual style EXACTLY from Image')
    || text.includes('Generate ONE environment shot. Match the visual style EXACTLY from Image')
    || (
      text.length > 0
      && !isComposedByComposer
      && (
        /character reference portrait/i.test(text)
        || /reusable character reference/i.test(text)
        || /environment (shot|reference)/i.test(text)
        || /reusable environment reference/i.test(text)
      )
    );
};

const formatStyleReference = (input: LookPromptInput): string => {
  if (!input.styleIdx) return '';

  const lines = [
    `Style reference image: Image ${input.styleIdx}`,
    'Extract medium, line, palette, texture, lighting, and finish. Do not copy its subject, layout, background, or crop.',
  ];
  const styleIntent = clip(input.styleDescription, 360);
  if (styleIntent) {
    lines.push(`Style intent note: ${styleIntent}`);
  }
  return lines.join('\n');
};

const formatUserReference = (input: LookPromptInput, kind: 'character' | 'environment'): string => {
  if (!input.userRefIdx) return '';

  if (kind === 'character') {
    return `Director character reference: Image ${input.userRefIdx}
Match identity cues. Style still comes from Image ${input.styleIdx || 1}.`;
  }

  return `Director environment reference: Image ${input.userRefIdx}
Match geography, architecture, layout, and mood. Style still comes from Image ${input.styleIdx || 1}.`;
};

export const buildCharacterLookPrompt = (input: LookPromptInput): string => {
  const inputs = [
    formatStyleReference(input),
    formatUserReference(input, 'character'),
    `Character: ${input.entity.name}`,
    `Character description: ${clip(input.entity.description, 1200) || 'No description provided.'}`,
  ].filter(Boolean).join('\n\n');

  return composePrompt({
    coreTask: `Generate one reusable character or object reference for production continuity.`,
    inputs,
    presetTaste: [
      input.preset.style.rules,
      input.preset.looks.characterRules,
      input.preset.looks.qualityRules,
    ].filter(Boolean).join('\n\n'),
    projectOverride: input.projectOverride || undefined,
    outputContract: `${SHARED_OUTPUT_CONTRACT}
Neutral pose or neutral object presentation. Plain/soft background. No action or scene-specific props.
Preserve identity: face/body/costume for people; shape/material/status details for objects.`,
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
    coreTask: `Generate one reusable environment reference for production continuity.`,
    inputs,
    presetTaste: [
      input.preset.style.rules,
      input.preset.looks.environmentRules,
      input.preset.looks.qualityRules,
    ].filter(Boolean).join('\n\n'),
    projectOverride: input.projectOverride || undefined,
    outputContract: `${SHARED_OUTPUT_CONTRACT}
Whole space visible and readable. No scene-specific action.
No characters unless tiny neutral figures are needed for scale.`,
  });
};
