import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectAll } from '../database.js';

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

export const recordDirectorEvent = async (input: DirectorEventInput): Promise<void> => {
  try {
    await insertRow('director_events', {
      id: uuidv4(),
      project_id: input.projectId,
      user_id: input.userId || null,
      source: input.source,
      event_type: input.eventType,
      entity_type: input.entityType || null,
      entity_id: input.entityId || null,
      summary: input.summary,
      payload: safePayload(input.payload),
    });
  } catch (err: any) {
    console.warn(`[director-events] ${input.eventType} not recorded: ${err?.message || err}`);
  }
};

export const listDirectorEvents = async (
  projectId: string,
  opts: { after?: string | null; limit?: number } = {},
): Promise<DirectorEvent[]> => {
  try {
    let events = await selectAll('director_events', { project_id: projectId }, {
      orderBy: 'created_at',
      ascending: false,
      limit: opts.limit || 50,
    }) as DirectorEvent[];
    if (opts.after) {
      const afterTime = Date.parse(opts.after);
      if (!Number.isNaN(afterTime)) {
        events = events.filter((event) => Date.parse(event.created_at) > afterTime);
      }
    }
    return events.reverse();
  } catch (err: any) {
    console.warn(`[director-events] could not read events for ${projectId}: ${err?.message || err}`);
    return [];
  }
};
