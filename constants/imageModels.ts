export interface ImageModelSpec {
  key: string;
  label: string;
  provider: 'google' | 'openai' | 'segmind';
  runtimeModel: string;
  supportsRefs: boolean;
  maxRefs: number;
  note?: string;
}

// Order matters: first entry is the default for new projects and what
// getImageModel() returns when no key is set. Mirage routes image generation
// through Segmind BYOK by default; model keys keep legacy names for DB
// compatibility, but provider/runtimeModel are the dispatch contract.
export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    key: 'gemini-3-pro',
    label: 'Nano Banana Pro',
    provider: 'segmind',
    runtimeModel: 'nano-banana-pro',
    supportsRefs: true,
    maxRefs: 14,
    note: 'Default. Segmind Nano Banana Pro. Strong ref-image conditioning and high-fidelity image output.',
  },
  {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'segmind',
    runtimeModel: 'nano-banana-2',
    supportsRefs: true,
    maxRefs: 14,
    note: 'Segmind Nano Banana 2. Faster/lower-cost reference-guided image generation.',
  },
  {
    key: 'gpt-image-2',
    label: 'GPT Image 2',
    provider: 'segmind',
    runtimeModel: 'gpt-image-2',
    supportsRefs: true,
    maxRefs: 14,
    note: 'Segmind GPT Image 2. Strong text/typography and high-detail image generation.',
  },
];

export const getImageModel = (key: string | undefined | null): ImageModelSpec =>
  IMAGE_MODELS.find((model) => model.key === key) ?? IMAGE_MODELS[0];

export const isOpenAIImageModel = (key: string | undefined | null): boolean =>
  getImageModel(key).provider === 'openai';

export const isSegmindImageModel = (key: string | undefined | null): boolean =>
  getImageModel(key).provider === 'segmind';
