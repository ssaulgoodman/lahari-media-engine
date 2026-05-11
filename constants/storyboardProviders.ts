export interface StoryboardProviderSpec {
  key: 'gpt-image-2' | 'nano-banana-2';
  label: string;
  provider: 'openai' | 'segmind';
  runtimeModel: string;
  note: string;
}

export const STORYBOARD_PROVIDERS: StoryboardProviderSpec[] = [
  {
    key: 'gpt-image-2',
    label: 'GPT Image 2',
    provider: 'openai',
    runtimeModel: 'gpt-image-2',
    note: 'Highest storyboard quality, potentially expensive.',
  },
  {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'segmind',
    runtimeModel: 'nano-banana-2',
    note: 'Cheaper storyboard renderer via Segmind.',
  },
];

export const getStoryboardProvider = (key: string | undefined | null): StoryboardProviderSpec =>
  STORYBOARD_PROVIDERS.find((provider) => provider.key === key) ?? STORYBOARD_PROVIDERS[0];
