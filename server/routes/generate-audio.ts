import { Router } from 'express';
import { selectAll, selectOne, updateRows, incrementColumn } from '../database.js';
import { getProjectRuntimePreset } from '../presets.js';
import { buildContextChain, logCall } from '../xray.js';
import { buildAudioPlanPrompt, AUDIO_PLAN_SCHEMA, sanitizeAudioPlan } from '../services/audioDirector.js';
import { generateText } from '../services/text-provider.js';
import { recordDirectorEvent } from '../services/directorEvents.js';
import { sendStructuredError } from '../services/structuredErrors.js';
import { getFullProject } from './projects.js';
import { paramStr } from './scope-helpers.js';

export const mountAudioRoutes = (router: Router) => {

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

    for (const shot of selected) {
      const scene = sceneById.get(shot.scene_id);
      if (!scene) continue;
      const prompt = buildAudioPlanPrompt(project, scene, shot, cast, preset);
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
      const audioPlan = sanitizeAudioPlan(response.parsedJson || JSON.parse(response.text), cast);
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

};
