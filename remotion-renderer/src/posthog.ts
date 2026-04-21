import { PostHog } from 'posthog-node';

const key = process.env.POSTHOG_API_KEY;

export const posthog = key
  ? new PostHog(key, {
      host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
      flushAt: 1,
      flushInterval: 0,
    })
  : null;

export const track = (event: string, distinctId: string, properties?: Record<string, unknown>) => {
  posthog?.capture({ distinctId, event, properties });
};

export const trackError = (distinctId: string, err: unknown, properties?: Record<string, unknown>) => {
  const e = err instanceof Error ? err : new Error(String(err));
  posthog?.captureException(e, distinctId, properties);
};

export const shutdownPosthog = async () => {
  await posthog?.shutdown();
};
