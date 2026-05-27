import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { GENERATE_USER_NOTE_POLICY, clip, conceptSubject } from './_shared.js';

type StyleBrainstormPromptInput = {
  sourceText?: string;
  meaning?: string;
  concept?: any;
  userNote?: string;
  scriptSummary?: string;
  songType?: string;
  isNarrative?: boolean;
  isMeditative?: boolean;
  styleNotes?: string;
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
Cover a real range across legitimate aesthetics for the project source and any STYLE NOTES.`;

// User-note policy is shared (_shared.ts). Style-brainstorm-specific tail:
// Source/style-note conflicts get translated to safe analogues rather than
// leaving the project, and range = variety inside the note (not in spite of it).
const USER_NOTE_TAIL = `Specifically: if the note conflicts with the locked project source or STYLE NOTES, preserve the project intent and translate the note into the closest production-safe analogue. Range means variety inside the noted constraint, not in spite of it.`;

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
  return composePrompt({
    coreTask: CORE_TASK,
    inputs: formatInputs(input),
    styleNotes: input.styleNotes,
    userNotePolicy: `${GENERATE_USER_NOTE_POLICY}\n\n${USER_NOTE_TAIL}`,
    outputContract: OUTPUT_CONTRACT,
    userNote: input.userNote,
  });
};
