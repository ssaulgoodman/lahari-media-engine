import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectOne, updateRows, supportsPlatformColumns } from '../database.js';
import { saveBuffer, storageUrl } from '../storage.js';
import { verifyMcpBearerToken } from '../services/mcpTokens.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });

const PURPOSES = [
  'cast_reference',
  'env_reference',
  'style_reference',
  'cast_guide',
  'env_guide',
  'style_guide',
  'audio_source',
  'storyboard_image',
  'keyframe_image',
] as const;

type UploadPurpose = typeof PURPOSES[number];

const bearerToken = (header?: string | null) => {
  const match = (header || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const extFromMime = (mimeType?: string) => {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('aac')) return 'aac';
  if (mime.includes('m4a') || mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'png';
};

const categoryForPurpose = (purpose: UploadPurpose) => {
  if (purpose === 'audio_source') return 'audio_source';
  if (purpose === 'storyboard_image') return 'storyboard_user_import';
  if (purpose === 'keyframe_image') return 'keyframe_user_import';
  if (purpose.startsWith('cast_')) return 'character_user_ref';
  if (purpose.startsWith('env_')) return 'environment_user_ref';
  return 'style_user_ref';
};

const storageCategoryForPurpose = (purpose: UploadPurpose) =>
  purpose === 'audio_source' ? 'audio' : 'images';

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const auth = await verifyMcpBearerToken(bearerToken(req.header('authorization')));
    const projectId = String(req.body?.projectId || '').trim();
    const purpose = String(req.body?.purpose || '').trim() as UploadPurpose;
    const entityId = String(req.body?.entityId || '').trim() || null;
    if (!projectId) return res.status(400).json({ code: 'validation_failed', message: 'projectId is required.' });
    if (!PURPOSES.includes(purpose)) return res.status(400).json({ code: 'validation_failed', message: `purpose must be one of: ${PURPOSES.join(', ')}.` });
    if (!req.file) return res.status(400).json({ code: 'validation_failed', message: 'file is required.' });

    const project = await selectOne('projects', { id: projectId });
    if (!project) return res.status(404).json({ code: 'not_found', message: 'Project not found.' });
    if (project.user_id !== auth.userId) return res.status(403).json({ code: 'access_denied', message: 'Access denied.' });

    if (purpose.startsWith('cast_')) {
      if (!entityId) return res.status(400).json({ code: 'validation_failed', message: 'entityId is required for cast uploads.' });
      const member = await selectOne('cast_members', { id: entityId });
      if (!member || member.project_id !== projectId) return res.status(404).json({ code: 'not_found', message: 'Cast member not found in this project.' });
    }
    if (purpose.startsWith('env_')) {
      if (!entityId) return res.status(400).json({ code: 'validation_failed', message: 'entityId is required for environment uploads.' });
      const environment = await selectOne('environments', { id: entityId });
      if (!environment || environment.project_id !== projectId) return res.status(404).json({ code: 'not_found', message: 'Environment not found in this project.' });
    }
    if (purpose === 'audio_source' && !String(req.file.mimetype || '').toLowerCase().startsWith('audio/')) {
      return res.status(400).json({ code: 'validation_failed', message: 'audio_source uploads require an audio/* file.' });
    }
    if (purpose === 'storyboard_image' && !String(req.file.mimetype || '').toLowerCase().startsWith('image/')) {
      return res.status(400).json({ code: 'validation_failed', message: 'storyboard_image uploads require an image/* file.' });
    }
    if (purpose === 'keyframe_image' && !String(req.file.mimetype || '').toLowerCase().startsWith('image/')) {
      return res.status(400).json({ code: 'validation_failed', message: 'keyframe_image uploads require an image/* file.' });
    }

    const filePath = await saveBuffer(req.file.buffer, storageCategoryForPurpose(purpose), extFromMime(req.file.mimetype));
    const assetId = uuidv4();
    await insertRow('assets', {
      id: assetId,
      project_id: projectId,
      category: categoryForPurpose(purpose),
      file_path: filePath,
      prompt: `Agent upload: ${purpose}`,
      metadata: JSON.stringify({
        purpose,
        entityId,
        uploadedBy: 'agent-upload-endpoint',
        filename: req.file.originalname || null,
        mimeType: req.file.mimetype || null,
        tokenId: auth.tokenId,
      }),
    });

    if (purpose === 'audio_source') {
      await updateRows('projects', { id: projectId }, {
        audio_path: filePath,
        status: project.status === 'analyzing' ? 'uploaded' : project.status,
        ...(supportsPlatformColumns() ? {
          source_payload: {
            ...((project.source_payload && typeof project.source_payload === 'object') ? project.source_payload : {}),
            kind: 'audio',
            sourceAssetId: assetId,
            originalName: req.file.originalname || null,
            storageKey: filePath,
          },
        } : {}),
        updated_at: new Date().toISOString(),
      });
    }

    const next = purpose === 'audio_source'
      ? 'Audio source attached. Ask whether this is soundtrack-only or source material; run analyze_audio_transcribe/analyze_audio_structure only if useful.'
      : purpose === 'style_guide'
      ? 'Use this assetId as guideAssetId in run_action(generate_style_candidates).'
      : purpose === 'style_reference'
        ? 'Use this assetId as sourceAssetId in run_action(apply_style_direction). If styleDescription is empty, Mirage will auto-identify style text when the asset is locked.'
        : purpose === 'storyboard_image'
          ? 'Use this assetId as sourceAssetId in run_action(import_storyboard_image) with shotId and optional lock=true.'
          : purpose === 'keyframe_image'
            ? 'Use this assetId as sourceAssetId in run_action(import_keyframe_image) with shotId. Then use run_action(apply_shot_workflow_modes) if the shot must force keyframe mode.'
            : purpose.endsWith('_guide')
              ? 'Use this assetId as guideAssetId in run_action(generate_candidates).'
              : 'Use this assetId as sourceAssetId in run_action(lock_reference).';

    return res.json({
      kind: 'mirage.agent.upload',
      projectId,
      assetId,
      url: storageUrl(filePath),
      purpose,
      entityId,
      next,
    });
  } catch (error: any) {
    return res.status(401).json({
      code: 'agent_upload_failed',
      message: error?.message || String(error),
    });
  }
});

export { router as agentUploadsRouter };
