// Provider registry for v1 text-generation stages surfaced in Blueprint.
// The picker must only expose providers that can cover the full artist-facing
// text path, including script planning / rewrite / shot prompts. Gemini text
// support exists in the dispatcher, but the script planner does not have a
// Gemini retry loop yet, so it stays hidden until that path is real.
//
// First entry is the default for new projects (mirrors how IMAGE_MODELS and
// VIDEO_MODELS first-entry-is-default works). Existing projects with null
// `text_provider` also fall back to position 0 via getTextProvider().
//
// Refine actions (frame refine, motion refine, chained-shot refresh, etc.)
// continue to use cheaper sibling models per provider — that path doesn't
// flow through this picker because per-stage cost trumps per-stage choice
// at the refine level.

export type TextProviderKey = 'claude-opus' | 'gpt-5.5';

export interface TextProviderSpec {
  key: TextProviderKey;
  label: string;
  provider: 'anthropic' | 'openai' | 'google';
  /** Model identifier used by the provider's SDK / API. */
  runtimeModel: string;
  /** Cheaper sibling for refines and follow-up rewrites. Optional —
   *  consumers that don't have a refine variant just reuse runtimeModel. */
  refineModel?: string;
  note: string;
}

export const TEXT_PROVIDERS: TextProviderSpec[] = [
  {
    key: 'claude-opus',
    label: 'Claude Opus 4.7',
    provider: 'anthropic',
    runtimeModel: 'claude-opus-4-7',
    refineModel: 'claude-sonnet-4-6',
    note: 'Default. Strong creative writing, careful pacing. Tends literary.',
  },
  {
    key: 'gpt-5.5',
    label: 'GPT-5.5',
    provider: 'openai',
    runtimeModel: 'gpt-5.5',
    refineModel: 'gpt-5.5',
    note: 'Practical, direct prose. Less flowery scripts.',
  },
];

export const getTextProvider = (key: string | undefined | null): TextProviderSpec =>
  TEXT_PROVIDERS.find((p) => p.key === key) ?? TEXT_PROVIDERS[0];
