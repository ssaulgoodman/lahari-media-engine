import type { ApiProject } from '../types';
import type { Phase } from './blueprintPhases';

const PROJECT_STATUS_ORDER = [
  'uploaded',
  'analyzing',
  'analyzed',
  'concept_locked',
  'scripted',
  'style_locked',
  'characters_locked',
  'environments_locked',
  'in_production',
  'rendered',
  'completed',
] as const;

const statusIndex = (status: string): number => {
  const idx = PROJECT_STATUS_ORDER.indexOf(status as typeof PROJECT_STATUS_ORDER[number]);
  return idx >= 0 ? idx : -1;
};

export const isProjectStatusAtLeast = (status: string, target: typeof PROJECT_STATUS_ORDER[number]): boolean =>
  statusIndex(status) >= statusIndex(target);

export const canReopenBlueprintPhase = (project: Pick<ApiProject, 'status'>, phase: Phase): boolean => {
  switch (phase) {
    case 'script':
      return isProjectStatusAtLeast(project.status, 'scripted');
    case 'style':
      return isProjectStatusAtLeast(project.status, 'style_locked');
    case 'characters':
      return isProjectStatusAtLeast(project.status, 'characters_locked');
    case 'environments':
      return isProjectStatusAtLeast(project.status, 'environments_locked');
    default:
      return false;
  }
};
