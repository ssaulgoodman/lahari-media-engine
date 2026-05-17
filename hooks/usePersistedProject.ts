import { useCallback, useEffect } from 'react';
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
  if (value === 'blueprint') return AppStep.BLUEPRINT;
  if (value === 'studio') return AppStep.STUDIO;
  if (value === 'render') return AppStep.RENDER;
  return null;
};

export const usePersistedProject = ({
  currentStep,
  projectId,
  setActiveSceneIdx,
  setCurrentStep,
  setProject,
  navigateToPhase,
}: UsePersistedProjectOptions) => {
  const persistState = useCallback((id: string | null, step: AppStep) => {
    if (id) localStorage.setItem('lahari:projectId', id);
    else localStorage.removeItem('lahari:projectId');
    localStorage.setItem('lahari:step', String(step));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedId = params.get('project') || params.get('projectId');
    const linkedStep = params.get('step');
    const linkedShot = params.get('shot') || params.get('shotId');
    const savedId = localStorage.getItem('lahari:projectId');
    const savedStepRaw = localStorage.getItem('lahari:step');
    const savedStep = savedStepRaw !== null ? Number(savedStepRaw) as AppStep : null;

    const focusLinkedShot = (project: ApiProject) => {
      if (!linkedShot) return;
      const sceneIndex = project.scenes.findIndex(scene => scene.shots.some(shot => shot.id === linkedShot));
      if (sceneIndex >= 0) setActiveSceneIdx(sceneIndex);
    };

    const load = async () => {
      try {
        const preferredId = linkedId || savedId;
        if (preferredId) {
          const project = await api.getProject(preferredId);
          if (project) {
            setProject(project);
            focusLinkedShot(project);
            const linkedStepValue = stepFromParam(linkedStep);
            if (linkedStepValue !== null) {
              setCurrentStep(linkedStepValue);
            } else if (!linkedId && savedStep !== null && savedStep >= AppStep.UPLOAD && savedStep <= AppStep.RENDER) {
              setCurrentStep(savedStep);
            } else {
              navigateToPhase(project);
            }
            return;
          }
        }

        const projects = await api.listProjects();
        if (projects.length > 0) {
          const project = await api.getProject(projects[0].id);
          if (project) {
            setProject(project);
            navigateToPhase(project);
          }
        }
      } catch {
        // No projects yet, stay on upload.
      }
    };

    load();
  }, [navigateToPhase, setActiveSceneIdx, setCurrentStep, setProject]);

  useEffect(() => {
    persistState(projectId || null, currentStep);
  }, [currentStep, persistState, projectId]);
};
