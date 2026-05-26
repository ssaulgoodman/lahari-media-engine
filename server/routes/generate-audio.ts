import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { selectAll, selectOne, updateRows, incrementColumn, insertRow } from '../database.js';
import { getProjectRuntimePreset } from '../presets.js';
import { buildContextChain, logCall } from '../xray.js';
import { buildAudioPlanPrompt, AUDIO_PLAN_SCHEMA, sanitizeAudioPlan, type AudioPlan, type AudioPlanDialogueLine } from '../services/audioDirector.js';
import { generateText } from '../services/text-provider.js';
import { generateSpeech } from '../services/tts/index.js';
import { assertDailyCapAvailable, incrementProviderUsageDaily } from '../services/providerUsage.js';
import { recordDirectorEvent } from '../services/directorEvents.js';
import { sendStructuredError } from '../services/structuredErrors.js';
import { saveBuffer, storageUrl } from '../storage.js';
import { getFullProject } from './projects.js';
import { paramStr } from './scope-helpers.js';
import { getProjectPromptOverride } from '../services/projectConfig.js';

export const mountAudioRoutes = (router: Router) => {

const ELEVENLABS_TTS_USD_PER_1K_CHARS = 0.30;

const parseAudioPlan = (value: any): AudioPlan | null => {
  if (!value) return null;
  if (typeof value === 'object') return value as AudioPlan;
  try { return JSON.parse(value) as AudioPlan; } catch { return null; }
};

const queryList = (value: any): string[] | undefined => {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const items = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
};

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

const collectDialogueTargets = async (
  projectId: string,
  filters: { shotIds?: string[]; dialogueIds?: string[]; characterIds?: string[] },
) => {
  const scenes = await selectAll('scenes', { project_id: projectId }, { orderBy: 'sort_order', ascending: true });
  const sceneIds = scenes.map((scene: any) => scene.id);
  const allShots = sceneIds.length
    ? await selectAll('shots', { scene_id: sceneIds }, { orderBy: 'sort_order', ascending: true })
    : [];
  const shots = allShots
    .map((shot: any) => ({ row: shot, audioPlan: parseAudioPlan(shot.audio_plan) }))
    .filter((entry) => entry.audioPlan && (!filters.shotIds || filters.shotIds.includes(entry.row.id)));

  const targets: Array<{
    shot: any;
    audioPlan: AudioPlan;
    line: AudioPlanDialogueLine;
    lineIndex: number;
  }> = [];

  for (const entry of shots) {
    entry.audioPlan!.dialogue.forEach((line, lineIndex) => {
      if (filters.dialogueIds && !filters.dialogueIds.includes(line.id)) return;
      if (filters.characterIds && !filters.characterIds.includes(line.characterId)) return;
      if (line.ttsStatus === 'success' && line.ttsAssetId && !filters.dialogueIds) return;
      targets.push({ shot: entry.row, audioPlan: entry.audioPlan!, line, lineIndex });
    });
  }

  return { scenes, shots, targets };
};

router.get('/:id/audio-plan-cost', async (req, res) => {
  const projectId = paramStr(req.params.id);
  try {
    const project = await selectOne('projects', { id: projectId });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const cast = await selectAll('cast_members', { project_id: projectId }, { orderBy: 'sort_order', ascending: true });
    const castById = new Map(cast.map((member: any) => [member.id, member]));
    const { targets } = await collectDialogueTargets(projectId, {
      shotIds: queryList(req.query.shotIds),
      dialogueIds: queryList(req.query.dialogueIds),
      characterIds: queryList(req.query.characterIds),
    });

    const pending = targets.filter(({ line }) => line.ttsStatus !== 'success' || !line.ttsAssetId);
    const totalChars = pending.reduce((sum, { line }) => sum + line.text.length, 0);
    const missingVoiceMap = new Map<string, { characterId: string; name: string }>();
    for (const { line } of pending) {
      const member: any = castById.get(line.characterId);
      if (!member?.voice_id) {
        missingVoiceMap.set(line.characterId, {
          characterId: line.characterId,
          name: member?.name || 'Unknown character',
        });
      }
    }

    res.json({
      totalChars,
      estimatedUsd: estimateTtsUsd(totalChars),
      pendingLines: pending.length,
      missingVoices: [...missingVoiceMap.values()],
    });
  } catch (err) {
    sendStructuredError(res, err);
  }
});

router.post('/:id/write-audio-plan', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const requestedShotIds = Array.isArray(req.body?.shotIds)
    ? req.body.shotIds.filter((id: any) => typeof id === 'string')
    : null;
  const force = req.body?.force === true;
  const preset = getProjectRuntimePreset(project, req.body?.presetKey);

  try {
    const [cast, scenes] = await Promise.all([
      selectAll('cast_members', { project_id: projectId }, { orderBy: 'sort_order', ascending: true }),
      selectAll('scenes', { project_id: projectId }, { orderBy: 'sort_order', ascending: true }),
    ]);
    if (cast.length === 0) {
      const err = new Error('No cast members exist yet.');
      (err as any).statusCode = 400;
      throw err;
    }
    if (scenes.length === 0) {
      const err = new Error('No scenes exist yet.');
      (err as any).statusCode = 400;
      throw err;
    }

    const sceneById = new Map(scenes.map((scene: any) => [scene.id, scene]));
    const sceneIds = scenes.map((scene: any) => scene.id);
    const allShots = sceneIds.length
      ? await selectAll('shots', { scene_id: sceneIds }, { orderBy: 'sort_order', ascending: true })
      : [];
    const selected = allShots.filter((shot: any) => {
      if (requestedShotIds && !requestedShotIds.includes(shot.id)) return false;
      if (force) return true;
      if (shot.audio_plan_stale) return true;
      return !shot.audio_plan;
    });

    if (selected.length === 0) {
      return res.json(await getFullProject(projectId));
    }

    const t0 = Date.now();
    const prompts: string[] = [];
    let written = 0;
    const projectOverride = await getProjectPromptOverride(projectId, 'audio_plan');

    for (const shot of selected) {
      const scene = sceneById.get(shot.scene_id);
      if (!scene) continue;
      const prompt = buildAudioPlanPrompt(project, scene, shot, cast, preset, projectOverride);
      prompts.push(`=== ${shot.id} ===\n${prompt}`);
      const response = await generateText(project.text_provider, {
        systemPrompt: 'You write concise, production-ready dialogue/audio JSON for AI video shots.',
        userPrompt: prompt,
        jsonSchema: {
          name: 'audio_plan',
          description: 'Per-shot dialogue and sound notes for TTS/video production.',
          schema: AUDIO_PLAN_SCHEMA as any,
        },
        reasoning: 'medium',
        maxTokens: 1800,
      });
      const existingPlan = parseAudioPlan(shot.audio_plan);
      const projectBrief = project.project_brief && typeof project.project_brief === 'object'
        ? project.project_brief as Record<string, any>
        : {};
      const projectDialogueMode = projectBrief.dialogueVideoMode === 'lipsync' ? 'lipsync' : 'overlay';
      const audioPlan = sanitizeAudioPlan(response.parsedJson || JSON.parse(response.text), cast, {
        dialogueStrategy: projectDialogueMode || existingPlan?.dialogueStrategy,
      });
      await updateRows('shots', { id: shot.id }, {
        audio_plan: audioPlan,
        audio_plan_stale: false,
      });
      written++;

      await recordDirectorEvent({
        projectId,
        userId: req.userId,
        source: 'web',
        eventType: 'audio_plan_written',
        entityType: 'shot',
        entityId: shot.id,
        summary: `Artist wrote audio plan for shot ${shot.id}.`,
        payload: {
          dialogueLines: audioPlan.dialogue.length,
          dialogueStrategy: audioPlan.dialogueStrategy,
          force,
        },
      });
    }

    const durationMs = Date.now() - t0;
    await logCall({
      projectId,
      stage: 'write-audio-plan',
      model: project.text_provider || 'default-text-provider',
      prompt: prompts.join('\n\n'),
      contextChain: await buildContextChain(projectId),
      responseSummary: `Wrote audio plans for ${written} shots`,
      durationMs,
      costEstimate: 0.01 * written,
    });
    await incrementColumn('projects', { id: projectId }, 'cost_estimate', 0.01 * written);
    await updateRows('projects', { id: projectId }, { updated_at: new Date().toISOString() });

    res.json(await getFullProject(projectId));
  } catch (err) {
    console.error(`[${projectId}] Write audio plan failed:`, err);
    sendStructuredError(res, err);
  }
});

router.post('/:id/generate-dialogue-audio', async (req, res) => {
  const projectId = paramStr(req.params.id);
  try {
    const project = await selectOne('projects', { id: projectId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const cast = await selectAll('cast_members', { project_id: projectId }, { orderBy: 'sort_order', ascending: true });
    const castById = new Map(cast.map((member: any) => [member.id, member]));
    const { targets } = await collectDialogueTargets(projectId, {
      shotIds: Array.isArray(req.body?.shotIds) ? req.body.shotIds.filter((id: any) => typeof id === 'string') : undefined,
      dialogueIds: Array.isArray(req.body?.dialogueIds) ? req.body.dialogueIds.filter((id: any) => typeof id === 'string') : undefined,
      characterIds: Array.isArray(req.body?.characterIds) ? req.body.characterIds.filter((id: any) => typeof id === 'string') : undefined,
    });

    const pendingTargets = targets.filter(({ line }) => line.ttsStatus !== 'success' || !line.ttsAssetId);
    const estimatedUsd = estimateTtsUsd(pendingTargets.reduce((sum, { line }) => {
      const member: any = castById.get(line.characterId);
      return member?.voice_provider && member?.voice_id ? sum + line.text.length : sum;
    }, 0));
    await assertDailyCapAvailable(req.userId, 'elevenlabs', estimatedUsd);

    const generated: Array<{ dialogueId: string; assetId: string; url: string; durationSec?: number; costUsd: number }> = [];
    const failed: Array<{ dialogueId: string; error: string }> = [];
    let totalCostUsd = 0;
    const updatedPlansByShot = new Map<string, AudioPlan>();

    for (const target of pendingTargets) {
      const member: any = castById.get(target.line.characterId);
      const mutablePlan = updatedPlansByShot.get(target.shot.id) || structuredClone(target.audioPlan);
      updatedPlansByShot.set(target.shot.id, mutablePlan);
      const mutableLine = mutablePlan.dialogue[target.lineIndex];

      if (!member?.voice_provider || !member?.voice_id) {
        mutableLine.ttsStatus = 'error';
        mutableLine.ttsError = 'Voice is not assigned for this character.';
        failed.push({ dialogueId: target.line.id, error: mutableLine.ttsError });
        continue;
      }

      try {
        await assertDailyCapAvailable(req.userId, 'elevenlabs', estimateTtsUsd(target.line.text.length));
        mutableLine.ttsStatus = 'generating';
        mutableLine.ttsError = undefined;

        const speech = await generateSpeech({
          userId: req.userId,
          provider: member.voice_provider,
          voiceId: member.voice_id,
          text: target.line.text,
        });
        const ext = extForMime(speech.mimeType);
        const filePath = await saveBuffer(speech.audioBuffer, 'audio', ext);
        const assetId = uuidv4();
        const lineCostUsd = estimateTtsUsd(speech.characterCount);
        await insertRow('assets', {
          id: assetId,
          project_id: projectId,
          shot_id: target.shot.id,
          category: 'dialogue_audio',
          file_path: filePath,
          prompt: target.line.text,
          metadata: JSON.stringify({
            dialogueId: target.line.id,
            characterId: target.line.characterId,
            provider: member.voice_provider,
            voiceId: member.voice_id,
            voiceName: member.voice_name || null,
            mimeType: speech.mimeType,
            costUsd: lineCostUsd,
          }),
        });
        await incrementProviderUsageDaily(req.userId, 'elevenlabs', {
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
      } catch (err: any) {
        mutableLine.ttsStatus = 'error';
        mutableLine.ttsError = err?.message || 'TTS generation failed.';
        failed.push({ dialogueId: target.line.id, error: mutableLine.ttsError || 'TTS generation failed.' });
        if (err?.code === 'daily_cap_exceeded' || err?.name === 'DailyCapExceededError') break;
      }
    }

    for (const [shotId, audioPlan] of updatedPlansByShot) {
      await updateRows('shots', { id: shotId }, { audio_plan: audioPlan });
    }

    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'dialogue_audio_generated',
      entityType: 'project',
      entityId: projectId,
      summary: `Generated dialogue audio for ${generated.length} lines.`,
      payload: { generated: generated.length, failed: failed.length, totalCostUsd },
    });

    await logCall({
      projectId,
      stage: 'generate-dialogue-audio',
      model: 'elevenlabs',
      prompt: `Generated TTS for ${generated.length}/${pendingTargets.length} dialogue lines`,
      contextChain: await buildContextChain(projectId),
      responseSummary: `Generated ${generated.length} dialogue audio assets; ${failed.length} failed`,
      outputAssetIds: generated.map((item) => item.assetId),
      durationMs: 0,
      costEstimate: totalCostUsd,
    });

    res.json({
      ok: true,
      generated,
      failed,
      totalCostUsd,
      project: await getFullProject(projectId),
    });
  } catch (err) {
    console.error(`[${projectId}] Generate dialogue audio failed:`, err);
    sendStructuredError(res, err);
  }
});

};
