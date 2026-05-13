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
    // TEMP routing: Segmind credits exhausted 2026-05-13. Switched to Google
    // Developer API path; under the hood now runs `gemini-3.1-flash-image-preview`
    // (Google's Nano Banana 2 equivalent, Flash tier). Image quality is close
    // to Segmind's nano-banana-2; ref-conditioning is Gemini-native so refs
    // behave like the Nano Banana Pro path, just on the smaller model.
    // TO RESTORE SEGMIND when credits are back: set provider='segmind' and
    // runtimeModel='nano-banana-2'. No other changes needed.
    provider: 'google',
    runtimeModel: 'gemini-3.1-flash-image-preview',
    supportsRefs: true,
    maxRefs: 10,
    note: 'Routed to Google Gemini 3.1 Flash Image while Segmind credits are out.',
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
