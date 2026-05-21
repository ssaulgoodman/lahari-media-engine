import type { PipelinePreset } from '../presets.js';

/**
 * Trim and cap a string value at `max` characters. Returns '' for non-strings
 * and empty/whitespace-only input.
 */
export const clip = (value: unknown, max: number): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max) : text;
};

/**
 * Extract a human-readable subject from a concept object, tolerating the
 * legacy `primarySubject` / `deity` aliases.
 */
export const conceptSubject = (concept: any): string =>
  concept?.subject || concept?.primarySubject || concept?.title || 'Unknown';

/**
 * The small graph-context string that goes into the `CONTEXT` section of
 * composed prompts. Production language only — never enum keys.
 *
 * Per D26, when new workflow archetypes (campaign, short_form) land, add
 * branches here.
 */
export const workflowContextFor = (preset: PipelinePreset): string => {
  if (preset.workflowKey === 'scripted_narrative') {
    return 'This is a scripted narrative project. The work being created is an episode, film, or scene piece driven by a script.';
  }

  return 'This is a music-led project. The work being created is a music video driven by uploaded audio.';
};
