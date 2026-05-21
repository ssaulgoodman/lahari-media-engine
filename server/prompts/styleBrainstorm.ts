import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip, conceptSubject, workflowContextFor } from './_shared.js';

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

const USER_NOTE_POLICY = `If USER NOTE is present, treat it as a hard creative constraint inside the tool contract and TASTE rules. All 4 directions must satisfy it.

If the note conflicts with the medium guard in TASTE (e.g. asking for a photographic or live-action medium when the project is anime), translate the intent into the closest medium-safe analogue rather than leaving the medium. For anime, that means treating a "Polaroid" request as a printed-photo-inspired color/texture treatment still rendered as a drawn anime frame, not as an actual photograph.

Range means variety inside the user note when one is provided, not in spite of it. With no user note, cover the full legitimate range described in TASTE.`;

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
- Do not restate one look with different adjectives.
- When USER NOTE is present, all 4 directions satisfy it; range is variation inside the noted constraint.`;

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
    userNotePolicy: USER_NOTE_POLICY,
    outputContract: OUTPUT_CONTRACT,
    userNote: input.userNote,
  });
};
