export interface ImageModelSpec {
  key: string;
  label: string;
  provider: 'google' | 'openai' | 'segmind';
  runtimeModel: string;
  supportsRefs: boolean;
  maxRefs: number;
  note?: string;
}

export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'segmind',
    runtimeModel: 'nano-banana-2',
    supportsRefs: true,
    maxRefs: 14,
    note: 'Practical default via Segmind. Lower-cost image refs for style, looks, and frames.',
  },
  {
    key: 'gemini-3-pro',
    label: 'Gemini 3 Pro',
    provider: 'google',
    runtimeModel: 'gemini-3-pro-image-preview',
    supportsRefs: true,
    maxRefs: 10,
    note: 'Current default. Falls back to Flash on overload.',
  },
  {
    key: 'gpt-image-2',
    label: 'GPT Image 2',
    provider: 'openai',
    runtimeModel: 'gpt-image-2',
    supportsRefs: true,
    maxRefs: 10,
    note: 'OpenAI GPT Image 2 with ref images.',
  },
];

export const getImageModel = (key: string | undefined | null): ImageModelSpec =>
  IMAGE_MODELS.find((model) => model.key === key) ?? IMAGE_MODELS[0];

export const isOpenAIImageModel = (key: string | undefined | null): boolean =>
  getImageModel(key).provider === 'openai';

export const isSegmindImageModel = (key: string | undefined | null): boolean =>
  getImageModel(key).provider === 'segmind';
