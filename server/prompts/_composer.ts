export type ComposePromptParts = {
  coreTask: string;
  workflowContext?: string;
  inputs?: string;
  presetTaste?: string;
  userNotePolicy?: string;
  outputContract: string;
  userNote?: string;
};

export type ComposePromptSectionKey =
  | 'coreTask'
  | 'workflowContext'
  | 'inputs'
  | 'presetTaste'
  | 'userNotePolicy'
  | 'outputContract'
  | 'userNote';

export type ComposePromptSection = {
  key: ComposePromptSectionKey;
  title: string;
  body: string;
};

const section = (title: string, body?: string): string | null => {
  const text = body?.trim();
  return text ? `${title}\n${text}` : null;
};

const maybeSection = (key: ComposePromptSectionKey, title: string, body?: string): ComposePromptSection | null => {
  const text = body?.trim();
  return text ? { key, title, body: text } : null;
};

export const composePromptSections = (parts: ComposePromptParts): ComposePromptSection[] => [
  maybeSection('coreTask', 'CORE TASK', parts.coreTask),
  maybeSection('workflowContext', 'CONTEXT', parts.workflowContext),
  maybeSection('inputs', 'INPUTS', parts.inputs),
  maybeSection('presetTaste', 'TASTE', parts.presetTaste),
  maybeSection('userNotePolicy', 'USER NOTE POLICY', parts.userNotePolicy),
  maybeSection('outputContract', 'OUTPUT CONTRACT', parts.outputContract),
  maybeSection('userNote', 'USER NOTE', parts.userNote),
].filter((item): item is ComposePromptSection => Boolean(item));

export const renderPromptSections = (sections: ComposePromptSection[]): string =>
  sections.map((item, index) => (
    index === 0 && item.key === 'coreTask'
      ? item.body
      : section(item.title, item.body)
  )).filter(Boolean).join('\n\n');

export const composePrompt = (parts: ComposePromptParts): string =>
  renderPromptSections(composePromptSections(parts));

const SECTION_TITLES: Array<{ key: ComposePromptSectionKey; title: string }> = [
  { key: 'workflowContext', title: 'CONTEXT' },
  { key: 'inputs', title: 'INPUTS' },
  { key: 'presetTaste', title: 'TASTE' },
  { key: 'userNotePolicy', title: 'USER NOTE POLICY' },
  { key: 'outputContract', title: 'OUTPUT CONTRACT' },
  { key: 'userNote', title: 'USER NOTE' },
];

export const inspectComposedPrompt = (prompt: string): ComposePromptSection[] => {
  const text = prompt.trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const headerIndexes = lines
    .map((line, index) => {
      const found = SECTION_TITLES.find((item) => item.title === line.trim());
      return found ? { ...found, index } : null;
    })
    .filter((item): item is { key: ComposePromptSectionKey; title: string; index: number } => Boolean(item));

  if (headerIndexes.length === 0) {
    return [{ key: 'coreTask', title: 'PROMPT', body: text }];
  }

  const sections: ComposePromptSection[] = [];
  const firstHeader = headerIndexes[0];
  const coreBody = lines.slice(0, firstHeader.index).join('\n').trim();
  if (coreBody) sections.push({ key: 'coreTask', title: 'CORE TASK', body: coreBody });

  for (let i = 0; i < headerIndexes.length; i += 1) {
    const current = headerIndexes[i];
    const next = headerIndexes[i + 1];
    const body = lines.slice(current.index + 1, next?.index ?? lines.length).join('\n').trim();
    if (body) sections.push({ key: current.key, title: current.title, body });
  }

  return sections;
};
