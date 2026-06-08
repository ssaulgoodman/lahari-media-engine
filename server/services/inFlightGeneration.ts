const inFlight = new Set<string>();

type GenerationKind = 'image' | 'end-frame' | 'storyboard' | 'video' | string;

// Process-local duplicate-submit guard. This prevents same-instance double
// clicks / agent retries; provider attempt ledgers remain the cross-instance
// accounting layer.
const generationLabels: Record<string, string> = {
  image: 'Start-frame',
  'end-frame': 'End-frame',
  storyboard: 'Storyboard',
  video: 'Video',
};

export const generationKey = (kind: GenerationKind, projectId: string, shotId: string) => `${kind}:${projectId}:${shotId}`;

export const beginInFlightGeneration = (key: string): (() => void) | null => {
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  return () => {
    inFlight.delete(key);
  };
};

export const generationAlreadyRunningError = (
  kind: GenerationKind,
  projectId: string,
  shotId: string,
) => {
  const label = generationLabels[kind] || 'Generation';
  const error = new Error(JSON.stringify({
    code: 'generation_already_running',
    message: `${label} generation is already running for this shot. Wait for it to finish before starting another.`,
    kind,
    projectId,
    shotId,
  })) as Error & { statusCode?: number };
  error.statusCode = 409;
  return error;
};

export const withInFlightGeneration = async <T>(
  key: string,
  meta: { kind: GenerationKind; projectId: string; shotId: string },
  run: () => Promise<T>,
): Promise<T> => {
  const release = beginInFlightGeneration(key);
  if (!release) throw generationAlreadyRunningError(meta.kind, meta.projectId, meta.shotId);
  try {
    return await run();
  } finally {
    release();
  }
};
