export type StoryboardProviderKey = 'gpt-image-2' | 'nano-banana-2';

export interface StoryboardProviderSpec {
  key: StoryboardProviderKey;
  label: string;
  provider: 'openai' | 'segmind';
  runtimeModel: string;
  note: string;
}

// Order matters: first entry is the default storyboard renderer for new
// projects. Nano Banana 2 chosen as default for cost — storyboards are
// boards (low-stakes drafts), not final frames; Segmind's pricing wins
// for that workload. GPT Image 2 remains available for top-quality runs.
export const STORYBOARD_PROVIDERS: StoryboardProviderSpec[] = [
  {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'segmind',
    runtimeModel: 'nano-banana-2',
    note: 'Default. Cheaper storyboard renderer via Segmind.',
  },
  {
    key: 'gpt-image-2',
    label: 'GPT Image 2',
    provider: 'openai',
    runtimeModel: 'gpt-image-2',
    note: 'Higher storyboard quality, more expensive.',
  },
];

export const getStoryboardProvider = (key: string | undefined | null): StoryboardProviderSpec =>
  STORYBOARD_PROVIDERS.find((provider) => provider.key === key) ?? STORYBOARD_PROVIDERS[0];
