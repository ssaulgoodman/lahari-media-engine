const inFlight = new Set<string>();

export const beginInFlightGeneration = (key: string): (() => void) | null => {
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  return () => {
    inFlight.delete(key);
  };
};

