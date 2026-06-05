export interface ImageModelSpec {
  key: string;
  label: string;
  provider: 'segmind';
  runtimeModel: string;
  supportsRefs: boolean;
  maxRefs: number;
  note?: string;
}

// Order matters: first entry is the default for new projects and what
// getImageModel() returns when no key is set or when an older project still
// stores a retired Google image key. Visual generation is routed through
// Segmind by default; Google image routes are intentionally not active.
export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    key: 'nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'segmind',
    runtimeModel: 'nano-banana-2',
    supportsRefs: true,
    maxRefs: 10,
    note: 'Segmind Nano Banana 2. Default visual model for style, character, environment, and frame generation.',
  },
];

const LEGACY_IMAGE_MODEL_ALIASES: Record<string, string> = {
  'gemini-3-pro': 'nano-banana-2',
  'nano-banana-pro': 'nano-banana-2',
  'gpt-image-2': 'nano-banana-2',
};

export const getImageModel = (key: string | undefined | null): ImageModelSpec =>
  IMAGE_MODELS.find((model) => model.key === (key ? LEGACY_IMAGE_MODEL_ALIASES[key] || key : key)) ?? IMAGE_MODELS[0];

export const isSegmindImageModel = (key: string | undefined | null): boolean =>
  getImageModel(key).provider === 'segmind';
