export type StoryboardProviderKey = 'gpt-image-2' | 'nano-banana-2' | 'nano-banana-pro';

export interface StoryboardProviderSpec {
  key: StoryboardProviderKey;
  label: string;
  provider: 'openai' | 'segmind' | 'google';
  runtimeModel: string;
  note: string;
}

// Order matters: first entry is the default storyboard renderer for new
// projects. Nano Banana 2 stays default for cost — storyboards are boards
// (low-stakes drafts), not final frames. Mirage routes all storyboard
// provider options through Segmind BYOK.
export const STORYBOARD_PROVIDERS: StoryboardProviderSpec[] = [
  {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'segmind',
    runtimeModel: 'nano-banana-2',
    note: 'Segmind Nano Banana 2. Fast, lower-cost storyboard board rendering with refs.',
  },
  {
    key: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    provider: 'segmind',
    runtimeModel: 'nano-banana-pro',
    note: 'Segmind Nano Banana Pro. Strong ref-image conditioning for identity-sensitive boards.',
  },
  {
    key: 'gpt-image-2',
    label: 'GPT Image 2',
    provider: 'segmind',
    runtimeModel: 'gpt-image-2',
    note: 'Segmind GPT Image 2. Higher-detail storyboard rendering and typography.',
  },
];

export const getStoryboardProvider = (key: string | undefined | null): StoryboardProviderSpec =>
  STORYBOARD_PROVIDERS.find((provider) => provider.key === key) ?? STORYBOARD_PROVIDERS[0];
