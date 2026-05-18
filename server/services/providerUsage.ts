import { getSB, T } from '../database.js';
import { type ByokProvider } from './byok/resolver.js';

export const TTS_DAILY_CAP_USD = 20;

export class DailyCapExceededError extends Error {
  code = 'daily_cap_exceeded';
  currentUsd: number;
  capUsd: number;
  capResetsAtUtc: string;

  constructor(currentUsd: number, capUsd = TTS_DAILY_CAP_USD) {
    super(`Daily provider cap exceeded. Current usage is $${currentUsd.toFixed(2)} of $${capUsd.toFixed(2)}.`);
    this.name = 'DailyCapExceededError';
    this.currentUsd = currentUsd;
    this.capUsd = capUsd;
    this.capResetsAtUtc = nextUtcMidnightIso();
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      currentUsd: this.currentUsd,
      capUsd: this.capUsd,
      capResetsAtUtc: this.capResetsAtUtc,
    };
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

const nextUtcMidnightIso = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
};

export const getProviderUsageForToday = async (
  userId: string,
  provider: ByokProvider,
): Promise<{ costUsd: number; charCount: number; dayUtc: string }> => {
  const dayUtc = todayUtc();
  const { data, error } = await getSB()
    .from(T.provider_usage_daily)
    .select('cost_usd,char_count')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('day_utc', dayUtc)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`DB select provider usage: ${error.message}`);
  return {
    costUsd: Number(data?.cost_usd || 0),
    charCount: Number(data?.char_count || 0),
    dayUtc,
  };
};

export const assertDailyCapAvailable = async (
  userId: string,
  provider: ByokProvider,
  estimatedUsd = 0,
  capUsd = TTS_DAILY_CAP_USD,
) => {
  const usage = await getProviderUsageForToday(userId, provider);
  if (usage.costUsd + estimatedUsd > capUsd) {
    throw new DailyCapExceededError(usage.costUsd, capUsd);
  }
  return usage;
};

export const incrementProviderUsageDaily = async (
  userId: string,
  provider: ByokProvider,
  delta: { costUsd?: number; charCount?: number },
) => {
  const dayUtc = todayUtc();
  const costUsd = Number(delta.costUsd || 0);
  const charCount = Math.max(0, Math.round(Number(delta.charCount || 0)));

  const existing = await getProviderUsageForToday(userId, provider);
  const now = new Date().toISOString();
  const { error } = await getSB()
    .from(T.provider_usage_daily)
    .upsert({
      user_id: userId,
      provider,
      day_utc: dayUtc,
      cost_usd: Number((existing.costUsd + costUsd).toFixed(4)),
      char_count: existing.charCount + charCount,
      updated_at: now,
    }, { onConflict: 'user_id,provider,day_utc' });
  if (error) throw new Error(`DB upsert provider usage: ${error.message}`);
};
