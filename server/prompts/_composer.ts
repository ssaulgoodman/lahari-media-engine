export type ComposePromptParts = {
  coreTask: string;
  workflowContext?: string;
  inputs?: string;
  presetTaste?: string;
  outputContract: string;
  userNote?: string;
};

const section = (title: string, body?: string): string | null => {
  const text = body?.trim();
  return text ? `${title}\n${text}` : null;
};

export const composePrompt = (parts: ComposePromptParts): string => [
  parts.coreTask.trim(),
  section('CONTEXT', parts.workflowContext),
  section('INPUTS', parts.inputs),
  section('TASTE', parts.presetTaste),
  parts.outputContract.trim(),
  section('USER NOTE', parts.userNote),
].filter(Boolean).join('\n\n');
