import { updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { styleDirectionHash, webStudioUrl, type Project } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import { appendApplyJournal, applyError, ensureLength, validateBaseHash } from './helpers.js';

export type StyleDirectionApplyInput = {
  styleDescription: string;
  styleGenerationPrompt?: string;
  colorPalette?: string;
};

export const applyStyleDirection = async (
  project: Project,
  input: StyleDirectionApplyInput,
  opts: { baseHash?: string; force?: boolean } = {},
) => {
  const validation = ensureLength('styleDescription', input?.styleDescription, 3000, { required: true })
    || ensureLength('styleGenerationPrompt', input?.styleGenerationPrompt, 4000)
    || ensureLength('colorPalette', input?.colorPalette, 500)
    || validateBaseHash(styleDirectionHash(project), opts.baseHash, opts.force);
  if (validation) return validation;

  const nextProject = {
    ...project,
    styleDescription: input.styleDescription.trim(),
    styleGenerationPrompt: input.styleGenerationPrompt?.trim() || undefined,
    colorPalette: input.colorPalette?.trim() || project.colorPalette,
  };
  await updateRows('projects', { id: project.id }, {
    style_description: nextProject.styleDescription,
    style_generation_prompt: nextProject.styleGenerationPrompt || null,
    ...(input.colorPalette !== undefined ? { color_palette: input.colorPalette?.trim() || null } : {}),
    updated_at: new Date().toISOString(),
  });

  const newHash = styleDirectionHash(nextProject);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'style_direction_applied',
    entityType: 'project',
    entityId: project.id,
    summary: 'Codex applied a project style direction.',
    payload: {
      newHash,
      descriptionChars: nextProject.styleDescription.length,
      generationPromptChars: nextProject.styleGenerationPrompt?.length || 0,
      colorPaletteChanged: input.colorPalette !== undefined,
    },
  });
  appendApplyJournal(project, 'applied style direction', `New hash: ${newHash}\nDescription chars: ${nextProject.styleDescription.length}\nGeneration prompt chars: ${nextProject.styleGenerationPrompt?.length || 0}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  return {
    kind: 'lahari.apply.style_direction',
    projectId: project.id,
    style: {
      styleDescription: nextProject.styleDescription,
      styleGenerationPrompt: nextProject.styleGenerationPrompt || null,
      colorPalette: nextProject.colorPalette || null,
    },
    newHash,
    changedArtifacts: buildNotebookMirrorArtifacts(nextProject, { style: true }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Applied style direction text. No style image was generated or locked; visualize or lock a preset separately.',
  };
};
