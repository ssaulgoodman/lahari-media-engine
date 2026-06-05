export type StoryboardProviderKey = 'nano-banana-2';

export interface StoryboardProviderSpec {
  key: StoryboardProviderKey;
  label: string;
  provider: 'segmind';
  runtimeModel: string;
  note: string;
}

// Order matters: first entry is the default storyboard renderer for new
// projects. Nano Banana 2 stays default for cost — storyboards are boards
// (low-stakes drafts), not final frames; Segmind's pricing wins for that
// workload. Google/OpenAI storyboard providers are intentionally not active;
// older stored Google/OpenAI keys normalize to Nano Banana 2.
export const STORYBOARD_PROVIDERS: StoryboardProviderSpec[] = [
  {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'segmind',
    runtimeModel: 'nano-banana-2',
    note: 'Segmind Nano Banana 2. Default storyboard image renderer.',
  },
];

const LEGACY_STORYBOARD_PROVIDER_ALIASES: Record<string, StoryboardProviderKey> = {
  'nano-banana-pro': 'nano-banana-2',
  'gpt-image-2': 'nano-banana-2',
};

export const getStoryboardProvider = (key: string | undefined | null): StoryboardProviderSpec =>
  STORYBOARD_PROVIDERS.find((provider) => provider.key === (key ? LEGACY_STORYBOARD_PROVIDER_ALIASES[key] || key : key)) ?? STORYBOARD_PROVIDERS[0];
