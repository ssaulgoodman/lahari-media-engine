import { useCallback, useEffect, useState } from 'react';
import { ApiProject, AppStep } from '../types';
import * as api from '../services/api';

type SetProject = (update: ApiProject | ((prev: ApiProject | null) => ApiProject | null) | null) => void;

type UsePersistedProjectOptions = {
  currentStep: AppStep;
  projectId: string | undefined;
  setActiveSceneIdx: (idx: number) => void;
  setCurrentStep: (step: AppStep) => void;
  setProject: SetProject;
  navigateToPhase: (project: ApiProject) => void;
};

const stepFromParam = (value: string | null): AppStep | null => {
  if (value === 'queue') return AppStep.UPLOAD;
  if (value === 'start') return AppStep.UPLOAD;
  if (value === 'blueprint') return AppStep.BLUEPRINT;
  if (value === 'studio') return AppStep.STUDIO;
  if (value === 'render') return AppStep.RENDER;
  return null;
};

const stepToParam = (step: AppStep): string => {
  if (step === AppStep.UPLOAD) return 'start';
  if (step === AppStep.BLUEPRINT) return 'blueprint';
  if (step === AppStep.STUDIO) return 'studio';
  if (step === AppStep.RENDER) return 'render';
  return 'start';
};

const TAB_PROJECT_KEY = 'mirage:tab:projectId';
const TAB_STEP_KEY = 'mirage:tab:step';
const GLOBAL_PROJECT_KEY = 'mirage:projectId';
const GLOBAL_STEP_KEY = 'mirage:step';

const LEGACY_PROJECT_KEY = 'lahari:projectId';
const LEGACY_STEP_KEY = 'lahari:step';

const validStoredStep = (value: string | null): AppStep | null => {
  if (value === null) return null;
  const step = Number(value) as AppStep;
  return step >= AppStep.UPLOAD && step <= AppStep.RENDER ? step : null;
};

export const usePersistedProject = ({
  currentStep,
  projectId,
  setActiveSceneIdx,
  setCurrentStep,
  setProject,
  navigateToPhase,
}: UsePersistedProjectOptions) => {
  const [restoring, setRestoring] = useState(true);

  const writeUrl = useCallback((id: string | null, step: AppStep) => {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set('project', id);
      url.searchParams.delete('projectId');
      url.searchParams.set('step', stepToParam(step));
    } else {
      url.searchParams.delete('project');
      url.searchParams.delete('projectId');
      url.searchParams.delete('shot');
      url.searchParams.delete('shotId');
      if (step === AppStep.UPLOAD) url.searchParams.delete('step');
      else url.searchParams.set('step', stepToParam(step));
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(null, '', next);
  }, []);

  const persistState = useCallback((id: string | null, step: AppStep) => {
    if (id) {
      sessionStorage.setItem(TAB_PROJECT_KEY, id);
      localStorage.setItem(GLOBAL_PROJECT_KEY, id);
    } else {
      sessionStorage.removeItem(TAB_PROJECT_KEY);
    }
    sessionStorage.setItem(TAB_STEP_KEY, String(step));
    localStorage.setItem(GLOBAL_STEP_KEY, String(step));
    writeUrl(id, step);
  }, [writeUrl]);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const params = new URLSearchParams(window.location.search);
      const linkedId = params.get('project') || params.get('projectId');
      const linkedStepValue = stepFromParam(params.get('step'));
      const linkedShot = params.get('shot') || params.get('shotId');
      const tabId = sessionStorage.getItem(TAB_PROJECT_KEY);
      const tabStep = validStoredStep(sessionStorage.getItem(TAB_STEP_KEY));
      const globalId = localStorage.getItem(GLOBAL_PROJECT_KEY) || localStorage.getItem(LEGACY_PROJECT_KEY);
      const globalStep = validStoredStep(localStorage.getItem(GLOBAL_STEP_KEY) || localStorage.getItem(LEGACY_STEP_KEY));

      const focusLinkedShot = (project: ApiProject) => {
        if (!linkedShot) return;
        const sceneIndex = project.scenes.findIndex(scene => scene.shots.some(shot => shot.id === linkedShot));
        if (sceneIndex >= 0) setActiveSceneIdx(sceneIndex);
      };

      const stepForProject = (id: string, project: ApiProject): AppStep | null => {
        if (linkedStepValue !== null) return linkedStepValue;
        if (id === tabId && tabStep !== null) return tabStep;
        if (!linkedId && id === globalId && globalStep !== null) return globalStep;
        return null;
      };

      const loadProject = async (id: string): Promise<boolean> => {
        const project = await api.getProject(id);
        if (!project || cancelled) return false;
        setProject(project);
        focusLinkedShot(project);
        const restoredStep = stepForProject(id, project);
        if (restoredStep !== null) setCurrentStep(restoredStep);
        else navigateToPhase(project);
        return true;
      };

      try {
        const preferredId = linkedId || tabId || globalId;
        if (preferredId && await loadProject(preferredId)) return;

        const projects = await api.listProjects();
        if (projects.length > 0) await loadProject(projects[0].id);
      } catch {
        // No projects yet, stay on Start.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    };

    restore();

    return () => { cancelled = true; };
  }, [navigateToPhase, setActiveSceneIdx, setCurrentStep, setProject]);

  useEffect(() => {
    if (restoring) return;
    persistState(projectId || null, currentStep);
  }, [currentStep, persistState, projectId, restoring]);

  useEffect(() => {
    let cancelled = false;
    let requestSeq = 0;

    const onPopState = async () => {
      const seq = ++requestSeq;
      const stillCurrent = () => !cancelled && seq === requestSeq;
      const params = new URLSearchParams(window.location.search);
      const linkedId = params.get('project') || params.get('projectId');
      const linkedStepValue = stepFromParam(params.get('step'));
      const linkedShot = params.get('shot') || params.get('shotId');
      if (!linkedId) {
        if (!stillCurrent()) return;
        setRestoring(false);
        setProject(null);
        setCurrentStep(linkedStepValue ?? AppStep.UPLOAD);
        return;
      }
      try {
        setRestoring(true);
        const project = await api.getProject(linkedId);
        if (!stillCurrent()) return;
        setProject(project);
        if (linkedShot) {
          const sceneIndex = project.scenes.findIndex(scene => scene.shots.some(shot => shot.id === linkedShot));
          if (sceneIndex >= 0) setActiveSceneIdx(sceneIndex);
        }
        if (linkedStepValue !== null) setCurrentStep(linkedStepValue);
        else navigateToPhase(project);
      } finally {
        if (stillCurrent()) setRestoring(false);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', onPopState);
    };
  }, [navigateToPhase, setActiveSceneIdx, setCurrentStep, setProject]);

  return { restoring };
};
