import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { readAsBase64, mimeFromExt, saveBase64 } from '../storage.js';
import { generateStyleOptions, generateCharacterLooks, generateSingleStyleImage, generateEnvironmentLooks, generateShotStartFrame, generateShotEndFrame, generateShotFramePair } from '../services/imagen.js';
import { critiqueShotImage, chatWithDirector } from '../services/gemini.js';
import { planScenes, writeShotPrompts, brainstormStyleDirections, refineStyleDirection, enrichStyleDNA, analyzeImageStyle } from '../services/claude.js';
import { generateVideo } from '../services/veo.js';
import { getFullProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';

const router = Router();

// Helper: get route param as string (Express 5 returns string | string[])
const paramStr = (val: string | string[]): string => Array.isArray(val) ? val[0] : val;
const upload = multer({ storage: multer.memoryStorage() });

// ─── Generate Style Options ─────────────────────────────────────────

router.post('/:id/generate-styles', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const { notes } = req.body;

  const prompt = `Generate 4 style options for "${concept.deity || project.title}" — ${notes || project.style_description || 'cinematic, photorealistic'}`;

  try {
    console.log(`[${project.id}] Generating style options...`);
    const t0 = Date.now();
    const styles = await generateStyleOptions(
      concept.deity || project.title,
      notes || project.style_description
    );
    const durationMs = Date.now() - t0;

    // Save as assets
    const assetIds: { id: string; style: string; url: string }[] = [];
    for (const s of styles) {
      const assetId = uuidv4();
      db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'style', ?, ?)`)
        .run(assetId, project.id, s.assetPath, s.style);
      assetIds.push({ id: assetId, style: s.style, url: `/storage/${s.assetPath}` });
    }

    logCall({
      projectId: project.id,
      stage: 'generate-styles',
      model: 'imagen-4.0-generate-001',
      prompt,
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated ${styles.length} style images: ${assetIds.map(a => a.style).join(', ')}`,
      outputAssetIds: assetIds.map(a => a.id),
      durationMs,
      costEstimate: 0.04,
    });

    res.json({ styles: assetIds, project: getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Style generation failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-styles',
      model: 'imagen-4.0-generate-001',
      prompt,
      contextChain: buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Brainstorm Style Directions (text only, no images) ─────────────

router.post('/:id/brainstorm-styles', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const structure = JSON.parse(project.musical_structure || '[]');
  const { userNotes } = req.body;

  try {
    console.log(`[${project.id}] Brainstorming style directions...`);
    const t0 = Date.now();
    // Build script summary for richer brainstorm context
    const scenes = db.prepare('SELECT section_label, narrative_description FROM scenes WHERE project_id = ? ORDER BY sort_order').all(project.id) as any[];
    const scriptSummary = scenes.length > 0
      ? scenes.map((s: any) => `[${s.section_label}] ${s.narrative_description}`).join('\n')
      : undefined;

    const directions = await brainstormStyleDirections(
      project.lyrics || '',
      structure,
      project.meaning || '',
      concept,
      userNotes,
      scriptSummary
    );
    const durationMs = Date.now() - t0;

    logCall({
      projectId: project.id,
      stage: 'brainstorm-styles',
      model: 'claude-opus-4-6',
      prompt: `Brainstorm 4 style directions | Concept: ${concept.conceptDirection || concept.title} | Mood: ${concept.mood}${userNotes ? ` | User notes: ${userNotes}` : ''}`,
      contextChain: buildContextChain(project.id),
      responseSummary: JSON.stringify(directions),
      durationMs,
      costEstimate: 0.01,
    });

    res.json({ directions });
  } catch (err: any) {
    console.error(`[${project.id}] Brainstorm failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'brainstorm-styles',
      model: 'claude-opus-4-6',
      prompt: `Brainstorm 4 style directions`,
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Visualize a Single Style Direction (one image) ─────────────────

router.post('/:id/visualize-style', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const { prompt: stylePrompt } = req.body;
  if (!stylePrompt) return res.status(400).json({ error: 'prompt required' });

  try {
    console.log(`[${project.id}] Visualizing style direction...`);
    const t0 = Date.now();
    const assetPath = await generateSingleStyleImage(
      stylePrompt,
      concept.deity || project.title
    );
    const durationMs = Date.now() - t0;

    const assetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'style', ?, ?)`)
      .run(assetId, project.id, assetPath, stylePrompt);

    logCall({
      projectId: project.id,
      stage: 'visualize-style',
      model: 'gemini-3-pro-image-preview',
      prompt: stylePrompt,
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated style image`,
      outputAssetIds: [assetId],
      durationMs,
      costEstimate: 0.01,
    });

    res.json({ assetId, url: `/storage/${assetPath}` });
  } catch (err: any) {
    console.error(`[${project.id}] Visualize style failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'visualize-style',
      model: 'gemini-3-pro-image-preview',
      prompt: stylePrompt,
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Refine Style Direction (text only) ─────────────────────────────

router.post('/:id/refine-style-direction', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const { description, feedback } = req.body;

  try {
    const t0 = Date.now();
    const refined = await refineStyleDirection(description, feedback, concept);
    const durationMs = Date.now() - t0;

    logCall({
      projectId: project.id,
      stage: 'refine-style-direction',
      model: 'claude-sonnet-4-6',
      prompt: `Refine: "${description.substring(0, 100)}..." | Feedback: "${feedback}"`,
      contextChain: buildContextChain(project.id),
      responseSummary: `${refined.title}: ${refined.description.substring(0, 150)}`,
      durationMs,
      costEstimate: 0.005,
    });

    res.json(refined);
  } catch (err: any) {
    console.error(`[${project.id}] Refine direction failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Lock Style (with DNA enrichment) ───────────────────────────────

router.post('/:id/lock-style', async (req, res) => {
  const { assetId, styleDescription } = req.body;
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  const projectId = paramStr(req.params.id);

  // Enrich style DNA from the locked image
  let enrichedDescription = styleDescription || '';
  try {
    const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(assetId);
    if (asset) {
      console.log(`[${projectId}] Enriching style DNA...`);
      const t0 = Date.now();
      const imageBase64 = readAsBase64(asset.file_path);
      const mimeType = mimeFromExt(asset.file_path);
      enrichedDescription = await enrichStyleDNA(imageBase64, mimeType, styleDescription || '');
      const durationMs = Date.now() - t0;

      logCall({
        projectId,
        stage: 'enrich-style-dna',
        model: 'claude-sonnet-4-6',
        prompt: `Enrich style DNA from locked image | Short desc: ${(styleDescription || '').substring(0, 100)}`,
        referenceInputs: [{ type: 'image', label: 'Locked style image', url: `/storage/${asset.file_path}` }],
        contextChain: buildContextChain(projectId),
        responseSummary: enrichedDescription.substring(0, 300),
        durationMs,
        costEstimate: 0.01,
      });
    }
  } catch (err) {
    console.error('[lock-style] Style DNA enrichment failed, using short description:', err);
  }

  db.prepare(`
    UPDATE projects SET
      status = 'style_locked',
      style_asset_id = ?,
      style_description = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(assetId, enrichedDescription, projectId);

  res.json(getFullProject(projectId));
});

// ─── Unlock Style (revert to scripted) ──────────────────────────────

router.post('/:id/unlock-style', (req, res) => {
  const projectId = paramStr(req.params.id);
  const project: any = db.prepare('SELECT status FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Only allow unlocking if currently style_locked (not further along)
  if (project.status !== 'style_locked') {
    return res.status(400).json({ error: `Cannot unlock style from status "${project.status}". Only allowed when style_locked.` });
  }

  db.prepare(`
    UPDATE projects SET
      status = 'scripted',
      style_asset_id = NULL,
      style_description = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(projectId);

  res.json(getFullProject(projectId));
});

// ─── Analyze Uploaded Style Image ───────────────────────────────────

router.post('/:id/analyze-style-image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  const projectId = paramStr(req.params.id);
  const prompt = 'Analyze uploaded style reference image for visual style description';

  try {
    const imageBase64 = req.file.buffer.toString('base64');
    const t0 = Date.now();
    const styleDesc = await analyzeImageStyle(imageBase64, req.file.mimetype);
    const durationMs = Date.now() - t0;

    db.prepare("UPDATE projects SET style_description = ?, updated_at = datetime('now') WHERE id = ?")
      .run(styleDesc, projectId);

    logCall({
      projectId,
      stage: 'analyze-style-image',
      model: 'claude-sonnet-4-6',
      prompt,
      referenceInputs: [{ type: 'image', label: 'User-uploaded style reference' }],
      contextChain: buildContextChain(projectId),
      responseSummary: styleDesc.substring(0, 200),
      durationMs,
      costEstimate: 0.01,
    });

    res.json({ styleDescription: styleDesc, project: getFullProject(projectId) });
  } catch (err: any) {
    logCall({
      projectId,
      stage: 'analyze-style-image',
      model: 'claude-sonnet-4-6',
      prompt,
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate Character Looks ───────────────────────────────────────

router.post('/:id/generate-looks', async (req, res) => {
  const { castMemberId, feedback } = req.body;
  if (!castMemberId) return res.status(400).json({ error: 'castMemberId required' });

  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const member: any = db.prepare('SELECT * FROM cast_members WHERE id = ?').get(castMemberId);
  if (!member) return res.status(404).json({ error: 'Cast member not found' });

  const styleDNA = project.style_description || 'Cinematic, photorealistic';

  // Resolve style image path for visual ref
  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(project.style_asset_id);
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  const xrayPrompt = `Generate 3 looks for "${member.name}" — ${(member.description || '').substring(0, 100)} | Style DNA: ${styleDNA.substring(0, 100)}...${feedback ? ` | Feedback: ${feedback}` : ''}`;

  try {
    console.log(`[${project.id}] Generating looks for ${member.name} via gemini-3-pro-image-preview...`);
    const t0 = Date.now();

    const imagePaths = await generateCharacterLooks(
      { name: member.name, description: member.description || '' },
      styleDNA,
      styleImagePath,
      feedback
    );
    const durationMs = Date.now() - t0;

    // Save as assets and return URLs
    const looks: { id: string; url: string }[] = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const assetId = uuidv4();
      db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'character', ?, ?)`)
        .run(assetId, project.id, imagePaths[i], `Look ${i + 1} for ${member.name}`);
      looks.push({ id: assetId, url: `/storage/${imagePaths[i]}` });
    }

    logCall({
      projectId: project.id,
      stage: 'generate-looks',
      model: 'gemini-3-pro-image-preview',
      prompt: xrayPrompt,
      referenceInputs: styleImagePath ? [{ type: 'image', label: 'Style reference', url: `/storage/${styleImagePath}` }] : [],
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated ${imagePaths.length} looks for ${member.name}`,
      outputAssetIds: looks.map(l => l.id),
      durationMs,
      costEstimate: 0.04,
    });

    res.json({ looks, project: getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Look gen failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-looks',
      model: 'gemini-3-pro-image-preview',
      prompt: xrayPrompt,
      contextChain: buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Lock Character Reference ───────────────────────────────────────

router.post('/:id/lock-character', (req, res) => {
  const { castMemberId, assetId } = req.body;
  if (!castMemberId || !assetId) return res.status(400).json({ error: 'castMemberId and assetId required' });

  db.prepare('UPDATE cast_members SET reference_asset_id = ? WHERE id = ?').run(assetId, castMemberId);

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Advance past Characters phase ─────────────────────────────────
// User decides when they're done — not all cast members need looks

router.post('/:id/advance-characters', (req, res) => {
  const project: any = db.prepare('SELECT id, status FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'style_locked') return res.status(400).json({ error: 'Not in style_locked phase' });

  db.prepare("UPDATE projects SET status = 'characters_locked', updated_at = datetime('now') WHERE id = ?").run(paramStr(req.params.id));
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Generate Environment Looks ──────────────────────────────────────

router.post('/:id/generate-environment-look', async (req, res) => {
  const { environmentId } = req.body;
  if (!environmentId) return res.status(400).json({ error: 'environmentId required' });

  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const env: any = db.prepare('SELECT * FROM environments WHERE id = ?').get(environmentId);
  if (!env) return res.status(404).json({ error: 'Environment not found' });

  const styleDNA = project.style_description || 'Cinematic, photorealistic';

  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(project.style_asset_id);
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  try {
    console.log(`[${project.id}] Generating environment looks for ${env.name}...`);
    const t0 = Date.now();

    const imagePaths = await generateEnvironmentLooks(
      { name: env.name, description: env.description || '' },
      styleDNA,
      styleImagePath
    );
    const durationMs = Date.now() - t0;

    const looks: { id: string; url: string }[] = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const assetId = uuidv4();
      db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'environment', ?, ?)`)
        .run(assetId, project.id, imagePaths[i], `Environment look ${i + 1} for ${env.name}`);
      looks.push({ id: assetId, url: `/storage/${imagePaths[i]}` });
    }

    logCall({
      projectId: project.id,
      stage: 'generate-environment-look',
      model: 'gemini-3-pro-image-preview',
      prompt: `Generate 3 environment looks for "${env.name}" — ${(env.description || '').substring(0, 100)}`,
      referenceInputs: styleImagePath ? [{ type: 'image', label: 'Style reference', url: `/storage/${styleImagePath}` }] : [],
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated ${imagePaths.length} looks for environment ${env.name}`,
      outputAssetIds: looks.map(l => l.id),
      durationMs,
      costEstimate: 0.04,
    });

    res.json({ looks, project: getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Environment look gen failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-environment-look',
      model: 'gemini-3-pro-image-preview',
      prompt: `Generate environment looks for "${env.name}"`,
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Lock Environment Reference ─────────────────────────────────────

router.post('/:id/lock-environment', (req, res) => {
  const { environmentId, assetId } = req.body;
  if (!environmentId || !assetId) return res.status(400).json({ error: 'environmentId and assetId required' });

  db.prepare('UPDATE environments SET reference_asset_id = ? WHERE id = ?').run(assetId, environmentId);

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Advance past Environments phase ────────────────────────────────
// User decides when they're done — not all environments need looks

router.post('/:id/advance-environments', (req, res) => {
  const project: any = db.prepare('SELECT id, status FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'characters_locked') return res.status(400).json({ error: 'Not in characters_locked phase' });

  db.prepare("UPDATE projects SET status = 'environments_locked', updated_at = datetime('now') WHERE id = ?").run(paramStr(req.params.id));
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Generate Script ────────────────────────────────────────────────

router.post('/:id/generate-script', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.audio_path) return res.status(400).json({ error: 'No audio file' });

  const concept = JSON.parse(project.locked_concept || '{}');

  const scriptPrompt = `Plan script + propose cast for "${project.title}" — Concept: ${concept.conceptDirection || concept.title} | Mood: ${concept.mood} | Mode: ${project.video_mode || 'montage'}`;

  try {
    console.log(`[${project.id}] Generating script + cast...`);

    const t0 = Date.now();
    const data = await planScenes({
      concept,
      videoMode: project.video_mode || 'montage',
      lyrics: project.lyrics || '',
      meaning: project.meaning || '',
      musicalStructure: project.musical_structure || '',
      basePacing: project.target_duration || 8,
    });
    const durationMs = Date.now() - t0;

    // ── Create proposed cast members ──
    // Clear old cast (script proposes fresh cast each time)
    db.prepare('DELETE FROM cast_members WHERE project_id = ?').run(project.id);

    const nameToId: Record<string, string> = {};
    const proposedCast = data.cast || [];
    proposedCast.forEach((c: any, idx: number) => {
      const memberId = uuidv4();
      nameToId[c.name] = memberId;
      db.prepare(`INSERT INTO cast_members (id, project_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)`)
        .run(memberId, project.id, c.name || `Character ${idx + 1}`, c.description || 'To be defined', idx);
    });

    // ── Create proposed environments ──
    db.prepare('DELETE FROM environments WHERE project_id = ?').run(project.id);

    const envNameToId: Record<string, string> = {};
    const proposedEnvironments = data.environments || [];
    proposedEnvironments.forEach((e: any, idx: number) => {
      const envId = uuidv4();
      envNameToId[e.name] = envId;
      db.prepare(`INSERT INTO environments (id, project_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)`)
        .run(envId, project.id, e.name || `Environment ${idx + 1}`, e.description || '', idx);
    });

    // ── Clear old scenes/shots ──
    const oldScenes = db.prepare('SELECT id FROM scenes WHERE project_id = ?').all(project.id) as any[];
    for (const s of oldScenes) {
      db.prepare('DELETE FROM shots WHERE scene_id = ?').run(s.id);
    }
    db.prepare('DELETE FROM scenes WHERE project_id = ?').run(project.id);

    // ── Insert new scenes and shots ──
    const insertScene = db.prepare(`
      INSERT INTO scenes (id, project_id, section_label, start_time, end_time, lyrics, narrative_description, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertShot = db.prepare(`
      INSERT INTO shots (id, scene_id, visual_prompt, motion_prompt, duration, cast_ids, use_next_as_end_frame, sort_order, environment_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalShots = 0;
    (data.scenes || []).forEach((scene: any, sIdx: number) => {
      const sceneId = scene.id || uuidv4();
      insertScene.run(
        sceneId, project.id,
        scene.sectionLabel || `Scene ${sIdx + 1}`,
        scene.startTime || '0:00',
        scene.endTime || '0:00',
        scene.lyrics || '',
        scene.narrativeDescription || '',
        sIdx
      );

      (scene.shots || []).forEach((shot: any, shIdx: number) => {
        const shotId = uuidv4();
        // Map castNames → castIds using the name→id lookup
        const castNames: string[] = shot.castNames || [];
        const castIds = castNames.map((name: string) => nameToId[name] || name).filter(Boolean);
        // Map environmentName → environmentId
        const envId = shot.environmentName ? (envNameToId[shot.environmentName] || null) : null;

        // Store direction as visual_prompt placeholder — writeShotPrompts will overwrite later
        insertShot.run(
          shotId, sceneId,
          shot.direction || '',
          '',  // motion_prompt left empty — writeShotPrompts fills it
          shot.duration || (project.target_duration || 8),
          JSON.stringify(castIds),
          project.video_mode === 'cinematic' ? 1 : 0,
          shIdx,
          envId
        );
        totalShots++;
      });
    });

    logCall({
      projectId: project.id,
      stage: 'generate-script',
      model: 'claude-opus-4-6',
      prompt: scriptPrompt,
      referenceInputs: [],
      contextChain: buildContextChain(project.id),
      responseSummary: `Proposed ${proposedCast.length} cast members, ${proposedEnvironments.length} environments. Generated ${(data.scenes || []).length} scenes with ${totalShots} total shots.`,
      durationMs,
      costEstimate: 0.02,
    });

    db.prepare("UPDATE projects SET status = 'scripted', cost_estimate = cost_estimate + 0.02, updated_at = datetime('now') WHERE id = ?")
      .run(project.id);

    res.json(getFullProject(project.id));
  } catch (err: any) {
    console.error(`[${project.id}] Script gen failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-script',
      model: 'claude-opus-4-6',
      prompt: scriptPrompt,
      referenceInputs: [],
      contextChain: buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Write Shot Prompts (after all creative decisions locked) ────────
// Input: project with script skeleton + locked style DNA + locked characters
// Output: visualPrompt + motionPrompt written into each shot record
// Stored: shots.visual_prompt, shots.motion_prompt (overwritten from direction placeholders)

router.post('/:id/write-shot-prompts', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.style_description) return res.status(400).json({ error: 'Style not locked yet' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ? ORDER BY sort_order').all(project.id) as any[];
  const scenes = db.prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order').all(project.id) as any[];

  try {
    console.log(`[${project.id}] Writing shot prompts with full context...`);
    const t0 = Date.now();

    // Gather all shots with their scene context
    const allShots: { id: string; direction: string; duration: number; castNames: string[]; sceneNarrative: string; sceneLyrics: string }[] = [];
    for (const scene of scenes as any[]) {
      const shots = db.prepare('SELECT * FROM shots WHERE scene_id = ? ORDER BY sort_order').all(scene.id) as any[];
      for (const shot of shots) {
        const shotCastIds = JSON.parse(shot.cast_ids || '[]');
        const shotCastNames = cast.filter((c: any) => shotCastIds.includes(c.id)).map((c: any) => c.name);
        allShots.push({
          id: shot.id,
          direction: shot.visual_prompt || '',  // was stored as direction placeholder
          duration: shot.duration,
          castNames: shotCastNames,
          sceneNarrative: scene.narrative_description || '',
          sceneLyrics: scene.lyrics || '',
        });
      }
    }

    // Write prompts in batches with continuity overlap
    const BATCH_SIZE = 15;
    let previousBatchTail: { id: string; visualPrompt: string; motionPrompt: string }[] | undefined;

    for (let i = 0; i < allShots.length; i += BATCH_SIZE) {
      const batch = allShots.slice(i, i + BATCH_SIZE);
      const prompts = await writeShotPrompts(batch, {
        styleDNA: project.style_description,
        cast: cast.map((c: any) => ({ name: c.name, description: c.description })),
        concept,
        lyrics: project.lyrics || '',
      }, previousBatchTail);

      // Write back to DB
      const updateShot = db.prepare('UPDATE shots SET visual_prompt = ?, motion_prompt = ? WHERE id = ?');
      for (const p of prompts) {
        updateShot.run(p.visualPrompt || '', p.motionPrompt || '', p.id);
      }

      // Keep last 2 shots as continuity context for next batch
      if (prompts.length >= 2) {
        previousBatchTail = prompts.slice(-2);
      } else if (prompts.length === 1) {
        previousBatchTail = prompts;
      }
    }

    const durationMs = Date.now() - t0;
    console.log(`[${project.id}] Shot prompts written for ${allShots.length} shots in ${durationMs}ms`);

    logCall({
      projectId: project.id,
      stage: 'write-shot-prompts',
      model: 'claude-opus-4-6',
      prompt: `Write visualPrompt + motionPrompt for ${allShots.length} shots with full style/character context`,
      contextChain: buildContextChain(project.id),
      responseSummary: `Wrote prompts for ${allShots.length} shots`,
      durationMs,
      costEstimate: 0.02,
    });

    db.prepare("UPDATE projects SET cost_estimate = cost_estimate + 0.02, updated_at = datetime('now') WHERE id = ?")
      .run(project.id);

    res.json(getFullProject(project.id));
  } catch (err: any) {
    console.error(`[${project.id}] Write shot prompts failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate Shot Start Frame (with full reference chain) ───────────

router.post('/:id/shots/:shotId/generate-image', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const scene: any = db.prepare('SELECT * FROM scenes WHERE id = ?').get(shot.scene_id);

  // Sequential enforcement: check if previous shot in same scene is locked
  if (shot.sort_order > 0) {
    const prevShot: any = db.prepare(
      'SELECT id, locked FROM shots WHERE scene_id = ? AND sort_order = ?'
    ).get(shot.scene_id, shot.sort_order - 1);
    if (prevShot && !prevShot.locked) {
      return res.status(400).json({ error: 'Previous shot must be locked first (sequential enforcement)' });
    }
  }

  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ?').all(paramStr(req.params.id)) as any[];
  const activeCast = cast.filter((c: any) => shotCastIds.includes(c.id));

  const shotPrompt = shot.visual_prompt || '';
  const userFeedback = shot.user_feedback || undefined;

  // Resolve style image path
  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(project.style_asset_id);
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  // Resolve character reference images
  const characterRefs: { name: string; imagePath: string }[] = [];
  for (const c of activeCast) {
    if (c.reference_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(c.reference_asset_id);
      if (asset) characterRefs.push({ name: c.name, imagePath: asset.file_path });
    }
  }

  // Resolve environment reference
  let environmentRef: { name: string; imagePath: string } | undefined;
  if (shot.environment_id) {
    const env: any = db.prepare('SELECT * FROM environments WHERE id = ?').get(shot.environment_id);
    if (env?.reference_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(env.reference_asset_id);
      if (asset) environmentRef = { name: env.name, imagePath: asset.file_path };
    }
  }

  // Resolve previous shot's end frame for continuity
  let prevShotEndFramePath: string | undefined;
  if (shot.sort_order > 0) {
    const prevShot: any = db.prepare(
      'SELECT end_image_asset_id FROM shots WHERE scene_id = ? AND sort_order = ? AND locked = 1'
    ).get(shot.scene_id, shot.sort_order - 1);
    if (prevShot?.end_image_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(prevShot.end_image_asset_id);
      if (asset) prevShotEndFramePath = asset.file_path;
    }
  }

  try {
    db.prepare("UPDATE shots SET image_status = 'loading' WHERE id = ?").run(shot.id);
    const t0 = Date.now();

    console.log(`[shot ${shot.id}] Generating start frame with ${characterRefs.length} char refs, env: ${environmentRef?.name || 'none'}, prev end frame: ${prevShotEndFramePath ? 'yes' : 'no'}`);

    const imagePath = await generateShotStartFrame({
      visualPrompt: shotPrompt,
      styleDNA: project.style_description || 'Cinematic',
      styleImagePath,
      characterRefs,
      environmentRef,
      prevShotEndFramePath,
      userFeedback,
    });

    const durationMs = Date.now() - t0;

    // Save asset
    const assetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'shot_image', ?, ?)`)
      .run(assetId, project.id, imagePath, shotPrompt);

    db.prepare(`
      UPDATE shots SET
        image_asset_id = ?,
        image_status = 'success',
        attempt_count = COALESCE(attempt_count, 0) + 1
      WHERE id = ?
    `).run(assetId, shot.id);

    logCall({
      projectId: project.id,
      stage: 'generate-shot-start-frame',
      model: 'gemini-3-pro-image-preview',
      prompt: shotPrompt,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style ref', url: `/storage/${styleImagePath}` }] : []),
        ...characterRefs.map(r => ({ type: 'image' as const, label: `${r.name} ref`, url: `/storage/${r.imagePath}` })),
        ...(environmentRef ? [{ type: 'image' as const, label: `Env: ${environmentRef.name}`, url: `/storage/${environmentRef.imagePath}` }] : []),
        ...(prevShotEndFramePath ? [{ type: 'image' as const, label: 'Prev end frame', url: `/storage/${prevShotEndFramePath}` }] : []),
      ],
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated start frame for shot`,
      outputAssetIds: [assetId],
      durationMs,
      costEstimate: 0.04,
    });

    db.prepare("UPDATE projects SET cost_estimate = cost_estimate + 0.04, updated_at = datetime('now') WHERE id = ?")
      .run(paramStr(req.params.id));

    res.json(getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Start frame gen failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-shot-start-frame',
      model: 'gemini-3-pro-image-preview',
      prompt: shotPrompt,
      durationMs: 0,
      error: err.message,
    });
    db.prepare("UPDATE shots SET image_status = 'error' WHERE id = ?").run(shot.id);
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate Shot End Frame ─────────────────────────────────────────

router.post('/:id/shots/:shotId/generate-end-frame', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!shot.image_asset_id) return res.status(400).json({ error: 'Start frame must be generated first' });

  const startAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.image_asset_id);
  if (!startAsset) return res.status(400).json({ error: 'Start frame asset not found' });

  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(project.style_asset_id);
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  try {
    db.prepare("UPDATE shots SET end_image_status = 'loading' WHERE id = ?").run(shot.id);
    const t0 = Date.now();

    console.log(`[shot ${shot.id}] Generating end frame...`);

    const endImagePath = await generateShotEndFrame({
      startFramePath: startAsset.file_path,
      visualPrompt: shot.visual_prompt || '',
      motionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      styleImagePath,
      styleDNA: project.style_description || 'Cinematic',
    });

    const durationMs = Date.now() - t0;

    const assetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'shot_end_frame', ?, ?)`)
      .run(assetId, project.id, endImagePath, shot.motion_prompt || 'End frame');

    db.prepare(`UPDATE shots SET end_image_asset_id = ?, end_image_status = 'success' WHERE id = ?`)
      .run(assetId, shot.id);

    logCall({
      projectId: project.id,
      stage: 'generate-shot-end-frame',
      model: 'gemini-3-pro-image-preview',
      prompt: shot.motion_prompt || 'End frame generation',
      referenceInputs: [{ type: 'image', label: 'Start frame', url: `/storage/${startAsset.file_path}` }],
      contextChain: buildContextChain(project.id),
      responseSummary: 'Generated end frame',
      outputAssetIds: [assetId],
      durationMs,
      costEstimate: 0.04,
    });

    db.prepare("UPDATE projects SET cost_estimate = cost_estimate + 0.04, updated_at = datetime('now') WHERE id = ?")
      .run(paramStr(req.params.id));

    res.json(getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] End frame gen failed:`, err);
    db.prepare("UPDATE shots SET end_image_status = 'error' WHERE id = ?").run(shot.id);
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate Shot Frame Pair (start + end in one call) ──────────────

router.post('/:id/shots/:shotId/generate-frame-pair', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  // Sequential enforcement
  if (shot.sort_order > 0) {
    const prevShot: any = db.prepare(
      'SELECT id, locked FROM shots WHERE scene_id = ? AND sort_order = ?'
    ).get(shot.scene_id, shot.sort_order - 1);
    if (prevShot && !prevShot.locked) {
      return res.status(400).json({ error: 'Previous shot must be locked first (sequential enforcement)' });
    }
  }

  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ?').all(paramStr(req.params.id)) as any[];
  const activeCast = cast.filter((c: any) => shotCastIds.includes(c.id));

  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(project.style_asset_id);
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  const characterRefs: { name: string; imagePath: string }[] = [];
  for (const c of activeCast) {
    if (c.reference_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(c.reference_asset_id);
      if (asset) characterRefs.push({ name: c.name, imagePath: asset.file_path });
    }
  }

  let environmentRef: { name: string; imagePath: string } | undefined;
  if (shot.environment_id) {
    const env: any = db.prepare('SELECT * FROM environments WHERE id = ?').get(shot.environment_id);
    if (env?.reference_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(env.reference_asset_id);
      if (asset) environmentRef = { name: env.name, imagePath: asset.file_path };
    }
  }

  let prevShotEndFramePath: string | undefined;
  if (shot.sort_order > 0) {
    const prevShot: any = db.prepare(
      'SELECT end_image_asset_id FROM shots WHERE scene_id = ? AND sort_order = ? AND locked = 1'
    ).get(shot.scene_id, shot.sort_order - 1);
    if (prevShot?.end_image_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(prevShot.end_image_asset_id);
      if (asset) prevShotEndFramePath = asset.file_path;
    }
  }

  try {
    db.prepare("UPDATE shots SET image_status = 'loading', end_image_status = 'loading' WHERE id = ?").run(shot.id);
    const t0 = Date.now();

    console.log(`[shot ${shot.id}] Generating frame pair (single call) with ${characterRefs.length} char refs, env: ${environmentRef?.name || 'none'}`);

    const { startFramePath, endFramePath } = await generateShotFramePair({
      visualPrompt: shot.visual_prompt || '',
      motionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      styleDNA: project.style_description || 'Cinematic',
      styleImagePath,
      characterRefs,
      environmentRef,
      prevShotEndFramePath,
      userFeedback: shot.user_feedback || undefined,
    });

    const durationMs = Date.now() - t0;

    const startAssetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'shot_image', ?, ?)`)
      .run(startAssetId, project.id, startFramePath, shot.visual_prompt || '');

    const endAssetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'shot_end_frame', ?, ?)`)
      .run(endAssetId, project.id, endFramePath, shot.motion_prompt || '');

    db.prepare(`
      UPDATE shots SET
        image_asset_id = ?,
        image_status = 'success',
        end_image_asset_id = ?,
        end_image_status = 'success',
        attempt_count = COALESCE(attempt_count, 0) + 1
      WHERE id = ?
    `).run(startAssetId, endAssetId, shot.id);

    logCall({
      projectId: project.id,
      stage: 'generate-shot-frame-pair',
      model: 'gemini-3-pro-image-preview',
      prompt: `${shot.visual_prompt} | Motion: ${shot.motion_prompt}`,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style ref', url: `/storage/${styleImagePath}` }] : []),
        ...characterRefs.map(r => ({ type: 'image' as const, label: `${r.name} ref`, url: `/storage/${r.imagePath}` })),
        ...(environmentRef ? [{ type: 'image' as const, label: `Env: ${environmentRef.name}`, url: `/storage/${environmentRef.imagePath}` }] : []),
      ],
      contextChain: buildContextChain(project.id),
      responseSummary: 'Generated start + end frame pair in single call',
      outputAssetIds: [startAssetId, endAssetId],
      durationMs,
      costEstimate: 0.04,
    });

    db.prepare("UPDATE projects SET cost_estimate = cost_estimate + 0.04, updated_at = datetime('now') WHERE id = ?")
      .run(paramStr(req.params.id));

    res.json(getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Frame pair gen failed:`, err);
    db.prepare("UPDATE shots SET image_status = 'error', end_image_status = 'error' WHERE id = ?").run(shot.id);
    res.status(500).json({ error: err.message });
  }
});

// ─── Lock Shot ───────────────────────────────────────────────────────

router.post('/:id/shots/:shotId/lock', (req, res) => {
  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!shot.image_asset_id) return res.status(400).json({ error: 'Start frame required to lock' });
  if (!shot.end_image_asset_id) return res.status(400).json({ error: 'End frame required to lock' });

  db.prepare('UPDATE shots SET locked = 1 WHERE id = ?').run(shot.id);
  res.json(getFullProject(paramStr(req.params.id)));
});

router.post('/:id/shots/:shotId/unlock', (req, res) => {
  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  db.prepare('UPDATE shots SET locked = 0 WHERE id = ?').run(shot.id);
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Generate Shot Video ────────────────────────────────────────────

router.post('/:id/shots/:shotId/generate-video', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot || !shot.image_asset_id) return res.status(400).json({ error: 'Shot has no image yet' });

  const imageAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.image_asset_id);
  if (!imageAsset) return res.status(400).json({ error: 'Image asset not found' });

  const scene: any = db.prepare('SELECT * FROM scenes WHERE id = ?').get(shot.scene_id);
  const concept = JSON.parse(project.locked_concept || '{}');
  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ?').all(paramStr(req.params.id)) as any[];
  const activeCast = cast.filter((c: any) => shotCastIds.includes(c.id));

  try {
    db.prepare("UPDATE shots SET video_status = 'loading' WHERE id = ?").run(shot.id);
    const t0 = Date.now();

    // Build Veo prompt: motion description + brief scene context.
    // No Claude compile — the keyframes carry all visual information.
    // Veo just needs to know what MOVES and the emotional tone.
    const motionDesc = shot.motion_prompt || 'Cinematic camera movement';
    const castNames = activeCast.map((c: any) => c.name).join(', ');
    const mood = concept.mood || 'Cinematic';

    const veoPromptParts = [motionDesc];
    if (scene?.narrative_description) {
      // One-line scene context so Veo understands the emotional beat
      const narrativeBrief = scene.narrative_description.length > 120
        ? scene.narrative_description.substring(0, 120) + '...'
        : scene.narrative_description;
      veoPromptParts.push(narrativeBrief);
    }
    if (castNames) veoPromptParts.push(`Characters: ${castNames}`);
    veoPromptParts.push(`${mood} mood`);

    const veoPrompt = veoPromptParts.join('. ');

    console.log(`  [shot ${shot.id} video] ${veoPrompt.substring(0, 120)}...`);

    // Use shot's own end frame if available, else fall back to next shot's start frame
    let endImagePath: string | undefined;
    if (shot.end_image_asset_id) {
      const endAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.end_image_asset_id);
      if (endAsset) endImagePath = endAsset.file_path;
    } else if (shot.use_next_as_end_frame) {
      // Legacy fallback: use next shot's start frame
      const nextShot: any = db.prepare(`
        SELECT s.image_asset_id FROM shots s WHERE s.sort_order > ? AND s.scene_id = ? ORDER BY s.sort_order LIMIT 1
      `).get(shot.sort_order, shot.scene_id);

      if (nextShot?.image_asset_id) {
        const nextAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(nextShot.image_asset_id);
        if (nextAsset) endImagePath = nextAsset.file_path;
      }
    }

    const videoPath = await generateVideo(imageAsset.file_path, veoPrompt, endImagePath);
    const durationMs = Date.now() - t0;

    const assetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'shot_video', ?)`)
      .run(assetId, project.id, videoPath);

    db.prepare(`UPDATE shots SET video_asset_id = ?, video_status = 'success' WHERE id = ?`)
      .run(assetId, shot.id);

    logCall({
      projectId: project.id,
      stage: 'generate-shot-video',
      model: 'veo-3.1-fast-generate-preview',
      prompt: veoPrompt,
      referenceInputs: [
        { type: 'image', label: 'Start keyframe', url: `/storage/${imageAsset.file_path}` },
        ...(endImagePath ? [{ type: 'image' as const, label: 'End keyframe', url: `/storage/${endImagePath}` }] : []),
      ],
      contextChain: buildContextChain(project.id),
      responseSummary: `Video generated: ${videoPath}`,
      outputAssetIds: [assetId],
      durationMs,
      costEstimate: 0.80,
    });

    db.prepare("UPDATE projects SET cost_estimate = cost_estimate + 0.80, updated_at = datetime('now') WHERE id = ?")
      .run(paramStr(req.params.id));

    res.json(getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Video gen failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-shot-video',
      model: 'veo-3.1-fast-generate-preview',
      prompt: shot.motion_prompt || 'Cinematic camera movement',
      referenceInputs: [{ type: 'image', label: 'Start keyframe', url: `/storage/${imageAsset.file_path}` }],
      contextChain: buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    db.prepare("UPDATE shots SET video_status = 'error' WHERE id = ?").run(shot.id);
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat ───────────────────────────────────────────────────────────

router.post('/:id/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Save user message
  db.prepare('INSERT INTO chat_messages (project_id, role, text) VALUES (?, ?, ?)').run(paramStr(req.params.id), 'user', message);

  const history = db.prepare('SELECT role, text FROM chat_messages WHERE project_id = ? ORDER BY id').all(paramStr(req.params.id)) as any[];
  const concept = JSON.parse(project.locked_concept || project.concept_options || '{}');

  const chatContext = `Project: ${project.title}, Concept: ${JSON.stringify(concept).substring(0, 500)}`;

  try {
    const t0 = Date.now();
    const response = await chatWithDirector(chatContext, message, history);
    const durationMs = Date.now() - t0;

    db.prepare('INSERT INTO chat_messages (project_id, role, text) VALUES (?, ?, ?)').run(paramStr(req.params.id), 'model', response);

    logCall({
      projectId: paramStr(req.params.id),
      stage: 'chat',
      model: 'gemini-3-pro-preview',
      prompt: `[User]: ${message}\n[System context]: ${chatContext}`,
      contextChain: buildContextChain(paramStr(req.params.id)),
      responseSummary: response.substring(0, 300),
      durationMs,
      costEstimate: 0.005,
    });

    res.json({ text: response, project: getFullProject(paramStr(req.params.id)) });
  } catch (err: any) {
    logCall({
      projectId: paramStr(req.params.id),
      stage: 'chat',
      model: 'gemini-3-pro-preview',
      prompt: `[User]: ${message}`,
      durationMs: 0,
      error: err.message,
    });
    const errMsg = 'Error connecting to AI.';
    db.prepare('INSERT INTO chat_messages (project_id, role, text) VALUES (?, ?, ?)').run(paramStr(req.params.id), 'model', errMsg);
    res.json({ text: errMsg });
  }
});

export { router as generateRouter };
