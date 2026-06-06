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
  /** Whether refs work alongside start/end frames. Keep false unless provider proof exists. */
  refsWithFrames: boolean;
  /** Resolutions accepted by this provider/model endpoint. */
  resolutions: Array<'720p' | '1080p'>;
}

// Order matters: first entry is the default video model for new projects
// and what getVideoModel() returns when no key is set. Seedance 2.0 Fast
// chosen as default — it's the storyboard-mode workhorse (up to 15s
// clips) and Lahari now defaults to storyboard mode. Veo variants stay
// available for keyframe-mode runs that need longer ref chains.
//
// First entry of `durations` is the model's default shot length; we list
// 15 first on Seedance so the script-phase pacing picker defaults there.
export const VIDEO_MODELS: VideoModelSpec[] = [
  {
    key: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    provider: 'segmind',
    durations: [15, 4, 5, 6, 8, 10, 12],
    costPerSec: 0.146,
    note: 'Default. Storyboard clips up to 15s.',
    supportsLastFrame: true,
    supportsRefs: true,
    refsWithFrames: false,
    resolutions: ['720p'],
  },
  {
    key: 'seedance-2.0',
    label: 'Seedance 2.0',
    provider: 'segmind',
    durations: [15, 4, 5, 6, 8, 10, 12],
    costPerSec: 0.182,
    note: 'Higher quality, storyboard clips up to 15s.',
    supportsLastFrame: true,
    supportsRefs: true,
    refsWithFrames: false,
    resolutions: ['720p'],
  },
  {
    key: 'veo-3.1-fast',
    label: 'Veo 3.1 Fast',
    provider: 'segmind',
    durations: [8],
    costPerSec: 0.10,
    supportsLastFrame: true,
    supportsRefs: true,
    refsWithFrames: false,
    resolutions: ['720p', '1080p'],
  },
  {
    key: 'veo-3.1',
    label: 'Veo 3.1',
    provider: 'segmind',
    durations: [4, 6, 8],
    costPerSec: 0.20,
    supportsLastFrame: true,
    supportsRefs: true,
    refsWithFrames: false,
    resolutions: ['720p', '1080p'],
  },
];

export const getVideoModel = (key: string | undefined): VideoModelSpec =>
  VIDEO_MODELS.find(m => m.key === key) ?? VIDEO_MODELS[0];
