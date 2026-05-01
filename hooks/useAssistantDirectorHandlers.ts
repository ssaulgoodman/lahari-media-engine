import { useMemo } from 'react';
import * as api from '../services/api';
import type { ApiProject } from '../types';
import type { ActiveProjectSnapshot, ToolResult } from '../components/FloatingAiButton';

interface Args {
  project: ApiProject | null;
  setProject: (p: ApiProject) => void;
}

/**
 * Wires the assistant-director client tools defined in
 * `components/FloatingAiButton.tsx` to the live App project state.
 *
 * Each handler:
 *  - calls the corresponding `services/api.ts` endpoint
 *  - refetches the project so React state matches DB state
 *  - returns a `{ ok, message }` payload the agent reads via addToolResult
 *
 * To add a new client tool, add the prop on FloatingAiButtonProps, the
 * branch in `resolveClientTool`, and the handler here.
 */
export function useAssistantDirectorHandlers({ project, setProject }: Args) {
  return useMemo(() => {
    const noProject: ToolResult = { ok: false, message: 'no project loaded' };

    const refresh = async (msg: string): Promise<ToolResult> => {
      if (!project) return noProject;
      const fresh = await api.getProject(project.id);
      setProject(fresh);
      return { ok: true, message: msg };
    };

    const onGetActiveProject = (): ActiveProjectSnapshot | null => {
      if (!project) return null;
      const idx = project.lockedConcept
        ? project.conceptOptions.findIndex(c => c.title === project.lockedConcept!.title)
        : -1;
      return {
        id: project.id,
        title: project.title,
        status: project.status,
        lockedConceptIndex: idx >= 0 ? idx : null,
        hasConceptOptions: (project.conceptOptions?.length ?? 0) > 0,
      };
    };

    const onRefreshProject = async (): Promise<ToolResult> => {
      if (!project) return noProject;
      try {
        return await refresh(`refreshed "${project.title}"`);
      } catch (err: any) {
        return { ok: false, message: err?.message ?? 'refresh failed' };
      }
    };

    const onGenerateConcepts = async (
      opts: { userNote?: string; directorBrief?: string }
    ): Promise<ToolResult<{ concepts?: unknown[] }>> => {
      if (!project) return noProject;
      try {
        await api.generateConcepts(project.id, opts);
        const fresh = await api.getProject(project.id);
        setProject(fresh);
        return {
          ok: true,
          message: `generated ${fresh.conceptOptions?.length ?? 0} concept option(s)`,
          concepts: fresh.conceptOptions,
        };
      } catch (err: any) {
        return { ok: false, message: err?.message ?? 'generateConcepts failed' };
      }
    };

    const onLockConcept = async (
      { conceptIndex, fork }: { conceptIndex: number; fork?: boolean }
    ): Promise<ToolResult> => {
      if (!project) return noProject;
      try {
        const result = await api.lockConcept(project.id, conceptIndex, fork ? { fork: true } : undefined);
        const targetId = result?.id ?? project.id;
        const fresh = await api.getProject(targetId);
        setProject(fresh);
        return {
          ok: true,
          message: `locked concept #${conceptIndex}${fork ? ` (forked to ${fresh.id})` : ''}`,
        };
      } catch (err: any) {
        return { ok: false, message: err?.message ?? 'lockConcept failed' };
      }
    };

    const onRefineConcept = async (
      { feedback }: { feedback: string }
    ): Promise<ToolResult> => {
      if (!project) return noProject;
      try {
        await api.refineConcept(project.id, feedback);
        return await refresh('concept refined');
      } catch (err: any) {
        return { ok: false, message: err?.message ?? 'refineConcept failed' };
      }
    };

    const onUnlockConcept = async (): Promise<ToolResult> => {
      if (!project) return noProject;
      try {
        await api.unlockConcept(project.id);
        return await refresh('concept unlocked');
      } catch (err: any) {
        return { ok: false, message: err?.message ?? 'unlockConcept failed' };
      }
    };

    // ─── Phase 1b — Script ────────────────────────────────────────────

    const onGenerateScript = async (
      { userNote, fork }: { userNote?: string; fork?: boolean }
    ): Promise<ToolResult<{ sceneCount?: number; shotCount?: number }>> => {
      if (!project) return noProject;
      try {
        await api.generateScript(project.id, userNote, fork ? { fork: true } : undefined);
        const fresh = await api.getProject(project.id);
        setProject(fresh);
        const sceneCount = fresh.scenes?.length ?? 0;
        const shotCount = fresh.scenes?.reduce((n: number, s: any) => n + (s.shots?.length ?? 0), 0) ?? 0;
        return {
          ok: true,
          message: `script generated: ${sceneCount} scene(s), ${shotCount} shot(s)${fork ? ' (forked)' : ''}`,
          sceneCount,
          shotCount,
        };
      } catch (err: any) {
        return { ok: false, message: err?.message ?? 'generateScript failed' };
      }
    };

    const onRefineScript = async (
      { feedback }: { feedback: string }
    ): Promise<ToolResult> => {
      if (!project) return noProject;
      try {
        await api.refineScript(project.id, feedback);
        return await refresh('script refined');
      } catch (err: any) {
        return { ok: false, message: err?.message ?? 'refineScript failed' };
      }
    };

    const onSplitShot = async (
      { shotId, splitAt }: { shotId: string; splitAt?: number }
    ): Promise<ToolResult<{ newShotId?: string }>> => {
      if (!project) return noProject;
      try {
        const result = await api.splitShot(project.id, shotId, splitAt);
        const fresh = await api.getProject(project.id);
        setProject(fresh);
        return {
          ok: true,
          message: `shot split${result?.newShotId ? ` (new shot: ${result.newShotId})` : ''}`,
          newShotId: result?.newShotId,
        };
      } catch (err: any) {
        return { ok: false, message: err?.message ?? 'splitShot failed' };
      }
    };

    return {
      onGetActiveProject,
      onRefreshProject,
      onGenerateConcepts,
      onLockConcept,
      onRefineConcept,
      onUnlockConcept,
      onGenerateScript,
      onRefineScript,
      onSplitShot,
    };
  }, [project, setProject]);
}
