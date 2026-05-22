import { getSB, T } from '../../database.js';
import { storageUrl } from '../../storage.js';
import { webStudioUrl } from './core.js';

const clampLimit = (limit?: number, fallback = 12, max = 50) => {
  const parsed = Number(limit || fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), max) : fallback;
};

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

const tokenize = (value: string) => normalize(value)
  .replace(/[^a-z0-9\s-]/g, ' ')
  .split(/\s+/)
  .filter((token) => token.length >= 3)
  .slice(0, 10);

const includesAny = (haystack: unknown, tokens: string[]) => {
  const text = normalize(haystack);
  return tokens.some((token) => text.includes(token));
};

const parseJson = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};

type ProjectMemoryRow = {
  id: string;
  title: string | null;
  status: string | null;
  song_type?: string | null;
  is_narrative?: boolean | null;
  is_meditative?: boolean | null;
  style_description?: string | null;
  style_generation_prompt?: string | null;
  style_asset_id?: string | null;
  style_exploration?: unknown;
  image_model?: string | null;
  storyboard_provider?: string | null;
  video_model?: string | null;
  text_provider?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AssetMemoryRow = {
  id: string;
  project_id: string | null;
  shot_id?: string | null;
  category: string | null;
  file_path: string | null;
  prompt?: string | null;
  metadata?: unknown;
  created_at?: string | null;
};

const userProjects = async (userId: string, limit = 50): Promise<ProjectMemoryRow[]> => {
  const { data, error } = await getSB()
    .from(T.projects)
    .select('id,title,status,song_type,is_narrative,is_meditative,style_description,style_generation_prompt,style_asset_id,style_exploration,image_model,storyboard_provider,video_model,text_provider,created_at,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`DB artist memory projects: ${error.message}`);
  return (data as ProjectMemoryRow[]) || [];
};

const assetsForProjects = async (projectIds: string[], opts: { categories?: string[]; limit?: number } = {}): Promise<AssetMemoryRow[]> => {
  if (!projectIds.length) return [];
  let q = getSB()
    .from(T.assets)
    .select('id,project_id,shot_id,category,file_path,prompt,metadata,created_at')
    .in('project_id', projectIds.slice(0, 50))
    .order('created_at', { ascending: false })
    .limit(clampLimit(opts.limit, 60, 200));
  if (opts.categories?.length) q = q.in('category', opts.categories);
  const { data, error } = await q;
  if (error) throw new Error(`DB artist memory assets: ${error.message}`);
  return (data as AssetMemoryRow[]) || [];
};

const imageCategories = new Set([
  'style',
  'shot_storyboard',
  'shot_image',
  'shot_end_frame',
  'shot_extracted_last_frame',
  'character',
  'character_candidate',
  'environment',
  'environment_candidate',
  'shot_ref',
  'character_user_ref',
  'environment_user_ref',
  'storyboard_refine_ref',
]);

const videoCategories = new Set(['shot_video', 'final_render']);

const categoriesForKind = (kind?: string) => {
  if (!kind || kind === 'all') return undefined;
  if (kind === 'style') return ['style'];
  if (kind === 'storyboard') return ['shot_storyboard'];
  if (kind === 'shot_image' || kind === 'keyframe') return ['shot_image', 'shot_end_frame', 'shot_extracted_last_frame'];
  if (kind === 'look' || kind === 'character' || kind === 'environment') return ['character', 'character_candidate', 'environment', 'environment_candidate'];
  if (kind === 'video') return ['shot_video', 'final_render'];
  return [kind];
};

const assetKind = (category?: string | null) => {
  if (!category) return 'unknown';
  if (category === 'style') return 'style';
  if (category === 'shot_storyboard') return 'storyboard';
  if (videoCategories.has(category)) return 'video';
  if (category.includes('character') || category.includes('environment')) return 'look';
  if (imageCategories.has(category)) return 'image';
  return category;
};

const publicAsset = (asset: AssetMemoryRow, projectById: Map<string, ProjectMemoryRow>) => ({
  assetId: asset.id,
  projectId: asset.project_id,
  projectTitle: asset.project_id ? projectById.get(asset.project_id)?.title || null : null,
  shotId: asset.shot_id || null,
  kind: assetKind(asset.category),
  category: asset.category,
  url: asset.file_path ? storageUrl(asset.file_path) : null,
  prompt: asset.prompt || null,
  metadata: parseJson(asset.metadata),
  createdAt: asset.created_at || null,
});

const styleSlots = (project: ProjectMemoryRow) => {
  const parsed = parseJson(project.style_exploration) as any;
  const slots = Array.isArray(parsed?.slots) ? parsed.slots : [];
  return slots.slice(0, 8).map((slot: any) => ({
    title: slot?.title || slot?.name || null,
    description: slot?.description || slot?.style || slot?.prompt || null,
    assetId: slot?.assetId || null,
  })).filter((slot: any) => slot.title || slot.description || slot.assetId);
};

export const queryArtistMemory = async (
  userId: string,
  question: string,
  opts: { projectId?: string; includeAssets?: boolean; limit?: number } = {},
) => {
  const clean = String(question || '').trim();
  if (!clean) throw new Error('question is required');
  const limit = clampLimit(opts.limit, 12, 30);
  const tokens = tokenize(clean);
  const projects = await userProjects(userId, 80);
  const scopedProjects = opts.projectId ? projects.filter((project) => project.id === opts.projectId) : projects;
  if (opts.projectId && !scopedProjects.length) throw new Error('Access denied');

  const styleLike = /style|look|aesthetic|visual|palette|reference|popular|used before|earlier|prior/i.test(clean);
  const storyboardLike = /storyboard|board|panel|shot image|keyframe|frame/i.test(clean);
  const videoLike = /video|render|clip|final/i.test(clean);

  const rankedProjects = scopedProjects
    .map((project) => {
      let score = 0;
      const searchable = [
        project.title,
        project.status,
        project.song_type,
        project.style_description,
        project.style_generation_prompt,
        JSON.stringify(parseJson(project.style_exploration) || ''),
      ].join('\n');
      if (includesAny(searchable, tokens)) score += 4;
      if (styleLike && (project.style_description || project.style_asset_id || project.style_exploration)) score += 3;
      if (project.status === 'completed') score += 1;
      return { project, score };
    })
    .filter((entry) => entry.score > 0 || !tokens.length || styleLike || storyboardLike || videoLike)
    .sort((a, b) => b.score - a.score || String(b.project.updated_at || '').localeCompare(String(a.project.updated_at || '')))
    .slice(0, limit)
    .map(({ project, score }) => ({
      projectId: project.id,
      title: project.title || 'Untitled',
      status: project.status || null,
      songType: project.song_type || null,
      isNarrative: project.is_narrative ?? null,
      isMeditative: project.is_meditative ?? null,
      styleDescription: project.style_description || null,
      styleGenerationPrompt: project.style_generation_prompt || null,
      hasLockedStyle: !!project.style_asset_id,
      styleAssetId: project.style_asset_id || null,
      styleExploration: styleSlots(project),
      models: {
        image: project.image_model || null,
        storyboard: project.storyboard_provider || null,
        video: project.video_model || null,
        text: project.text_provider || null,
      },
      updatedAt: project.updated_at || null,
      webUrl: webStudioUrl(project.id, { step: styleLike ? 'blueprint' : videoLike ? 'render' : 'studio' }),
      relevanceScore: score,
    }));

  const projectById = new Map(scopedProjects.map((project) => [project.id, project]));
  let assets: ReturnType<typeof publicAsset>[] = [];
  if (opts.includeAssets || styleLike || storyboardLike || videoLike) {
    const categories = styleLike
      ? ['style', 'shot_storyboard', 'character', 'environment']
      : storyboardLike
        ? ['shot_storyboard', 'shot_image', 'shot_end_frame']
        : videoLike
          ? ['shot_video', 'final_render']
          : undefined;
    const assetRows = await assetsForProjects(rankedProjects.map((project) => project.projectId), { categories, limit: limit * 4 });
    assets = assetRows
      .filter((asset) => {
        if (!tokens.length) return true;
        return includesAny([asset.category, asset.prompt, JSON.stringify(parseJson(asset.metadata) || '')].join('\n'), tokens)
          || rankedProjects.some((project) => project.projectId === asset.project_id);
      })
      .slice(0, limit * 3)
      .map((asset) => publicAsset(asset, projectById));
  }

  return {
    kind: 'lahari.artist_memory.query',
    generatedAt: new Date().toISOString(),
    question: clean,
    scope: opts.projectId ? { projectId: opts.projectId } : { user: 'authenticated_artist' },
    resultShape: 'curated_evidence_for_agent_summary',
    guidance: 'Use these artist-owned prior projects/assets as evidence. Do not claim this is the full database; it is a scoped, compact memory slice.',
    projects: rankedProjects,
    assets,
  };
};

export const searchArtistAssets = async (
  userId: string,
  opts: { kind?: string; query?: string; projectId?: string; limit?: number } = {},
) => {
  const limit = clampLimit(opts.limit, 20, 80);
  const projects = await userProjects(userId, 80);
  const scopedProjects = opts.projectId ? projects.filter((project) => project.id === opts.projectId) : projects;
  if (opts.projectId && !scopedProjects.length) throw new Error('Access denied');
  const projectById = new Map(scopedProjects.map((project) => [project.id, project]));
  const tokens = tokenize(String(opts.query || ''));
  const rows = await assetsForProjects(scopedProjects.map((project) => project.id), {
    categories: categoriesForKind(opts.kind),
    limit: Math.max(limit * 3, 50),
  });
  const filtered = rows
    .filter((asset) => {
      if (!tokens.length) return true;
      const project = asset.project_id ? projectById.get(asset.project_id) : null;
      return includesAny([
        asset.category,
        asset.prompt,
        JSON.stringify(parseJson(asset.metadata) || ''),
        project?.title,
        project?.style_description,
      ].join('\n'), tokens);
    })
    .slice(0, limit)
    .map((asset) => publicAsset(asset, projectById));

  return {
    kind: 'lahari.artist_assets.search',
    generatedAt: new Date().toISOString(),
    scope: opts.projectId ? { projectId: opts.projectId } : { user: 'authenticated_artist' },
    query: opts.query || null,
    requestedKind: opts.kind || 'all',
    assets: filtered,
  };
};
