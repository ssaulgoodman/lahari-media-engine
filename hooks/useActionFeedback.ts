import { useState, useCallback, useRef } from 'react';

/**
 * Shared async action feedback — loading, error, success flash.
 * Replaces ad-hoc try/catch + console.error patterns across Blueprint & Studio.
 *
 * Usage:
 *   const action = useActionFeedback();
 *   <button disabled={action.isPending} onClick={() => action.run(() => api.doThing())}>
 *     {action.isPending ? 'Working...' : 'Do Thing'}
 *   </button>
 *   <ActionError error={action.error} onDismiss={action.clearError} />
 */

export interface ActionFeedbackState {
  isPending: boolean;
  error: string | null;
  flash: boolean;          // brief success indicator
}

export function useActionFeedback() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async <T,>(
    fn: () => Promise<T>,
    opts?: { successFlash?: boolean }
  ): Promise<T | undefined> => {
    setIsPending(true);
    setError(null);
    try {
      const result = await fn();
      if (opts?.successFlash !== false) {
        setFlash(true);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(false), 1500);
      }
      return result;
    } catch (err: any) {
      const msg = err?.message || 'Something went wrong';
      setError(msg);
      return undefined;
    } finally {
      setIsPending(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { isPending, error, flash, run, clearError };
}

/**
 * Keyed variant — tracks multiple independent actions by key.
 * Useful for lists (cast members, environments, shots) where each
 * item has its own async action.
 *
 * Usage:
 *   const actions = useKeyedActionFeedback();
 *   <button disabled={actions.isPending(envId)} onClick={() =>
 *     actions.run(envId, () => api.lockEnvironment(projectId, envId))
 *   }>Lock</button>
 *   <ActionError error={actions.error(envId)} onDismiss={() => actions.clearError(envId)} />
 */
export function useKeyedActionFeedback() {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [flashes, setFlashes] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const run = useCallback(async <T,>(
    key: string,
    fn: () => Promise<T>,
    opts?: { successFlash?: boolean }
  ): Promise<T | undefined> => {
    setPending(prev => new Set(prev).add(key));
    setErrors(prev => { const m = new Map(prev); m.delete(key); return m; });
    try {
      const result = await fn();
      if (opts?.successFlash !== false) {
        setFlashes(prev => new Set(prev).add(key));
        const old = timers.current.get(key);
        if (old) clearTimeout(old);
        timers.current.set(key, setTimeout(() => {
          setFlashes(prev => { const s = new Set(prev); s.delete(key); return s; });
        }, 1500));
      }
      return result;
    } catch (err: any) {
      setErrors(prev => new Map(prev).set(key, err?.message || 'Something went wrong'));
      return undefined;
    } finally {
      setPending(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, []);

  return {
    isPending: (key: string) => pending.has(key),
    error: (key: string) => errors.get(key) || null,
    flash: (key: string) => flashes.has(key),
    run,
    clearError: (key: string) => setErrors(prev => { const m = new Map(prev); m.delete(key); return m; }),
  };
}
