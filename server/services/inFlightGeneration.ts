const inFlight = new Set<string>();

type GenerationKind = 'image' | 'end-frame' | 'storyboard' | 'video' | string;

// Process-local duplicate-submit guard. This prevents same-instance double
// clicks / agent retries; provider attempt ledgers remain the cross-instance
// accounting layer.
const generationLabels: Record<string, string> = {
  'audio-structure': 'Audio-structure analysis',
  'audio-transcribe': 'Audio transcription',
  'dialogue-audio': 'Dialogue audio',
  'environment-look': 'Environment-look',
  image: 'Start-frame',
  'end-frame': 'End-frame',
  'character-look': 'Character-look',
  'style-brainstorm': 'Style-brainstorm',
  'style-candidates': 'Style-candidate',
  'style-identify': 'Style-identification',
  'style-refine': 'Style-refinement',
  storyboard: 'Storyboard',
  video: 'Video',
  'voice-change': 'Voice-change',
};

export const generationKey = (kind: GenerationKind, projectId: string, shotId: string) => `${kind}:${projectId}:${shotId}`;

export const beginInFlightGeneration = (key: string): (() => void) | null => {
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  return () => {
    inFlight.delete(key);
  };
};

export const beginInFlightGenerations = (keys: string[]): (() => void) | null => {
  const uniqueKeys = [...new Set(keys)].sort();
  if (!uniqueKeys.length) return () => {};
  if (uniqueKeys.some((key) => inFlight.has(key))) return null;
  for (const key of uniqueKeys) inFlight.add(key);
  return () => {
    for (const key of uniqueKeys) inFlight.delete(key);
  };
};

export const generationAlreadyRunningError = (
  kind: GenerationKind,
  projectId: string,
  targetId: string,
  targetLabel = 'shot',
) => {
  const label = generationLabels[kind] || 'Generation';
  const targetPhrase = targetLabel === 'shot' ? 'this shot' : `this ${targetLabel}`;
  const error = new Error(JSON.stringify({
    code: 'generation_already_running',
    message: `${label} generation is already running for ${targetPhrase}. Wait for it to finish before starting another.`,
    kind,
    projectId,
    targetId,
    ...(targetLabel === 'shot' ? { shotId: targetId } : {}),
  })) as Error & { statusCode?: number };
  error.statusCode = 409;
  return error;
};

export const withInFlightGeneration = async <T>(
  key: string,
  meta: { kind: GenerationKind; projectId: string; targetId?: string; shotId?: string; targetLabel?: string },
  run: () => Promise<T>,
): Promise<T> => {
  const release = beginInFlightGeneration(key);
  if (!release) throw generationAlreadyRunningError(meta.kind, meta.projectId, meta.targetId || meta.shotId || meta.projectId, meta.targetLabel);
  try {
    return await run();
  } finally {
    release();
  }
};

export const withInFlightGenerations = async <T>(
  keys: string[],
  meta: { kind: GenerationKind; projectId: string; targetId?: string; shotId?: string; targetLabel?: string },
  run: () => Promise<T>,
): Promise<T> => {
  const release = beginInFlightGenerations(keys);
  if (!release) throw generationAlreadyRunningError(meta.kind, meta.projectId, meta.targetId || meta.shotId || meta.projectId, meta.targetLabel);
  try {
    return await run();
  } finally {
    release();
  }
};
