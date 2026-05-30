import { updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { audioPlanHash, webStudioUrl, type Project, type ProjectShot } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import {
  appendApplyJournal,
  applyError,
  ensureLength,
  findProjectShot,
  shotApplyLabel,
  type ApplyError,
} from './helpers.js';
import type { AudioPlan, AudioPlanDialogueLine } from '../audioPlan.js';

export type TextEditDialogueInput = {
  dialogueId: string;
  text: string;
};

export type TextEditInput = {
  shotId?: string;
  sceneId?: string;
  direction?: string;
  dialogue?: TextEditDialogueInput[];
  sceneTitle?: string;
};

type SceneRef = Project['scenes'][number];

const findScene = (project: Project, sceneId: string): { scene: SceneRef; sceneIndex: number } | null => {
  const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (sceneIndex < 0) return null;
  return { scene: project.scenes[sceneIndex], sceneIndex };
};

const trimText = (value: string) => value.trim();

const resetDialogueLineAudio = (line: AudioPlanDialogueLine, text: string): AudioPlanDialogueLine => ({
  ...line,
  text,
  ttsAssetId: null,
  ttsStatus: 'pending',
  ttsError: undefined,
  ttsCharCount: undefined,
  ttsDurationSec: undefined,
});

const projectWithTextEdits = (
  project: Project,
  nextScenesById: Map<string, SceneRef>,
  nextShotsById: Map<string, ProjectShot>,
): Project => ({
  ...project,
  scenes: project.scenes.map((scene) => {
    const sceneBase = nextScenesById.get(scene.id) || scene;
    return {
      ...sceneBase,
      shots: sceneBase.shots.map((shot) => nextShotsById.get(shot.id) || shot),
    };
  }),
});

export const applyTextEdits = async (project: Project, edits: TextEditInput[]) => {
  if (!Array.isArray(edits) || edits.length === 0) {
    return applyError('validation_failed', 'edits must contain at least one text edit.', { field: 'edits' });
  }

  const applied: Array<{
    shotId?: string;
    sceneId?: string;
    fieldsChanged: string[];
    stale: string[];
    audioPlanHash?: string;
  }> = [];
  const rejected: ApplyError[] = [];
  const nextScenesById = new Map<string, SceneRef>();
  const nextShotsById = new Map<string, ProjectShot>();
  const storyboardShotIds = new Set<string>();
  const storyboardSceneIds = new Set<string>();
  let scriptChanged = false;
  let shotPromptStateChanged = false;
  let audioPlanChanged = false;

  for (const edit of edits) {
    const hasShotFields = edit.direction !== undefined || edit.dialogue !== undefined;
    const hasSceneFields = edit.sceneTitle !== undefined;
    if (!edit.shotId && !edit.sceneId) {
      rejected.push(applyError('validation_failed', 'Each text edit needs shotId or sceneId.', { field: 'edits' }));
      continue;
    }
    if (!hasShotFields && !hasSceneFields) {
      rejected.push(applyError('validation_failed', 'Text edit has no editable text fields.', { shotId: edit.shotId, field: 'edits' }));
      continue;
    }

    const shotTarget = edit.shotId ? findProjectShot(project, edit.shotId) : null;
    if (edit.shotId && !shotTarget) {
      rejected.push(applyError('shot_not_found', `Shot not found in project: ${edit.shotId}`, { shotId: edit.shotId }));
      continue;
    }
    const sceneId = edit.sceneId || (shotTarget ? project.scenes[shotTarget.sceneIndex - 1]?.id : undefined);
    const sceneTarget = sceneId ? findScene(project, sceneId) : null;
    if ((edit.sceneId || edit.sceneTitle !== undefined) && (!sceneId || !sceneTarget)) {
      rejected.push(applyError('validation_failed', `Scene not found in project: ${sceneId || edit.sceneId || '(missing)'}`, { field: 'sceneId' }));
      continue;
    }

    let rowInvalid = false;
    const validation = ensureLength('direction', edit.direction, 2000, { shotId: edit.shotId })
      || ensureLength('sceneTitle', edit.sceneTitle, 500, { shotId: edit.shotId });
    if (validation) {
      rejected.push(validation);
      continue;
    }
    for (const line of edit.dialogue || []) {
      const lineValidation = ensureLength('dialogue.text', line.text, 500, { shotId: edit.shotId, required: true });
      if (lineValidation) {
        rejected.push(lineValidation);
        rowInvalid = true;
      }
    }
    if (shotTarget && edit.dialogue?.length) {
      const audioPlan = shotTarget.shot.audioPlan as AudioPlan | undefined;
      if (!audioPlan || !Array.isArray(audioPlan.dialogue)) {
        rejected.push(applyError('validation_failed', `Shot ${shotTarget.shot.id} has no audio plan dialogue to edit.`, {
          shotId: shotTarget.shot.id,
          field: 'dialogue',
        }));
        rowInvalid = true;
      } else {
        const dialogueIds = new Set(audioPlan.dialogue.map((line) => line.id));
        for (const dialogueEdit of edit.dialogue) {
          if (!dialogueIds.has(dialogueEdit.dialogueId)) {
            rejected.push(applyError('validation_failed', `Dialogue line not found in shot ${shotTarget.shot.id}: ${dialogueEdit.dialogueId}`, {
              shotId: shotTarget.shot.id,
              field: 'dialogueId',
            }));
            rowInvalid = true;
          }
        }
      }
    }
    if (rowInvalid) continue;

    const fieldsChanged: string[] = [];
    const stale: string[] = [];

    if (sceneTarget && edit.sceneTitle !== undefined) {
      const nextTitle = trimText(edit.sceneTitle);
      if (nextTitle !== (sceneTarget.scene.sectionLabel || '')) {
        await updateRows('scenes', { id: sceneTarget.scene.id }, { section_label: nextTitle });
        const nextScene = { ...sceneTarget.scene, sectionLabel: nextTitle };
        nextScenesById.set(sceneTarget.scene.id, nextScene);
        storyboardSceneIds.add(sceneTarget.scene.id);
        fieldsChanged.push('sceneTitle');
        scriptChanged = true;
      }
    }

    if (shotTarget && edit.direction !== undefined) {
      const nextDirection = trimText(edit.direction);
      if (nextDirection !== (shotTarget.shot.direction || '')) {
        const dbUpdate: Record<string, unknown> = {
          direction: nextDirection,
          prompts_stale: true,
        };
        if (shotTarget.shot.storyboardUrl) dbUpdate.storyboard_status = 'stale';
        if (shotTarget.shot.videoUrl) dbUpdate.video_status = 'stale';
        await updateRows('shots', { id: shotTarget.shot.id }, dbUpdate);
        const nextShot = {
          ...shotTarget.shot,
          direction: nextDirection,
          promptsStale: true,
          ...(shotTarget.shot.storyboardUrl ? { storyboardStatus: 'stale' } : {}),
          ...(shotTarget.shot.videoUrl ? { videoStatus: 'stale' } : {}),
        };
        nextShotsById.set(shotTarget.shot.id, nextShot);
        storyboardShotIds.add(shotTarget.shot.id);
        fieldsChanged.push('direction');
        stale.push('shot_prompts');
        if (shotTarget.shot.storyboardUrl) stale.push('storyboard');
        if (shotTarget.shot.videoUrl) stale.push('video');
        scriptChanged = true;
        shotPromptStateChanged = true;
      }
    }

    if (shotTarget && edit.dialogue?.length) {
      const audioPlan = shotTarget.shot.audioPlan as AudioPlan | undefined;
      if (!audioPlan || !Array.isArray(audioPlan.dialogue)) continue;
      const lineById = new Map(audioPlan.dialogue.map((line, index) => [line.id, { line, index }]));
      const nextDialogue = [...audioPlan.dialogue];
      const changedDialogueIds: string[] = [];
      for (const dialogueEdit of edit.dialogue) {
        const target = lineById.get(dialogueEdit.dialogueId);
        if (!target) continue;
        const nextText = trimText(dialogueEdit.text);
        if (nextText !== target.line.text) {
          nextDialogue[target.index] = resetDialogueLineAudio(target.line, nextText);
          changedDialogueIds.push(dialogueEdit.dialogueId);
        }
      }
      if (changedDialogueIds.length) {
        const nextAudioPlan: AudioPlan = { ...audioPlan, dialogue: nextDialogue };
        await updateRows('shots', { id: shotTarget.shot.id }, {
          audio_plan: nextAudioPlan,
          audio_plan_stale: true,
        });
        const existing = nextShotsById.get(shotTarget.shot.id) || shotTarget.shot;
        nextShotsById.set(shotTarget.shot.id, { ...existing, audioPlan: nextAudioPlan, audioPlanStale: true });
        fieldsChanged.push('dialogue');
        stale.push('audio');
        audioPlanChanged = true;
      }
    }

    if (fieldsChanged.length) {
      const receipt: { shotId?: string; sceneId?: string; fieldsChanged: string[]; stale: string[]; audioPlanHash?: string } = {
        shotId: shotTarget?.shot.id,
        sceneId: sceneTarget?.scene.id,
        fieldsChanged,
        stale,
      };
      if (shotTarget && fieldsChanged.includes('dialogue')) {
        receipt.audioPlanHash = audioPlanHash(nextShotsById.get(shotTarget.shot.id) || shotTarget.shot);
      }
      applied.push(receipt);
      await recordDirectorEvent({
        projectId: project.id,
        source: 'codex',
        eventType: 'text_edits_applied',
        entityType: shotTarget ? 'shot' : 'scene',
        entityId: shotTarget?.shot.id || sceneTarget?.scene.id || project.id,
        summary: `Codex applied low-blast-radius text edits${shotTarget ? ` for ${shotApplyLabel(shotTarget)}` : ''}.`,
        payload: {
          shotId: shotTarget?.shot.id,
          sceneId: sceneTarget?.scene.id,
          fieldsChanged,
          stale,
        },
      });
      appendApplyJournal(project, 'applied text edits', `${shotTarget ? `${shotApplyLabel(shotTarget)}\nShot ID: ${shotTarget.shot.id}` : `Scene ID: ${sceneTarget?.scene.id}`}\nFields: ${fieldsChanged.join(', ')}\nStale: ${stale.join(', ') || 'none'}\nWeb: ${webStudioUrl(project.id, { step: shotTarget ? 'studio' : 'blueprint', shotId: shotTarget?.shot.id })}`);
    }
  }

  const notebookProject = applied.length
    ? projectWithTextEdits(project, nextScenesById, nextShotsById)
    : project;

  return {
    kind: 'mirage.apply.text_edits',
    projectId: project.id,
    editsApplied: applied.length,
    applied,
    rejected,
    changedArtifacts: applied.length
      ? buildNotebookMirrorArtifacts(notebookProject, {
        script: scriptChanged,
        shotPrompts: shotPromptStateChanged,
        audioPlan: audioPlanChanged,
        storyboardShotIds: [...storyboardShotIds],
        storyboardSceneIds: [...storyboardSceneIds],
      })
      : [],
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: rejected.length
      ? 'Applied valid low-blast-radius text edits and rejected invalid rows. No topology, refs, boards, videos, or locks were deleted.'
      : 'Applied low-blast-radius text edits. No topology, refs, boards, videos, or locks were deleted.',
  };
};
