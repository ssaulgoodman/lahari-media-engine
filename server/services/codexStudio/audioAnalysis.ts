import { selectOne, updateRows } from '../../database.js';
import { readAsBase64, mimeFromExt, storageUrl } from '../../storage.js';
import { GEMINI_AUDIO_ANALYSIS_MODEL, transcribeLyrics, detectStructure } from '../gemini.js';
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

const parseTimestampMs = (value: unknown): number | null => {
  const text = String(value || '').trim();
  const match = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/) || text.match(/^(\d{1,2}):(\d{2})(?:\.\d+)?$/);
  if (!match) return null;
  if (match.length === 4) {
    return ((Number(match[1] || 0) * 3600) + (Number(match[2]) * 60) + Number(match[3])) * 1000;
  }
  return ((Number(match[1]) * 60) + Number(match[2])) * 1000;
};

const lastTimestampMs = (lyrics: string): number | null => {
  let last: number | null = null;
  for (const match of lyrics.matchAll(/\[(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]/g)) {
    const parsed = parseTimestampMs(match[1]);
    if (parsed !== null) last = Math.max(last ?? 0, parsed);
  }
  return last;
};

type TranscriptQualityProject = Pick<Project, 'lyrics' | 'musicalStructure'>;

const structureEndMs = (project: TranscriptQualityProject): number | null => {
  let maxEnd: number | null = null;
  for (const section of project.musicalStructure || []) {
    const parsed = parseTimestampMs(section?.endTime);
    if (parsed !== null) maxEnd = Math.max(maxEnd ?? 0, parsed);
  }
  return maxEnd;
};

const lyricsLineCount = (lyrics: string): number => lyrics.split('\n').map((line) => line.trim()).filter(Boolean).length;

export const assertTranscriptDoesNotRegress = (project: TranscriptQualityProject, lyrics: string) => {
  const previous = String(project.lyrics || '');
  const newLines = lyricsLineCount(lyrics);
  const previousLines = lyricsLineCount(previous);
  if (!lyrics.trim()) {
    const err = new Error('Audio transcription returned empty output; existing lyrics were preserved.');
    (err as any).statusCode = 502;
    (err as any).code = 'audio_transcription_empty';
    throw err;
  }

  const expectedEnd = structureEndMs(project);
  const observedEnd = lastTimestampMs(lyrics);
  if (expectedEnd && observedEnd && observedEnd < expectedEnd * 0.75) {
    const err = new Error(`Audio transcription appears partial: last timestamp ${Math.round(observedEnd / 1000)}s is far before expected ${Math.round(expectedEnd / 1000)}s. Existing lyrics were preserved.`);
    (err as any).statusCode = 502;
    (err as any).code = 'audio_transcription_partial';
    (err as any).details = { observedEndMs: observedEnd, expectedEndMs: expectedEnd, newLines, previousLines };
    throw err;
  }

  if (previousLines >= 20 && newLines < previousLines * 0.75) {
    const err = new Error(`Audio transcription regressed from ${previousLines} lines to ${newLines} lines. Existing lyrics were preserved.`);
    (err as any).statusCode = 502;
    (err as any).code = 'audio_transcription_regressed';
    (err as any).details = { newLines, previousLines };
    throw err;
  }
};

export const applySourceLyrics = async (
  project: Project,
  userId: string,
  lyrics: string,
  opts: { source?: string | null; note?: string | null } = {},
) => {
  const cleaned = String(lyrics || '').trim();
  if (cleaned.length < 20) throw new Error('apply_source_lyrics requires non-empty lyrics/source text.');
  await updateRows('projects', { id: project.id }, {
    lyrics: cleaned,
    status: project.status === 'uploaded' || project.status === 'analyzing' ? 'analyzed' : project.status,
    updated_at: new Date().toISOString(),
  });
  await recordDirectorEvent({
    projectId: project.id,
    userId,
    source: 'codex',
    eventType: 'source_lyrics_applied',
    entityType: 'project',
    entityId: project.id,
    summary: 'Source lyrics/text applied to the project.',
    payload: {
      source: opts.source || null,
      note: opts.note || null,
      chars: cleaned.length,
      lines: lyricsLineCount(cleaned),
    },
  });
  appendApplyJournal(project, 'applied source lyrics', `Lyrics chars: ${cleaned.length}\nSource: ${opts.source || 'unspecified'}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  const updatedProject = nextProject(project, { lyrics: cleaned, status: 'analyzed' } as Partial<Project>);
  return {
    kind: 'mirage.audio.source_lyrics',
    projectId: project.id,
    chars: cleaned.length,
    lines: lyricsLineCount(cleaned),
    changedArtifacts: buildNotebookMirrorArtifacts(updatedProject, { audioAnalysis: true }),
    note: 'Applied project source lyrics/text. Use this when canonical text is better than a partial transcription.',
  };
};

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
  assertTranscriptDoesNotRegress(project, lyrics);

  await updateRows('projects', { id: project.id }, {
    lyrics,
    status: project.status === 'uploaded' || project.status === 'analyzing' ? 'analyzed' : project.status,
    updated_at: new Date().toISOString(),
  });
  await logCall({
    projectId: project.id,
    stage: 'transcribe-lyrics',
    model: GEMINI_AUDIO_ANALYSIS_MODEL,
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
    model: GEMINI_AUDIO_ANALYSIS_MODEL,
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
