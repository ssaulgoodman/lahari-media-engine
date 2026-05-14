import { v4 as uuidv4 } from 'uuid';
import {
  appendSessionJournalEntry,
  hashJson,
  shotLabel,
  stableJson,
  type Project,
  type ProjectShot,
} from '../core.js';

export type ApplyErrorCode =
  | 'validation_failed'
  | 'drift_detected'
  | 'downstream_visual_work'
  | 'shot_not_found'
  | 'project_not_found'
  | 'schema_invalid'
  | 'locked'
  | 'wrong_workflow';

export type ApplyError = {
  error: ApplyErrorCode;
  field?: string;
  shotId?: string;
  currentHash?: string;
  submittedBaseHash?: string;
  message: string;
  next?: string;
};

export const applyError = (error: ApplyErrorCode, message: string, extra: Omit<ApplyError, 'error' | 'message'> = {}): ApplyError => ({
  error,
  message,
  ...extra,
});

export const isApplyError = (value: unknown): value is ApplyError => {
  return !!value && typeof value === 'object' && typeof (value as any).error === 'string';
};

export const findProjectShot = (project: Project, shotId: string): { shot: ProjectShot; sceneIndex: number; shotIndex: number } | null => {
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const shotIndex = scene.shots.findIndex((shot) => shot.id === shotId);
    if (shotIndex >= 0) return { shot: scene.shots[shotIndex], sceneIndex: sceneIndex + 1, shotIndex: shotIndex + 1 };
  }
  return null;
};

export const ensureLength = (field: string, value: string | undefined | null, max: number, opts: { required?: boolean; shotId?: string } = {}): ApplyError | null => {
  const trimmed = value?.trim() || '';
  if (opts.required && !trimmed) {
    return applyError('validation_failed', `${field} is required.`, { field, shotId: opts.shotId });
  }
  if (trimmed.length > max) {
    return applyError('validation_failed', `Length ${trimmed.length} exceeds cap ${max}. Compress ${field} and retry.`, { field, shotId: opts.shotId });
  }
  return null;
};

export const validateBaseHash = (currentHash: string, baseHash?: string | null, force?: boolean, shotId?: string): ApplyError | null => {
  if (!baseHash || force) return null;
  if (baseHash !== currentHash) {
    return applyError('drift_detected', 'Current content changed since baseHash. Re-fetch the latest packet and retry, or pass force: true after explicit approval.', {
      shotId,
      currentHash,
      submittedBaseHash: baseHash,
      next: 'Re-fetch the latest packet and retry with the new baseHash.',
    });
  }
  return null;
};

export const shotApplyLabel = (target: { sceneIndex: number; shotIndex: number }) => shotLabel(target.sceneIndex - 1, target.shotIndex - 1);

export const appendApplyJournal = appendSessionJournalEntry;

export const scriptDraftHash = (script: unknown): string => hashJson(normalizeScriptForHash(script));

const normalizeScriptForHash = (script: any) => ({
  cast: (script?.cast || []).map((member: any) => ({ id: member.id || null, name: member.name || '', description: member.description || '' })),
  environments: (script?.environments || []).map((environment: any) => ({ id: environment.id || null, name: environment.name || '', description: environment.description || '' })),
  scenes: (script?.scenes || []).map((scene: any) => ({
    id: scene.id || null,
    sectionLabel: scene.sectionLabel || '',
    startTime: scene.startTime || '',
    endTime: scene.endTime || '',
    lyrics: scene.lyrics || '',
    narrativeDescription: scene.narrativeDescription || '',
    shots: (scene.shots || []).map((shot: any) => ({
      id: shot.id || null,
      direction: shot.direction || '',
      duration: Number(shot.duration || 0),
      castIds: shot.castIds || [],
      environmentId: shot.environmentId || null,
      continuityFrom: shot.continuityFrom || 'cut',
    })),
  })),
});

export const hasDownstreamVisualWork = (project: Project): boolean => {
  return !!project.styleAssetUrl
    || project.cast.some((member) => !!member.referenceImageUrl)
    || project.environments.some((environment) => !!environment.referenceImageUrl)
    || project.scenes.some((scene) => scene.shots.some((shot) => (
      !!shot.imageUrl
      || !!shot.endImageUrl
      || !!shot.extractedLastFrameUrl
      || !!shot.storyboardUrl
      || !!shot.videoUrl
      || !!shot.locked
      || !!shot.storyboardLocked
    )));
};

export const normalizeScriptForApply = (raw: any) => {
  const cast = (raw?.cast || []).map((member: any, index: number) => ({
    id: member.id || uuidv4(),
    name: member.name || `Character ${index + 1}`,
    description: member.description || '',
  }));
  const environments = (raw?.environments || []).map((environment: any, index: number) => ({
    id: environment.id || uuidv4(),
    name: environment.name || `Environment ${index + 1}`,
    description: environment.description || '',
  }));
  const castIds = new Set(cast.map((member: any) => member.id));
  const environmentIds = new Set(environments.map((environment: any) => environment.id));
  const scenes = (raw?.scenes || []).map((scene: any, sceneIndex: number) => ({
    id: scene.id || uuidv4(),
    sectionLabel: scene.sectionLabel || `Scene ${sceneIndex + 1}`,
    startTime: scene.startTime || '',
    endTime: scene.endTime || '',
    lyrics: scene.lyrics || '',
    narrativeDescription: scene.narrativeDescription || '',
    shots: (scene.shots || []).map((shot: any) => ({
      id: shot.id || uuidv4(),
      direction: shot.direction || '',
      duration: Number(shot.duration || 15),
      castIds: Array.isArray(shot.castIds) ? shot.castIds.filter((id: string) => castIds.has(id)) : [],
      environmentId: shot.environmentId && environmentIds.has(shot.environmentId) ? shot.environmentId : null,
      continuityFrom: shot.continuityFrom === 'prev_shot' ? 'prev_shot' : 'cut',
    })),
  }));
  return { cast, environments, scenes };
};

export const scriptCounts = (script: any) => ({
  cast: script?.cast?.length || 0,
  environments: script?.environments?.length || 0,
  scenes: script?.scenes?.length || 0,
  shots: (script?.scenes || []).reduce((sum: number, scene: any) => sum + (scene.shots?.length || 0), 0),
});

export const contentHashInfo = (value: unknown) => ({
  hash: hashJson(value),
  sourceChars: stableJson(value).length,
});
