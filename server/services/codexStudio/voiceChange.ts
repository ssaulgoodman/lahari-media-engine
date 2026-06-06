import fs from 'fs';
import crypto from 'crypto';
import { insertRow, incrementColumn, selectOne, updateRows } from '../../database.js';
import { storageUrl, downloadToTmp, saveBuffer, mimeFromExt } from '../../storage.js';
import { buildContextChain, logCall } from '../../xray.js';
import { eventResultPointers, recordDirectorEvent } from '../directorEvents.js';
import { assertDailyCapAvailable, incrementProviderUsageDaily } from '../providerUsage.js';
import { changeElevenLabsVoice } from '../tts/elevenlabs.js';
import { extractVideoAudioSegment, probeMediaDurationSec, replaceVideoAudioWithSegments } from '../ffmpeg.js';
import {
  appendSessionJournalEntry,
  shotLabel,
  webStudioUrl,
  type Project,
  type ProjectShot,
} from './core.js';
import { buildNotebookMirrorArtifacts } from './notebook.js';

const VOICE_CHANGE_USD_PER_MINUTE = 0.30;
const VOICE_CHANGE_CREDITS_PER_MINUTE = 1000;
const DEFAULT_STS_MODEL = 'eleven_multilingual_sts_v2';

type VoiceChangeSegmentInput = {
  startMs?: number;
  endMs?: number;
  speakerId?: string;
  voiceId?: string;
  label?: string;
};

type VoiceChangeSegment = Required<Pick<VoiceChangeSegmentInput, 'startMs' | 'endMs'>> & {
  speakerId?: string;
  voiceId: string;
  label?: string;
  speakerName?: string;
};

export type VoiceChangeVideoInput = {
  shotId: string;
  sourceVideoAssetId?: string;
  segments: VoiceChangeSegmentInput[];
  dryRun?: boolean;
  modelId?: string;
  removeBackgroundNoise?: boolean;
  makeCanonical?: boolean;
  note?: string;
};

const roundCost = (value: number): number => Number(value.toFixed(4));

const estimateVoiceChange = (seconds: number) => ({
  processedSec: Number(Math.max(0, seconds).toFixed(3)),
  estimatedCredits: Math.ceil((Math.max(0, seconds) / 60) * VOICE_CHANGE_CREDITS_PER_MINUTE),
  estimatedUsd: roundCost((Math.max(0, seconds) / 60) * VOICE_CHANGE_USD_PER_MINUTE),
});

const findProjectShot = (project: Project, shotId: string): { shot: ProjectShot; sceneIndex: number; shotIndex: number } | null => {
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const shotIndex = scene.shots.findIndex((shot) => shot.id === shotId);
    if (shotIndex >= 0) return { shot: scene.shots[shotIndex], sceneIndex: sceneIndex + 1, shotIndex: shotIndex + 1 };
  }
  return null;
};

const withShotVideoPatch = (project: Project, shotId: string, videoUrl: string): Project => ({
  ...project,
  scenes: project.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => shot.id === shotId ? { ...shot, videoUrl, videoStatus: 'success' } : shot),
  })),
});

const fileExtForMime = (mimeType: string) => {
  const clean = mimeType.split(';')[0].trim().toLowerCase();
  if (clean.includes('mpeg') || clean.includes('mp3')) return 'mp3';
  if (clean.includes('wav')) return 'wav';
  if (clean.includes('ogg')) return 'ogg';
  if (clean.includes('mp4') || clean.includes('m4a')) return 'm4a';
  return 'mp3';
};

const validateSourceVideo = async (project: Project, input: VoiceChangeVideoInput) => {
  const shotRow = await selectOne('shots', { id: input.shotId });
  if (!shotRow || shotRow.project_id && shotRow.project_id !== project.id) {
    throw new Error(`Shot not found in project: ${input.shotId}`);
  }
  const sourceVideoAssetId = input.sourceVideoAssetId || shotRow.video_asset_id;
  if (!sourceVideoAssetId) throw new Error('No source video asset is available. Generate or pass sourceVideoAssetId first.');
  const sourceVideo = await selectOne('assets', { id: sourceVideoAssetId, project_id: project.id });
  if (!sourceVideo) throw new Error(`Source video asset not found in this project: ${sourceVideoAssetId}`);
  if (sourceVideo.shot_id && sourceVideo.shot_id !== input.shotId) {
    throw new Error('sourceVideoAssetId belongs to a different shot.');
  }
  if (!sourceVideo.file_path) throw new Error('Source video asset has no file_path.');
  if (!String(sourceVideo.file_path).toLowerCase().match(/\.(mp4|webm|mov|mkv)$/) && !String(sourceVideo.category || '').includes('video')) {
    throw new Error('sourceVideoAssetId must reference a video asset.');
  }
  return { shotRow, sourceVideo, sourceVideoAssetId };
};

const normalizeSegments = (project: Project, inputSegments: VoiceChangeSegmentInput[], durationSec: number): VoiceChangeSegment[] => {
  if (!Array.isArray(inputSegments) || inputSegments.length === 0) {
    throw new Error('voice_change_video requires at least one segment.');
  }
  const castById = new Map(project.cast.map((member) => [member.id, member]));
  const durationMs = Math.max(1, Math.round(durationSec * 1000));
  return inputSegments.map((segment, index) => {
    const isWholeClipDefault = inputSegments.length === 1 && segment.startMs === undefined && segment.endMs === undefined;
    const startMs = isWholeClipDefault ? 0 : Number(segment.startMs);
    const endMs = isWholeClipDefault ? durationMs : Number(segment.endMs);
    if (!Number.isFinite(startMs) || startMs < 0) throw new Error(`Segment ${index + 1} has invalid startMs.`);
    if (!Number.isFinite(endMs) || endMs <= startMs) throw new Error(`Segment ${index + 1} must have endMs greater than startMs.`);
    if (endMs > durationMs + 200) throw new Error(`Segment ${index + 1} ends after the source video duration.`);
    const speaker = segment.speakerId ? castById.get(segment.speakerId) : undefined;
    const voiceId = segment.voiceId || speaker?.voiceId;
    if (!voiceId) {
      throw new Error(`Segment ${index + 1} has no voiceId and no assigned speaker voice.`);
    }
    return {
      startMs: Math.max(0, Math.round(startMs)),
      endMs: Math.min(durationMs, Math.round(endMs)),
      speakerId: segment.speakerId,
      speakerName: speaker?.name,
      voiceId,
      label: segment.label,
    };
  });
};

export const voiceChangeVideo = async (
  project: Project,
  userId: string,
  input: VoiceChangeVideoInput,
) => {
  const target = findProjectShot(project, input.shotId);
  if (!target) throw new Error(`Shot not found in project: ${input.shotId}`);
  const { sourceVideo, sourceVideoAssetId } = await validateSourceVideo(project, input);
  const durationSec = await probeMediaDurationSec(sourceVideo.file_path);
  const segments = normalizeSegments(project, input.segments, durationSec);
  const estimates = estimateVoiceChange(segments.reduce((sum, segment) => sum + ((segment.endMs - segment.startMs) / 1000), 0));
  const modelId = input.modelId || DEFAULT_STS_MODEL;
  const makeCanonical = input.makeCanonical !== false;

  const plan = {
    kind: 'mirage.voice_change.plan',
    projectId: project.id,
    shotId: input.shotId,
    sourceVideoAssetId,
    sourceVideoUrl: storageUrl(sourceVideo.file_path),
    durationSec: Number(durationSec.toFixed(3)),
    modelId,
    segments: segments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerId: segment.speakerId || null,
      speakerName: segment.speakerName || null,
      voiceId: segment.voiceId,
      label: segment.label || null,
    })),
    makeCanonical,
    ...estimates,
    billingNote: 'ElevenLabs documents voice changer billing by processed audio minute; estimatedUsd is an internal cap/accounting estimate, not invoice truth.',
  };

  if (input.dryRun) return plan;
  await assertDailyCapAvailable(userId, 'elevenlabs', estimates.estimatedUsd);

  const started = Date.now();
  const sourceSegmentAssets: Array<{ assetId: string; path: string; url: string; startMs: number; endMs: number }> = [];
  const changedSegmentAssets: Array<{ assetId: string; path: string; url: string; startMs: number; endMs: number; voiceId: string }> = [];

  for (const [index, segment] of segments.entries()) {
    const startSec = segment.startMs / 1000;
    const segmentDurationSec = (segment.endMs - segment.startMs) / 1000;
    const sourceAudioPath = await extractVideoAudioSegment(sourceVideo.file_path, startSec, segmentDurationSec);
    const sourceAudioAssetId = crypto.randomUUID();
    await insertRow('assets', {
      id: sourceAudioAssetId,
      project_id: project.id,
      shot_id: input.shotId,
      category: 'voice_change_source_audio',
      file_path: sourceAudioPath,
      prompt: input.note || `Voice change source segment ${index + 1}`,
      metadata: JSON.stringify({
        sourceVideoAssetId,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: segment.speakerId || null,
        label: segment.label || null,
      }),
    });
    sourceSegmentAssets.push({
      assetId: sourceAudioAssetId,
      path: sourceAudioPath,
      url: storageUrl(sourceAudioPath),
      startMs: segment.startMs,
      endMs: segment.endMs,
    });

    const localAudio = await downloadToTmp(sourceAudioPath);
    const audioBuffer = fs.readFileSync(localAudio);
    const changed = await changeElevenLabsVoice({
      userId,
      voiceId: segment.voiceId,
      modelId,
      audioBuffer,
      mimeType: mimeFromExt(localAudio),
      filename: `segment-${index + 1}.mp3`,
      removeBackgroundNoise: input.removeBackgroundNoise,
    });
    const changedExt = fileExtForMime(changed.mimeType);
    const changedPath = await saveBuffer(changed.audioBuffer, 'audio', changedExt);
    const changedAssetId = crypto.randomUUID();
    await insertRow('assets', {
      id: changedAssetId,
      project_id: project.id,
      shot_id: input.shotId,
      category: 'voice_changed_audio',
      file_path: changedPath,
      prompt: input.note || `Voice changed segment ${index + 1}`,
      metadata: JSON.stringify({
        sourceVideoAssetId,
        sourceAudioAssetId,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: segment.speakerId || null,
        speakerName: segment.speakerName || null,
        voiceId: segment.voiceId,
        modelId,
        mimeType: changed.mimeType,
      }),
    });
    changedSegmentAssets.push({
      assetId: changedAssetId,
      path: changedPath,
      url: storageUrl(changedPath),
      startMs: segment.startMs,
      endMs: segment.endMs,
      voiceId: segment.voiceId,
    });
  }

  const finalVideoPath = await replaceVideoAudioWithSegments(
    sourceVideo.file_path,
    changedSegmentAssets.map((segment) => ({
      audioStoragePath: segment.path,
      startSec: segment.startMs / 1000,
      durationSec: (segment.endMs - segment.startMs) / 1000,
    })),
    durationSec,
  );
  const finalAssetId = crypto.randomUUID();
  await insertRow('assets', {
    id: finalAssetId,
    project_id: project.id,
    shot_id: input.shotId,
    category: 'shot_video',
    file_path: finalVideoPath,
    prompt: input.note || 'Voice-changed native dialogue video.',
    metadata: JSON.stringify({
      sourceVideoAssetId,
      sourceAudioAssetIds: sourceSegmentAssets.map((segment) => segment.assetId),
      changedAudioAssetIds: changedSegmentAssets.map((segment) => segment.assetId),
      voiceChange: {
        provider: 'elevenlabs',
        modelId,
        segments: plan.segments,
        processedSec: estimates.processedSec,
        estimatedCredits: estimates.estimatedCredits,
        estimatedUsd: estimates.estimatedUsd,
        removeBackgroundNoise: !!input.removeBackgroundNoise,
      },
    }),
  });
  if (makeCanonical) {
    await updateRows('shots', { id: input.shotId }, {
      video_asset_id: finalAssetId,
      video_status: 'success',
      last_error: null,
    });
  }
  await incrementProviderUsageDaily(userId, 'elevenlabs', {
    costUsd: estimates.estimatedUsd,
    charCount: estimates.estimatedCredits,
  });
  await incrementColumn('projects', { id: project.id }, 'cost_estimate', estimates.estimatedUsd);
  await updateRows('projects', { id: project.id }, { updated_at: new Date().toISOString() });

  const finalVideoUrl = storageUrl(finalVideoPath);
  const result = {
    kind: 'mirage.voice_change.video',
    projectId: project.id,
    shotId: input.shotId,
    sourceVideoAssetId,
    finalVideoAssetId: finalAssetId,
    finalVideoUrl,
    makeCanonical,
    modelId,
    processedSec: estimates.processedSec,
    estimatedCredits: estimates.estimatedCredits,
    estimatedCostUsd: estimates.estimatedUsd,
    segments: changedSegmentAssets.map((segment, index) => ({
      ...plan.segments[index],
      sourceAudioAssetId: sourceSegmentAssets[index]?.assetId,
      changedAudioAssetId: segment.assetId,
      changedAudioUrl: segment.url,
    })),
  };

  await logCall({
    projectId: project.id,
    stage: 'voice-change-video',
    model: `elevenlabs:${modelId}`,
    prompt: [
      `Voice-change native video audio for ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}.`,
      input.note ? `Note: ${input.note}` : null,
      `Segments: ${plan.segments.map((segment) => `${segment.startMs}-${segment.endMs}ms -> ${segment.speakerName || segment.voiceId}`).join('; ')}`,
    ].filter(Boolean).join('\n'),
    referenceInputs: [
      { type: 'audio', label: 'Source video audio segments', preview: JSON.stringify(plan.segments) },
      { type: 'text', label: 'Source video asset', preview: sourceVideoAssetId },
    ],
    contextChain: await buildContextChain(project.id),
    responseSummary: `Voice-changed ${segments.length} segment(s); final video ${finalAssetId}${makeCanonical ? ' is canonical' : ''}.`,
    outputAssetIds: [finalAssetId, ...sourceSegmentAssets.map((segment) => segment.assetId), ...changedSegmentAssets.map((segment) => segment.assetId)],
    durationMs: Date.now() - started,
    costEstimate: estimates.estimatedUsd,
  });

  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'video_voice_changed',
    entityType: 'shot',
    entityId: input.shotId,
    summary: `Codex voice-changed ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)} with ${segments.length} segment(s).`,
    payload: {
      sourceVideoAssetId,
      result: eventResultPointers(result),
      segments: result.segments,
      makeCanonical,
      note: input.note || null,
    },
  });
  appendSessionJournalEntry(
    project,
    'voice changed video',
    `${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}\nShot ID: ${input.shotId}\nSource video: ${sourceVideoAssetId}\nFinal video: ${finalAssetId}\nSegments: ${segments.length}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId: input.shotId, action: 'review-video' })}`,
  );

  return {
    ...result,
    changedArtifacts: buildNotebookMirrorArtifacts(
      makeCanonical ? withShotVideoPatch(project, input.shotId, finalVideoUrl) : project,
      { brief: true, shotPrompts: true },
    ),
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId: input.shotId, action: 'review-video' }),
    note: makeCanonical
      ? 'Voice-changed video created and set as the active shot video. Raw source video remains in asset history.'
      : 'Voice-changed video created but not made active.',
  };
};
