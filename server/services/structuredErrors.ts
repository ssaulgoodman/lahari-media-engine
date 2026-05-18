import type { Response } from 'express';
import { MissingProviderKeyError } from './byok/resolver.js';
import { DailyCapExceededError } from './providerUsage.js';
import { RateLimitError } from './rateLimit.js';

export type StructuredErrorBody = {
  code: string;
  message: string;
  provider?: string;
  setupUrl?: string;
  retryAfterSeconds?: number;
  details?: unknown;
  currentUsd?: number;
  capUsd?: number;
  capResetsAtUtc?: string;
};

export const structuredError = (error: unknown, fallbackCode = 'server_error'): StructuredErrorBody => {
  if (error instanceof MissingProviderKeyError) return error.toJSON();
  if (error instanceof DailyCapExceededError) return error.toJSON();
  if (error instanceof RateLimitError) {
    return {
      code: 'rate_limited',
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string' && typeof parsed.message === 'string') {
        return parsed;
      }
    } catch {
      // Plain error; normalize below.
    }

    return {
      code: error.message.toLowerCase().includes('auth') ? 'auth_expired' : fallbackCode,
      message: error.message,
    };
  }

  return {
    code: fallbackCode,
    message: String(error || 'Unknown error'),
  };
};

export const statusForStructuredError = (error: unknown, body = structuredError(error)): number => {
  const explicitStatus = Number((error as any)?.statusCode || (error as any)?.status);
  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599) return explicitStatus;
  if (error instanceof MissingProviderKeyError || body.code === 'missing_key') return 402;
  if (error instanceof DailyCapExceededError || body.code === 'daily_cap_exceeded') return 402;
  if (error instanceof RateLimitError || body.code === 'rate_limited') return 429;
  const message = body.message.toLowerCase();
  if (body.code === 'auth_expired' || message.includes('auth')) return 401;
  if (message.includes('access denied')) return 403;
  if (message.includes('not found')) return 404;
  return 500;
};

export const sendStructuredError = (res: Response, error: unknown, fallbackCode = 'server_error') => {
  const body = structuredError(error, fallbackCode);
  return res.status(statusForStructuredError(error, body)).json({
    ok: false,
    error: body,
  });
};
