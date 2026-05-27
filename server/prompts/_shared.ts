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
 * legacy `primarySubject` alias.
 */
export const conceptSubject = (concept: any): string =>
  concept?.subject || concept?.primarySubject || concept?.title || 'Unknown';

/**
 * Shared user-note policies. Per C3 of `docs/mirage-composer-audit.md`,
 * collapse six near-identical per-file restatements into two canonical
 * shapes:
 *
 * GENERATE — every returned item must satisfy the note. Used when the
 * call produces fresh content (concept generation, scene planning, shot
 * prompts, style brainstorm).
 *
 * REFINE — apply the note surgically, preserve unchanged. Used when the
 * call edits an existing artifact (concept refine, script refine, style
 * refine, storyboard refine).
 *
 * Per-file domain-specific tails can still be appended where the field
 * vocabulary genuinely matters; otherwise the shared constant is
 * sufficient.
 */
export const GENERATE_USER_NOTE_POLICY = `If USER NOTE is present, treat it as a hard creative constraint inside the tool contract and project data. All returned output must satisfy it.

If the note conflicts with the source material, project data, or the layer's tool contract, refuse the conflicting part and translate the rest into the closest valid intent at this layer.`;

export const REFINE_USER_NOTE_POLICY = `USER NOTE contains the director's feedback. Apply it surgically:
- Touch only the fields the note addresses.
- Preserve unchanged what the note doesn't mention.
- Do not regenerate from scratch.
- If the note conflicts with the source material, project data, or the layer's tool contract, refuse the conflicting part and translate the rest into the closest valid intent at this layer.`;
