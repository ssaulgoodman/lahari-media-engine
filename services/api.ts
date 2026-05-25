/**
 * Frontend API client — replaces direct Gemini SDK calls.
 * All AI work now happens on the server; this just makes HTTP calls.
 */
import { supabase } from '../lib/supabase';

const API = '/api';

/** Get current auth token, or empty string if not signed in. */
const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
};

/** Fetch with auth headers injected. */
const authFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const headers = { ...await getAuthHeaders(), ...(init?.headers || {}) };
  return fetch(url, { ...init, headers });
};

const handleResponse = async (res: Response) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error?.message || body.error || `Request failed: ${res.status}`);
  }
  return res.json();
};

// Thrown when the caller aborts via AbortController. Lets handlers distinguish
// "user cancelled" from real errors and avoid showing a failure toast.
export const isCancelled = (err: any) =>
  err?.name === 'AbortError' || err?.code === 20 || /abort/i.test(err?.message || '');

// ─── Projects ───────────────────────────────────────────────────────

export const listProjects = async () => {
  const res = await authFetch(`${API}/projects`);
  return handleResponse(res);
};

export const getProject = async (id: string) => {
  const res = await authFetch(`${API}/projects/${id}`);
  return handleResponse(res);
};

export const createProject = async (
  audioFile: File,
  metadata?: { title?: string; context?: string; language?: string }
) => {
  const form = new FormData();
  form.append('audio', audioFile);
  if (metadata?.title) form.append('title', metadata.title);
  if (metadata?.context) form.append('context', metadata.context);
  if (metadata?.language) form.append('language', metadata.language);

  const res = await authFetch(`${API}/projects`, { method: 'POST', body: form });
  return handleResponse(res);
};

export const updateProject = async (id: string, updates: Record<string, any>) => {
  const res = await authFetch(`${API}/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};

export const deleteProject = async (id: string) => {
  const res = await authFetch(`${API}/projects/${id}`, { method: 'DELETE' });
  return handleResponse(res);
};

// ─── MCP Tokens ─────────────────────────────────────────────────────

export const listMcpTokens = async () => {
  const res = await authFetch(`${API}/mcp-tokens`);
  const body = await handleResponse(res);
  return body.data;
};

export const createMcpToken = async (opts?: { label?: string; expiresInDays?: number }) => {
  const res = await authFetch(`${API}/mcp-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts || {}),
  });
  const body = await handleResponse(res);
  return body.data;
};

export const revokeMcpToken = async (tokenId: string) => {
  const res = await authFetch(`${API}/mcp-tokens/${tokenId}`, { method: 'DELETE' });
  const body = await handleResponse(res);
  return body.data;
};

export const analyzeAudio = async (id: string, opts?: { fork?: boolean }, signal?: AbortSignal) => {
  const res = await authFetch(`${API}/projects/${id}/analyze-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts || {}),
    signal,
  });
  return handleResponse(res);
};

// ─── Concept Generation & Lock-in ───────────────────────────────────

export const generateConcepts = async (
  projectId: string,
  opts?: { lyrics?: string; context?: string; language?: string; userNote?: string; directorBrief?: string },
  signal?: AbortSignal
) => {
  const res = await authFetch(`${API}/projects/${projectId}/generate-concepts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts || {}),
    signal,
  });
  return handleResponse(res);
};

export const lockConcept = async (projectId: string, conceptIndex: number, opts?: { fork?: boolean }) => {
  const res = await authFetch(`${API}/projects/${projectId}/lock-concept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conceptIndex, ...(opts || {}) })
  });
  return handleResponse(res);
};

export const unlockConcept = async (projectId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/unlock-concept`, { method: 'POST' });
  return handleResponse(res);
};

export const refineConcept = async (projectId: string, feedback: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/refine-concept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
  return handleResponse(res);
};

export const updateConcept = async (projectId: string, updates: Record<string, any>) => {
  const res = await authFetch(`${API}/projects/${projectId}/concept`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return handleResponse(res);
};

export const forkProject = async (projectId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/fork`, { method: 'POST' });
  return handleResponse(res);
};

// ─── Style Generation & Lock ────────────────────────────────────────

export const generateStyles = async (projectId: string, notes?: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/generate-styles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes })
  });
  return handleResponse(res);
};

export const brainstormStyles = async (projectId: string, userNotes?: string, signal?: AbortSignal) => {
  const res = await authFetch(`${API}/projects/${projectId}/brainstorm-styles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userNotes }),
    signal,
  });
  return handleResponse(res);
};

export const visualizeStyle = async (projectId: string, prompt: string, signal?: AbortSignal) => {
  const res = await authFetch(`${API}/projects/${projectId}/visualize-style`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal,
  });
  return handleResponse(res);
};

export const refineStyleDirection = async (projectId: string, description: string, feedback: string, signal?: AbortSignal) => {
  const res = await authFetch(`${API}/projects/${projectId}/refine-style-direction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, feedback }),
    signal,
  });
  return handleResponse(res);
};

export const getStylePresets = async (projectId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/style-presets`);
  return handleResponse(res);
};

/** Lock a curated preset directly as the project style. No visualization step —
 *  the preset IS the style image. Backend points a new project-scoped asset row
 *  at the preset's shared file_path (same pattern forks use) and runs the
 *  standard /lock-style downstream-stale logic. style_description is set to
 *  empty server-side so prose can't leak into the concept-regen hint path.
 *  Returns the full updated project. */
export const lockStylePreset = async (
  projectId: string,
  presetKey: string,
  opts?: { signal?: AbortSignal }
) => {
  const res = await authFetch(`${API}/projects/${projectId}/lock-style-preset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetKey }),
    signal: opts?.signal,
  });
  return handleResponse(res);
};

// Unlocks are pure nav — no body, no options. Destructive events live on
// the active mutation endpoints (lock-concept, generate-script, etc).
const simplePost = (path: string) => authFetch(`${API}${path}`, { method: 'POST' }).then(handleResponse);
export const unlockStyle = (projectId: string) => simplePost(`/projects/${projectId}/unlock-style`);
export const unlockScript = (projectId: string) => simplePost(`/projects/${projectId}/unlock-script`);
export const unlockCharacters = (projectId: string) => simplePost(`/projects/${projectId}/unlock-characters`);
export const unlockEnvironments = (projectId: string) => simplePost(`/projects/${projectId}/unlock-environments`);

export const lockStyle = async (projectId: string, assetId: string, styleDescription?: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/lock-style`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, styleDescription })
  });
  return handleResponse(res);
};

export const analyzeStyleImage = async (projectId: string, imageFile: File) => {
  const form = new FormData();
  form.append('image', imageFile);
  const res = await authFetch(`${API}/projects/${projectId}/analyze-style-image`, {
    method: 'POST',
    body: form
  });
  return handleResponse(res);
};

export const uploadAndLockStyle = async (projectId: string, imageFile: File) => {
  const form = new FormData();
  form.append('image', imageFile);
  const res = await authFetch(`${API}/projects/${projectId}/upload-and-lock-style`, {
    method: 'POST',
    body: form
  });
  return handleResponse(res);
};

// ─── Character Look Generation & Lock ───────────────────────────────

export const generateLooks = async (
  projectId: string,
  castMemberId: string,
  feedback?: string,
  signal?: AbortSignal,
  refImage?: File,
) => {
  // With a director-supplied reference image, use multipart so the server
  // can ingest the file alongside Claude's text-derived character brief.
  if (refImage) {
    const form = new FormData();
    form.append('image', refImage);
    form.append('castMemberId', castMemberId);
    if (feedback) form.append('feedback', feedback);
    const res = await authFetch(`${API}/projects/${projectId}/generate-looks`, {
      method: 'POST',
      body: form,
      signal,
    });
    return handleResponse(res);
  }
  const res = await authFetch(`${API}/projects/${projectId}/generate-looks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ castMemberId, feedback }),
    signal,
  });
  return handleResponse(res);
};

export const uploadCharacterReference = async (projectId: string, castMemberId: string, imageFile: File) => {
  const form = new FormData();
  form.append('image', imageFile);
  form.append('castMemberId', castMemberId);
  const res = await authFetch(`${API}/projects/${projectId}/upload-character-reference`, { method: 'POST', body: form });
  return handleResponse(res);
};

export const uploadEnvironmentReference = async (projectId: string, environmentId: string, imageFile: File) => {
  const form = new FormData();
  form.append('image', imageFile);
  form.append('environmentId', environmentId);
  const res = await authFetch(`${API}/projects/${projectId}/upload-environment-reference`, { method: 'POST', body: form });
  return handleResponse(res);
};

export const lockCharacter = async (projectId: string, castMemberId: string, assetId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/lock-character`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ castMemberId, assetId })
  });
  return handleResponse(res);
};

export const getCandidates = async (projectId: string, entityType: 'character' | 'environment', entityId: string): Promise<{ id: string; url: string }[]> => {
  const res = await authFetch(`${API}/projects/${projectId}/candidates/${entityType}/${entityId}`);
  const data = await handleResponse(res);
  return data.candidates || [];
};

export const unlockCharacterLook = async (projectId: string, castMemberId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/unlock-character-look`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ castMemberId })
  });
  return handleResponse(res);
};

// ─── Cast Management ────────────────────────────────────────────────

export const addCastMember = async (projectId: string, name: string, description: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/cast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  });
  return handleResponse(res);
};

export const updateCastMember = async (projectId: string, memberId: string, updates: { name?: string; description?: string; generationPrompt?: string }) => {
  const res = await authFetch(`${API}/projects/${projectId}/cast/${memberId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};

export const deleteCastMember = async (projectId: string, memberId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/cast/${memberId}`, { method: 'DELETE' });
  return handleResponse(res);
};

// ─── Environment Management ─────────────────────────────────────────

export const addEnvironment = async (projectId: string, name: string, description: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/environments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  });
  return handleResponse(res);
};

export const updateEnvironment = async (projectId: string, envId: string, updates: { name?: string; description?: string; generationPrompt?: string }) => {
  const res = await authFetch(`${API}/projects/${projectId}/environments/${envId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};

export const deleteEnvironment = async (projectId: string, envId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/environments/${envId}`, { method: 'DELETE' });
  return handleResponse(res);
};

export const generateEnvironmentLook = async (
  projectId: string,
  environmentId: string,
  signal?: AbortSignal,
  refImage?: File,
  note?: string,
) => {
  if (refImage) {
    const form = new FormData();
    form.append('image', refImage);
    form.append('environmentId', environmentId);
    if (note) form.append('note', note);
    const res = await authFetch(`${API}/projects/${projectId}/generate-environment-look`, {
      method: 'POST',
      body: form,
      signal,
    });
    return handleResponse(res);
  }
  const res = await authFetch(`${API}/projects/${projectId}/generate-environment-look`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environmentId, ...(note && { note }) }),
    signal,
  });
  return handleResponse(res);
};

export const lockEnvironment = async (projectId: string, environmentId: string, assetId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/lock-environment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environmentId, assetId })
  });
  return handleResponse(res);
};

export const unlockEnvironmentLook = async (projectId: string, environmentId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/unlock-environment-look`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environmentId })
  });
  return handleResponse(res);
};

// ─── Phase Advancement ──────────────────────────────────────────────

export const advanceCharacters = async (projectId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/advance-characters`, { method: 'POST' });
  return handleResponse(res);
};

export const advanceEnvironments = async (projectId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/advance-environments`, { method: 'POST' });
  return handleResponse(res);
};

// ─── Script Generation ──────────────────────────────────────────────

export const updateScene = async (projectId: string, sceneId: string, updates: { narrativeDescription?: string }) => {
  const res = await authFetch(`${API}/projects/${projectId}/scenes/${sceneId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return handleResponse(res);
};

export const refineScript = async (projectId: string, feedback: string, signal?: AbortSignal) => {
  const res = await authFetch(`${API}/projects/${projectId}/refine-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
    signal,
  });
  return handleResponse(res);
};

export const generateScript = async (projectId: string, userNote?: string, opts?: { fork?: boolean; scriptProvider?: 'claude' | 'openai' }, signal?: AbortSignal) => {
  const body: Record<string, any> = {};
  if (userNote) body.userNote = userNote;
  if (opts?.fork) body.fork = true;
  if (opts?.scriptProvider) body.scriptProvider = opts.scriptProvider;
  const res = await authFetch(`${API}/projects/${projectId}/generate-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return handleResponse(res);
};

export const writeShotPrompts = async (projectId: string, userNote?: string, signal?: AbortSignal) => {
  const res = await authFetch(`${API}/projects/${projectId}/write-shot-prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userNote ? { userNote } : {}),
    signal,
  });
  return handleResponse(res);
};

// ─── Shot Storyboards ──────────────────────────────────────────────

export type StoryboardVersionEntry = {
  id: string;
  assetId: string;
  imageUrl?: string;
  parentVersionId?: string;
  artistNote?: string;
  openaiResponseId?: string;
  reasoningModel?: string;
  imageModel?: string;
  cutPlanText?: string;
  continuityNotes?: string;
  locked: boolean;
  createdAt: string;
};

export const writeStoryboardPrompt = async (
  projectId: string,
  shotId: string,
  feedback?: string,
  signal?: AbortSignal
) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/write-storyboard-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant: 'adaptive_numbered_storyboard', ...(feedback ? { feedback } : {}) }),
    signal,
  });
  return handleResponse(res);
};

export const generateStoryboard = async (projectId: string, shotId: string, signal?: AbortSignal) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/generate-storyboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant: 'adaptive_numbered_storyboard' }),
    signal,
  });
  return handleResponse(res);
};

export type StoryboardRefineMode = 'replan' | 'edit_image';

export const refineStoryboard = async (
  projectId: string,
  shotId: string,
  feedback: string,
  previousVersionId?: string,
  refineMode: StoryboardRefineMode = 'replan',
  referenceImage?: File,
  signal?: AbortSignal
) => {
  if (referenceImage) {
    const form = new FormData();
    form.append('feedback', feedback);
    form.append('refineMode', refineMode);
    form.append('variant', 'adaptive_numbered_storyboard');
    if (previousVersionId) form.append('previousVersionId', previousVersionId);
    form.append('referenceImage', referenceImage);
    const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/refine-storyboard`, {
      method: 'POST',
      body: form,
      signal,
    });
    return handleResponse(res);
  }

  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/refine-storyboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback, previousVersionId, refineMode, variant: 'adaptive_numbered_storyboard' }),
    signal,
  });
  return handleResponse(res);
};

export const lockStoryboard = async (projectId: string, shotId: string, versionId?: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/lock-storyboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(versionId ? { versionId } : {}),
  });
  return handleResponse(res);
};

export const unlockStoryboard = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/unlock-storyboard`, { method: 'POST' });
  return handleResponse(res);
};

export const updateStoryboardPlan = async (projectId: string, shotId: string, cutPlanText: string, storyboardPrompt?: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/storyboard-plan`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cutPlanText, ...(storyboardPrompt !== undefined ? { storyboardPrompt } : {}) }),
  });
  return handleResponse(res);
};

export const getStoryboardHistory = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/storyboard-history`);
  return handleResponse(res) as Promise<{ versions: StoryboardVersionEntry[] }>;
};

// ─── Shot Image & Video ─────────────────────────────────────────────

export const refineShotPrompt = async (projectId: string, shotId: string, feedback: string, referenceImage?: File, signal?: AbortSignal) => {
  if (referenceImage) {
    const form = new FormData();
    form.append('feedback', feedback);
    form.append('referenceImage', referenceImage);
    const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/refine-prompt`, {
      method: 'POST',
      body: form,
      signal,
    });
    return handleResponse(res);
  }
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/refine-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
    signal,
  });
  return handleResponse(res);
};

export type ShotRefInput = { type: 'cast' | 'env' | 'style' | 'start-frame' | 'end-frame' | 'continuity' | 'uploaded'; id?: string };

export const generateShotImage = async (projectId: string, shotId: string, refs?: ShotRefInput[], signal?: AbortSignal) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refs ? { refs } : {}),
    signal,
  });
  return handleResponse(res);
};

export const usePrevLastFrame = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/use-prev-last-frame`, { method: 'POST' });
  return handleResponse(res);
};

export const clearShotFrame = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/clear-frame`, { method: 'POST' });
  return handleResponse(res);
};

export const cancelShotImage = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/cancel-image`, { method: 'POST' });
  return handleResponse(res);
};

export const cancelShotVideo = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/cancel-video`, { method: 'POST' });
  return handleResponse(res);
};

export const generateEndFrame = async (projectId: string, shotId: string, refs?: ShotRefInput[]) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/generate-end-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refs ? { refs } : {}),
  });
  return handleResponse(res);
};

export const refineEndFramePrompt = async (projectId: string, shotId: string, feedback: string, referenceImage?: File) => {
  if (referenceImage) {
    const form = new FormData();
    form.append('feedback', feedback);
    form.append('referenceImage', referenceImage);
    const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/refine-end-frame-prompt`, { method: 'POST', body: form });
    return handleResponse(res);
  }
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/refine-end-frame-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
  return handleResponse(res);
};

export const clearEndFrame = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/clear-end-frame`, { method: 'POST' });
  return handleResponse(res);
};

export const clearExtractedFrame = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/clear-extracted-frame`, { method: 'POST' });
  return handleResponse(res);
};

export const uploadEndFrame = async (projectId: string, shotId: string, file: File) => {
  const form = new FormData();
  form.append('image', file);
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/upload-end-frame`, { method: 'POST', body: form });
  return handleResponse(res);
};

export const uploadShotRef = async (projectId: string, shotId: string, file: File): Promise<{ ok: true; ref: { id: string; url: string } }> => {
  const form = new FormData();
  form.append('image', file);
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/upload-ref`, { method: 'POST', body: form });
  return handleResponse(res);
};

export const deleteShotRef = async (projectId: string, shotId: string, assetId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/delete-ref`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  });
  return handleResponse(res);
};

export const splitShot = async (projectId: string, shotId: string, splitAt?: number) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(splitAt ? { splitAt } : {}),
  });
  return handleResponse(res);
};

export const lockAllSceneShots = async (projectId: string, sceneId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/scenes/${sceneId}/lock-all`, { method: 'POST' });
  return handleResponse(res);
};

export const unlockAllSceneShots = async (projectId: string, sceneId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/scenes/${sceneId}/unlock-all`, { method: 'POST' });
  return handleResponse(res);
};

export const generateShotVideo = async (projectId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[], signal?: AbortSignal) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(promptOverride ? { promptOverride } : {}), ...(refs ? { refs } : {}) }),
    signal,
  });
  return handleResponse(res);
};

export const useShotAsPrevEnd = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/use-as-prev-end`, { method: 'POST' });
  return handleResponse(res);
};

export type VersionEntry = { assetId: string; url: string; createdAt: string; isCurrent: boolean; thumbnailUrl?: string | null };
export type MediaLibraryUpload = {
  assetId: string;
  url: string;
  createdAt: string;
  name: string;
  source?: 'upload' | 'generated' | string;
  mimeType?: string | null;
  bytes?: number | null;
  brief?: string | null;
  durationSec?: number | null;
  model?: string | null;
};

export const getShotHistory = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/history`);
  return handleResponse(res) as Promise<{ firstFrame: VersionEntry[]; lastFrame: VersionEntry[]; video: VersionEntry[] }>;
};

export const hideShotVideoFromMediaLibrary = async (projectId: string, shotId: string, assetId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/assets/${assetId}/hide-from-media-library`, {
    method: 'POST',
  });
  return handleResponse(res) as Promise<{ ok: true }>;
};

export const listMediaLibraryUploads = async (projectId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/media-library/uploads`);
  return handleResponse(res) as Promise<{ uploads: MediaLibraryUpload[] }>;
};

export const uploadMediaLibraryVideo = async (projectId: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  const res = await authFetch(`${API}/projects/${projectId}/media-library/uploads`, {
    method: 'POST',
    body: form,
  });
  return handleResponse(res) as Promise<{ upload: MediaLibraryUpload }>;
};

export const generateMediaLibraryClip = async (
  projectId: string,
  input: {
    title?: string;
    brief: string;
    durationSec?: number;
    useProjectRefs?: boolean;
    modelOverride?: { videoModel?: string };
  },
) => {
  const res = await authFetch(`${API}/projects/${projectId}/media-library/clips/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse(res) as Promise<{
    clip: MediaLibraryUpload;
    estimatedCost: number;
    note: string;
  }>;
};

export const hideMediaLibraryUpload = async (projectId: string, assetId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/media-library/uploads/${assetId}/hide`, {
    method: 'POST',
  });
  return handleResponse(res) as Promise<{ ok: true }>;
};

export const revertShotFrame = async (projectId: string, shotId: string, assetId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/revert-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId })
  });
  return handleResponse(res);
};

export const revertShotEndFrame = async (projectId: string, shotId: string, assetId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/revert-end-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId })
  });
  return handleResponse(res);
};

export const refineVideoPrompt = async (projectId: string, shotId: string, feedback: string, referenceImage?: File) => {
  if (referenceImage) {
    const form = new FormData();
    form.append('feedback', feedback);
    form.append('referenceImage', referenceImage);
    const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/refine-video-prompt`, { method: 'POST', body: form });
    return handleResponse(res);
  }
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/refine-video-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
  return handleResponse(res);
};

// Legacy — kept for backward compat, delegates to unified endpoint
export const getShotVideoHistory = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/video-history`);
  return handleResponse(res) as Promise<{ versions: Array<{ assetId: string; videoUrl: string; thumbnailUrl: string | null; createdAt: string; isCurrent: boolean }> }>;
};

export const revertShotVideo = async (projectId: string, shotId: string, assetId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/revert-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId })
  });
  return handleResponse(res);
};

export const updateShot = async (projectId: string, shotId: string, updates: Record<string, any>) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};

export const lockShot = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/lock`, { method: 'POST' });
  return handleResponse(res);
};

export const unlockShot = async (projectId: string, shotId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/shots/${shotId}/unlock`, { method: 'POST' });
  return handleResponse(res);
};

// ─── X-Ray ──────────────────────────────────────────────────────────

export const getXRayCalls = async (projectId: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/xray`);
  return handleResponse(res);
};

// ─── Chat ───────────────────────────────────────────────────────────

export const sendChatMessage = async (projectId: string, message: string) => {
  const res = await authFetch(`${API}/projects/${projectId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  return handleResponse(res);
};

// ─── Music Video Queue ────────────────────────────────────────────

export const listQueue = async (filters?: { status?: string; deity?: string }) => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.deity) params.set('deity', filters.deity);
  const res = await authFetch(`${API}/queue?${params}`);
  return handleResponse(res);
};

export const getQueueDeities = async (): Promise<string[]> => {
  const res = await authFetch(`${API}/queue/deities`);
  return handleResponse(res);
};

export const startProduction = async (queueId: string) => {
  const res = await authFetch(`${API}/queue/${queueId}/start`, { method: 'POST' });
  return handleResponse(res);
};

export const updateQueueItem = async (queueId: string, updates: Record<string, any>) => {
  const res = await authFetch(`${API}/queue/${queueId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};

/** Set or clear the current user's mnemonic note for a song on the queue
 *  dashboard. Pass empty/whitespace to clear. Server enforces a 200-char
 *  cap and per-user scoping (you can never write someone else's note). */
export const setSongNote = async (songId: string, note: string): Promise<{ note: string | null }> => {
  const res = await authFetch(`${API}/queue/notes/${songId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  return handleResponse(res);
};

// ─── Remotion Renderer ──────────────────────────────────────────────

// Render-authoritative subset of the timeline editor's zustand store. Pass
// exactly this shape from useStore.getState() — UI fields (scale, scroll,
// activeIds, playerRef, stateManager) MUST be dropped client-side.
export interface TimelineRenderState {
  trackItemIds: string[];
  trackItemsMap: Record<string, any>;
  transitionsMap: Record<string, any>;
  fps: number;
  size: { width: number; height: number };
  durationMs: number;
}

export type RenderStatus = 'idle' | 'rendering' | 'pending_finalize' | 'completed' | 'failed';

export interface RenderStatusResponse {
  renderId: string | null;
  status: RenderStatus;
  videoUrl: string | null;
  error: string | null;
  errorCode: string | null;
  renderMs: number | null;
  progress: number | null;
  stage: string | null;
  lastHeartbeatAt: string | null;
  modalFunctionCallId: string | null;
  renderEngine: string | null;
  ffmpegFallbackReason: string | null;
}

// Kicks off an async render. Backend returns 202 immediately with a renderId;
// the real result lands later via the renderer's callback. Poll
// getRenderStatus() until status is 'completed' or 'failed'.
export const startRender = async (
  projectId: string,
  timeline: TimelineRenderState,
  signal?: AbortSignal,
): Promise<{ renderId: string; status: 'rendering' }> => {
  const res = await authFetch(`${API}/projects/${projectId}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeline }),
    signal,
  });
  return handleResponse(res);
};

export const getRenderStatus = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<RenderStatusResponse> => {
  const res = await authFetch(`${API}/projects/${projectId}/render-status`, { signal });
  return handleResponse(res);
};

// ─── Render history ────────────────────────────────────────────────

export interface RenderHistoryItem {
  assetId: string;
  videoUrl: string;
  storagePath: string;
  createdAt: string;
  isCurrent: boolean;
}

export const listRenders = async (
  projectId: string,
): Promise<{ renders: RenderHistoryItem[] }> => {
  const res = await authFetch(`${API}/projects/${projectId}/renders`);
  return handleResponse(res);
};

export const deleteRender = async (
  projectId: string,
  assetId: string,
): Promise<{ ok: true; clearedQueueVideoUrl: boolean }> => {
  const res = await authFetch(`${API}/projects/${projectId}/renders/${assetId}`, {
    method: 'DELETE',
  });
  return handleResponse(res);
};
