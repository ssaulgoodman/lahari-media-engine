import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectAll, selectOne, supportsPlatformColumns, updateRows } from '../../database.js';
import { storageUrl } from '../../storage.js';
import { recordDirectorEvent } from '../directorEvents.js';
import { webStudioUrl } from './core.js';
import { createProjectForDirector } from './projectIntake.js';

type PersonaRow = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description?: string | null;
  workflow_name?: string | null;
  project_workflow_key?: string | null;
  preset_key?: string | null;
  character_reference_asset_id?: string | null;
  style_asset_id?: string | null;
  voice_provider?: string | null;
  voice_id?: string | null;
  voice_name?: string | null;
  tone_notes?: string | null;
  topic_lane?: string | null;
  metadata?: Record<string, any> | string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SavePersonaInput = {
  personaId?: string | null;
  name: string;
  slug?: string | null;
  description?: string | null;
  workflowName?: string | null;
  projectWorkflowKey?: string | null;
  presetKey?: string | null;
  characterReferenceAssetId?: string | null;
  styleAssetId?: string | null;
  voiceProvider?: string | null;
  voiceId?: string | null;
  voiceName?: string | null;
  toneNotes?: string | null;
  topicLane?: string | null;
  metadata?: Record<string, any> | null;
};

export type CreateProjectFromPersonaInput = {
  personaId?: string | null;
  personaName?: string | null;
  topic: string;
  title?: string | null;
  directorBrief?: string | null;
  targetRuntime?: number | null;
  targetShotDuration?: number | null;
};

const cleanText = (value: unknown, max = 8000): string => (
  String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
);

const cleanLongText = (value: unknown, max = 16000): string => (
  String(value || '').trim().slice(0, max)
);

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\u0c00-\u0c7f]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'persona';
};

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

const assertOwnedAsset = async (userId: string, assetId?: string | null) => {
  if (!assetId) return null;
  const asset = await selectOne('assets', { id: assetId });
  if (!asset) {
    const err = new Error(`Persona asset not found: ${assetId}`);
    (err as any).statusCode = 404;
    throw err;
  }
  const project = await selectOne('projects', { id: asset.project_id });
  if (!project || project.user_id !== userId) {
    const err = new Error('Access denied for persona asset.');
    (err as any).statusCode = 403;
    throw err;
  }
  return asset;
};

const copyOwnedAssetIntoProject = async (opts: {
  userId: string;
  sourceAssetId?: string | null;
  projectId: string;
  category: string;
  personaId: string;
}) => {
  const source = await assertOwnedAsset(opts.userId, opts.sourceAssetId);
  if (!source) return null;
  const assetId = uuidv4();
  await insertRow('assets', {
    id: assetId,
    project_id: opts.projectId,
    category: opts.category,
    file_path: source.file_path,
    prompt: source.prompt || `Persona ${opts.category} reference`,
    metadata: JSON.stringify({
      copiedFromAssetId: source.id,
      copiedFromProjectId: source.project_id,
      copiedForPersonaId: opts.personaId,
      copiedFor: 'create_project_from_persona',
    }),
  });
  return { ...source, id: assetId, project_id: opts.projectId };
};

const personaSummary = (row: PersonaRow, assetsById?: Map<string, any>) => {
  const characterAsset = row.character_reference_asset_id ? assetsById?.get(row.character_reference_asset_id) : null;
  const styleAsset = row.style_asset_id ? assetsById?.get(row.style_asset_id) : null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || null,
    workflowName: row.workflow_name || 'yapper',
    projectWorkflowKey: row.project_workflow_key || 'scripted_narrative',
    presetKey: row.preset_key || 'anime_default',
    topicLane: row.topic_lane || null,
    toneNotes: row.tone_notes || null,
    voice: {
      provider: row.voice_provider || null,
      id: row.voice_id || null,
      name: row.voice_name || null,
      assigned: !!row.voice_id,
    },
    refs: {
      characterAssetId: row.character_reference_asset_id || null,
      characterUrl: characterAsset?.file_path ? storageUrl(characterAsset.file_path) : null,
      styleAssetId: row.style_asset_id || null,
      styleUrl: styleAsset?.file_path ? storageUrl(styleAsset.file_path) : null,
    },
    ready: {
      hasCharacterReference: !!row.character_reference_asset_id,
      hasVoice: !!row.voice_id,
      hasStyle: !!row.style_asset_id,
      hasTone: !!row.tone_notes,
    },
    metadata: parseJson(row.metadata),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
};

const loadAssetsForPersonas = async (personas: PersonaRow[]) => {
  const assetIds = [...new Set(personas.flatMap((row) => [
    row.character_reference_asset_id,
    row.style_asset_id,
  ]).filter((id): id is string => !!id))];
  if (!assetIds.length) return new Map<string, any>();
  const rows = await selectAll('assets', { id: assetIds });
  return new Map(rows.map((row) => [row.id, row]));
};

export const listPersonasForDirector = async (userId: string, opts: {
  query?: string | null;
  workflowName?: string | null;
  limit?: number | null;
} = {}) => {
  const limit = Math.min(Math.max(Number(opts.limit || 20) || 20, 1), 60);
  const rows = await selectAll('personas', { user_id: userId }, { orderBy: 'updated_at', ascending: false, limit: 250 }) as PersonaRow[];
  const query = cleanText(opts.query, 120).toLowerCase();
  const workflowName = cleanText(opts.workflowName, 80).toLowerCase();
  const filtered = rows
    .filter((row) => !workflowName || String(row.workflow_name || '').toLowerCase() === workflowName)
    .filter((row) => {
      if (!query) return true;
      const haystack = `${row.name || ''} ${row.slug || ''} ${row.description || ''} ${row.tone_notes || ''} ${row.topic_lane || ''}`.toLowerCase();
      return haystack.includes(query);
    })
    .slice(0, limit);
  const assetsById = await loadAssetsForPersonas(filtered);
  return {
    kind: 'mirage.personas.list',
    generatedAt: new Date().toISOString(),
    count: filtered.length,
    personas: filtered.map((row) => personaSummary(row, assetsById)),
  };
};

export const savePersonaForDirector = async (userId: string, input: SavePersonaInput) => {
  const name = cleanText(input.name, 160);
  if (!name) throw new Error('Persona name is required.');
  const slug = slugify(input.slug || name);

  await assertOwnedAsset(userId, input.characterReferenceAssetId);
  await assertOwnedAsset(userId, input.styleAssetId);

  const existingById = input.personaId
    ? await selectOne('personas', { id: input.personaId, user_id: userId }) as PersonaRow | null
    : null;
  if (input.personaId && !existingById) {
    const err = new Error('Persona not found or not accessible.');
    (err as any).statusCode = 404;
    throw err;
  }
  const existingBySlug = !existingById
    ? await selectOne('personas', { user_id: userId, slug }) as PersonaRow | null
    : null;
  const personaId = existingById?.id || existingBySlug?.id || uuidv4();
  const now = new Date().toISOString();
  const row = {
    id: personaId,
    user_id: userId,
    name,
    slug,
    description: cleanLongText(input.description, 4000) || null,
    workflow_name: cleanText(input.workflowName || 'yapper', 80),
    project_workflow_key: cleanText(input.projectWorkflowKey || 'scripted_narrative', 80),
    preset_key: cleanText(input.presetKey || 'anime_default', 80),
    character_reference_asset_id: input.characterReferenceAssetId || null,
    style_asset_id: input.styleAssetId || null,
    voice_provider: input.voiceProvider ? cleanText(input.voiceProvider, 80) : null,
    voice_id: input.voiceId ? cleanText(input.voiceId, 240) : null,
    voice_name: input.voiceName ? cleanText(input.voiceName, 240) : null,
    tone_notes: cleanLongText(input.toneNotes, 12000) || null,
    topic_lane: cleanLongText(input.topicLane, 4000) || null,
    metadata: input.metadata || {},
    updated_at: now,
  };

  if (existingById || existingBySlug) {
    await updateRows('personas', { id: personaId, user_id: userId }, row);
  } else {
    await insertRow('personas', { ...row, created_at: now });
  }

  const saved = await selectOne('personas', { id: personaId, user_id: userId }) as PersonaRow;
  const assetsById = await loadAssetsForPersonas([saved]);
  return {
    kind: 'mirage.persona.saved',
    generatedAt: new Date().toISOString(),
    persona: personaSummary(saved, assetsById),
    note: 'Persona saved. Use create_project_from_persona with a topic to start a reusable Yapper-style project without re-uploading refs or re-entering voice IDs.',
  };
};

const resolvePersonaForDirector = async (userId: string, input: { personaId?: string | null; personaName?: string | null }) => {
  if (input.personaId) {
    const row = await selectOne('personas', { id: input.personaId, user_id: userId }) as PersonaRow | null;
    if (row) return row;
  }
  const name = cleanText(input.personaName, 160);
  if (name) {
    const slug = slugify(name);
    const rows = await selectAll('personas', { user_id: userId }, { orderBy: 'updated_at', ascending: false, limit: 250 }) as PersonaRow[];
    const match = rows.find((row) => row.slug === slug)
      || rows.find((row) => row.name.toLowerCase() === name.toLowerCase())
      || rows.find((row) => row.name.toLowerCase().includes(name.toLowerCase()));
    if (match) return match;
  }
  const err = new Error('Persona not found. Use list_personas or save_persona first.');
  (err as any).statusCode = 404;
  throw err;
};

const personaDirectorBrief = (persona: PersonaRow, topic: string, extra?: string | null) => {
  return [
    `Persona: ${persona.name}`,
    persona.topic_lane ? `Topic lane: ${persona.topic_lane}` : null,
    persona.tone_notes ? `Tone notes: ${persona.tone_notes}` : null,
    `Requested topic: ${topic}`,
    extra ? `Artist note: ${extra}` : null,
    'Write in this persona lane. Keep the Yapper format tight: vertical podcast monologue, one host, direct-to-camera, topic-aware, no re-explaining persona setup.',
  ].filter(Boolean).join('\n');
};

export const createProjectFromPersonaForDirector = async (userId: string, input: CreateProjectFromPersonaInput) => {
  const topic = cleanLongText(input.topic, 2000);
  if (!topic) throw new Error('topic is required.');
  const persona = await resolvePersonaForDirector(userId, input);
  const title = cleanText(input.title, 160) || `${persona.name} - ${topic.slice(0, 72)}`;

  const created = await createProjectForDirector(userId, {
    title,
    workflowKey: persona.project_workflow_key || 'scripted_narrative',
    presetKey: persona.preset_key || 'anime_default',
    seedKind: 'brief',
    directorBrief: personaDirectorBrief(persona, topic, input.directorBrief),
    targetRuntime: input.targetRuntime || null,
    targetShotDuration: input.targetShotDuration || null,
  });

  const characterAsset = await copyOwnedAssetIntoProject({
    userId,
    sourceAssetId: persona.character_reference_asset_id,
    projectId: created.projectId,
    category: 'character',
    personaId: persona.id,
  });
  const styleAsset = await copyOwnedAssetIntoProject({
    userId,
    sourceAssetId: persona.style_asset_id,
    projectId: created.projectId,
    category: 'style',
    personaId: persona.id,
  });

  if (styleAsset) {
    await updateRows('projects', { id: created.projectId }, {
      style_asset_id: styleAsset.id,
      status: 'style_locked',
    });
  }

  const castMemberId = uuidv4();
  await insertRow('cast_members', {
    id: castMemberId,
    project_id: created.projectId,
    name: persona.name,
    description: persona.description || persona.tone_notes || `Recurring Yapper persona for ${persona.name}.`,
    reference_asset_id: characterAsset?.id || null,
    sort_order: 0,
    prompts_stale: false,
    voice_provider: persona.voice_provider || null,
    voice_id: persona.voice_id || null,
    voice_name: persona.voice_name || null,
  });

  if (supportsPlatformColumns()) {
    const project = await selectOne('projects', { id: created.projectId });
    await updateRows('projects', { id: created.projectId }, {
      project_brief: {
        ...parseJson(project?.project_brief),
        persona: {
          id: persona.id,
          name: persona.name,
          slug: persona.slug,
          workflowName: persona.workflow_name || 'yapper',
          topic,
          toneNotes: persona.tone_notes || null,
          topicLane: persona.topic_lane || null,
        },
      },
      source_payload: {
        ...parseJson(project?.source_payload),
        persona: {
          id: persona.id,
          name: persona.name,
          slug: persona.slug,
          sourceCharacterAssetId: persona.character_reference_asset_id || null,
          sourceStyleAssetId: persona.style_asset_id || null,
          projectCharacterAssetId: characterAsset?.id || null,
          projectStyleAssetId: styleAsset?.id || null,
          castMemberId,
        },
        topic,
      },
    });
  }

  await recordDirectorEvent({
    projectId: created.projectId,
    userId,
    source: 'codex',
    eventType: 'project_created_from_persona',
    entityType: 'project',
    entityId: created.projectId,
    summary: `Created "${title}" from persona ${persona.name}.`,
    payload: {
      personaId: persona.id,
      workflowName: persona.workflow_name || 'yapper',
      topic,
      castMemberId,
      characterAssetId: characterAsset?.id || null,
      styleAssetId: styleAsset?.id || null,
      hasVoice: !!persona.voice_id,
    },
  });

  return {
    kind: 'mirage.project.created_from_persona',
    generatedAt: new Date().toISOString(),
    projectId: created.projectId,
    title,
    persona: personaSummary(persona, await loadAssetsForPersonas([persona])),
    seeded: {
      castMemberId,
      characterAssetId: characterAsset?.id || null,
      styleAssetId: styleAsset?.id || null,
      voiceAssigned: !!persona.voice_id,
    },
    workflowName: persona.workflow_name || 'yapper',
    webUrl: webStudioUrl(created.projectId, { step: 'blueprint' }),
    next: 'Open the project, apply the workflow recipe if not already applied, then write/apply the script from the persona brief and topic. No ref or voice re-setup is needed.',
  };
};
