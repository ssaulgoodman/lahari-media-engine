import { getSB, T } from '../../database.js';
import { storageUrl } from '../../storage.js';
import { normalizeWorkflowKey } from '../../presets.js';
import { compactText, webStudioUrl } from './core.js';

const parseJson = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const stringifySearch = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const termsForQuery = (query?: string | null): string[] => {
  const terms = (query || '')
    .toLowerCase()
    .split(/[^a-z0-9\u0900-\u097f\u0c00-\u0c7f]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  return [...new Set(terms)].slice(0, 20);
};

const matchTerms = (terms: string[], value: unknown): number => {
  if (!terms.length) return 0;
  const text = stringifySearch(value).toLowerCase();
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
};

const mediaTypeForAsset = (asset: any): 'image' | 'video' | 'audio' | 'other' => {
  const category = String(asset.category || '').toLowerCase();
  const filePath = String(asset.file_path || '').toLowerCase();
  if (category.includes('audio') || /\.(mp3|wav|m4a|aac|flac|ogg)(\?|$)/.test(filePath)) return 'audio';
  if (category.includes('video') || category === 'final_render' || /\.(mp4|mov|webm|mkv)(\?|$)/.test(filePath)) return 'video';
  if (category.includes('image') || category.includes('style') || category.includes('character') || category.includes('environment') || category.includes('storyboard') || /\.(png|jpe?g|webp|gif)(\?|$)/.test(filePath)) return 'image';
  return 'other';
};

const listUserProjects = async (userId: string, limit = 200, projectId?: string | null) => {
  let query = getSB()
    .from(T.projects)
    .select('id,title,status,preset_key,workflow_key,seed_kind,image_model,storyboard_provider,video_model,text_provider,style_description,style_generation_prompt,color_palette,concept,created_at,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (projectId) query = query.eq('id', projectId);
  const { data, error } = await query;
  if (error) throw new Error(`DB select artist projects: ${error.message}`);
  return data || [];
};

export const queryArtistMemory = async (opts: {
  userId: string;
  query?: string | null;
  workflowKey?: string | null;
  limit?: number;
}) => {
  const limit = Math.min(Math.max(Number(opts.limit || 10) || 10, 1), 25);
  const terms = termsForQuery(opts.query);
  const workflowFilter = opts.workflowKey ? normalizeWorkflowKey(opts.workflowKey) : null;
  const rows = await listUserProjects(opts.userId, 250);

  const scored = rows
    .filter((row: any) => !workflowFilter || normalizeWorkflowKey(row.workflow_key) === workflowFilter)
    .map((row: any) => {
      const conceptText = stringifySearch(row.concept);
      const fields = [
        { name: 'title', weight: 8, value: row.title },
        { name: 'style', weight: 5, value: `${row.style_description || ''} ${row.style_generation_prompt || ''} ${row.color_palette || ''}` },
        { name: 'concept', weight: 4, value: conceptText },
        { name: 'workflow', weight: 3, value: `${row.workflow_key || ''} ${row.preset_key || ''} ${row.seed_kind || ''}` },
        { name: 'models', weight: 2, value: `${row.image_model || ''} ${row.storyboard_provider || ''} ${row.video_model || ''} ${row.text_provider || ''}` },
        { name: 'status', weight: 1, value: row.status },
      ];
      const matchedFields = fields
        .map((field) => ({ field: field.name, hits: matchTerms(terms, field.value), weight: field.weight }))
        .filter((field) => field.hits > 0);
      const score = terms.length
        ? matchedFields.reduce((sum, field) => sum + field.hits * field.weight, 0)
        : 1;
      return { row, score, matchedFields: matchedFields.map((field) => field.field) };
    })
    .filter((item) => !terms.length || item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.row.updated_at || '').localeCompare(String(a.row.updated_at || '')))
    .slice(0, limit);

  return {
    kind: 'mirage.artist_memory.projects',
    generatedAt: new Date().toISOString(),
    query: opts.query || null,
    workflowKey: workflowFilter,
    count: scored.length,
    projects: scored.map(({ row, score, matchedFields }) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      workflowKey: normalizeWorkflowKey(row.workflow_key),
      presetKey: row.preset_key || null,
      seedKind: row.seed_kind || null,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      webUrl: webStudioUrl(row.id, { step: 'studio' }),
      score,
      matchedFields,
      models: {
        image: row.image_model || null,
        storyboard: row.storyboard_provider || null,
        video: row.video_model || null,
        text: row.text_provider || null,
      },
      style: compactText(`${row.style_description || ''} ${row.style_generation_prompt || ''}`.trim(), 360),
      concept: compactText(stringifySearch(row.concept), 420),
    })),
  };
};

export const searchArtistAssets = async (opts: {
  userId: string;
  query?: string | null;
  projectId?: string | null;
  categories?: string[] | null;
  mediaType?: 'image' | 'video' | 'audio' | 'other' | null;
  limit?: number;
}) => {
  const limit = Math.min(Math.max(Number(opts.limit || 20) || 20, 1), 60);
  const terms = termsForQuery(opts.query);
  const projects = await listUserProjects(opts.userId, opts.projectId ? 1 : 250, opts.projectId || null);
  const projectIds = projects.map((project: any) => project.id).filter(Boolean);
  const projectsById = new Map(projects.map((project: any) => [project.id, project]));
  if (opts.projectId && projectIds.length === 0) throw new Error(`Project not found or not accessible: ${opts.projectId}`);
  if (projectIds.length === 0) {
    return {
      kind: 'mirage.artist_memory.assets',
      generatedAt: new Date().toISOString(),
      query: opts.query || null,
      count: 0,
      assets: [],
    };
  }

  let query = getSB()
    .from(T.assets)
    .select('id,project_id,shot_id,category,file_path,prompt,metadata,created_at')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(500);
  const categories = [...new Set((opts.categories || []).map((category) => String(category).trim()).filter(Boolean))].slice(0, 25);
  if (categories.length) query = query.in('category', categories);
  const { data, error } = await query;
  if (error) throw new Error(`DB select artist assets: ${error.message}`);

  const scored = (data || [])
    .map((asset: any) => {
      const project: any = projectsById.get(asset.project_id);
      const metadata = parseJson(asset.metadata);
      const mediaType = mediaTypeForAsset(asset);
      const fields = [
        { name: 'category', weight: 5, value: asset.category },
        { name: 'project', weight: 4, value: project?.title },
        { name: 'prompt', weight: 4, value: asset.prompt },
        { name: 'metadata', weight: 2, value: metadata },
        { name: 'path', weight: 1, value: asset.file_path },
      ];
      const matchedFields = fields
        .map((field) => ({ field: field.name, hits: matchTerms(terms, field.value), weight: field.weight }))
        .filter((field) => field.hits > 0);
      const score = terms.length
        ? matchedFields.reduce((sum, field) => sum + field.hits * field.weight, 0)
        : 1;
      return { asset, project, metadata, mediaType, score, matchedFields: matchedFields.map((field) => field.field) };
    })
    .filter((item) => !opts.mediaType || item.mediaType === opts.mediaType)
    .filter((item) => !terms.length || item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.asset.created_at || '').localeCompare(String(a.asset.created_at || '')))
    .slice(0, limit);

  return {
    kind: 'mirage.artist_memory.assets',
    generatedAt: new Date().toISOString(),
    query: opts.query || null,
    projectId: opts.projectId || null,
    categories,
    mediaType: opts.mediaType || null,
    count: scored.length,
    assets: scored.map(({ asset, project, metadata, mediaType, score, matchedFields }) => ({
      id: asset.id,
      projectId: asset.project_id,
      projectTitle: project?.title || null,
      shotId: asset.shot_id || null,
      category: asset.category,
      mediaType,
      url: asset.file_path ? storageUrl(asset.file_path) : null,
      createdAt: asset.created_at,
      score,
      matchedFields,
      prompt: compactText(asset.prompt, 420),
      metadata: Object.keys(metadata).length ? {
        keys: Object.keys(metadata).slice(0, 12),
        summary: compactText(stringifySearch(metadata), 420),
      } : null,
      webUrl: asset.project_id ? webStudioUrl(asset.project_id, { step: 'studio' }) : null,
    })),
  };
};
