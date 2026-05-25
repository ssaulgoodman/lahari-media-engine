import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectAll, selectOne, updateRows } from '../database.js';
import { saveBuffer, storageUrl } from '../storage.js';
import { generateVideoWithFallback } from './video-provider.js';
import { SEGMIND_MODELS, SegmindModelKey } from './segmind.js';
import { logCall, buildContextChain } from '../xray.js';
import { recordDirectorEvent } from './directorEvents.js';

export const MEDIA_LIBRARY_VIDEO_CATEGORY = 'media_library_video';

const parseAssetMetadata = (metadata: any): Record<string, any> => {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try { return JSON.parse(metadata); } catch { return {}; }
};

export const mediaLibraryItemResponse = (asset: any) => {
  const metadata = parseAssetMetadata(asset.metadata);
  return {
    assetId: asset.id,
    url: storageUrl(asset.file_path),
    createdAt: asset.created_at,
    name: metadata.name || asset.prompt || 'Library clip',
    source: metadata.source || 'generated',
    mimeType: metadata.mimeType || null,
    bytes: metadata.bytes || null,
    brief: metadata.brief || null,
    durationSec: metadata.durationSec || metadata.generatedDurationSec || null,
    model: metadata.model || null,
  };
};

export const listMediaLibraryItems = async (projectId: string) => {
  const rows = await selectAll(
    'assets',
    { project_id: projectId, category: MEDIA_LIBRARY_VIDEO_CATEGORY },
    { orderBy: 'created_at', ascending: false },
  );
  return (rows as any[])
    .filter((row) => parseAssetMetadata(row.metadata).hiddenFromMediaLibrary !== true)
    .map(mediaLibraryItemResponse);
};

export const uploadMediaLibraryVideo = async (
  projectId: string,
  file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number },
) => {
  if (!file.mimetype?.startsWith('video/')) {
    const error = new Error('Media library upload currently supports video files only.') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const rawExt = (file.originalname || '').split('.').pop()?.toLowerCase();
  const ext = rawExt && rawExt !== file.originalname
    ? rawExt
    : file.mimetype === 'video/webm'
      ? 'webm'
      : file.mimetype === 'video/quicktime'
        ? 'mov'
        : 'mp4';
  const filePath = await saveBuffer(file.buffer, 'videos', ext);
  const assetId = uuidv4();
  const name = (file.originalname || 'Uploaded clip').slice(0, 160);
  const asset = {
    id: assetId,
    project_id: projectId,
    category: MEDIA_LIBRARY_VIDEO_CATEGORY,
    file_path: filePath,
    prompt: name,
    metadata: JSON.stringify({
      mediaLibrary: true,
      source: 'upload',
      name,
      mimeType: file.mimetype,
      bytes: file.size || null,
    }),
    created_at: new Date().toISOString(),
  };
  await insertRow('assets', asset);
  return mediaLibraryItemResponse(asset);
};

export const hideMediaLibraryItem = async (projectId: string, assetId: string) => {
  const asset: any = await selectOne('assets', { id: assetId });
  if (!asset || asset.project_id !== projectId || asset.category !== MEDIA_LIBRARY_VIDEO_CATEGORY) {
    const error = new Error('Media library clip not found for this project') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  const metadata = parseAssetMetadata(asset.metadata);
  await updateRows('assets', { id: assetId }, {
    metadata: JSON.stringify({
      ...metadata,
      hiddenFromMediaLibrary: true,
      hiddenFromMediaLibraryAt: new Date().toISOString(),
    }),
  });
};

export type MediaLibraryRefInput = {
  type?: 'style' | 'cast' | 'env' | 'uploaded';
  id?: string;
};

export type GenerateMediaLibraryClipInput = {
  projectId: string;
  userId?: string;
  title?: string;
  brief: string;
  durationSec?: number;
  refs?: MediaLibraryRefInput[];
  useProjectRefs?: boolean;
  modelOverride?: {
    videoModel?: string;
  };
  source?: 'web' | 'codex';
};

const clampDuration = (durationSec: unknown) => {
  const requested = Number(durationSec || 8);
  if (!Number.isFinite(requested)) return 8;
  return Math.max(4, Math.min(15, Math.round(requested)));
};

const resolveReferencePaths = async (
  project: any,
  refs: MediaLibraryRefInput[] | undefined,
  useProjectRefs: boolean,
) => {
  const paths: string[] = [];
  const pushAsset = async (assetId?: string | null) => {
    if (!assetId || paths.length >= 9) return;
    const asset = await selectOne('assets', { id: assetId });
    if (asset?.file_path && asset.project_id === project.id) paths.push(asset.file_path);
  };

  if (refs?.length) {
    const allCast = await selectAll('cast_members', { project_id: project.id });
    const allEnvs = await selectAll('environments', { project_id: project.id });
    for (const ref of refs) {
      if (paths.length >= 9) break;
      if (ref.type === 'style') {
        await pushAsset(project.style_asset_id);
      } else if (ref.type === 'cast' && ref.id) {
        const member = (allCast as any[]).find((item) => item.id === ref.id);
        await pushAsset(member?.reference_asset_id);
      } else if (ref.type === 'env' && ref.id) {
        const env = (allEnvs as any[]).find((item) => item.id === ref.id);
        await pushAsset(env?.reference_asset_id);
      } else if (ref.type === 'uploaded' && ref.id) {
        await pushAsset(ref.id);
      }
    }
    return paths;
  }

  if (!useProjectRefs) return paths;

  await pushAsset(project.style_asset_id);
  const [cast, envs] = await Promise.all([
    selectAll('cast_members', { project_id: project.id }, { orderBy: 'sort_order' }),
    selectAll('environments', { project_id: project.id }, { orderBy: 'sort_order' }),
  ]);
  for (const member of cast as any[]) {
    if (paths.length >= 9) break;
    await pushAsset(member.reference_asset_id);
  }
  for (const env of envs as any[]) {
    if (paths.length >= 9) break;
    await pushAsset(env.reference_asset_id);
  }
  return paths;
};

export const generateMediaLibraryClip = async (input: GenerateMediaLibraryClipInput) => {
  const project: any = await selectOne('projects', { id: input.projectId });
  if (!project) {
    const error = new Error('Project not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const title = (input.title || 'Extra clip').trim().slice(0, 160);
  const brief = input.brief.trim();
  if (!brief) {
    const error = new Error('brief required') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const requestedVideoModelKey = (input.modelOverride?.videoModel || project.video_model || 'seedance-2.0-fast') as SegmindModelKey;
  const videoModelKey = requestedVideoModelKey in SEGMIND_MODELS ? requestedVideoModelKey : 'seedance-2.0-fast';
  const modelSpec = SEGMIND_MODELS[videoModelKey];
  const durationSec = clampDuration(input.durationSec);
  const referenceImagePaths = await resolveReferencePaths(project, input.refs, input.useProjectRefs !== false);
  const aspect = (project.aspect_ratio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16';
  const resolution = (project.video_resolution === '1080p' ? '1080p' : '720p') as '720p' | '1080p';
  const prompt = [
    title ? `Extra insert clip: ${title}.` : 'Extra insert clip.',
    brief,
    'Make it useful as standalone B-roll or montage material. Do not include dialogue, captions, readable text, or generated audio.',
  ].join(' ');

  const t0 = Date.now();
  const result = await generateVideoWithFallback(undefined, prompt, {
    referenceImagePaths: modelSpec.supportsRefs ? referenceImagePaths : undefined,
    aspectRatio: aspect,
    resolution,
    durationSec,
    modelKey: videoModelKey,
  });

  const assetId = uuidv4();
  const metadata = {
    mediaLibrary: true,
    source: 'generated',
    name: title,
    brief,
    durationSec,
    generatedDurationSec: result.durationSec,
    model: videoModelKey,
    modelId: result.modelId,
    refs: input.refs || null,
    useProjectRefs: input.useProjectRefs !== false,
    referenceCount: referenceImagePaths.length,
  };
  const asset = {
    id: assetId,
    project_id: project.id,
    category: MEDIA_LIBRARY_VIDEO_CATEGORY,
    file_path: result.videoPath,
    prompt,
    metadata: JSON.stringify(metadata),
    created_at: new Date().toISOString(),
  };
  await insertRow('assets', asset);

  await logCall({
    projectId: project.id,
    stage: 'generate-media-library-clip',
    model: result.modelId,
    prompt,
    referenceInputs: referenceImagePaths.map((filePath, index) => ({
      type: 'image' as const,
      label: `Media library ref ${index + 1}`,
      url: storageUrl(filePath),
    })),
    contextChain: await buildContextChain(project.id),
    responseSummary: `Generated extra media-library clip "${title}"`,
    outputAssetIds: [assetId],
    durationMs: Date.now() - t0,
    costEstimate: modelSpec.costPerSec * result.durationSec,
  });

  await recordDirectorEvent({
    projectId: project.id,
    userId: input.userId,
    source: input.source || 'web',
    eventType: 'media_library_clip_generated',
    entityType: 'asset',
    entityId: assetId,
    summary: `Generated extra media-library clip "${title}".`,
    payload: {
      title,
      brief,
      durationSec,
      model: videoModelKey,
      referenceCount: referenceImagePaths.length,
      assetId,
    },
  });

  return {
    clip: mediaLibraryItemResponse(asset),
    prompt,
    model: {
      key: videoModelKey,
      label: modelSpec.label,
      costPerSec: modelSpec.costPerSec,
    },
    estimatedCost: modelSpec.costPerSec * result.durationSec,
    note: 'Saved as a media-library clip. It did not change script scenes, shots, or stale flags.',
  };
};
