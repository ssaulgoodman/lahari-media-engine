import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { getSB, T } from '../database.js';
import type { FullProjectCore } from '../routes/projects.js';
import { IMAGE_MODELS } from '../../constants/imageModels.js';
import { STORYBOARD_PROVIDERS } from '../../constants/storyboardProviders.js';
import { TEXT_PROVIDERS } from '../../constants/textProviders.js';
import { DEFAULT_ELEVENLABS_TTS_MODEL, ELEVENLABS_TTS_MODELS } from '../../constants/ttsModels.js';
import { VIDEO_MODELS } from '../../constants/videoModels.js';

// Match codexStudio/core.ts: derive from the core shape so the registry
// projection on getFullProject doesn't recurse into the type.
type Project = FullProjectCore;

export const PROJECT_PROMPT_OVERRIDE_KINDS = ['concept', 'script', 'shot_prompts', 'storyboard', 'video', 'character_looks', 'environment_looks', 'audio_plan'] as const;
export type ProjectPromptOverrideKind = typeof PROJECT_PROMPT_OVERRIDE_KINDS[number];
export type ProjectPromptScopeType = 'project' | 'scene' | 'shot';

export interface ProjectPromptScope {
  scopeType?: ProjectPromptScopeType;
  scopeId?: string | null;
}

export interface ProjectPreferences {
  textProvider?: string;
  imageModel?: string;
  storyboardProvider?: string;
  videoModel?: string;
  ttsModel?: string;
}

export interface ProjectPreferencesState {
  preferences: Required<ProjectPreferences>;
  storedPreferences: Record<string, unknown>;
  hash: string;
  warnings: string[];
  source: 'project_config' | 'project_row';
}

export const PROJECT_STYLE_NOTE_SECTIONS = ['image', 'storyboard', 'motion', 'script', 'dialogue', 'audio'] as const;
export type ProjectStyleNoteSection = typeof PROJECT_STYLE_NOTE_SECTIONS[number];

export type ProjectStyleNotes = Partial<Record<ProjectStyleNoteSection, string>> & {
  modelPhrases?: Record<string, string[]>;
};

export interface ProjectStyleNotesState {
  styleNotes: ProjectStyleNotes;
  storedStyleNotes: Record<string, unknown>;
  hash: string;
  warnings: string[];
  source: 'project_config' | 'empty';
}

export interface PromptOverrideState {
  kind: ProjectPromptOverrideKind;
  scopeType: ProjectPromptScopeType;
  scopeId: string | null;
  body: string;
  hash: string;
  source: 'project_override' | 'global';
  overrideId: string | null;
  updatedAt: string | null;
  active: boolean;
}

export interface ProjectConfigState {
  preferences: ProjectPreferencesState;
  styleNotes: ProjectStyleNotesState;
  prompts: Record<ProjectPromptOverrideKind, PromptOverrideState>;
}

const allowedTextProviders = new Set(TEXT_PROVIDERS.map((provider) => provider.key));
const allowedImageModels = new Set(IMAGE_MODELS.map((model) => model.key));
const allowedStoryboardProviders = new Set(STORYBOARD_PROVIDERS.map((provider) => provider.key));
const allowedVideoModels = new Set(VIDEO_MODELS.map((model) => model.key));
const allowedTtsModels = new Set(ELEVENLABS_TTS_MODELS);

export const hashText = (value: string): string => (
  createHash('sha256').update(value, 'utf8').digest('hex')
);

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
};

export const hashJson = (value: unknown): string => hashText(stableJson(value));

const isMissingConfigTableError = (error: unknown): boolean => {
  const anyError = error as any;
  const message = String(anyError?.message || error || '').toLowerCase();
  const code = String(anyError?.code || '');
  return code === '42P01'
    || code === 'PGRST205'
    || message.includes('lahari_project_config')
    || message.includes('lahari_project_prompt_overrides')
    || message.includes('style_notes')
    || message.includes('could not find the table');
};

const promptSeedBody = (kind: ProjectPromptOverrideKind): string => {
  if (kind === 'concept') {
    return [
      '# Project Concept Prompt Override',
      '',
      'No project concept override is active.',
      '',
      'When Codex applies one here, it should describe the reusable recipe for how concept directions should be written for this project.',
    ].join('\n');
  }
  if (kind === 'script') {
    return [
      '# Project Script Prompt Override',
      '',
      'No project script override is active.',
      '',
      'When Codex applies one here, it should describe the reusable recipe for how scenes, cast, environments, and shot beats should be planned for this project.',
    ].join('\n');
  }
  if (kind === 'shot_prompts') {
    return [
      '# Project Shot Prompts Override',
      '',
      'No project shot-prompts override is active.',
      '',
      'When Codex applies one here, it should describe the reusable recipe for how visual and motion prompts should be written for this project.',
    ].join('\n');
  }
  if (kind === 'storyboard') {
    return [
      '# Project Storyboard Prompt Override',
      '',
      'No project storyboard override is active.',
      '',
      'When Codex applies one here, it should describe the reusable recipe for how storyboard prompts should be written for this project. Per-shot prompt text still belongs on the shot itself.',
    ].join('\n');
  }
  if (kind === 'character_looks') {
    return [
      '# Project Character Looks Override',
      '',
      'No project character-looks override is active.',
      '',
      'When Codex applies one here, it should describe the reusable recipe for how character/entity look prompts should be written for this project. Per-character descriptions and prompts still belong on the cast entries.',
    ].join('\n');
  }
  if (kind === 'environment_looks') {
    return [
      '# Project Environment Looks Override',
      '',
      'No project environment-looks override is active.',
      '',
      'When Codex applies one here, it should describe the reusable recipe for how environment/location look prompts should be written for this project. Per-environment descriptions and prompts still belong on the environment entries.',
    ].join('\n');
  }
  if (kind === 'audio_plan') {
    return [
      '# Project Audio Plan Override',
      '',
      'No project audio-plan override is active.',
      '',
      'When Codex applies one here, it should describe the reusable recipe for how dialogue, narration, sound notes, and lipsync/overlay strategy should be written for this project. Per-shot audio plans still belong on the shots.',
    ].join('\n');
  }
  return [
    '# Project Video Prompt Override',
    '',
    'No project video override is active.',
    '',
    'When Codex applies one here, it should describe the reusable recipe for how video prompts should be assembled for this project. Per-shot video prompt text still belongs on the shot itself.',
  ].join('\n');
};

const projectField = (project: any, camelKey: string, snakeKey: string): string | undefined => (
  project?.[camelKey] || project?.[snakeKey] || undefined
);

const basePreferences = (project: Project): Required<ProjectPreferences> => ({
  textProvider: projectField(project, 'textProvider', 'text_provider') || TEXT_PROVIDERS[0].key,
  imageModel: projectField(project, 'imageModel', 'image_model') || IMAGE_MODELS[0].key,
  storyboardProvider: projectField(project, 'storyboardProvider', 'storyboard_provider') || STORYBOARD_PROVIDERS[0].key,
  videoModel: projectField(project, 'videoModel', 'video_model') || VIDEO_MODELS[0].key,
  ttsModel: DEFAULT_ELEVENLABS_TTS_MODEL,
});

const cleanPreferences = (
  input: unknown,
  base: Required<ProjectPreferences>,
): { preferences: Required<ProjectPreferences>; stored: Record<string, unknown>; warnings: string[] } => {
  const raw = (input && typeof input === 'object' && !Array.isArray(input))
    ? input as Record<string, unknown>
    : {};
  const warnings: string[] = [];
  const stored: Record<string, unknown> = {};
  const next: Required<ProjectPreferences> = { ...base };

  const assignKey = (
    key: keyof Required<ProjectPreferences>,
    allowed: Set<string>,
    label: string,
  ) => {
    const value = raw[key];
    if (value === undefined || value === null || value === '') return;
    if (typeof value !== 'string') {
      warnings.push(`${label} must be a string; using ${base[key]}.`);
      return;
    }
    if (!allowed.has(value)) {
      warnings.push(`Unknown ${label} "${value}"; using ${base[key]}.`);
      return;
    }
    next[key] = value;
    stored[key] = value;
  };

  assignKey('textProvider', allowedTextProviders, 'textProvider');
  assignKey('imageModel', allowedImageModels, 'imageModel');
  assignKey('storyboardProvider', allowedStoryboardProviders, 'storyboardProvider');
  assignKey('videoModel', allowedVideoModels, 'videoModel');
  assignKey('ttsModel', allowedTtsModels, 'ttsModel');

  return { preferences: next, stored, warnings };
};

const cleanStyleNotes = (input: unknown): { styleNotes: ProjectStyleNotes; stored: Record<string, unknown>; warnings: string[] } => {
  const raw = (input && typeof input === 'object' && !Array.isArray(input))
    ? input as Record<string, unknown>
    : {};
  const warnings: string[] = [];
  const stored: Record<string, unknown> = {};
  const next: ProjectStyleNotes = {};

  for (const section of PROJECT_STYLE_NOTE_SECTIONS) {
    const value = raw[section];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      warnings.push(`${section} style note must be a string; ignoring.`);
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.length > 5000) {
      warnings.push(`${section} style note was trimmed to 5000 characters.`);
      next[section] = trimmed.slice(0, 5000).trim();
      stored[section] = next[section];
      continue;
    }
    next[section] = trimmed;
    stored[section] = trimmed;
  }

  const modelPhrases = raw.modelPhrases;
  if (modelPhrases !== undefined && modelPhrases !== null) {
    if (!modelPhrases || typeof modelPhrases !== 'object' || Array.isArray(modelPhrases)) {
      warnings.push('modelPhrases must be an object keyed by model name; ignoring.');
    } else {
      const cleanedPhrases: Record<string, string[]> = {};
      for (const [modelKey, phrases] of Object.entries(modelPhrases as Record<string, unknown>)) {
        if (!Array.isArray(phrases)) {
          warnings.push(`modelPhrases.${modelKey} must be an array; ignoring.`);
          continue;
        }
        const cleaned = phrases
          .filter((phrase): phrase is string => typeof phrase === 'string')
          .map((phrase) => phrase.trim())
          .filter(Boolean)
          .slice(0, 20)
          .map((phrase) => phrase.slice(0, 500).trim());
        if (cleaned.length) cleanedPhrases[modelKey.slice(0, 120)] = cleaned;
      }
      if (Object.keys(cleanedPhrases).length) {
        next.modelPhrases = cleanedPhrases;
        stored.modelPhrases = cleanedPhrases;
      }
    }
  }

  return { styleNotes: next, stored, warnings };
};

export const formatSelectedStyleNotes = (
  styleNotes: ProjectStyleNotes | ProjectStyleNotesState | null | undefined,
  sections: ProjectStyleNoteSection[],
  opts: { modelKey?: string | null } = {},
): string => {
  const notes: ProjectStyleNotes | null | undefined = (
    styleNotes && typeof styleNotes === 'object' && 'hash' in styleNotes && 'styleNotes' in styleNotes
  )
    ? styleNotes.styleNotes
    : styleNotes as ProjectStyleNotes | null | undefined;
  if (!notes) return '';
  const lines: string[] = [];
  for (const sectionName of sections) {
    const value = notes[sectionName]?.trim();
    if (value) lines.push(`${sectionName} style note:\n${value}`);
  }
  const modelKey = opts.modelKey?.trim();
  const phrases = modelKey ? notes.modelPhrases?.[modelKey] : undefined;
  if (phrases?.length) {
    lines.push(`model phrases for ${modelKey}:\n${phrases.map((phrase) => `- ${phrase}`).join('\n')}`);
  }
  return lines.join('\n\n');
};

const normalizeScope = (scope: ProjectPromptScope = {}): Required<ProjectPromptScope> => ({
  scopeType: scope.scopeType || 'project',
  scopeId: scope.scopeType && scope.scopeType !== 'project' ? scope.scopeId ?? null : null,
});

const applyScopeFilter = (query: any, scopeType: ProjectPromptScopeType, scopeId: string | null) => {
  let scoped = query.eq('scope_type', scopeType);
  if (scopeId) scoped = scoped.eq('scope_id', scopeId);
  else scoped = scoped.is('scope_id', null);
  return scoped;
};

const activePromptOverrideRow = async (
  projectId: string,
  kind: ProjectPromptOverrideKind,
  scope: ProjectPromptScope = {},
): Promise<any | null> => {
  const normalized = normalizeScope(scope);
  try {
    let query = getSB()
      .from(T.project_prompt_overrides)
      .select('*')
      .eq('project_id', projectId)
      .eq('kind', kind)
      .eq('active', true);
    query = applyScopeFilter(query, normalized.scopeType, normalized.scopeId);
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (error) {
    if (isMissingConfigTableError(error)) return null;
    throw error;
  }
};

const inactivePromptOverrideRows = async (
  projectId: string,
  kind: ProjectPromptOverrideKind,
  scope: ProjectPromptScope = {},
): Promise<any[]> => {
  const normalized = normalizeScope(scope);
  let query = getSB()
    .from(T.project_prompt_overrides)
    .select('*')
    .eq('project_id', projectId)
    .eq('kind', kind)
    .eq('active', false);
  query = applyScopeFilter(query, normalized.scopeType, normalized.scopeId);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(5);
  if (error) throw error;
  return data || [];
};

export const getProjectPreferencesState = async (project: Project): Promise<ProjectPreferencesState> => {
  const base = basePreferences(project);
  try {
    const { data, error } = await getSB()
      .from(T.project_config)
      .select('preferences')
      .eq('project_id', project.id)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const { preferences, stored, warnings } = cleanPreferences(data?.preferences, base);
    return {
      preferences,
      storedPreferences: stored,
      hash: hashJson(preferences),
      warnings,
      source: data ? 'project_config' : 'project_row',
    };
  } catch (error) {
    if (!isMissingConfigTableError(error)) throw error;
    return {
      preferences: base,
      storedPreferences: {},
      hash: hashJson(base),
      warnings: ['Project config table is not available yet; using project row preferences.'],
      source: 'project_row',
    };
  }
};

export const getProjectStyleNotesState = async (project: Project): Promise<ProjectStyleNotesState> => {
  try {
    const { data, error } = await getSB()
      .from(T.project_config)
      .select('style_notes')
      .eq('project_id', project.id)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const { styleNotes, stored, warnings } = cleanStyleNotes(data?.style_notes);
    return {
      styleNotes,
      storedStyleNotes: stored,
      hash: hashJson(styleNotes),
      warnings,
      source: data ? 'project_config' : 'empty',
    };
  } catch (error) {
    if (!isMissingConfigTableError(error)) throw error;
    const empty = {};
    return {
      styleNotes: empty,
      storedStyleNotes: {},
      hash: hashJson(empty),
      warnings: ['Project config style_notes is not available yet; using empty style notes.'],
      source: 'empty',
    };
  }
};

export const getPromptOverrideState = async (
  projectId: string,
  kind: ProjectPromptOverrideKind,
  scope: ProjectPromptScope = {},
): Promise<PromptOverrideState> => {
  const normalized = normalizeScope(scope);
  const row = await activePromptOverrideRow(projectId, kind, normalized);
  const body = row?.body ?? promptSeedBody(kind);
  return {
    kind,
    scopeType: normalized.scopeType,
    scopeId: normalized.scopeId,
    body,
    hash: hashText(body),
    source: row ? 'project_override' : 'global',
    overrideId: row?.id ?? null,
    updatedAt: row?.updated_at ?? null,
    active: !!row,
  };
};

export const getProjectPromptOverride = async (
  projectId: string,
  kind: ProjectPromptOverrideKind,
  scope: ProjectPromptScope = {},
): Promise<string | null> => {
  const state = await getPromptOverrideState(projectId, kind, scope);
  return state.source === 'project_override' ? state.body : null;
};

export const getProjectConfigState = async (project: Project): Promise<ProjectConfigState> => ({
  preferences: await getProjectPreferencesState(project),
  styleNotes: await getProjectStyleNotesState(project),
  prompts: Object.fromEntries(await Promise.all(PROJECT_PROMPT_OVERRIDE_KINDS.map(async (kind) => [
    kind,
    await getPromptOverrideState(project.id, kind),
  ]))) as Record<ProjectPromptOverrideKind, PromptOverrideState>,
});

const ensureConfigDir = (projectDir: string): string => {
  const configDir = path.join(projectDir, 'config');
  fs.mkdirSync(path.join(configDir, 'prompts'), { recursive: true });
  return configDir;
};

export const writeProjectConfigDeskCopy = async (
  project: Project,
  projectDir: string,
): Promise<{
  configDir: string;
  preferencesPath: string;
  styleNotesPath: string;
  promptPaths: Record<ProjectPromptOverrideKind, string>;
  hashesPath: string;
  state: ProjectConfigState;
}> => {
  const state = await getProjectConfigState(project);
  const configDir = ensureConfigDir(projectDir);
  const preferencesPath = path.join(configDir, 'preferences.json');
  const styleNotesPath = path.join(configDir, 'style-notes.json');
  const promptPaths = Object.fromEntries(PROJECT_PROMPT_OVERRIDE_KINDS.map((kind) => [
    kind,
    path.join(configDir, 'prompts', `${kind}.md`),
  ])) as Record<ProjectPromptOverrideKind, string>;
  const hashesPath = path.join(configDir, 'hashes.json');

  fs.writeFileSync(preferencesPath, `${JSON.stringify(state.preferences.preferences, null, 2)}\n`);
  fs.writeFileSync(styleNotesPath, `${JSON.stringify(state.styleNotes.styleNotes, null, 2)}\n`);
  for (const kind of PROJECT_PROMPT_OVERRIDE_KINDS) {
    const body = state.prompts[kind].body;
    fs.writeFileSync(promptPaths[kind], body.endsWith('\n') ? body : `${body}\n`);
  }
  fs.writeFileSync(hashesPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    preferences: {
      hash: state.preferences.hash,
      source: state.preferences.source,
    },
    styleNotes: {
      hash: state.styleNotes.hash,
      source: state.styleNotes.source,
    },
    prompts: Object.fromEntries(PROJECT_PROMPT_OVERRIDE_KINDS.map((kind) => [
      kind,
      {
        hash: state.prompts[kind].hash,
        source: state.prompts[kind].source,
        overrideId: state.prompts[kind].overrideId,
      },
    ])),
  }, null, 2)}\n`);

  return {
    configDir,
    preferencesPath,
    styleNotesPath,
    promptPaths,
    hashesPath,
    state,
  };
};

const driftError = (message: string, currentHash: string, baseHash?: string): Error => {
  const error = new Error(message) as Error & { code?: string; currentHash?: string; baseHash?: string };
  error.code = 'config_drift';
  error.currentHash = currentHash;
  error.baseHash = baseHash;
  return error;
};

export const applyProjectPreferences = async (
  project: Project,
  preferencesInput: unknown,
  baseHash?: string | null,
): Promise<ProjectPreferencesState> => {
  const current = await getProjectPreferencesState(project);
  if (baseHash && baseHash !== current.hash) {
    throw driftError('Project preferences changed since this desk copy was written. Re-attach or refresh config before applying.', current.hash, baseHash);
  }
  const cleaned = cleanPreferences(preferencesInput, basePreferences(project));
  const nextStored = { ...current.storedPreferences, ...cleaned.stored };
  const { error } = await getSB()
    .from(T.project_config)
    .upsert({
      project_id: project.id,
      preferences: nextStored,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' });
  if (error) throw new Error(`DB upsert project_config: ${error.message}`);
  return getProjectPreferencesState(project);
};

export const applyProjectStyleNotes = async (
  project: Project,
  styleNotesInput: unknown,
  baseHash?: string | null,
): Promise<ProjectStyleNotesState> => {
  const current = await getProjectStyleNotesState(project);
  if (baseHash && baseHash !== current.hash) {
    throw driftError('Project style notes changed since this desk copy was written. Re-attach or refresh config before applying.', current.hash, baseHash);
  }
  const cleaned = cleanStyleNotes(styleNotesInput);
  const { error } = await getSB()
    .from(T.project_config)
    .upsert({
      project_id: project.id,
      style_notes: cleaned.stored,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' });
  if (error) throw new Error(`DB upsert project_config style_notes: ${error.message}`);
  return getProjectStyleNotesState(project);
};

const deactivateActivePromptRows = async (
  projectId: string,
  kind: ProjectPromptOverrideKind,
  scope: Required<ProjectPromptScope>,
): Promise<void> => {
  let query = getSB()
    .from(T.project_prompt_overrides)
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('kind', kind)
    .eq('active', true);
  query = applyScopeFilter(query, scope.scopeType, scope.scopeId);
  const { error } = await query;
  if (error) throw new Error(`DB deactivate project_prompt_overrides: ${error.message}`);
};

export const applyProjectPromptOverride = async (
  projectId: string,
  kind: ProjectPromptOverrideKind,
  body: string,
  baseHash?: string | null,
  scope: ProjectPromptScope = {},
  metadata: Record<string, unknown> = {},
): Promise<PromptOverrideState> => {
  const normalized = normalizeScope(scope);
  const current = await getPromptOverrideState(projectId, kind, normalized);
  if (baseHash && baseHash !== current.hash) {
    throw driftError(`Project ${kind} prompt override changed since this desk copy was written. Re-attach or refresh config before applying.`, current.hash, baseHash);
  }
  const nextBody = body.trim();
  if (!nextBody) throw new Error('Prompt override body cannot be empty. Use revert_project_prompt_override to fall back to global.');
  await deactivateActivePromptRows(projectId, kind, normalized);
  const { error } = await getSB()
    .from(T.project_prompt_overrides)
    .insert({
      project_id: projectId,
      kind,
      scope_type: normalized.scopeType,
      scope_id: normalized.scopeId,
      body: nextBody,
      metadata,
      active: true,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`DB insert project_prompt_overrides: ${error.message}`);
  return getPromptOverrideState(projectId, kind, normalized);
};

export const revertProjectPromptOverride = async (
  projectId: string,
  kind: ProjectPromptOverrideKind,
  baseHash?: string | null,
  scope: ProjectPromptScope = {},
): Promise<PromptOverrideState> => {
  const normalized = normalizeScope(scope);
  const current = await getPromptOverrideState(projectId, kind, normalized);
  if (baseHash && baseHash !== current.hash) {
    throw driftError(`Project ${kind} prompt override changed since this desk copy was written. Re-attach or refresh config before reverting.`, current.hash, baseHash);
  }
  await deactivateActivePromptRows(projectId, kind, normalized);
  const previousRows = await inactivePromptOverrideRows(projectId, kind, normalized);
  const previous = previousRows.find((row) => row.id !== current.overrideId);
  if (previous) {
    const { error } = await getSB()
      .from(T.project_prompt_overrides)
      .update({ active: true, updated_at: new Date().toISOString() })
      .eq('id', previous.id);
    if (error) throw new Error(`DB reactivate project_prompt_overrides: ${error.message}`);
  }
  return getPromptOverrideState(projectId, kind, normalized);
};
