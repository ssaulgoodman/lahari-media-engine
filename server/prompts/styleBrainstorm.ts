import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';

type StyleBrainstormPromptInput = {
  sourceText?: string;
  meaning?: string;
  concept?: any;
  userNote?: string;
  scriptSummary?: string;
  songType?: string;
  isNarrative?: boolean;
  isMeditative?: boolean;
  preset: PipelinePreset;
};

const clip = (value: unknown, max: number): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max) : text;
};

const conceptSubject = (concept: any): string =>
  concept?.subject || concept?.primarySubject || concept?.title || 'Unknown';

const workflowContextFor = (preset: PipelinePreset): string => {
  if (preset.workflowKey === 'scripted_narrative') {
    return 'This is a scripted narrative project. The style directions become the visual world the episode, film, or scene work sits inside.';
  }

  return 'This is a music-led project. The style directions become the visual world the music video sits inside.';
};

const formatInputs = (input: StyleBrainstormPromptInput): string => {
  const concept = input.concept || {};
  const lines: string[] = [];

  lines.push(`Project subject: ${conceptSubject(concept)}`);
  if (concept.theme) lines.push(`Concept/theme: ${clip(concept.theme, 500)}`);
  if (concept.mood) lines.push(`Mood: ${clip(concept.mood, 160)}`);
  if (concept.language) lines.push(`Language: ${clip(concept.language, 80)}`);

  if (input.preset.workflowKey === 'music_led') {
    const traits = [
      input.songType && input.songType !== 'unknown' ? input.songType : null,
      input.isNarrative ? 'narrative' : null,
      input.isMeditative ? 'meditative' : null,
    ].filter(Boolean);
    if (traits.length) lines.push(`Audio classification: ${traits.join(', ')}`);
    if (input.meaning) lines.push(`Meaning/intent:\n${clip(input.meaning, 1500)}`);
    if (input.sourceText) lines.push(`Lyrics/source excerpt:\n${clip(input.sourceText, 3000)}`);
  } else {
    if (input.scriptSummary) lines.push(`Script overview:\n${clip(input.scriptSummary, 2400)}`);
    if (input.sourceText) lines.push(`Script/source excerpt:\n${clip(input.sourceText, 2400)}`);
    if (input.meaning) lines.push(`Director brief/logline:\n${clip(input.meaning, 800)}`);
  }

  return lines.filter(Boolean).join('\n\n');
};

const CORE_TASK = `Propose 4 distinct visual style directions for this project.

Each direction is one coherent visual world the project could live inside.
Do not write story, scenes, characters, camera shot lists, or plot beats.
Cover a real range across legitimate aesthetics for the medium described in TASTE.`;

const OUTPUT_CONTRACT = `Return exactly 4 directions as JSON.

Each direction:
- title: short evocative name, 2-5 words
- description: 2 compact sentences describing palette, line or medium treatment, rendering, lighting, texture, and overall mood

Hard rules:
- No character names.
- No scene beats.
- No plot.
- Do not number directions as story arcs.
- Each direction must be independently usable as an image-generation style prompt.
- Do not restate one look with different adjectives.`;

export const buildStyleBrainstormPrompt = (input: StyleBrainstormPromptInput): string => {
  const presetTaste = [
    input.preset.style.rules,
    input.preset.style.brainstormTaste,
  ].filter(Boolean).join('\n\n');

  return composePrompt({
    coreTask: CORE_TASK,
    workflowContext: workflowContextFor(input.preset),
    inputs: formatInputs(input),
    presetTaste,
    outputContract: OUTPUT_CONTRACT,
    userNote: input.userNote,
  });
};
