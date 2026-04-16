// Shared video model registry — must stay in sync with
// server/services/veo.ts (VEO_MODELS) and server/services/fal.ts (FAL_VIDEO_MODELS).
// These are the only models the UI exposes + that the server accepts.

export interface VideoModelSpec {
  key: string;
  label: string;
  provider: 'veo' | 'fal';
  /** Allowed shot durations (seconds). First entry is the default. */
  durations: number[];
  /** Rough cost estimate for display ($/sec). */
  costPerSec: number;
  /** Extra context shown under the label in the picker. */
  note?: string;
  /** Whether this model accepts an end keyframe (enables reverse-chain). */
  supportsLastFrame: boolean;
}

export const VIDEO_MODELS: VideoModelSpec[] = [
  {
    key: 'veo-3.0-fast',
    label: 'Veo 3.0 Fast',
    provider: 'veo',
    durations: [8],
    costPerSec: 0.10,
    supportsLastFrame: false,
  },
  {
    key: 'veo-3.0',
    label: 'Veo 3.0',
    provider: 'veo',
    durations: [4, 6, 8],
    costPerSec: 0.20,
    supportsLastFrame: false,
  },
  {
    key: 'veo-3.1-fast',
    label: 'Veo 3.1 Fast',
    provider: 'veo',
    durations: [8],
    costPerSec: 0.10,
    supportsLastFrame: true,
  },
  {
    key: 'veo-3.1',
    label: 'Veo 3.1',
    provider: 'veo',
    durations: [4, 6, 8],
    costPerSec: 0.20,
    supportsLastFrame: true,
  },
  {
    key: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    provider: 'fal',
    durations: [5, 10],
    costPerSec: 0.24,
    note: '5s or 10s via fal.ai',
    supportsLastFrame: false,
  },
  {
    key: 'seedance-2.0',
    label: 'Seedance 2.0',
    provider: 'fal',
    durations: [5, 10],
    costPerSec: 0.30,
    note: '5s or 10s, higher quality',
    supportsLastFrame: false,
  },
];

export const getVideoModel = (key: string | undefined): VideoModelSpec =>
  VIDEO_MODELS.find(m => m.key === key) ?? VIDEO_MODELS[0];
