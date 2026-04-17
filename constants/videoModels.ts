// Shared video model registry — must stay in sync with
// server/services/segmind.ts (SEGMIND_MODELS).
// All models now route through Segmind's unified API.

export interface VideoModelSpec {
  key: string;
  label: string;
  provider: 'segmind';
  /** Allowed shot durations (seconds). First entry is the default. */
  durations: number[];
  /** Rough cost estimate for display ($/sec). */
  costPerSec: number;
  /** Extra context shown under the label in the picker. */
  note?: string;
  /** Whether this model accepts an end keyframe (enables reverse-chain). */
  supportsLastFrame: boolean;
  /** Whether this model accepts reference images for consistency. */
  supportsRefs: boolean;
}

export const VIDEO_MODELS: VideoModelSpec[] = [
  {
    key: 'veo-3.1-fast',
    label: 'Veo 3.1 Fast',
    provider: 'segmind',
    durations: [8],
    costPerSec: 0.10,
    supportsLastFrame: true,
    supportsRefs: true,
  },
  {
    key: 'veo-3.1',
    label: 'Veo 3.1',
    provider: 'segmind',
    durations: [4, 6, 8],
    costPerSec: 0.20,
    supportsLastFrame: true,
    supportsRefs: true,
  },
  {
    key: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    provider: 'segmind',
    durations: [5, 10],
    costPerSec: 0.146,
    note: 'Up to 9 ref images',
    supportsLastFrame: true,
    supportsRefs: true,
  },
  {
    key: 'seedance-2.0',
    label: 'Seedance 2.0',
    provider: 'segmind',
    durations: [5, 10],
    costPerSec: 0.182,
    note: 'Higher quality, up to 9 ref images',
    supportsLastFrame: true,
    supportsRefs: true,
  },
];

export const getVideoModel = (key: string | undefined): VideoModelSpec =>
  VIDEO_MODELS.find(m => m.key === key) ?? VIDEO_MODELS[0];
