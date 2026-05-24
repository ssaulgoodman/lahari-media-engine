import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { updateRows, insertRow, deleteRows, rpcVoid } from '../database.js';
import { planScenes, refineScript, writeShotPrompts } from './claude.js';
import { planStoryboardPrompt } from './storyboard.js';
import { eventResultPointers, listDirectorEvents, recordDirectorEvent, type DirectorEvent } from './directorEvents.js';
import { getModelMinDuration } from './segmind.js';
import { getProjectConfigState, writeProjectConfigDeskCopy } from './projectConfig.js';

import {
  compactText,
  defaultArtifactPath,
  defaultPreviewPath,
  defaultProjectWorkbenchDir,
  deriveCheckpointState,
  deriveDirectorDiagnosis,
  hasUsableShotPrompts,
  journalEntry,
  listProjects,
  md,
  namesById,
  readJsonFileIfExists,
  readTextFileIfExists,
  recommendedActions,
  safeTimestamp,
  sessionDir,
  sessionJournalPath,
  sessionStatePath,
  shotLabel,
  statusCounts,
  usesStoryboardWorkflow,
  webStudioUrl,
  writeArtifact,
  writeArtifactIfMissing,
  type Project,
  type ProjectShot,
} from './codexStudio/core.js';
import {
  buildProjectContactSheet,
  buildProjectReport,
  buildProjectSheet,
  defaultProjectSheetPath,
  normalizeProjectSheetType,
  PROJECT_SHEET_TYPES,
  type ProjectSheetType,
} from './codexStudio/sheets.js';
import {
  applyGenerateStoryboard,
  applyGenerateVideo,
  applyProjectPreferencesConfig,
  applyProjectPromptOverrideConfig,
  buildStoryboardStatus,
  bulkGenerateStoryboards,
  bulkWriteStoryboardPrompts,
  lockStoryboardBoard,
  planGenerateStoryboard,
  planGenerateVideo,
  refineStoryboardImage,
  revertProjectPromptOverrideConfig,
  unlockStoryboardBoard,
  writeStoryboardPromptForShot,
} from './codexStudio/storyboardOps.js';
export { applyShotPrompts } from './codexStudio/applies/shotPrompts.js';
export { applyShotWorkflowModes } from './codexStudio/applies/shotWorkflow.js';
export { applyStoryboardPrompt, applyStoryboardPromptsBulk, applyStoryboardSceneMarkdown } from './codexStudio/applies/storyboardPrompt.js';
export { applyConcept } from './codexStudio/applies/concept.js';
export { applyStyleDirection } from './codexStudio/applies/style.js';
export {
  applyCastReference,
  applyEnvironmentReference,
  listReferenceCandidates,
  uploadCastReference,
  uploadEnvironmentReference,
} from './codexStudio/applies/references.js';
export { applyVideoPrompt } from './codexStudio/applies/videoPrompt.js';
export { applyScript, applyScriptMarkdown } from './codexStudio/applies/script.js';
export { applyAudioPlan, applyAudioPlanMarkdown, applyCastVoice, generateDialogueAudio, getAudioPlanCost } from './codexStudio/audioPlan.js';
import { buildProjectPacket, buildShotPacket } from './codexStudio/packets.js';
export { buildProjectPacket, buildShotPacket } from './codexStudio/packets.js';
import { buildProjectActionList, buildStoryboardPromptReview } from './codexStudio/plans.js';
export { buildProjectActionList, buildStoryboardPromptReview } from './codexStudio/plans.js';
export { buildProjectNotebook, type NotebookFile } from './codexStudio/notebook.js';
export { createProjectForDirector } from './codexStudio/projectIntake.js';
export { generateCharacterLooksForDirector, generateEnvironmentLooksForDirector } from './codexStudio/lookGeneration.js';
export {
  listQueueForDirector,
  resolveProjectForDirector,
  searchCatalogForDirector,
} from './codexStudio/discovery.js';
export {
  applyGenerateStoryboard,
  applyGenerateVideo,
  applyProjectPreferencesConfig,
  applyProjectPromptOverrideConfig,
  buildStoryboardStatus,
  bulkGenerateStoryboards,
  bulkWriteStoryboardPrompts,
  lockStoryboardBoard,
  planGenerateStoryboard,
  planGenerateVideo,
  refineStoryboardImage,
  revertProjectPromptOverrideConfig,
  unlockStoryboardBoard,
  writeStoryboardPromptForShot,
} from './codexStudio/storyboardOps.js';

export {
  buildProjectContactSheet,
  buildProjectReport,
  buildProjectSheet,
  defaultProjectSheetPath,
  normalizeProjectSheetType,
  PROJECT_SHEET_TYPES,
  type ProjectSheetType,
} from './codexStudio/sheets.js';

export {
  compactText,
  defaultArtifactPath,
  defaultProjectWorkbenchDir,
  deriveCheckpointState,
  deriveDirectorDiagnosis,
  listProjects,
  recommendedActions,
  statusCounts,
  webStudioUrl,
  writeArtifact,
  styleDirectionHash,
} from './codexStudio/core.js';

const readSessionEventCursor = (projectId: string): { seq: number | null; createdAt: string | null } => {
  try {
    const raw = fs.readFileSync(sessionStatePath(projectId), 'utf8');
    const parsed = JSON.parse(raw);
    const seq = Number(parsed?.directorEvents?.lastSeq);
    return {
      seq: Number.isFinite(seq) ? seq : null,
      createdAt: parsed?.directorEvents?.lastSyncedAt || null,
    };
  } catch {
    return { seq: null, createdAt: null };
  }
};

const formatDirectorEvents = (events: DirectorEvent[]): string => {
  if (!events.length) return '- No web studio or Codex apply events since the last attach.';
  return events.map((event) => {
    const target = event.entity_type && event.entity_id ? ` (${event.entity_type}:${event.entity_id})` : '';
    return `- ${event.created_at} [${event.source}/${event.event_type}]${target} ${event.summary}`;
  }).join('\n');
};

const eventSyncSummary = (events: DirectorEvent[], previousCursor: { seq: number | null; createdAt: string | null } = { seq: null, createdAt: null }) => {
  const last = events[events.length - 1] || null;
  const lastSeq = typeof last?.seq === 'number' ? last.seq : previousCursor.seq;
  return {
    newEvents: events.length,
    lastSeq,
    lastSyncedAt: last?.created_at || previousCursor.createdAt,
    recentEvents: events.slice(-10).map((event) => ({
      id: event.id,
      createdAt: event.created_at,
      source: event.source,
      eventType: event.event_type,
      entityType: event.entity_type,
      entityId: event.entity_id,
      summary: event.summary,
    })),
  };
};

const sessionState = (
  project: Project,
  note?: string | null,
  directorEvents = eventSyncSummary([], { seq: null, createdAt: null }),
  projectConfig?: Awaited<ReturnType<typeof getProjectConfigState>>,
) => {
  const checkpoint = deriveCheckpointState(project);
  const diagnosis = deriveDirectorDiagnosis(project);
  return {
    kind: 'mirage.director.session',
    updatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      preset: project.presetKey || 'unknown',
      imageModel: project.imageModel,
      storyboardProvider: project.storyboardProvider,
      videoModel: project.videoModel,
      textProvider: project.textProvider,
      updatedAt: project.updatedAt,
      webUrl: webStudioUrl(project.id, { step: 'studio' }),
    },
    checkpoint,
    diagnosis,
    directorEvents,
    projectConfig: projectConfig ? {
      preferences: projectConfig.preferences.preferences,
      preferencesHash: projectConfig.preferences.hash,
      warnings: projectConfig.preferences.warnings,
      promptOverrides: Object.values(projectConfig.prompts).map((prompt) => ({
        kind: prompt.kind,
        active: prompt.active,
        source: prompt.source,
        hash: prompt.hash,
        updatedAt: prompt.updatedAt,
      })),
    } : null,
    note: note || null,
    files: {
      state: sessionStatePath(project.id),
      journal: sessionJournalPath(project.id),
      workbench: defaultProjectWorkbenchDir(project),
      directorReport: defaultArtifactPath(project, 'director-report.md'),
      contactSheet: defaultArtifactPath(project, 'contact-sheet.html'),
    },
    guardrails: [
      'Supabase is canonical project truth; .mirage files are Codex desk copies.',
      'Read-only inspection is allowed without approval.',
      'Ask before paid generation, DB writes, lock/unlock changes, deletes, publish, or destructive rewrites.',
      'Use preview/diff artifacts before overwriting creative work.',
    ],
  };
};

export const attachDirectorSession = async (project: Project, note?: string) => {
  const dir = sessionDir(project.id);
  fs.mkdirSync(dir, { recursive: true });

  const statePath = sessionStatePath(project.id);
  const previousState = readJsonFileIfExists(statePath) as { updatedAt?: string } | null;
  const previousEventCursor = readSessionEventCursor(project.id);
  const newEvents = await listDirectorEvents(project.id, {
    afterSeq: previousEventCursor.seq,
    afterCreatedAt: previousEventCursor.seq === null ? previousEventCursor.createdAt : null,
    limit: 100,
  });
  const workbench = await hydrateProjectWorkbench(project);
  const state = sessionState(project, note, eventSyncSummary(newEvents, previousEventCursor), workbench.projectConfig);

  const journalPath = sessionJournalPath(project.id);
  const journalAlreadyExisted = fs.existsSync(journalPath);
  if (!journalAlreadyExisted) {
    fs.writeFileSync(journalPath, `# Mirage Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }

  const actions = state.checkpoint.recommendedActions.length
    ? state.checkpoint.recommendedActions.map((action) => `- ${action}`).join('\n')
    : '- No deterministic next action.';
  const issues = state.checkpoint.openIssues.length
    ? state.checkpoint.openIssues.map((issue) => `- ${issue}`).join('\n')
    : '- No open issues from deterministic checks.';
  const noteBlock = note ? `\n\nOperator note: ${note}` : '';
  const eventBlock = `\n\nChanges since last attach:\n${formatDirectorEvents(newEvents)}`;

  const previousAttachAt = previousState?.updatedAt ? Date.parse(previousState.updatedAt) : NaN;
  const attachDedupMinutes = Number(process.env.LAHARI_ATTACH_JOURNAL_DEDUP_MINUTES || 10);
  const recentAttach = Number.isFinite(previousAttachAt)
    && Date.now() - previousAttachAt <= attachDedupMinutes * 60 * 1000;
  const skipJournalAppend = journalAlreadyExisted
    && recentAttach
    && newEvents.length === 0
    && !note?.trim();

  if (!skipJournalAppend) {
    fs.appendFileSync(journalPath, journalEntry('session attached', `Checkpoint: ${state.checkpoint.label}\n\n${state.checkpoint.summary}${noteBlock}${eventBlock}\n\nBottleneck: ${state.diagnosis.bottleneck}\nNext approved action: ${state.diagnosis.nextApprovedAction}\n\nOpen issues:\n${issues}\n\nRecommended next actions:\n${actions}`));
  }
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  return {
    kind: 'mirage.director.session.attached',
    projectId: project.id,
    projectTitle: project.title,
    suggestedCodexSessionTitle: `Mirage - ${project.title}`,
    artistOpening: `Working on ${project.title}`,
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
    statePath: sessionStatePath(project.id),
    journalPath,
    journalUpdated: !skipJournalAppend,
    journalSkippedReason: skipJournalAppend ? `Skipped repetitive attach entry: no new events within ${attachDedupMinutes} minutes.` : null,
    workbenchDir: workbench.baseDir,
    workbenchArtifacts: workbench.artifacts,
    projectConfig: state.projectConfig,
    checkpoint: state.checkpoint,
    diagnosis: state.diagnosis,
    directorEvents: state.directorEvents,
    sourceOfTruth: 'Supabase is canonical; .mirage files are local Codex desk copies.',
  };
};

export const getDirectorSession = (project: Project) => {
  const statePath = sessionStatePath(project.id);
  const journalPath = sessionJournalPath(project.id);
  const currentState = sessionState(project);

  return {
    kind: 'mirage.director.session.read',
    projectId: project.id,
    exists: fs.existsSync(statePath) || fs.existsSync(journalPath),
    currentState,
    savedState: readJsonFileIfExists(statePath),
    journal: readTextFileIfExists(journalPath),
  };
};

export const addDirectorSessionNote = (project: Project, note: string) => {
  if (!note.trim()) throw new Error('Session note cannot be empty.');

  const dir = sessionDir(project.id);
  fs.mkdirSync(dir, { recursive: true });

  const state = sessionState(project, note);
  fs.writeFileSync(sessionStatePath(project.id), `${JSON.stringify(state, null, 2)}\n`);

  const journalPath = sessionJournalPath(project.id);
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Mirage Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }

  fs.appendFileSync(journalPath, journalEntry('operator note', `${note.trim()}\n\nCheckpoint: ${state.checkpoint.label}`));

  return {
    kind: 'mirage.director.session.note_added',
    projectId: project.id,
    statePath: sessionStatePath(project.id),
    journalPath,
    checkpoint: state.checkpoint,
  };
};

type ShotPromptPreviewShot = {
  id: string;
  sceneIndex: number;
  shotIndex: number;
  duration: number;
  beat: string;
  castNames: string[];
  sceneNarrative: string;
  sceneLyrics: string;
  before: {
    visualPrompt: string;
    motionPrompt: string;
    continuityFrom: string;
    promptsStale: boolean;
  };
  after: {
    visualPrompt: string;
    motionPrompt: string;
    continuityFrom: 'cut' | 'prev_shot';
  };
};

type ShotPromptPreviewFile = {
  kind: 'mirage.preview.rewrite_shot_prompts';
  previewId: string;
  generatedAt: string;
  project: {
    id: string;
    title: string;
    status: string;
    imageModel?: string;
    videoModel?: string;
  };
  model: string;
  userNote: string | null;
  counts: {
    shots: number;
    changed: number;
  };
  artifacts: {
    markdownPath: string;
    jsonPath: string;
    promptPath: string;
  };
  shots: ShotPromptPreviewShot[];
  note: string;
};

const formatPromptBlock = (value?: string | null): string => {
  return value?.trim() ? value.trim() : '_empty_';
};

const buildShotPromptPreviewMarkdown = (
  project: Project,
  preview: {
    previewId: string;
    generatedAt: string;
    userNote?: string;
    model: string;
    shots: ShotPromptPreviewShot[];
    promptPath: string;
    jsonPath: string;
  },
) => {
  const changed = preview.shots.filter((shot) => (
    shot.before.visualPrompt !== shot.after.visualPrompt
    || shot.before.motionPrompt !== shot.after.motionPrompt
    || shot.before.continuityFrom !== shot.after.continuityFrom
  )).length;

  const shotSections = preview.shots.map((shot) => `## Scene ${shot.sceneIndex}, Shot ${shot.shotIndex}

- Shot ID: \`${shot.id}\`
- Duration: ${shot.duration}s
- Cast: ${shot.castNames.join(', ') || 'none'}
- Beat: ${shot.beat || 'None'}
- Continuity: \`${shot.before.continuityFrom || 'cut'}\` -> \`${shot.after.continuityFrom}\`

### Visual Prompt

Before:
${formatPromptBlock(shot.before.visualPrompt)}

After:
${formatPromptBlock(shot.after.visualPrompt)}

### Motion Prompt

Before:
${formatPromptBlock(shot.before.motionPrompt)}

After:
${formatPromptBlock(shot.after.motionPrompt)}
`).join('\n');

  return `# Shot Prompt Rewrite Preview

Generated: ${preview.generatedAt}
Preview ID: \`${preview.previewId}\`
Project: ${project.title}
Project ID: \`${project.id}\`
Model: ${preview.model}
User note: ${preview.userNote || 'None'}

This is a preview only. No Lahari database rows, prompts, stale flags, frames, or videos were changed.

## Summary

- Shots previewed: ${preview.shots.length}
- Shots changed: ${changed}
- JSON artifact: \`${preview.jsonPath}\`
- Runtime prompt artifact: \`${preview.promptPath}\`

${shotSections || 'No shots.'}
`;
};

export const previewRewriteShotPrompts = async (project: Project, userNote?: string) => {
  if (!project.scenes.length) throw new Error('Project has no scenes. Generate a script before previewing shot prompts.');
  const allProjectShots = project.scenes.flatMap((scene) => scene.shots);
  if (!allProjectShots.length) throw new Error('Project has no shots. Generate a script before previewing shot prompts.');

  const castById = namesById(project.cast);
  const firstShotIdsPerScene = new Set<string>();
  const previewShots: ShotPromptPreviewShot[] = [];
  const batchPrompts: string[] = [];
  const BATCH_SIZE = 15;

  const allShots = project.scenes.flatMap((scene, sceneIndex) => {
    if (scene.shots[0]) firstShotIdsPerScene.add(scene.shots[0].id);
    return scene.shots.map((shot, shotIndex) => {
      const castNames = (shot.castIds || []).map((id) => castById.get(id) || id);
      return {
        id: shot.id,
        sceneIndex: sceneIndex + 1,
        shotIndex: shotIndex + 1,
        direction: shot.direction || shot.visualPrompt || '',
        duration: shot.duration,
        castNames,
        sceneNarrative: scene.narrativeDescription || '',
        sceneLyrics: scene.lyrics || '',
        before: {
          visualPrompt: shot.visualPrompt || '',
          motionPrompt: shot.motionPrompt || '',
          continuityFrom: shot.continuityFrom || 'cut',
          promptsStale: !!shot.promptsStale,
        },
      };
    });
  });

  let previousBatchTail: { id: string; visualPrompt: string; motionPrompt: string }[] | undefined;

  for (let i = 0; i < allShots.length; i += BATCH_SIZE) {
    const batch = allShots.slice(i, i + BATCH_SIZE);
    const result = await writeShotPrompts(batch.map((shot) => ({
      id: shot.id,
      direction: shot.direction,
      duration: shot.duration,
      castNames: shot.castNames,
      sceneNarrative: shot.sceneNarrative,
      sceneLyrics: shot.sceneLyrics,
    })), {
      cast: project.cast.map((member) => ({ name: member.name, description: member.description })),
      concept: project.lockedConcept || {},
      userNote,
      songType: project.songType || undefined,
      isNarrative: project.isNarrative ?? undefined,
      isMeditative: project.isMeditative ?? undefined,
    }, previousBatchTail);

    batchPrompts.push(
      allShots.length > BATCH_SIZE
        ? `=== Batch ${Math.floor(i / BATCH_SIZE) + 1} (shots ${i + 1}-${Math.min(i + BATCH_SIZE, allShots.length)}) ===\n${result.prompt}`
        : result.prompt,
    );

    const outputById = new Map(result.shots.map((shot) => [shot.id, shot]));
    for (const shot of batch) {
      const output = outputById.get(shot.id);
      if (!output) throw new Error(`writeShotPrompts preview did not return shot ID ${shot.id}`);
      previewShots.push({
        id: shot.id,
        sceneIndex: shot.sceneIndex,
        shotIndex: shot.shotIndex,
        duration: shot.duration,
        beat: shot.direction,
        castNames: shot.castNames,
        sceneNarrative: shot.sceneNarrative,
        sceneLyrics: shot.sceneLyrics,
        before: shot.before,
        after: {
          visualPrompt: output.visualPrompt || '',
          motionPrompt: output.motionPrompt || '',
          continuityFrom: firstShotIdsPerScene.has(shot.id) ? 'cut' : (output.continuityFrom || 'cut'),
        },
      });
    }

    previousBatchTail = result.shots.slice(-2).map((shot) => ({
      id: shot.id,
      visualPrompt: shot.visualPrompt,
      motionPrompt: shot.motionPrompt,
    }));
  }

  const now = new Date().toISOString();
  const previewId = `${now.replace(/[:.]/g, '-')}-shot-prompts`;
  const promptPath = defaultPreviewPath(project, previewId, 'runtime-prompt.txt');
  const jsonPath = defaultPreviewPath(project, previewId, 'preview.json');
  const markdownPath = defaultPreviewPath(project, previewId, 'preview.md');
  const promptText = batchPrompts.join('\n\n');

  const preview = {
    kind: 'mirage.preview.rewrite_shot_prompts',
    previewId,
    generatedAt: now,
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      imageModel: project.imageModel,
      videoModel: project.videoModel,
    },
    model: 'claude-opus-4-7',
    userNote: userNote || null,
    counts: {
      shots: previewShots.length,
      changed: previewShots.filter((shot) => (
        shot.before.visualPrompt !== shot.after.visualPrompt
        || shot.before.motionPrompt !== shot.after.motionPrompt
        || shot.before.continuityFrom !== shot.after.continuityFrom
      )).length,
    },
    artifacts: {
      markdownPath,
      jsonPath,
      promptPath,
    },
    shots: previewShots,
    note: 'Preview only. No database rows, assets, or stale flags were changed.',
  };

  writeArtifact(promptPath, promptText);
  writeArtifact(jsonPath, `${JSON.stringify(preview, null, 2)}\n`);
  writeArtifact(markdownPath, buildShotPromptPreviewMarkdown(project, {
    previewId,
    generatedAt: now,
    userNote,
    model: preview.model,
    shots: previewShots,
    promptPath,
    jsonPath,
  }));

  return preview;
};

const readShotPromptPreview = (previewJsonPath: string): ShotPromptPreviewFile => {
  const resolved = path.resolve(previewJsonPath);
  if (!fs.existsSync(resolved)) throw new Error(`Preview JSON not found: ${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (parsed?.kind !== 'mirage.preview.rewrite_shot_prompts') {
    throw new Error('Preview JSON is not a lahari.preview.rewrite_shot_prompts artifact.');
  }
  if (!parsed.project?.id || !Array.isArray(parsed.shots)) {
    throw new Error('Preview JSON is missing project ID or shots.');
  }
  return parsed as ShotPromptPreviewFile;
};

export const getRewriteShotPromptsApplyPlan = async (previewJsonPath: string, project: Project) => {
  const preview = readShotPromptPreview(previewJsonPath);
  if (preview.project.id !== project.id) {
    throw new Error(`Preview belongs to project ${preview.project.id}, not loaded project ${project.id}.`);
  }

  const currentShots = new Map<string, ProjectShot>(project.scenes.flatMap((scene) => scene.shots.map((shot) => [shot.id, shot])));
  const missingShotIds = preview.shots.filter((shot) => !currentShots.has(shot.id)).map((shot) => shot.id);
  const driftedShots = preview.shots.filter((shot) => {
    const current = currentShots.get(shot.id);
    if (!current) return false;
    return (current.visualPrompt || '') !== (shot.before.visualPrompt || '')
      || (current.motionPrompt || '') !== (shot.before.motionPrompt || '')
      || (current.continuityFrom || 'cut') !== (shot.before.continuityFrom || 'cut');
  }).map((shot) => shot.id);
  const changedShots = preview.shots.filter((shot) => (
    shot.before.visualPrompt !== shot.after.visualPrompt
    || shot.before.motionPrompt !== shot.after.motionPrompt
    || shot.before.continuityFrom !== shot.after.continuityFrom
  ));
  const hasShots = preview.shots.length > 0;

  return {
    kind: 'mirage.apply_plan.rewrite_shot_prompts',
    previewId: preview.previewId,
    previewPath: path.resolve(previewJsonPath),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
    },
    counts: {
      previewShots: preview.shots.length,
      changedShots: changedShots.length,
      missingShots: missingShotIds.length,
      driftedShots: driftedShots.length,
    },
    missingShotIds,
    driftedShotIds: driftedShots,
    canApply: hasShots && missingShotIds.length === 0 && driftedShots.length === 0,
    note: !hasShots
      ? 'Refusing to apply an empty preview.'
      : missingShotIds.length || driftedShots.length
      ? 'Refusing to apply until missing/drifted shots are resolved. Regenerate a fresh preview.'
      : 'Ready to apply. This will update shot prompts/continuity and clear prompts_stale for previewed shots.',
  };
};

export const applyRewriteShotPromptsPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readShotPromptPreview(previewJsonPath);
  const plan = await getRewriteShotPromptsApplyPlan(previewJsonPath, project);
  if (!plan.canApply) {
    throw new Error(`${plan.note} Missing: ${plan.missingShotIds.join(', ') || 'none'}. Drifted: ${plan.driftedShotIds.join(', ') || 'none'}.`);
  }

  for (const shot of preview.shots) {
    await updateRows('shots', { id: shot.id }, {
      visual_prompt: shot.after.visualPrompt || '',
      motion_prompt: shot.after.motionPrompt || '',
      continuity_from: shot.after.continuityFrom || 'cut',
      prompts_stale: false,
    });
  }

  const promptText = preview.artifacts?.promptPath && fs.existsSync(preview.artifacts.promptPath)
    ? fs.readFileSync(preview.artifacts.promptPath, 'utf8')
    : undefined;
  await updateRows('projects', { id: project.id }, {
    ...(promptText ? { last_write_shots_prompt: promptText } : {}),
    updated_at: new Date().toISOString(),
  });

  const changed = preview.shots.filter((shot) => (
    shot.before.visualPrompt !== shot.after.visualPrompt
    || shot.before.motionPrompt !== shot.after.motionPrompt
    || shot.before.continuityFrom !== shot.after.continuityFrom
  ));
  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Mirage Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('applied shot prompt preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nShots updated: ${preview.shots.length}\nChanged shots: ${changed.length}\n\nNo frames, videos, assets, or locks were changed.`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'shot_prompts_preview_applied',
    entityType: 'project',
    entityId: project.id,
    summary: `Applied shot prompt preview ${preview.previewId}; ${preview.shots.length} shots updated, ${changed.length} changed.`,
    payload: {
      previewId: preview.previewId,
      previewJsonPath: path.resolve(previewJsonPath),
      shotsUpdated: preview.shots.length,
      changedShots: changed.length,
      changedShotIds: changed.map((shot) => shot.id),
    },
  });

  return {
    kind: 'mirage.apply.rewrite_shot_prompts',
    previewId: preview.previewId,
    projectId: project.id,
    shotsUpdated: preview.shots.length,
    changedShots: changed.length,
    journalPath,
    note: 'Applied preview to Supabase. Updated visual_prompt, motion_prompt, continuity_from, prompts_stale=false, and project last_write_shots_prompt when available.',
  };
};

type StoryboardPromptPreviewFile = {
  kind: 'mirage.preview.rewrite_storyboard_prompt';
  previewId: string;
  generatedAt: string;
  project: { id: string; title: string; status: string; textProvider?: string; storyboardProvider?: string };
  shot: {
    id: string;
    sceneIndex: number;
    shotIndex: number;
    beat: string;
    before: {
      storyboardPrompt: string;
      storyboardCutPlan: string;
      promptsStale: boolean;
    };
    after: {
      storyboardPrompt: string;
      storyboardCutPlan: string;
    };
  };
  model: string;
  costEstimate: number;
  userNote: string | null;
  artifacts: { markdownPath: string; jsonPath: string; promptPath: string };
  note: string;
};

const buildStoryboardPromptPreviewMarkdown = (preview: StoryboardPromptPreviewFile) => {
  return `# Storyboard Prompt Preview

Generated: ${preview.generatedAt}
Preview ID: \`${preview.previewId}\`
Project: ${preview.project.title}
Project ID: \`${preview.project.id}\`
Shot ID: \`${preview.shot.id}\`
Model: ${preview.model}
Estimated cost: ${preview.costEstimate}
User note: ${preview.userNote || 'None'}

This is a preview only. No Lahari database rows, assets, stale flags, frames, videos, or locks were changed.

## Shot

- Scene ${preview.shot.sceneIndex}, Shot ${preview.shot.shotIndex}
- Beat: ${preview.shot.beat || 'None'}
- JSON artifact: \`${preview.artifacts.jsonPath}\`
- Runtime prompt artifact: \`${preview.artifacts.promptPath}\`

## Storyboard Prompt

Before:
${formatPromptBlock(preview.shot.before.storyboardPrompt)}

After:
${formatPromptBlock(preview.shot.after.storyboardPrompt)}

## Cut Plan

Before:
${formatPromptBlock(preview.shot.before.storyboardCutPlan)}

After:
${formatPromptBlock(preview.shot.after.storyboardCutPlan)}
`;
};

export const previewRewriteStoryboardPrompt = async (project: Project, shotId: string, userNote?: string) => {
  let target: { shot: ProjectShot; sceneIndex: number; shotIndex: number } | null = null;
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const shotIndex = scene.shots.findIndex((shot) => shot.id === shotId);
    if (shotIndex >= 0) {
      target = { shot: scene.shots[shotIndex], sceneIndex: sceneIndex + 1, shotIndex: shotIndex + 1 };
      break;
    }
  }
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);

  const result = await planStoryboardPrompt({
    projectId: project.id,
    shotId,
    variant: 'adaptive_numbered_storyboard',
    artistNote: userNote,
  });

  const now = new Date().toISOString();
  const previewId = `${now.replace(/[:.]/g, '-')}-storyboard-prompt-${shotId.slice(0, 8)}`;
  const promptPath = defaultPreviewPath(project, previewId, 'runtime-prompt.txt');
  const jsonPath = defaultPreviewPath(project, previewId, 'preview.json');
  const markdownPath = defaultPreviewPath(project, previewId, 'preview.md');

  const preview: StoryboardPromptPreviewFile = {
    kind: 'mirage.preview.rewrite_storyboard_prompt',
    previewId,
    generatedAt: now,
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      textProvider: project.textProvider,
      storyboardProvider: project.storyboardProvider,
    },
    shot: {
      id: shotId,
      sceneIndex: target.sceneIndex,
      shotIndex: target.shotIndex,
      beat: target.shot.direction || target.shot.storyboardPrompt || target.shot.visualPrompt || '',
      before: {
        storyboardPrompt: target.shot.storyboardPrompt || '',
        storyboardCutPlan: target.shot.storyboardCutPlan || '',
        promptsStale: !!target.shot.promptsStale,
      },
      after: {
        storyboardPrompt: result.storyboardPrompt,
        storyboardCutPlan: result.cutPlanText,
      },
    },
    model: result.model,
    costEstimate: result.costEstimate,
    userNote: userNote || null,
    artifacts: { markdownPath, jsonPath, promptPath },
    note: 'Preview only. No database rows, assets, stale flags, frames, videos, or locks were changed.',
  };

  writeArtifact(promptPath, result.runtimePrompt);
  writeArtifact(jsonPath, `${JSON.stringify(preview, null, 2)}\n`);
  writeArtifact(markdownPath, buildStoryboardPromptPreviewMarkdown(preview));
  return preview;
};

const readStoryboardPromptPreview = (previewJsonPath: string): StoryboardPromptPreviewFile => {
  const resolved = path.resolve(previewJsonPath);
  if (!fs.existsSync(resolved)) throw new Error(`Preview JSON not found: ${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (parsed?.kind !== 'mirage.preview.rewrite_storyboard_prompt') {
    throw new Error('Preview JSON is not a lahari.preview.rewrite_storyboard_prompt artifact.');
  }
  if (!parsed.project?.id || !parsed.shot?.id) {
    throw new Error('Preview JSON is missing project or shot ID.');
  }
  return parsed as StoryboardPromptPreviewFile;
};

export const getRewriteStoryboardPromptApplyPlan = async (previewJsonPath: string, project: Project) => {
  const preview = readStoryboardPromptPreview(previewJsonPath);
  if (preview.project.id !== project.id) {
    throw new Error(`Preview belongs to project ${preview.project.id}, not loaded project ${project.id}.`);
  }
  const current = project.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === preview.shot.id);
  const missingShot = !current;
  const drifted = current
    ? (current.storyboardPrompt || '') !== (preview.shot.before.storyboardPrompt || '')
      || (current.storyboardCutPlan || '') !== (preview.shot.before.storyboardCutPlan || '')
    : false;
  const changed = preview.shot.before.storyboardPrompt !== preview.shot.after.storyboardPrompt
    || preview.shot.before.storyboardCutPlan !== preview.shot.after.storyboardCutPlan;

  return {
    kind: 'mirage.apply_plan.rewrite_storyboard_prompt',
    previewId: preview.previewId,
    previewPath: path.resolve(previewJsonPath),
    project: { id: project.id, title: project.title, status: project.status },
    shotId: preview.shot.id,
    counts: {
      changed: changed ? 1 : 0,
      missingShots: missingShot ? 1 : 0,
      driftedShots: drifted ? 1 : 0,
    },
    canApply: changed && !missingShot && !drifted,
    note: missingShot
      ? 'Refusing to apply because the previewed shot no longer exists.'
      : drifted
      ? 'Refusing to apply because the current storyboard prompt/cut plan drifted. Regenerate a fresh preview.'
      : changed
      ? 'Ready to apply. This will update storyboard_prompt, storyboard_cut_plan, storyboard_prompt_status, prompts_stale=false, and mark storyboard/video stale for review.'
      : 'Nothing changed in the preview.',
  };
};

export const applyRewriteStoryboardPromptPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readStoryboardPromptPreview(previewJsonPath);
  const plan = await getRewriteStoryboardPromptApplyPlan(previewJsonPath, project);
  if (!plan.canApply) throw new Error(plan.note);
  const current = project.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === preview.shot.id);

  await updateRows('shots', { id: preview.shot.id }, {
    storyboard_prompt: preview.shot.after.storyboardPrompt,
    storyboard_cut_plan: preview.shot.after.storyboardCutPlan,
    storyboard_prompt_status: 'success',
    storyboard_prompt_user_feedback: preview.userNote,
    prompts_stale: false,
    ...(current?.storyboardUrl ? { storyboard_status: 'stale' } : {}),
    ...(current?.videoUrl ? { video_status: 'stale' } : {}),
    last_error: null,
  });

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Mirage Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('applied storyboard prompt preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nShot updated: ${preview.shot.id}\n\nExisting storyboard/video outputs were marked stale for review when present. No assets or locks were changed.`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_prompt_preview_applied',
    entityType: 'shot',
    entityId: preview.shot.id,
    summary: `Applied storyboard prompt preview ${preview.previewId} for ${shotLabel(preview.shot.sceneIndex - 1, preview.shot.shotIndex - 1)}.`,
    payload: {
      previewId: preview.previewId,
      previewJsonPath: path.resolve(previewJsonPath),
      shotId: preview.shot.id,
      markedStoryboardStale: !!current?.storyboardUrl,
      markedVideoStale: !!current?.videoUrl,
    },
  });

  return {
    kind: 'mirage.apply.rewrite_storyboard_prompt',
    previewId: preview.previewId,
    projectId: project.id,
    shotId: preview.shot.id,
    journalPath,
    note: 'Applied preview to Supabase. Updated storyboard prompt/cut plan, cleared prompt stale state, and marked existing storyboard/video outputs stale.',
  };
};

const buildBriefMarkdown = (project: Project, actionList: ReturnType<typeof buildProjectActionList>): string => {
  const counts = statusCounts(project);
  const diagnosis = actionList.diagnosis;
  const actionLines = actionList.actions.length
    ? actionList.actions.slice(0, 10).map((action: any) => `- ${action.label} (${action.canRun ? 'native' : 'manual'}${action.estimatedCost ? `, ~$${action.estimatedCost}` : ''})`).join('\n')
    : '- No immediate actions found.';

  return `# ${project.title}

Updated: ${new Date().toISOString()}
Project ID: ${project.id}

## Current Read

${diagnosis.productionRead}

- Status: ${project.status}
- Workflow: ${usesStoryboardWorkflow(project) ? 'storyboard' : 'keyframe'}
- Models: text ${project.textProvider}, image ${project.imageModel}, storyboard ${project.storyboardProvider}, video ${project.videoModel}
- Format: ${project.aspectRatio}, ${project.videoResolution}
- Counts: ${counts.scenes} scenes, ${counts.shots} shots, ${counts.storyboards}/${counts.shots} boards, ${counts.videos}/${counts.shots} videos, ${counts.lockedShots}/${counts.shots} locked shots

## Bottleneck

${diagnosis.bottleneck}

## Weak Links

${diagnosis.weakLinks.length ? diagnosis.weakLinks.map((item) => `- ${item}`).join('\n') : '- None from deterministic checks.'}

## Risk Notes

${diagnosis.riskNotes.length ? diagnosis.riskNotes.map((item) => `- ${item}`).join('\n') : '- None from deterministic checks.'}

## Next Actions

${actionLines}
`;
};

const buildAudioAnalysisMarkdown = (project: Project): string => {
  const sections = project.musicalStructure.length
    ? project.musicalStructure.map((section: any) => `- ${section.label || 'Section'} ${section.startTime || '?'}-${section.endTime || '?'}${section.energyLevel ? `, energy ${section.energyLevel}` : ''}: ${section.description || ''}`).join('\n')
    : '- No musical structure saved.';

  return `# Audio Analysis

Project: ${project.title}
Updated: ${new Date().toISOString()}

## Classification

- Song type: ${project.songType || 'unknown'}
- Narrative: ${project.isNarrative ?? 'unknown'}
- Meditative: ${project.isMeditative ?? 'unknown'}

## Meaning

${md(project.meaning)}

## Musical Structure

${sections}

## Lyrics

${md(project.lyrics)}
`;
};

const buildConceptNotesMarkdown = (project: Project): string => {
  const locked = project.lockedConcept;
  const options = project.conceptOptions.length
    ? project.conceptOptions.map((option: any, index: number) => `## Option ${index + 1}: ${option.title || option.subject || option.primarySubject || 'Untitled'}

${md(option.description || option.conceptDirection || JSON.stringify(option, null, 2))}`).join('\n\n')
    : 'No concept options saved.';

  return `# Concept Notes

Project: ${project.title}
Updated: ${new Date().toISOString()}

## Locked Concept

${locked ? `### ${locked.title || locked.subject || locked.primarySubject || 'Untitled'}

${md(locked.description || locked.conceptDirection || JSON.stringify(locked, null, 2))}` : 'No locked concept.'}

## Saved Options

${options}
`;
};

const buildScriptMarkdown = (project: Project): string => {
  const cast = project.cast.length
    ? project.cast.map((member) => `- ${member.name}: ${member.description || 'No description.'}`).join('\n')
    : '- No cast/entities saved.';
  const environments = project.environments.length
    ? project.environments.map((environment) => `- ${environment.name}: ${environment.description || 'No description.'}`).join('\n')
    : '- No environments/locations saved.';
  const scenes = project.scenes.length
    ? project.scenes.map((scene, sceneIndex) => {
      const shots = scene.shots.map((shot, shotIndex) => `- ${shotLabel(sceneIndex, shotIndex)} (${shot.duration}s): ${shot.direction || shot.visualPrompt || shot.storyboardPrompt || 'No beat.'}`).join('\n');
      return `## Scene ${sceneIndex + 1}: ${scene.sectionLabel || 'Untitled'} (${scene.startTime || '?'}-${scene.endTime || '?'})

${md(scene.narrativeDescription)}

${shots || 'No shots.'}`;
    }).join('\n\n')
    : 'No scenes saved.';

  return `# Script

Project: ${project.title}
Updated: ${new Date().toISOString()}

## Cast / Entities

${cast}

## Environments / Locations

${environments}

## Scenes And Shots

${scenes}
`;
};

const buildStoryboardPromptsMarkdown = (project: Project): string => {
  const scenes = project.scenes.length
    ? project.scenes.map((scene, sceneIndex) => {
      const shots = scene.shots.map((shot, shotIndex) => `## ${shotLabel(sceneIndex, shotIndex)}: ${compactText(shot.direction, 120) || 'Shot'}

- Shot ID: ${shot.id}
- Duration: ${shot.duration}s
- Storyboard status: ${shot.storyboardStatus || 'idle'}${shot.storyboardLocked ? ', locked' : ''}
- Video status: ${shot.videoStatus || 'idle'}${shot.locked ? ', locked' : ''}

### Storyboard Prompt

${md(shot.storyboardPrompt)}

### Cut Plan

${md(shot.storyboardCutPlan)}

### Visual Prompt

${md(shot.visualPrompt)}

### Motion Prompt

${md(shot.motionPrompt)}
`).join('\n');
      return `# Scene ${sceneIndex + 1}: ${scene.sectionLabel || 'Untitled'}

${shots}`;
    }).join('\n\n')
    : 'No storyboard prompts saved.';

  return `# Storyboard Prompts

Project: ${project.title}
Updated: ${new Date().toISOString()}

${scenes}
`;
};

export const hydrateProjectWorkbench = async (project: Project, outputDir?: string) => {
  const baseDir = path.resolve(outputDir || defaultProjectWorkbenchDir(project));
  const snapshotDir = path.join(baseDir, 'snapshots');
  const packet = await buildProjectPacket(project);
  const actionList = buildProjectActionList(project);
  const configCopy = await writeProjectConfigDeskCopy(project, baseDir);
  const timestamp = safeTimestamp();
  const artifacts = [
    { type: 'brief', path: writeArtifact(path.join(baseDir, 'brief.md'), buildBriefMarkdown(project, actionList)) },
    { type: 'audio-analysis', path: writeArtifact(path.join(baseDir, 'audio-analysis.md'), buildAudioAnalysisMarkdown(project)) },
    { type: 'concept-notes', path: writeArtifact(path.join(baseDir, 'concept-notes.md'), buildConceptNotesMarkdown(project)) },
    { type: 'script', path: writeArtifact(path.join(baseDir, 'script.md'), buildScriptMarkdown(project)) },
    { type: 'storyboard-prompts', path: writeArtifact(path.join(baseDir, 'storyboard-prompts.md'), buildStoryboardPromptsMarkdown(project)) },
    { type: 'config-preferences', path: configCopy.preferencesPath },
    ...Object.entries(configCopy.promptPaths).map(([kind, promptPath]) => ({ type: `config-${kind}-prompt`, path: promptPath })),
    { type: 'config-hashes', path: configCopy.hashesPath },
    { type: 'action-plan', path: writeArtifact(path.join(baseDir, 'action-plan.json'), `${JSON.stringify(actionList, null, 2)}\n`) },
    { type: 'packet-snapshot', path: writeArtifact(path.join(snapshotDir, `${timestamp}-packet.json`), `${JSON.stringify(packet, null, 2)}\n`) },
    { type: 'actions-snapshot', path: writeArtifact(path.join(snapshotDir, `${timestamp}-actions.json`), `${JSON.stringify(actionList, null, 2)}\n`) },
    { type: 'director-notes', path: writeArtifactIfMissing(path.join(baseDir, 'director-notes.md'), `# Director Notes

Project: ${project.title}
Project ID: ${project.id}

Local Codex notes live here. This file is not overwritten by hydration.
`) },
  ];

  return {
    kind: 'mirage.project.workbench',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
    },
    baseDir,
    sourceOfTruth: 'Supabase remains canonical; these files are a local Codex workbench mirror.',
    artifacts,
    projectConfig: configCopy.state,
  };
};

type ScriptPreviewFile = {
  kind: 'mirage.preview.rewrite_script';
  previewId: string;
  generatedAt: string;
  project: { id: string; title: string; status: string; videoModel?: string; textProvider?: string };
  mode: 'generate' | 'refine';
  model: string;
  userNote: string | null;
  beforeFingerprint: string;
  beforeCounts: { cast: number; environments: number; scenes: number; shots: number };
  beforeProject?: {
    status: string;
    lastScriptPrompt?: string | null;
    lastWriteShotsPrompt?: string | null;
  };
  beforeRows?: {
    cast: Array<{ id: string; name: string; description?: string | null; generationPrompt?: string | null; promptsStale?: boolean; referenceAssetId?: string | null }>;
    environments: Array<{ id: string; name: string; description?: string | null; generationPrompt?: string | null; promptsStale?: boolean; referenceAssetId?: string | null }>;
    scenes: Array<{
      id: string;
      sectionLabel?: string | null;
      startTime?: string | null;
      endTime?: string | null;
      lyrics?: string | null;
      narrativeDescription?: string | null;
      shots: Array<{
        id: string;
        direction?: string | null;
        visualPrompt?: string | null;
        motionPrompt?: string | null;
        duration?: number | null;
        castIds?: string[];
        environmentId?: string | null;
        continuityFrom?: string | null;
        promptsStale?: boolean;
        useNextAsEndFrame?: boolean;
        lipsyncEnabled?: boolean;
        usePrevStoryboardRef?: boolean;
        includePrevCutPlan?: boolean | null;
        excludedRefs?: { storyboard: string[]; video: string[] };
      }>;
    }>;
  };
  afterCounts: { cast: number; environments: number; scenes: number; shots: number };
  script: { cast: any[]; environments: any[]; scenes: any[] };
  artifacts: { markdownPath: string; jsonPath: string; promptPath: string };
  note: string;
};

const musicalStructureText = (project: Project): string => {
  return project.musicalStructure.length
    ? project.musicalStructure.map((section: any) => `${section.label || 'Section'} [${section.startTime || '?'}-${section.endTime || '?'}] ${section.energyLevel || ''} ${section.description || ''}`).join('\n')
    : '';
};

const buildScriptDraft = (project: Project) => {
  const castById = namesById(project.cast);
  const environmentById = namesById(project.environments);
  return {
    cast: project.cast.map((member) => ({ name: member.name, description: member.description || '' })),
    environments: project.environments.map((environment) => ({ name: environment.name, description: environment.description || '' })),
    scenes: project.scenes.map((scene) => ({
      sectionLabel: scene.sectionLabel,
      startTime: scene.startTime,
      endTime: scene.endTime,
      narrativeDescription: scene.narrativeDescription,
      shots: scene.shots.map((shot) => ({
        direction: shot.direction || shot.visualPrompt || '',
        duration: shot.duration,
        castNames: (shot.castIds || []).map((id) => castById.get(id) || id),
        environmentName: shot.environmentId ? environmentById.get(shot.environmentId) || '' : '',
      })),
    })),
  };
};

const buildScriptRollbackRows = (project: Project): NonNullable<ScriptPreviewFile['beforeRows']> => ({
  cast: project.cast.map((member) => ({
    id: member.id,
    name: member.name,
    description: member.description || '',
    generationPrompt: member.generationPrompt || null,
    promptsStale: !!member.promptsStale,
    referenceAssetId: member.referenceAssetId || null,
  })),
  environments: project.environments.map((environment) => ({
    id: environment.id,
    name: environment.name,
    description: environment.description || '',
    generationPrompt: environment.generationPrompt || null,
    promptsStale: !!environment.promptsStale,
    referenceAssetId: environment.referenceAssetId || null,
  })),
  scenes: project.scenes.map((scene) => ({
    id: scene.id,
    sectionLabel: scene.sectionLabel || '',
    startTime: scene.startTime || '',
    endTime: scene.endTime || '',
    lyrics: scene.lyrics || '',
    narrativeDescription: scene.narrativeDescription || '',
    shots: scene.shots.map((shot) => ({
      id: shot.id,
      direction: shot.direction || '',
      visualPrompt: shot.visualPrompt || '',
      motionPrompt: shot.motionPrompt || '',
      duration: shot.duration || null,
      castIds: shot.castIds || [],
      environmentId: shot.environmentId || null,
      continuityFrom: shot.continuityFrom || 'cut',
      promptsStale: !!shot.promptsStale,
      useNextAsEndFrame: !!shot.useNextAsEndFrame,
      lipsyncEnabled: !!shot.lipsyncEnabled,
      usePrevStoryboardRef: !!shot.usePrevStoryboardRef,
      includePrevCutPlan: shot.includePrevCutPlan ?? null,
      excludedRefs: shot.excludedRefs || { storyboard: [], video: [] },
    })),
  })),
});

const scriptFingerprint = (project: Project): string => {
  return JSON.stringify(buildScriptDraft(project));
};

const scriptFingerprintFromDraft = (script: { cast: any[]; environments: any[]; scenes: any[] }): string => {
  return JSON.stringify({
    cast: (script.cast || []).map((member) => ({ name: member.name, description: member.description || '' })),
    environments: (script.environments || []).map((environment) => ({ name: environment.name, description: environment.description || '' })),
    scenes: (script.scenes || []).map((scene) => ({
      sectionLabel: scene.sectionLabel || '',
      startTime: scene.startTime || '',
      endTime: scene.endTime || '',
      lyrics: scene.lyrics || '',
      narrativeDescription: scene.narrativeDescription || '',
      shots: (scene.shots || []).map((shot: any) => ({
        direction: shot.direction || '',
        castNames: shot.castNames || [],
        environmentName: shot.environmentName || '',
        duration: shot.duration || undefined,
      })),
    })),
  });
};

const scriptCounts = (script: { cast: any[]; environments: any[]; scenes: any[] }) => ({
  cast: script.cast?.length || 0,
  environments: script.environments?.length || 0,
  scenes: script.scenes?.length || 0,
  shots: (script.scenes || []).reduce((sum, scene) => sum + (scene.shots?.length || 0), 0),
});

const hasDownstreamVisualWork = (project: Project): boolean => {
  return project.cast.some((member) => !!member.referenceImageUrl)
    || project.environments.some((environment) => !!environment.referenceImageUrl)
    || project.scenes.some((scene) => scene.shots.some((shot) => (
      !!shot.imageUrl
      || !!shot.storyboardUrl
      || !!shot.videoUrl
      || !!shot.locked
      || !!shot.storyboardLocked
    )));
};

const buildScriptPreviewMarkdown = (preview: ScriptPreviewFile): string => {
  const cast = preview.script.cast.length
    ? preview.script.cast.map((member) => `- ${member.name}: ${member.description || 'No description.'}`).join('\n')
    : '- No cast/entities proposed.';
  const environments = preview.script.environments.length
    ? preview.script.environments.map((environment) => `- ${environment.name}: ${environment.description || 'No description.'}`).join('\n')
    : '- No environments proposed.';
  const scenes = preview.script.scenes.length
    ? preview.script.scenes.map((scene, sceneIndex) => {
      const shots = (scene.shots || []).map((shot: any, shotIndex: number) => {
        const castNames = (shot.castNames || []).join(', ') || 'None';
        return `- ${shotLabel(sceneIndex, shotIndex)} (${shot.duration || '?'}s, cast: ${castNames}, env: ${shot.environmentName || 'None'}): ${shot.direction || 'No direction.'}`;
      }).join('\n');
      return `## Scene ${sceneIndex + 1}: ${scene.sectionLabel || 'Untitled'} (${scene.startTime || '?'}-${scene.endTime || '?'})

${md(scene.narrativeDescription)}

${shots || 'No shots.'}`;
    }).join('\n\n')
    : 'No scenes proposed.';

  return `# Script Preview

Generated: ${preview.generatedAt}
Preview ID: \`${preview.previewId}\`
Project: ${preview.project.title}
Project ID: \`${preview.project.id}\`
Mode: ${preview.mode}
Model: ${preview.model}
User note: ${preview.userNote || 'None'}

This is a preview only. No Lahari database rows, assets, frames, videos, references, or locks were changed.

## Counts

- Before: ${preview.beforeCounts.cast} cast, ${preview.beforeCounts.environments} environments, ${preview.beforeCounts.scenes} scenes, ${preview.beforeCounts.shots} shots
- After: ${preview.afterCounts.cast} cast, ${preview.afterCounts.environments} environments, ${preview.afterCounts.scenes} scenes, ${preview.afterCounts.shots} shots

## Cast / Entities

${cast}

## Environments / Locations

${environments}

## Scenes And Shots

${scenes}
`;
};

export const previewRewriteScript = async (project: Project, userNote?: string) => {
  if (!project.lockedConcept) throw new Error('Project has no locked concept. Lock a concept before script preview.');
  if (!project.audioPath) throw new Error('Project has no audio file.');
  const beforeScript = buildScriptDraft(project);
  const mode: 'generate' | 'refine' = project.scenes.length ? 'refine' : 'generate';
  const context = {
    concept: project.lockedConcept || {},
    lyrics: project.lyrics || '',
    meaning: project.meaning || '',
    musicalStructure: musicalStructureText(project),
    basePacing: project.targetDuration || 15,
    minShotDuration: getModelMinDuration(project.videoModel),
    videoModel: project.videoModel || undefined,
  };
  const result = mode === 'refine'
    ? await refineScript(beforeScript, userNote || 'Improve the script for stronger narrative clarity, continuity, and production feasibility while preserving what works.', context)
    : await planScenes({
      ...context,
      userNote,
      songType: project.songType || undefined,
      isNarrative: project.isNarrative ?? undefined,
      isMeditative: project.isMeditative ?? undefined,
    });

  const now = new Date().toISOString();
  const previewId = `${safeTimestamp()}-script`;
  const promptPath = defaultPreviewPath(project, previewId, 'runtime-prompt.txt');
  const jsonPath = defaultPreviewPath(project, previewId, 'preview.json');
  const markdownPath = defaultPreviewPath(project, previewId, 'preview.md');
  const script = {
    cast: result.cast || [],
    environments: result.environments || [],
    scenes: result.scenes || [],
  };
  const preview: ScriptPreviewFile = {
    kind: 'mirage.preview.rewrite_script',
    previewId,
    generatedAt: now,
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      videoModel: project.videoModel,
      textProvider: project.textProvider,
    },
    mode,
    model: mode === 'refine' ? 'claude-opus-4-7' : 'claude-opus-4-7',
    userNote: userNote || null,
    beforeFingerprint: scriptFingerprint(project),
    beforeCounts: scriptCounts(beforeScript),
    beforeProject: {
      status: project.status,
      lastScriptPrompt: project.lastScriptPrompt || null,
      lastWriteShotsPrompt: project.lastWriteShotsPrompt || null,
    },
    beforeRows: buildScriptRollbackRows(project),
    afterCounts: scriptCounts(script),
    script,
    artifacts: { markdownPath, jsonPath, promptPath },
    note: 'Preview only. Applying this preview replaces cast, environments, scenes, and shots, and is refused when downstream visual work exists.',
  };

  writeArtifact(promptPath, result.prompt);
  writeArtifact(jsonPath, `${JSON.stringify(preview, null, 2)}\n`);
  writeArtifact(markdownPath, buildScriptPreviewMarkdown(preview));
  return preview;
};

const readScriptPreview = (previewJsonPath: string): ScriptPreviewFile => {
  const resolved = path.resolve(previewJsonPath);
  if (!fs.existsSync(resolved)) throw new Error(`Preview JSON not found: ${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (parsed?.kind !== 'mirage.preview.rewrite_script') {
    throw new Error('Preview JSON is not a lahari.preview.rewrite_script artifact.');
  }
  if (!parsed.project?.id || !parsed.script?.scenes) {
    throw new Error('Preview JSON is missing project or script data.');
  }
  return parsed as ScriptPreviewFile;
};

export const getRewriteScriptApplyPlan = async (previewJsonPath: string, project: Project) => {
  const preview = readScriptPreview(previewJsonPath);
  if (preview.project.id !== project.id) {
    throw new Error(`Preview belongs to project ${preview.project.id}, not loaded project ${project.id}.`);
  }
  const drifted = scriptFingerprint(project) !== preview.beforeFingerprint;
  const downstreamVisualWork = hasDownstreamVisualWork(project);
  const hasScript = preview.afterCounts.scenes > 0 && preview.afterCounts.shots > 0;
  const canApply = hasScript && !drifted && !downstreamVisualWork;

  return {
    kind: 'mirage.apply_plan.rewrite_script',
    previewId: preview.previewId,
    previewPath: path.resolve(previewJsonPath),
    project: { id: project.id, title: project.title, status: project.status },
    mode: preview.mode,
    counts: {
      before: preview.beforeCounts,
      after: preview.afterCounts,
      drifted: drifted ? 1 : 0,
      downstreamVisualWork: downstreamVisualWork ? 1 : 0,
    },
    canApply,
    willChange: [
      'Replace cast/entity rows for this project.',
      'Replace environment/location rows for this project.',
      'Replace all scenes and shots for this project.',
      'Set project status to scripted.',
      'Update last_script_prompt from preview runtime prompt.',
    ],
    note: !hasScript
      ? 'Refusing to apply an empty script preview.'
      : drifted
      ? 'Refusing to apply because the current script drifted. Regenerate a fresh preview.'
      : downstreamVisualWork
      ? 'Refusing to apply because downstream visual work exists. Fork first or use the web studio destructive flow deliberately.'
      : 'Ready to apply. This replaces script structure only; no assets exist yet.',
  };
};

export const applyRewriteScriptPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readScriptPreview(previewJsonPath);
  const plan = await getRewriteScriptApplyPlan(previewJsonPath, project);
  if (!plan.canApply) throw new Error(plan.note);

  await deleteRows('cast_members', { project_id: project.id });
  await deleteRows('environments', { project_id: project.id });
  for (const scene of project.scenes) {
    await deleteRows('shots', { scene_id: scene.id });
  }
  await deleteRows('scenes', { project_id: project.id });

  const castNameToId = new Map<string, string>();
  for (let index = 0; index < preview.script.cast.length; index++) {
    const member = preview.script.cast[index];
    const id = uuidv4();
    castNameToId.set(String(member.name || '').toLowerCase(), id);
    await insertRow('cast_members', {
      id,
      project_id: project.id,
      name: member.name || `Character ${index + 1}`,
      description: member.description || '',
      sort_order: index,
    });
  }

  const environmentNameToId = new Map<string, string>();
  for (let index = 0; index < preview.script.environments.length; index++) {
    const environment = preview.script.environments[index];
    const id = uuidv4();
    environmentNameToId.set(String(environment.name || '').toLowerCase(), id);
    await insertRow('environments', {
      id,
      project_id: project.id,
      name: environment.name || `Environment ${index + 1}`,
      description: environment.description || '',
      sort_order: index,
    });
  }

  for (let sceneIndex = 0; sceneIndex < preview.script.scenes.length; sceneIndex++) {
    const scene = preview.script.scenes[sceneIndex];
    const sceneId = uuidv4();
    await insertRow('scenes', {
      id: sceneId,
      project_id: project.id,
      section_label: scene.sectionLabel || `Scene ${sceneIndex + 1}`,
      start_time: scene.startTime || '0:00',
      end_time: scene.endTime || '0:00',
      lyrics: scene.lyrics || '',
      narrative_description: scene.narrativeDescription || '',
      sort_order: sceneIndex,
    });

    for (let shotIndex = 0; shotIndex < (scene.shots || []).length; shotIndex++) {
      const shot = scene.shots[shotIndex];
      const castIds = (shot.castNames || [])
        .map((name: string) => castNameToId.get(String(name).toLowerCase()))
        .filter(Boolean);
      const environmentId = shot.environmentName
        ? environmentNameToId.get(String(shot.environmentName).toLowerCase()) || null
        : null;
      await insertRow('shots', {
        id: uuidv4(),
        scene_id: sceneId,
        direction: shot.direction || '',
        visual_prompt: '',
        motion_prompt: '',
        duration: Number(shot.duration || project.targetDuration || 15),
        cast_ids: JSON.stringify(castIds),
        environment_id: environmentId,
        // Defaults off; writeShotPrompts apply derives it later from
        // per-shot continuity_from. Replaces old videoMode heuristic.
        use_next_as_end_frame: 0,
        sort_order: shotIndex,
        image_status: 'idle',
        video_status: 'idle',
      });
    }
  }

  const promptText = preview.artifacts?.promptPath && fs.existsSync(preview.artifacts.promptPath)
    ? fs.readFileSync(preview.artifacts.promptPath, 'utf8')
    : undefined;
  await updateRows('projects', { id: project.id }, {
    status: 'scripted',
    ...(promptText ? { last_script_prompt: promptText } : {}),
    updated_at: new Date().toISOString(),
  });

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Mirage Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('applied script preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nMode: ${preview.mode}\nScenes: ${preview.afterCounts.scenes}\nShots: ${preview.afterCounts.shots}\n\nNo assets, frames, videos, or locks existed at apply time.`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'script_preview_applied',
    entityType: 'project',
    entityId: project.id,
    summary: `Applied script preview ${preview.previewId}; wrote ${preview.afterCounts.scenes} scenes and ${preview.afterCounts.shots} shots.`,
    payload: {
      previewId: preview.previewId,
      previewJsonPath: path.resolve(previewJsonPath),
      mode: preview.mode,
      scenesWritten: preview.afterCounts.scenes,
      shotsWritten: preview.afterCounts.shots,
    },
  });

  return {
    kind: 'mirage.apply.rewrite_script',
    previewId: preview.previewId,
    projectId: project.id,
    scenesWritten: preview.afterCounts.scenes,
    shotsWritten: preview.afterCounts.shots,
    journalPath,
    note: 'Applied preview to Supabase. Replaced cast, environments, scenes, and shots; project is now scripted.',
  };
};

export const rollbackRewriteShotPromptsPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readShotPromptPreview(previewJsonPath);
  if (preview.project.id !== project.id) throw new Error(`Preview belongs to ${preview.project.id}, not ${project.id}.`);

  const currentById = new Map(project.scenes.flatMap((scene) => scene.shots).map((shot) => [shot.id, shot]));
  const drifted: string[] = [];
  for (const shot of preview.shots) {
    const current = currentById.get(shot.id);
    if (!current) {
      drifted.push(shot.id);
      continue;
    }
    if (
      current.visualPrompt !== (shot.after.visualPrompt || '')
      || current.motionPrompt !== (shot.after.motionPrompt || '')
      || current.continuityFrom !== (shot.after.continuityFrom || 'cut')
    ) {
      drifted.push(shot.id);
    }
  }
  if (drifted.length) {
    throw new Error(`Refusing rollback because current shot prompts no longer match preview after-state. Drifted: ${drifted.join(', ')}`);
  }

  for (const shot of preview.shots) {
    await updateRows('shots', { id: shot.id }, {
      visual_prompt: shot.before.visualPrompt || '',
      motion_prompt: shot.before.motionPrompt || '',
      continuity_from: shot.before.continuityFrom || 'cut',
      prompts_stale: !!shot.before.promptsStale,
    });
  }

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Mirage Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('rolled back shot prompt preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nShots restored: ${preview.shots.length}`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'shot_prompts_preview_rolled_back',
    entityType: 'project',
    entityId: project.id,
    summary: `Rolled back shot prompt preview ${preview.previewId}; restored ${preview.shots.length} shots.`,
    payload: { previewId: preview.previewId, previewJsonPath: path.resolve(previewJsonPath), shotsRestored: preview.shots.length },
  });

  return {
    kind: 'mirage.rollback.rewrite_shot_prompts',
    previewId: preview.previewId,
    projectId: project.id,
    shotsRestored: preview.shots.length,
    journalPath,
    note: 'Rolled back preview fields to their before snapshot after validating current state matched the preview after-state.',
  };
};

export const rollbackRewriteStoryboardPromptPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readStoryboardPromptPreview(previewJsonPath);
  if (preview.project.id !== project.id) throw new Error(`Preview belongs to ${preview.project.id}, not ${project.id}.`);
  const current = project.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === preview.shot.id);
  if (!current) throw new Error(`Previewed shot no longer exists: ${preview.shot.id}`);
  if (
    (current.storyboardPrompt || '') !== preview.shot.after.storyboardPrompt
    || (current.storyboardCutPlan || '') !== preview.shot.after.storyboardCutPlan
  ) {
    throw new Error('Refusing rollback because the current storyboard prompt/cut plan no longer matches the preview after-state.');
  }

  await updateRows('shots', { id: preview.shot.id }, {
    storyboard_prompt: preview.shot.before.storyboardPrompt,
    storyboard_cut_plan: preview.shot.before.storyboardCutPlan,
    prompts_stale: !!preview.shot.before.promptsStale,
    storyboard_prompt_status: 'success',
    last_error: null,
  });

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Mirage Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('rolled back storyboard prompt preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nShot restored: ${preview.shot.id}`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_prompt_preview_rolled_back',
    entityType: 'shot',
    entityId: preview.shot.id,
    summary: `Rolled back storyboard prompt preview ${preview.previewId}.`,
    payload: { previewId: preview.previewId, previewJsonPath: path.resolve(previewJsonPath), shotId: preview.shot.id },
  });

  return {
    kind: 'mirage.rollback.rewrite_storyboard_prompt',
    previewId: preview.previewId,
    projectId: project.id,
    shotId: preview.shot.id,
    journalPath,
    note: 'Rolled back storyboard prompt fields to their before snapshot after validating current state matched the preview after-state.',
  };
};

export const rollbackRewriteScriptPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readScriptPreview(previewJsonPath);
  if (preview.project.id !== project.id) throw new Error(`Preview belongs to ${preview.project.id}, not ${project.id}.`);
  if (!preview.beforeRows || !preview.beforeProject) {
    throw new Error('This script preview does not contain a rollback snapshot. Regenerate the preview with the current tool version before relying on script rollback.');
  }
  if (hasDownstreamVisualWork(project)) {
    throw new Error('Refusing script rollback because downstream visual work now exists. Fork first or clear visual outputs before restoring script rows.');
  }
  if (scriptFingerprint(project) !== scriptFingerprintFromDraft(preview.script)) {
    throw new Error('Refusing rollback because the current script no longer matches the preview after-state.');
  }

  await rpcVoid('lahari_rollback_script_preview', {
    p_project_id: project.id,
    p_before_project: preview.beforeProject,
    p_before_rows: preview.beforeRows,
  });

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Mirage Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('rolled back script preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nRestored scenes: ${preview.beforeRows.scenes.length}`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'script_preview_rolled_back',
    entityType: 'project',
    entityId: project.id,
    summary: `Rolled back script preview ${preview.previewId}.`,
    payload: { previewId: preview.previewId, previewJsonPath: path.resolve(previewJsonPath), scenesRestored: preview.beforeRows.scenes.length },
  });

  return {
    kind: 'mirage.rollback.rewrite_script',
    previewId: preview.previewId,
    projectId: project.id,
    scenesRestored: preview.beforeRows.scenes.length,
    journalPath,
    note: 'Rolled back script/cast/environment rows from the preview rollback snapshot after validating current script matched the preview after-state.',
  };
};
