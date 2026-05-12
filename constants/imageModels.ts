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
// getImageModel() returns when no key is set. Default is Nano Banana Pro
// (Google's gemini-3-pro-image-preview) — strongest ref-image conditioning,
// which is what most of Lahari's gens need (style + cast + env refs).
//
// Naming note: "Nano Banana Pro" is Google's public codename for Gemini 3
// Pro Image; we use that label since it's how the model is widely
// recognized. The internal key stays `gemini-3-pro` for backwards compat
// with projects already storing that value in DB.
export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    key: 'gemini-3-pro',
    label: 'Nano Banana Pro',
    provider: 'google',
    runtimeModel: 'gemini-3-pro-image-preview',
    supportsRefs: true,
    maxRefs: 10,
    note: 'Default. Google Gemini 3 Pro Image (a.k.a. Nano Banana Pro). Strong ref-image conditioning; falls back to Flash on overload.',
  },
  {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'segmind',
    runtimeModel: 'nano-banana-2',
    supportsRefs: true,
    maxRefs: 14,
    note: 'Cheaper alternative via Segmind. Unrelated to Google\'s Nano Banana lineage despite the name.',
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
