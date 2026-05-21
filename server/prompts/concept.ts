import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip, conceptSubject, workflowContextFor } from './_shared.js';

// ─── Generate Concept Options ─────────────────────────────────────────

type GenerateConceptPromptInput = {
  title: string;
  language: string;
  /** Lyrics (music_led) OR script excerpt (scripted_narrative). */
  sourceText?: string;
  meaning?: string;
  musicalStructure?: Array<{
    label?: string;
    startTime?: string | number;
    endTime?: string | number;
    energyLevel?: string;
    description?: string;
  }>;
  context?: string;
  scriptSummary?: string;
  songType?: string;
  isNarrative?: boolean;
  isMeditative?: boolean;
  /** If set, generate ONE concept that realizes this brief instead of three directions. */
  directorBrief?: string;
  /** Free-form artist nudge for this generation call. */
  userNote?: string;
  preset: PipelinePreset;
};

const GENERATE_CORE_TASK = `Propose creative narrative directions for this project.

Each direction is one coherent idea — what the viewer follows, what visibly happens, the emotional arc, the world the work lives in. Focus on story, beats, and what visibly happens.

Visual style, palette, and cinematography are decided in later phases. Do not include art-style language, camera directions, or color palette in any field — those belong to the style phase, not the concept phase.`;

const GENERATE_USER_NOTE_POLICY = `If USER NOTE is present, treat it as a hard creative constraint inside the tool contract and TASTE rules. All returned directions must satisfy it.

If the note conflicts with the source material, preset rules, or tool contract (e.g. asks for visual style/palette/cinematography at this layer, or asks the concept to abandon the source's intent), refuse the conflicting part and translate the rest into the closest valid concept-layer intent. Concept stays story/brief-level — style and medium are decided in later phases.

Variety means distinct directions inside the noted constraint, not in spite of it. With no user note, propose maximally distinct directions inside TASTE.`;

const outputContractForGenerate = (hasDirectorBrief: boolean): string => hasDirectorBrief
  ? `Return EXACTLY 1 concept in the concepts array — one that fleshes out the director's brief into a complete, production-ready concept. Do not override the director's intent; expand it.

Concept fields:
- title: 2-4 word creative title
- subject: the central subject (artist, character, premise, world, object)
- mood: one distinct emotional keyword
- theme: core narrative idea, 1 sentence
- conceptDirection: short creative label
- description: 2-3 sentences expanding the concept`
  : `Return EXACTLY 3 concepts in the concepts array — three genuinely different creative approaches, all respecting the source material.

Each concept:
- title: 2-4 word creative title
- subject: the central subject
- mood: one distinct emotional keyword (different per concept)
- theme: core narrative idea, 1 sentence
- conceptDirection: short creative label (e.g. ${'<preset.concept.directionExamples joined>'})
- description: 2-3 sentences expanding the concept

Hard rules:
- Each concept must offer a meaningfully different narrative approach.
- Do not let all three collapse into the same narrative shape.
- No art-style, color-palette, or cinematography language in any field.`;

const formatMusicalStructure = (structure?: GenerateConceptPromptInput['musicalStructure']): string => {
  if (!structure || structure.length === 0) return '';
  return structure.slice(0, 8).map((s) => {
    const range = (s.startTime !== undefined && s.endTime !== undefined) ? ` [${s.startTime}–${s.endTime}]` : '';
    const energy = s.energyLevel ? ` (${s.energyLevel})` : '';
    const desc = s.description ? `: ${clip(s.description, 200)}` : '';
    return `${s.label || 'Section'}${range}${energy}${desc}`;
  }).join('\n');
};

const formatGenerateInputs = (input: GenerateConceptPromptInput): string => {
  const lines: string[] = [
    `Title: ${clip(input.title, 200) || 'Untitled'}`,
    `Language: ${clip(input.language, 80) || 'Unknown'}`,
  ];

  if (input.context) lines.push(`Context: ${clip(input.context, 800)}`);

  if (input.preset.workflowKey === 'music_led') {
    const traits = [
      input.songType && input.songType !== 'unknown' ? input.songType : null,
      input.isNarrative ? 'narrative (has dramatic arc)' : null,
      input.isMeditative ? 'meditative (contemplative, inward)' : null,
    ].filter(Boolean);
    if (traits.length) lines.push(`Audio classification: ${traits.join(', ')}`);
    const structure = formatMusicalStructure(input.musicalStructure);
    if (structure) lines.push(`\nMusical structure:\n${structure}`);
    if (input.sourceText) lines.push(`\nLyrics:\n${clip(input.sourceText, 4000)}`);
    if (input.meaning) lines.push(`\nMeaning:\n${clip(input.meaning, 1500)}`);
  } else {
    if (input.scriptSummary) lines.push(`\nScript overview:\n${clip(input.scriptSummary, 2400)}`);
    if (input.sourceText) lines.push(`\nScript/source excerpt:\n${clip(input.sourceText, 4000)}`);
    if (input.meaning) lines.push(`\nDirector brief/logline:\n${clip(input.meaning, 1500)}`);
  }

  if (input.directorBrief) {
    lines.push(`\nDirector's brief (the concept must realize this vision):\n${clip(input.directorBrief, 1500)}`);
  }

  return lines.join('\n');
};

export const buildGenerateConceptPrompt = (input: GenerateConceptPromptInput): string => {
  const directionExamples = input.preset.concept.directionExamples?.length
    ? `${input.preset.concept.directionExamples.join(', ')} — NOT generic labels like "traditional" or "modern"`
    : 'something concrete to the project, not generic';

  const outputContract = outputContractForGenerate(!!input.directorBrief)
    .replace('<preset.concept.directionExamples joined>', directionExamples);

  return composePrompt({
    coreTask: GENERATE_CORE_TASK,
    workflowContext: workflowContextFor(input.preset),
    inputs: formatGenerateInputs(input),
    presetTaste: input.preset.concept.rules,
    userNotePolicy: GENERATE_USER_NOTE_POLICY,
    outputContract,
    userNote: input.userNote,
  });
};

// ─── Refine Locked Concept ────────────────────────────────────────────

type RefineConceptPromptInput = {
  currentConcept: any;
  feedback: string;
  preset: PipelinePreset;
};

const REFINE_CORE_TASK = `Revise the locked concept using the director's feedback.

This is a refinement, not a replacement — preserve the core identity. Update only the fields the feedback addresses; leave the rest unchanged.

Visual style, palette, and cinematography belong to later phases. Do not introduce art-style language, camera directions, or color palette here.`;

const REFINE_USER_NOTE_POLICY = `USER NOTE contains the director's feedback. Apply it surgically:
- Touch only the fields the note addresses (mood, theme, subject, direction, description).
- Preserve all locked fields the note does not mention.
- Do not regenerate the concept from scratch.
- If the note conflicts with the source material, preset rules, or tool contract (e.g. asks for visual style/palette/cinematography at this layer), refuse the conflicting part and translate the rest into the closest valid concept-layer intent. Concept stays story/brief-level — style and medium are decided in later phases.`;

const REFINE_OUTPUT_CONTRACT = `Return the refined concept as JSON with all fields populated:
- title
- subject
- mood
- theme
- conceptDirection

Fields not addressed by the feedback should carry their current values forward unchanged.`;

const formatRefineInputs = (concept: any): string => {
  const lines: string[] = [];
  lines.push(`Title: ${clip(concept?.title, 200) || 'Untitled'}`);
  lines.push(`Subject: ${conceptSubject(concept)}`);
  if (concept?.mood) lines.push(`Mood: ${clip(concept.mood, 160)}`);
  if (concept?.theme) lines.push(`Theme: ${clip(concept.theme, 500)}`);
  if (concept?.conceptDirection) lines.push(`Direction: ${clip(concept.conceptDirection, 200)}`);
  if (concept?.description) lines.push(`\nCurrent description:\n${clip(concept.description, 1500)}`);
  return lines.join('\n');
};

export const buildRefineConceptPrompt = (input: RefineConceptPromptInput): string => composePrompt({
  coreTask: REFINE_CORE_TASK,
  workflowContext: workflowContextFor(input.preset),
  inputs: formatRefineInputs(input.currentConcept),
  presetTaste: input.preset.concept.rules,
  userNotePolicy: REFINE_USER_NOTE_POLICY,
  outputContract: REFINE_OUTPUT_CONTRACT,
  userNote: input.feedback,
});
