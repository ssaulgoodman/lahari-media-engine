import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip, workflowContextFor } from './_shared.js';

type ParseScriptPromptInput = {
  scriptText: string;
  title?: string;
  directorBrief?: string;
  targetDuration?: number;
  pacing: number;
  preset: PipelinePreset;
};

const CORE_TASK = `Convert the uploaded script into a production-ready scene and shot plan.

This is extraction and production planning, not story rewriting. Preserve story intent, scene order, character actions, and dialogue order unless the director brief explicitly asks for adaptation.`;

const formatInputs = (input: ParseScriptPromptInput): string => [
  `Source title: ${clip(input.title, 200) || 'Untitled'}`,
  input.directorBrief ? `Director brief:\n${clip(input.directorBrief, 1500)}` : '',
  input.targetDuration ? `Target runtime: about ${input.targetDuration} seconds` : '',
  `Default shot pacing when no timing is supplied: about ${input.pacing}s per shot; longer for dialogue or action beats.`,
  `Script:\n${clip(input.scriptText, 12000)}`,
].filter(Boolean).join('\n\n');

const OUTPUT_CONTRACT = `Return the plan using the parse_scripted_narrative tool.

Hard rules:
- Break the script into production scenes and shots.
- Use approximate timings. If the script has no timing, assign practical shot durations.
- Extract cast members needed on screen.
- Extract reusable environments/backgrounds.
- Cast descriptions support consistent reference generation: neutral identity, no scene action, no art style.
- Environment descriptions support reusable background/location references: physical layout and continuity details, no art style.
- Shot directions describe what happens, not camera/lens/style.
- Every shot has castNames and environmentName.
- Do not invent new plot turns, characters, or locations unless required to make an underspecified brief producible.`;

export const buildParseScriptPrompt = (input: ParseScriptPromptInput): string => composePrompt({
  coreTask: CORE_TASK,
  workflowContext: workflowContextFor(input.preset),
  inputs: formatInputs(input),
  outputContract: OUTPUT_CONTRACT,
});
