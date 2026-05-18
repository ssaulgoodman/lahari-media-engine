import { AsyncLocalStorage } from 'node:async_hooks';

type RequestContext = {
  userId?: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getCurrentUserId = (): string | null =>
  storage.getStore()?.userId || null;
