type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const now = () => Date.now();

const cleanupExpiredBuckets = (at = now()) => {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= at) buckets.delete(key);
  }
};

export class RateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const envInt = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const assertRateLimit = (opts: {
  key: string;
  limit: number;
  windowMs: number;
  label: string;
}) => {
  const at = now();
  cleanupExpiredBuckets(at);
  const current = buckets.get(opts.key);
  const bucket = current && current.resetAt > at
    ? current
    : { count: 0, resetAt: at + opts.windowMs };

  bucket.count += 1;
  buckets.set(opts.key, bucket);

  if (bucket.count <= opts.limit) return;

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - at) / 1000));
  throw new RateLimitError(`${opts.label} rate limit exceeded. Try again in ${retryAfterSeconds}s.`, retryAfterSeconds);
};
