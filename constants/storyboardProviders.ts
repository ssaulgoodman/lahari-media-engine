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
// (low-stakes drafts), not final frames; Segmind's pricing wins for that
// workload. Nano Banana Pro (Google's gemini-3-pro-image-preview) added as
// the high-quality ref-conditioning option for artists who want maximum
// identity preservation across the board's panels. GPT Image 2 remains for
// comparison / fallback.
export const STORYBOARD_PROVIDERS: StoryboardProviderSpec[] = [
  {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    // TEMP routing: Segmind credits exhausted 2026-05-13. Switched to Google
    // Developer API path running `gemini-3.1-flash-image-preview` (Google's
    // Nano Banana 2 equivalent, Flash tier). Storyboard output quality is
    // close to Segmind's nano-banana-2; ref-conditioning is Gemini-native.
    // TO RESTORE SEGMIND when credits are back: set provider='segmind' and
    // runtimeModel='nano-banana-2'. No other changes needed.
    provider: 'google',
    runtimeModel: 'gemini-3.1-flash-image-preview',
    note: 'Routed to Google Gemini 3.1 Flash Image while Segmind credits are out.',
  },
  {
    key: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    provider: 'google',
    runtimeModel: 'gemini-3-pro-image-preview',
    note: 'Google Gemini 3 Pro Image (Nano Banana Pro). Strongest ref-image conditioning — best for storyboards that need to hold character identity across panels.',
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
