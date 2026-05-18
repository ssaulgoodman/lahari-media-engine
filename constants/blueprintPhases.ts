import type { ApiProject } from '../types';

export type Phase = 'concept' | 'script' | 'style' | 'characters' | 'environments' | 'audio';

export type BlueprintPhase = {
  key: Phase;
  label: string;
  /** Show this phase tab at all. False = hidden from nav entirely. */
  visible: boolean;
  /** Show tab but disabled with a "Coming soon" affordance. */
  comingSoon?: boolean;
};

export type WorkflowKey = ApiProject['workflowKey'];

/**
 * Per-workflow Blueprint phase configuration. Source of truth for which tabs
 * the UI exposes, in what order, and which are gated as coming-soon.
 *
 * Adding a new workflow means adding a new key here — UI consumers iterate
 * the returned list rather than branching on workflow strings.
 */
const PHASES_BY_WORKFLOW: Record<WorkflowKey, BlueprintPhase[]> = {
  music_video: [
    { key: 'concept', label: 'Concept', visible: true },
    { key: 'script', label: 'Script', visible: true },
    { key: 'style', label: 'Style', visible: true },
    { key: 'characters', label: 'Characters', visible: true },
    { key: 'environments', label: 'Environments', visible: true },
    // music_video.audio = 'skipped' per WorkflowRecipe — no Audio tab.
  ],
  anime_scripted: [
    { key: 'concept', label: 'Concept', visible: true },
    { key: 'script', label: 'Script', visible: true },
    { key: 'style', label: 'Style', visible: true },
    { key: 'characters', label: 'Characters', visible: true },
    { key: 'environments', label: 'Environments', visible: true },
    // Audio: backend (T3) and TTS production (T5.4) land later in v1.
    // Surface the slot now so artists see the planned shape; flagging as
    // coming-soon keeps it visible without offering a broken tab.
    { key: 'audio', label: 'Audio', visible: true, comingSoon: true },
  ],
};

const DEFAULT_WORKFLOW: WorkflowKey = 'music_video';

const resolveWorkflow = (project: { workflowKey?: WorkflowKey }): WorkflowKey =>
  (project.workflowKey && PHASES_BY_WORKFLOW[project.workflowKey]) ? project.workflowKey : DEFAULT_WORKFLOW;

/** Ordered phases for this project's workflow, including hidden/coming-soon. */
export const getBlueprintPhases = (project: { workflowKey?: WorkflowKey }): BlueprintPhase[] =>
  PHASES_BY_WORKFLOW[resolveWorkflow(project)];

/** Visible phase keys only (tab nav consumes this). */
export const getVisiblePhaseKeys = (project: { workflowKey?: WorkflowKey }): Phase[] =>
  getBlueprintPhases(project).filter((p) => p.visible).map((p) => p.key);

/** Navigation-ordered phase keys (drops coming-soon entries since they can't
 *  participate in active-phase computation). */
export const getNavigablePhaseKeys = (project: { workflowKey?: WorkflowKey }): Phase[] =>
  getBlueprintPhases(project).filter((p) => p.visible && !p.comingSoon).map((p) => p.key);

export const findPhase = (project: { workflowKey?: WorkflowKey }, phase: Phase): BlueprintPhase | undefined =>
  getBlueprintPhases(project).find((p) => p.key === phase);

export const isPhaseComingSoon = (project: { workflowKey?: WorkflowKey }, phase: Phase): boolean =>
  !!findPhase(project, phase)?.comingSoon;

/** Index within the navigable (non-coming-soon, visible) phase list. */
export const navigablePhaseIndex = (project: { workflowKey?: WorkflowKey }, phase: Phase): number =>
  getNavigablePhaseKeys(project).indexOf(phase);
