import { updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { conceptHash, webStudioUrl, type Project } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import { appendApplyJournal, applyError, ensureLength, validateBaseHash } from './helpers.js';

export type ConceptApplyInput = {
  title: string;
  direction: string;
  description: string;
  deity?: string;
  mood?: string;
};

export const applyConcept = async (project: Project, concept: ConceptApplyInput, opts: { baseHash?: string; force?: boolean } = {}) => {
  const validation = ensureLength('title', concept?.title, 200, { required: true })
    || ensureLength('direction', concept?.direction, 500, { required: true })
    || ensureLength('description', concept?.description, 2000, { required: true })
    || ensureLength('deity', concept?.deity, 100)
    || ensureLength('mood', concept?.mood, 200)
    || validateBaseHash(conceptHash(project.lockedConcept), opts.baseHash, opts.force);
  if (validation) return validation;

  const nextConcept = {
    title: concept.title.trim(),
    direction: concept.direction.trim(),
    description: concept.description.trim(),
    ...(concept.deity?.trim() ? { deity: concept.deity.trim() } : {}),
    ...(concept.mood?.trim() ? { mood: concept.mood.trim() } : {}),
  };
  const hasScript = project.scenes.length > 0;
  await updateRows('projects', { id: project.id }, {
    locked_concept: JSON.stringify(nextConcept),
    status: hasScript ? project.status : 'concept_locked',
    updated_at: new Date().toISOString(),
  });
  if (hasScript) {
    const shotIds = project.scenes.flatMap((scene) => scene.shots.map((shot) => shot.id));
    for (const shotId of shotIds) {
      await updateRows('shots', { id: shotId }, { prompts_stale: true });
    }
  }

  const newHash = conceptHash(nextConcept);
  const notebookProject = {
    ...project,
    lockedConcept: nextConcept,
    status: hasScript ? project.status : 'concept_locked',
    scenes: hasScript
      ? project.scenes.map((scene) => ({
        ...scene,
        shots: scene.shots.map((shot) => ({ ...shot, promptsStale: true })),
      }))
      : project.scenes,
  };
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'concept_applied',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex applied locked concept "${nextConcept.title}".`,
    payload: {
      newHash,
      sourceCharCount: JSON.stringify(nextConcept).length,
      markedPromptsStale: hasScript,
    },
  });
  appendApplyJournal(project, 'applied concept', `Title: ${nextConcept.title}\nNew hash: ${newHash}\nMarked prompts stale: ${hasScript}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  return {
    kind: 'lahari.apply.concept',
    projectId: project.id,
    concept: nextConcept,
    newHash,
    markedPromptsStale: hasScript,
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject, {
      concept: true,
      shotPrompts: hasScript,
    }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: hasScript
      ? 'Applied concept and marked existing shot prompts stale for review.'
      : 'Applied concept. No script rows were changed.',
  };
};
