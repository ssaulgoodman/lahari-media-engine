import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { ApiProject } from '../types';
import * as api from '../services/api';
import { supabase } from '../lib/supabase';

export type AgentOperationRow = {
  id: string;
  project_id: string;
  source: string;
  tool: string;
  status: 'running' | 'success' | 'error';
  scope_type: 'project' | 'scene' | 'shot';
  scope_id: string;
  label: string;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
};

export type RealtimeNotice = {
  tone: 'working' | 'updated' | 'error';
  message: string;
};

type SetProject = (update: ApiProject | ((prev: ApiProject | null) => ApiProject | null) | null) => void;

export const useRealtimePresence = (
  projectId: string | undefined,
  activeProjectId: MutableRefObject<string | null>,
  setProject: SetProject,
) => {
  const [agentOperations, setAgentOperations] = useState<Record<string, AgentOperationRow>>({});
  const [realtimeNotice, setRealtimeNotice] = useState<RealtimeNotice | null>(null);
  const realtimeRefreshTimer = useRef<number | null>(null);
  const realtimeNoticeTimer = useRef<number | null>(null);

  const clearRealtimeNoticeLater = useCallback(() => {
    if (realtimeNoticeTimer.current) window.clearTimeout(realtimeNoticeTimer.current);
    realtimeNoticeTimer.current = window.setTimeout(() => setRealtimeNotice(null), 3600);
  }, []);

  const scheduleRealtimeProjectRefresh = useCallback((message = 'Studio updated') => {
    const activeId = activeProjectId.current;
    if (!activeId) return;
    setRealtimeNotice({ tone: 'updated', message });
    if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
    realtimeRefreshTimer.current = window.setTimeout(async () => {
      try {
        const latest = await api.getProject(activeId);
        setProject(current => current?.id === activeId ? latest : current);
        setRealtimeNotice({ tone: 'updated', message });
      } catch (err: any) {
        setRealtimeNotice({ tone: 'error', message: err?.message || 'Realtime refresh failed' });
      } finally {
        clearRealtimeNoticeLater();
      }
    }, 800);
  }, [activeProjectId, clearRealtimeNoticeLater, setProject]);

  useEffect(() => {
    setAgentOperations({});
    setRealtimeNotice(null);
    if (!projectId) return;

    const handleAgentOperation = (payload: any) => {
      const row = (payload.new || payload.old) as AgentOperationRow | undefined;
      if (!row || row.project_id !== projectId) return;
      if (row.status === 'running') {
        setAgentOperations(current => ({ ...current, [row.id]: row }));
        setRealtimeNotice({ tone: 'working', message: row.label || 'Codex is working' });
        return;
      }
      setAgentOperations(current => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      scheduleRealtimeProjectRefresh(row.status === 'error'
        ? `${row.label || 'Codex work'} failed`
        : `${row.label || 'Codex work'} finished`);
    };

    const handleProjectChange = (payload: any) => {
      const row = (payload.new || payload.old) as any;
      if (row?.project_id && row.project_id !== projectId) return;
      if (row?.id && row.id !== projectId && payload.table === 'lahari_projects') return;
      if (payload.table === 'lahari_director_events' && row?.source === 'codex') {
        scheduleRealtimeProjectRefresh(row.summary || 'Codex updated the project');
        return;
      }
      scheduleRealtimeProjectRefresh('Studio updated');
    };

    const channel = supabase
      .channel(`lahari-project-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_agent_operations', filter: `project_id=eq.${projectId}` }, handleAgentOperation)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_projects', filter: `id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_scenes', filter: `project_id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_shots', filter: `project_id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_cast_members', filter: `project_id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_environments', filter: `project_id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_assets', filter: `project_id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_storyboard_versions', filter: `project_id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_renders', filter: `project_id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_project_timelines', filter: `project_id=eq.${projectId}` }, () => {
        setRealtimeNotice({ tone: 'updated', message: 'Timeline updated' });
        clearRealtimeNoticeLater();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_project_config', filter: `project_id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lahari_project_prompt_overrides', filter: `project_id=eq.${projectId}` }, handleProjectChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lahari_director_events', filter: `project_id=eq.${projectId}` }, handleProjectChange);

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      if (realtimeNoticeTimer.current) window.clearTimeout(realtimeNoticeTimer.current);
    };
  }, [projectId, scheduleRealtimeProjectRefresh]);

  return { agentOperations, realtimeNotice };
};
