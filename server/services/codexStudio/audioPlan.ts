import crypto from 'crypto';
import { updateRows, insertRow } from '../../database.js';
import { saveBuffer, storageUrl } from '../../storage.js';
import { recordDirectorEvent } from '../directorEvents.js';
import { assertDailyCapAvailable, incrementProviderUsageDaily } from '../providerUsage.js';
import { generateSpeech } from '../tts/index.js';
import { audioPlanHash, castVoiceHash, webStudioUrl, type Project, type ProjectShot } from './core.js';
import { buildNotebookMirrorArtifacts } from './notebook.js';
import {
  appendApplyJournal,
  applyError,
  findProjectShot,
  shotApplyLabel,
  validateBaseHash,
  type ApplyError,
} from './applies/helpers.js';
import { parseAudioPlanMarkdownDraft } from './audioPlanMarkdown.js';

export type DialogueStrategy = 'lipsync' | 'overlay';
export type TtsStatus = 'pending' | 'generating' | 'success' | 'error';

export type AudioPlanDialogueLine = {
  id: string;
  characterId: string;
  text: string;
  order: number;
  targetSec?: number;
  ttsAssetId: string | null;
  ttsStatus: TtsStatus;
  ttsError?: string;
  ttsCharCount?: number;
  ttsDurationSec?: number;
};

export type AudioPlan = {
  dialogueStrategy: DialogueStrategy;
  dialogue: AudioPlanDialogueLine[];
  soundNotes?: string;
};

export type AudioPlanApplyInput = {
  shotId: string;
  audioPlan: AudioPlan;
  baseHash?: string;
};

export type CastVoiceApplyInput = {
  castMemberId: string;
  voiceProvider: 'elevenlabs';
  voiceId: string;
  voiceName?: string;
  baseHash?: string;
};

type DialogueTarget = {
  shot: ProjectShot;
  audioPlan: AudioPlan;
  line: AudioPlanDialogueLine;
  lineIndex: number;
};

const ELEVENLABS_TTS_USD_PER_1K_CHARS = 0.30;

const estimateTtsUsd = (chars: number) =>
  Number(((Math.max(0, chars) / 1000) * ELEVENLABS_TTS_USD_PER_1K_CHARS).toFixed(4));

const extForMime = (mimeType: string) => {
  const clean = mimeType.split(';')[0].trim().toLowerCase();
  if (clean.includes('mpeg') || clean.includes('mp3')) return 'mp3';
  if (clean.includes('wav')) return 'wav';
  if (clean.includes('ogg')) return 'ogg';
  if (clean.includes('mp4') || clean.includes('m4a')) return 'm4a';
  return 'mp3';
};

const normalizeStrategy = (value: unknown): DialogueStrategy | null =>
  value === 'lipsync' || value === 'overlay' ? value : null;

const clip = (value: unknown, max: number): string => (
  typeof value === 'string' ? value.trim().slice(0, max) : ''
);

const validateAudioPlanInput = (project: Project, shotId: string, raw: any): { audioPlan?: AudioPlan; error?: ApplyError } => {
  const castIds = new Set(project.cast.map((member) => member.id));
  const dialogueStrategy = normalizeStrategy(raw?.dialogueStrategy);
  if (!dialogueStrategy) {
    return { error: applyError('validation_failed', 'audioPlan.dialogueStrategy must be lipsync or overlay.', { shotId, field: 'dialogueStrategy' }) };
  }
  if (!Array.isArray(raw?.dialogue)) {
    return { error: applyError('validation_failed', 'audioPlan.dialogue must be an array.', { shotId, field: 'dialogue' }) };
  }
  const dialogue: AudioPlanDialogueLine[] = [];
  for (const [index, line] of raw.dialogue.entries()) {
    const id = clip(line?.id, 120) || `dlg_${index + 1}`;
    const characterId = clip(line?.characterId, 120);
    const text = clip(line?.text, 500);
    if (!characterId || !castIds.has(characterId)) {
      return { error: applyError('validation_failed', `Dialogue line ${index + 1} references an unknown characterId.`, { shotId, field: 'characterId' }) };
    }
    if (!text) {
      return { error: applyError('validation_failed', `Dialogue line ${index + 1} needs text.`, { shotId, field: 'text' }) };
    }
    const targetSec = Number(line?.targetSec);
    dialogue.push({
      id,
      characterId,
      text,
      order: Number.isFinite(Number(line?.order)) ? Number(line.order) : index + 1,
      targetSec: Number.isFinite(targetSec) && targetSec > 0 ? Math.min(targetSec, 30) : undefined,
      ttsAssetId: typeof line?.ttsAssetId === 'string' ? line.ttsAssetId : null,
      ttsStatus: line?.ttsStatus === 'success' || line?.ttsStatus === 'generating' || line?.ttsStatus === 'error' ? line.ttsStatus : 'pending',
      ttsError: clip(line?.ttsError, 500) || undefined,
      ttsCharCount: Number.isFinite(Number(line?.ttsCharCount)) ? Number(line.ttsCharCount) : undefined,
      ttsDurationSec: Number.isFinite(Number(line?.ttsDurationSec)) ? Number(line.ttsDurationSec) : undefined,
    });
  }
  dialogue.sort((a, b) => a.order - b.order);
  dialogue.forEach((line, index) => { line.order = index + 1; });
  return {
    audioPlan: {
      dialogueStrategy,
      dialogue,
      soundNotes: clip(raw?.soundNotes, 1000) || undefined,
    },
  };
};

const collectDialogueTargets = (
  project: Project,
  filters: { shotIds?: string[]; dialogueIds?: string[]; characterIds?: string[] },
): DialogueTarget[] => {
  const targets: DialogueTarget[] = [];
  for (const scene of project.scenes) {
    for (const shot of scene.shots) {
      const audioPlan = shot.audioPlan as AudioPlan | undefined;
      if (!audioPlan) continue;
      if (filters.shotIds?.length && !filters.shotIds.includes(shot.id)) continue;
      audioPlan.dialogue.forEach((line, lineIndex) => {
        if (filters.dialogueIds?.length && !filters.dialogueIds.includes(line.id)) return;
        if (filters.characterIds?.length && !filters.characterIds.includes(line.characterId)) return;
        if (line.ttsStatus === 'success' && line.ttsAssetId && !filters.dialogueIds?.length) return;
        targets.push({ shot, audioPlan, line, lineIndex });
      });
    }
  }
  return targets;
};

const nextProjectWithAudioPlans = (project: Project, updates: Map<string, AudioPlan>): Project => ({
  ...project,
  scenes: project.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => (
      updates.has(shot.id)
        ? { ...shot, audioPlan: updates.get(shot.id), audioPlanStale: false }
        : shot
    )),
  })),
});

export const applyAudioPlan = async (
  project: Project,
  shots: AudioPlanApplyInput[],
  opts: { force?: boolean } = {},
) => {
  if (!Array.isArray(shots) || shots.length === 0) {
    return applyError('validation_failed', 'shots must contain at least one audio plan update.', { field: 'shots' });
  }

  const applied: Array<{ shotId: string; newHash: string }> = [];
  const rejected: ApplyError[] = [];
  const nextPlansByShot = new Map<string, AudioPlan>();

  for (const input of shots) {
    const target = findProjectShot(project, input.shotId);
    if (!target) {
      rejected.push(applyError('shot_not_found', `Shot not found in project: ${input.shotId}`, { shotId: input.shotId }));
      continue;
    }
    const currentHash = audioPlanHash(target.shot);
    const drift = validateBaseHash(currentHash, input.baseHash, opts.force, input.shotId);
    if (drift) {
      rejected.push(drift);
      continue;
    }
    const validation = validateAudioPlanInput(project, input.shotId, input.audioPlan);
    if (validation.error || !validation.audioPlan) {
      rejected.push(validation.error || applyError('validation_failed', 'Invalid audio plan.', { shotId: input.shotId }));
      continue;
    }

    await updateRows('shots', { id: input.shotId }, {
      audio_plan: validation.audioPlan,
      audio_plan_stale: false,
    });
    const newHash = audioPlanHash({ ...target.shot, audioPlan: validation.audioPlan, audioPlanStale: false });
    applied.push({ shotId: input.shotId, newHash });
    nextPlansByShot.set(input.shotId, validation.audioPlan);
    await recordDirectorEvent({
      projectId: project.id,
      source: 'codex',
      eventType: 'audio_plan_applied',
      entityType: 'shot',
      entityId: input.shotId,
      summary: `Codex applied audio plan for ${shotApplyLabel(target)}.`,
      payload: {
        newHash,
        dialogueLines: validation.audioPlan.dialogue.length,
        dialogueStrategy: validation.audioPlan.dialogueStrategy,
      },
    });
    appendApplyJournal(project, 'applied audio plan', `${shotApplyLabel(target)}\nShot ID: ${input.shotId}\nDialogue lines: ${validation.audioPlan.dialogue.length}\nStrategy: ${validation.audioPlan.dialogueStrategy}\nNew hash: ${newHash}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint', shotId: input.shotId, action: 'audio-plan' })}`);
  }

  if (applied.length) {
    await updateRows('projects', { id: project.id }, { updated_at: new Date().toISOString() });
  }

  const notebookProject = nextPlansByShot.size ? nextProjectWithAudioPlans(project, nextPlansByShot) : project;
  return {
    kind: 'mirage.apply.audio_plan',
    projectId: project.id,
    applied,
    rejected,
    changedArtifacts: applied.length ? buildNotebookMirrorArtifacts(notebookProject, { audioPlan: true }) : [],
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: rejected.length
      ? 'Applied valid audio plan updates and rejected invalid/drifted rows. Fix rejected rows and retry them.'
      : 'Applied audio plan updates.',
  };
};

export const applyAudioPlanMarkdown = async (
  project: Project,
  markdown: string,
  opts: { force?: boolean } = {},
) => {
  const parsed = parseAudioPlanMarkdownDraft(markdown);
  if ('error' in parsed) return parsed;
  if (parsed.projectId && parsed.projectId !== project.id) {
    return applyError('validation_failed', `Audio plan draft belongs to project ${parsed.projectId}, not ${project.id}.`, { field: 'projectId' });
  }
  const result = await applyAudioPlan(project, parsed.shots, opts);
  if ('error' in result) return result;
  return {
    ...result,
    kind: 'mirage.apply.audio_plan_markdown',
    note: 'Applied audio plan markdown. Review rejected rows before continuing; valid rows were persisted.',
  };
};

export const applyCastVoice = async (
  project: Project,
  input: CastVoiceApplyInput,
  opts: { force?: boolean } = {},
) => {
  const member = project.cast.find((candidate) => candidate.id === input.castMemberId);
  if (!member) {
    return applyError('validation_failed', `Cast member not found: ${input.castMemberId}`, { field: 'castMemberId' });
  }
  if (input.voiceProvider !== 'elevenlabs') {
    return applyError('validation_failed', 'voiceProvider must be elevenlabs for v1.', { field: 'voiceProvider' });
  }
  if (!input.voiceId?.trim()) {
    return applyError('validation_failed', 'voiceId is required.', { field: 'voiceId' });
  }
  const drift = validateBaseHash(castVoiceHash(member), input.baseHash, opts.force);
  if (drift) return drift;

  await updateRows('cast_members', { id: member.id }, {
    voice_provider: input.voiceProvider,
    voice_id: input.voiceId.trim(),
    voice_name: input.voiceName?.trim() || null,
    updated_at: new Date().toISOString(),
  });
  const updatedMember = {
    ...member,
    voiceProvider: input.voiceProvider,
    voiceId: input.voiceId.trim(),
    voiceName: input.voiceName?.trim() || undefined,
  };
  const newHash = castVoiceHash(updatedMember);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'cast_voice_assigned',
    entityType: 'cast_member',
    entityId: member.id,
    summary: `Codex assigned voice for ${member.name}.`,
    payload: {
      voiceProvider: input.voiceProvider,
      voiceName: updatedMember.voiceName || null,
      newHash,
    },
  });
  appendApplyJournal(project, 'applied cast voice', `${member.name}\nCast ID: ${member.id}\nProvider: ${input.voiceProvider}\nVoice: ${updatedMember.voiceName || input.voiceId}\nNew hash: ${newHash}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);
  return {
    kind: 'mirage.apply.cast_voice',
    projectId: project.id,
    castMemberId: member.id,
    newHash,
    voice: {
      provider: input.voiceProvider,
      id: updatedMember.voiceId,
      name: updatedMember.voiceName || null,
    },
    changedArtifacts: buildNotebookMirrorArtifacts({
      ...project,
      cast: project.cast.map((candidate) => candidate.id === member.id ? updatedMember : candidate),
    }, { cast: true }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
  };
};

export const getAudioPlanCost = async (
  project: Project,
  filters: { shotIds?: string[]; dialogueIds?: string[]; characterIds?: string[] } = {},
) => {
  const castById = new Map(project.cast.map((member) => [member.id, member]));
  const targets = collectDialogueTargets(project, filters);
  const pending = targets.filter(({ line }) => line.ttsStatus !== 'success' || !line.ttsAssetId);
  const missingVoiceMap = new Map<string, { characterId: string; name: string }>();
  let totalChars = 0;
  for (const { line } of pending) {
    totalChars += line.text.length;
    const member = castById.get(line.characterId);
    if (!member?.voiceId) {
      missingVoiceMap.set(line.characterId, {
        characterId: line.characterId,
        name: member?.name || 'Unknown character',
      });
    }
  }
  return {
    kind: 'mirage.audio_plan.cost',
    projectId: project.id,
    totalChars,
    estimatedUsd: estimateTtsUsd(totalChars),
    pendingLines: pending.length,
    missingVoices: [...missingVoiceMap.values()],
  };
};

export const generateDialogueAudio = async (
  project: Project,
  userId: string,
  filters: { shotIds?: string[]; dialogueIds?: string[]; characterIds?: string[] } = {},
) => {
  const castById = new Map(project.cast.map((member) => [member.id, member]));
  const targets = collectDialogueTargets(project, filters);
  const pendingTargets = targets.filter(({ line }) => line.ttsStatus !== 'success' || !line.ttsAssetId);
  const estimatedUsd = estimateTtsUsd(pendingTargets.reduce((sum, { line }) => {
    const member = castById.get(line.characterId);
    return member?.voiceProvider && member?.voiceId ? sum + line.text.length : sum;
  }, 0));
  await assertDailyCapAvailable(userId, 'elevenlabs', estimatedUsd);

  const generated: Array<{ dialogueId: string; assetId: string; url: string; durationSec?: number; costUsd: number }> = [];
  const failed: Array<{ dialogueId: string; error: string }> = [];
  let totalCostUsd = 0;
  const updatedPlansByShot = new Map<string, AudioPlan>();

  for (const target of pendingTargets) {
    const member = castById.get(target.line.characterId);
    const mutablePlan = updatedPlansByShot.get(target.shot.id) || structuredClone(target.audioPlan);
    updatedPlansByShot.set(target.shot.id, mutablePlan);
    const mutableLine = mutablePlan.dialogue[target.lineIndex];

    if (!member?.voiceProvider || !member?.voiceId) {
      mutableLine.ttsStatus = 'error';
      mutableLine.ttsError = 'Voice is not assigned for this character.';
      failed.push({ dialogueId: target.line.id, error: mutableLine.ttsError });
      continue;
    }

    try {
      await assertDailyCapAvailable(userId, 'elevenlabs', estimateTtsUsd(target.line.text.length));
      mutableLine.ttsStatus = 'generating';
      mutableLine.ttsError = undefined;

      const speech = await generateSpeech({
        userId,
        provider: member.voiceProvider,
        voiceId: member.voiceId,
        text: target.line.text,
      });
      const ext = extForMime(speech.mimeType);
      const filePath = await saveBuffer(speech.audioBuffer, 'audio', ext);
      const assetId = crypto.randomUUID();
      const lineCostUsd = estimateTtsUsd(speech.characterCount);
      await insertRow('assets', {
        id: assetId,
        project_id: project.id,
        shot_id: target.shot.id,
        category: 'dialogue_audio',
        file_path: filePath,
        prompt: target.line.text,
        metadata: JSON.stringify({
          dialogueId: target.line.id,
          characterId: target.line.characterId,
          provider: member.voiceProvider,
          voiceId: member.voiceId,
          voiceName: member.voiceName || null,
          mimeType: speech.mimeType,
          costUsd: lineCostUsd,
        }),
      });
      await incrementProviderUsageDaily(userId, 'elevenlabs', {
        costUsd: lineCostUsd,
        charCount: speech.characterCount,
      });

      mutableLine.ttsAssetId = assetId;
      mutableLine.ttsStatus = 'success';
      mutableLine.ttsError = undefined;
      mutableLine.ttsCharCount = speech.characterCount;
      mutableLine.ttsDurationSec = undefined;
      totalCostUsd = Number((totalCostUsd + lineCostUsd).toFixed(4));
      generated.push({
        dialogueId: target.line.id,
        assetId,
        url: storageUrl(filePath),
        costUsd: lineCostUsd,
      });
    } catch (error: any) {
      mutableLine.ttsStatus = 'error';
      mutableLine.ttsError = error?.message || 'TTS generation failed.';
      failed.push({ dialogueId: target.line.id, error: mutableLine.ttsError || 'TTS generation failed.' });
      if (error?.code === 'daily_cap_exceeded' || error?.name === 'DailyCapExceededError') break;
    }
  }

  for (const [shotId, audioPlan] of updatedPlansByShot) {
    await updateRows('shots', { id: shotId }, { audio_plan: audioPlan });
  }

  await recordDirectorEvent({
    projectId: project.id,
    userId,
    source: 'codex',
    eventType: 'dialogue_audio_generated',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex generated dialogue audio for ${generated.length} lines.`,
    payload: { generated: generated.length, failed: failed.length, totalCostUsd },
  });

  return {
    kind: 'mirage.audio_plan.dialogue_audio',
    projectId: project.id,
    generated,
    failed,
    totalCostUsd,
    changedArtifacts: updatedPlansByShot.size ? buildNotebookMirrorArtifacts(nextProjectWithAudioPlans(project, updatedPlansByShot), { audioPlan: true }) : [],
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
  };
};
