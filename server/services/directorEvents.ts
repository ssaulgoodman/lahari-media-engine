import { v4 as uuidv4 } from 'uuid';
import { getSB, T } from '../database.js';

export type DirectorEventSource = 'web' | 'codex' | 'system';

export type DirectorEventInput = {
  projectId: string;
  userId?: string | null;
  source: DirectorEventSource;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  payload?: Record<string, any>;
};

export type DirectorEvent = {
  id: string;
  seq?: number;
  project_id: string;
  user_id: string | null;
  source: DirectorEventSource;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  payload: Record<string, any>;
  created_at: string;
};

const safePayload = (payload?: Record<string, any>) => {
  if (!payload) return {};
  return JSON.parse(JSON.stringify(payload));
};

const isMissingTableError = (err: any): boolean => {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return code === '42P01'
    || code === 'PGRST205'
    || (message.includes('Could not find the table') && message.includes('lahari_director_events'));
};

export const recordDirectorEvent = async (input: DirectorEventInput): Promise<void> => {
  const row = {
      id: uuidv4(),
      project_id: input.projectId,
      user_id: input.userId || null,
      source: input.source,
      event_type: input.eventType,
      entity_type: input.entityType || null,
      entity_id: input.entityId || null,
      summary: input.summary,
      payload: safePayload(input.payload),
  };

  const { error } = await getSB().from(T.director_events).insert(row);
  if (!error) return;

  if (isMissingTableError(error)) {
    console.warn(`[director-events] table missing; ${input.eventType} for ${input.projectId} not recorded yet.`);
    return;
  }

  console.error(`[director-events] FAILED to record ${input.eventType} for ${input.projectId}: ${error.message}`, {
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
};

export const listDirectorEvents = async (
  projectId: string,
  opts: { afterSeq?: number | null; afterCreatedAt?: string | null; limit?: number } = {},
): Promise<DirectorEvent[]> => {
  try {
    if (typeof opts.afterSeq === 'number' && Number.isFinite(opts.afterSeq)) {
      const events: DirectorEvent[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await getSB()
          .from(T.director_events)
          .select('*')
          .eq('project_id', projectId)
          .gt('seq', opts.afterSeq)
          .order('seq', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        events.push(...((data || []) as DirectorEvent[]));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return events;
    }

    let query = getSB()
      .from(T.director_events)
      .select('*')
      .eq('project_id', projectId);

    if (opts.afterCreatedAt) {
      query = query.gt('created_at', opts.afterCreatedAt).order('created_at', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: false }).limit(opts.limit || 50);
    }

    const { data, error } = await query;
    if (error) throw error;
    const events = (data || []) as DirectorEvent[];
    return opts.afterCreatedAt ? events : events.reverse();
  } catch (err: any) {
    const level = isMissingTableError(err) ? console.warn : console.error;
    level(`[director-events] could not read events for ${projectId}: ${err?.message || err}`);
    return [];
  }
};

export const eventResultPointers = (result: Record<string, any> | null | undefined): Record<string, any> => {
  if (!result || typeof result !== 'object') return {};
  const pointers: Record<string, any> = {};
  for (const key of [
    'assetId',
    'versionId',
    'videoAssetId',
    'storyboardAssetId',
    'extractedLastFrameAssetId',
    'renderId',
    'status',
    'model',
    'provider',
    'mode',
    'durationSec',
    'costEstimate',
  ]) {
    if (result[key] !== undefined) pointers[key] = result[key];
  }
  return pointers;
};
