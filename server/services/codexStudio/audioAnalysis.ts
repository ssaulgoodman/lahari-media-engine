import { selectOne, updateRows } from '../../database.js';
import { readAsBase64, mimeFromExt, storageUrl } from '../../storage.js';
import { transcribeLyrics, detectStructure } from '../gemini.js';
import { recordDirectorEvent } from '../directorEvents.js';
import { logCall } from '../../xray.js';
import { generationKey, withInFlightGeneration } from '../inFlightGeneration.js';
import { buildNotebookMirrorArtifacts } from './notebook.js';
import { appendApplyJournal } from './applies/helpers.js';
import { webStudioUrl, type Project } from './core.js';

const audioRef = (project: Project) => (
  project.audioPath
    ? [{ type: 'audio' as const, label: 'Project audio', url: project.audioPath }]
    : []
);

const requireAudioPath = async (project: Project) => {
  const row = await selectOne('projects', { id: project.id });
  const audioPath = row?.audio_path;
  if (!audioPath) throw new Error('Project has no audio file.');
  return audioPath as string;
};

const nextProject = (project: Project, updates: Partial<Project>): Project => ({
  ...project,
  ...updates,
  updatedAt: new Date().toISOString(),
});

const analyzeAudioTranscribeUnlocked = async (
  project: Project,
  userId: string,
  opts: { language?: string | null } = {},
) => {
  const audioPath = await requireAudioPath(project);
  const audioBase64 = await readAsBase64(audioPath);
  const audioMime = mimeFromExt(audioPath);
  const t0 = Date.now();
  const lyrics = await transcribeLyrics(audioBase64, audioMime, opts.language || undefined);
  const durationMs = Date.now() - t0;

  await updateRows('projects', { id: project.id }, {
    lyrics,
    status: project.status === 'uploaded' || project.status === 'analyzing' ? 'analyzed' : project.status,
    updated_at: new Date().toISOString(),
  });
  await logCall({
    projectId: project.id,
    stage: 'transcribe-lyrics',
    model: 'gemini-3-pro-preview',
    prompt: `Transcribe lyrics from audio.\nLanguage: ${opts.language || 'Detect automatically'}.`,
    referenceInputs: audioRef(project),
    responseSummary: lyrics ? `${lyrics.split('\n').length} lines` : 'empty transcription',
    durationMs,
    costEstimate: 0.01,
  });
  await recordDirectorEvent({
    projectId: project.id,
    userId,
    source: 'codex',
    eventType: 'audio_transcribed',
    entityType: 'project',
    entityId: project.id,
    summary: 'Audio transcription applied to the project.',
    payload: { lines: lyrics ? lyrics.split('\n').length : 0 },
  });
  appendApplyJournal(project, 'transcribed audio', `Lyrics chars: ${lyrics.length}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  const updatedProject = nextProject(project, { lyrics, status: 'analyzed' } as Partial<Project>);
  return {
    kind: 'mirage.audio.transcribe',
    projectId: project.id,
    lyrics,
    changedArtifacts: buildNotebookMirrorArtifacts(updatedProject, { audioAnalysis: true }),
    note: 'Transcribed audio. Codex should interpret or summarize meaning in conversation when useful; no backend meaning prompt runs here.',
  };
};

export const analyzeAudioTranscribe = async (
  project: Project,
  userId: string,
  opts: { language?: string | null } = {},
) => withInFlightGeneration(
  generationKey('audio-transcribe', project.id, 'project'),
  { kind: 'audio-transcribe', projectId: project.id, targetId: project.id, targetLabel: 'project audio' },
  () => analyzeAudioTranscribeUnlocked(project, userId, opts),
);

const analyzeAudioStructureUnlocked = async (
  project: Project,
  userId: string,
) => {
  const audioPath = await requireAudioPath(project);
  const audioBase64 = await readAsBase64(audioPath);
  const audioMime = mimeFromExt(audioPath);
  const t0 = Date.now();
  const structureData = await detectStructure(audioBase64, audioMime);
  const durationMs = Date.now() - t0;
  const musicalStructure = Array.isArray(structureData) ? structureData : structureData.sections || [];

  await updateRows('projects', { id: project.id }, {
    musical_structure: JSON.stringify(musicalStructure),
    status: project.status === 'uploaded' || project.status === 'analyzing' ? 'analyzed' : project.status,
    updated_at: new Date().toISOString(),
  });
  await logCall({
    projectId: project.id,
    stage: 'detect-structure',
    model: 'gemini-3-pro-preview',
    prompt: 'Identify musical sections: label, startTime, endTime, energy level, description.',
    referenceInputs: audioRef(project),
    responseSummary: musicalStructure.map((s: any) => `${s.label} [${s.startTime}-${s.endTime}]`).join('\n') || 'no sections',
    durationMs,
    costEstimate: 0.01,
  });
  await recordDirectorEvent({
    projectId: project.id,
    userId,
    source: 'codex',
    eventType: 'audio_structure_analyzed',
    entityType: 'project',
    entityId: project.id,
    summary: 'Audio structure applied to the project.',
    payload: { sections: musicalStructure.length },
  });
  appendApplyJournal(project, 'analyzed audio structure', `Sections: ${musicalStructure.length}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  const updatedProject = nextProject(project, {
    musicalStructure,
    status: 'analyzed',
  } as Partial<Project>);
  return {
    kind: 'mirage.audio.structure',
    projectId: project.id,
    musicalStructure,
    changedArtifacts: buildNotebookMirrorArtifacts(updatedProject, { audioAnalysis: true }),
    note: 'Analyzed audio structure. Audio classification tags are no longer generated; use project style notes for pacing/taste decisions.',
  };
};

export const analyzeAudioStructure = async (
  project: Project,
  userId: string,
) => withInFlightGeneration(
  generationKey('audio-structure', project.id, 'project'),
  { kind: 'audio-structure', projectId: project.id, targetId: project.id, targetLabel: 'project audio' },
  () => analyzeAudioStructureUnlocked(project, userId),
);
