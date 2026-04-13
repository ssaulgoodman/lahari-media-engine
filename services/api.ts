/**
 * Frontend API client — replaces direct Gemini SDK calls.
 * All AI work now happens on the server; this just makes HTTP calls.
 */

const API = '/api';

const handleResponse = async (res: Response) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
};

// ─── Projects ───────────────────────────────────────────────────────

export const listProjects = async () => {
  const res = await fetch(`${API}/projects`);
  return handleResponse(res);
};

export const getProject = async (id: string) => {
  const res = await fetch(`${API}/projects/${id}`);
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

  const res = await fetch(`${API}/projects`, { method: 'POST', body: form });
  return handleResponse(res);
};

export const updateProject = async (id: string, updates: Record<string, any>) => {
  const res = await fetch(`${API}/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};

export const deleteProject = async (id: string) => {
  const res = await fetch(`${API}/projects/${id}`, { method: 'DELETE' });
  return handleResponse(res);
};

// ─── Concept Generation & Lock-in ───────────────────────────────────

export const generateConcepts = async (
  projectId: string,
  opts?: { lyrics?: string; context?: string; language?: string; userNote?: string }
) => {
  const res = await fetch(`${API}/projects/${projectId}/generate-concepts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts || {})
  });
  return handleResponse(res);
};

export const lockConcept = async (projectId: string, conceptIndex: number) => {
  const res = await fetch(`${API}/projects/${projectId}/lock-concept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conceptIndex })
  });
  return handleResponse(res);
};

// ─── Style Generation & Lock ────────────────────────────────────────

export const generateStyles = async (projectId: string, notes?: string) => {
  const res = await fetch(`${API}/projects/${projectId}/generate-styles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes })
  });
  return handleResponse(res);
};

export const brainstormStyles = async (projectId: string, userNotes?: string) => {
  const res = await fetch(`${API}/projects/${projectId}/brainstorm-styles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userNotes })
  });
  return handleResponse(res);
};

export const visualizeStyle = async (projectId: string, prompt: string) => {
  const res = await fetch(`${API}/projects/${projectId}/visualize-style`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  return handleResponse(res);
};

export const refineStyleDirection = async (projectId: string, description: string, feedback: string) => {
  const res = await fetch(`${API}/projects/${projectId}/refine-style-direction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, feedback })
  });
  return handleResponse(res);
};

export const unlockStyle = async (projectId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/unlock-style`, { method: 'POST' });
  return handleResponse(res);
};

export const lockStyle = async (projectId: string, assetId: string, styleDescription?: string) => {
  const res = await fetch(`${API}/projects/${projectId}/lock-style`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, styleDescription })
  });
  return handleResponse(res);
};

export const analyzeStyleImage = async (projectId: string, imageFile: File) => {
  const form = new FormData();
  form.append('image', imageFile);
  const res = await fetch(`${API}/projects/${projectId}/analyze-style-image`, {
    method: 'POST',
    body: form
  });
  return handleResponse(res);
};

// ─── Character Look Generation & Lock ───────────────────────────────

export const generateLooks = async (projectId: string, castMemberId: string, feedback?: string) => {
  const res = await fetch(`${API}/projects/${projectId}/generate-looks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ castMemberId, feedback })
  });
  return handleResponse(res);
};

export const lockCharacter = async (projectId: string, castMemberId: string, assetId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/lock-character`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ castMemberId, assetId })
  });
  return handleResponse(res);
};

// ─── Cast Management ────────────────────────────────────────────────

export const addCastMember = async (projectId: string, name: string, description: string) => {
  const res = await fetch(`${API}/projects/${projectId}/cast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  });
  return handleResponse(res);
};

export const updateCastMember = async (projectId: string, memberId: string, updates: { name?: string; description?: string }) => {
  const res = await fetch(`${API}/projects/${projectId}/cast/${memberId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};

export const deleteCastMember = async (projectId: string, memberId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/cast/${memberId}`, { method: 'DELETE' });
  return handleResponse(res);
};

// ─── Environment Management ─────────────────────────────────────────

export const addEnvironment = async (projectId: string, name: string, description: string) => {
  const res = await fetch(`${API}/projects/${projectId}/environments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  });
  return handleResponse(res);
};

export const updateEnvironment = async (projectId: string, envId: string, updates: { name?: string; description?: string }) => {
  const res = await fetch(`${API}/projects/${projectId}/environments/${envId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};

export const deleteEnvironment = async (projectId: string, envId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/environments/${envId}`, { method: 'DELETE' });
  return handleResponse(res);
};

export const generateEnvironmentLook = async (projectId: string, environmentId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/generate-environment-look`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environmentId })
  });
  return handleResponse(res);
};

export const lockEnvironment = async (projectId: string, environmentId: string, assetId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/lock-environment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environmentId, assetId })
  });
  return handleResponse(res);
};

// ─── Phase Advancement ──────────────────────────────────────────────

export const advanceCharacters = async (projectId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/advance-characters`, { method: 'POST' });
  return handleResponse(res);
};

export const advanceEnvironments = async (projectId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/advance-environments`, { method: 'POST' });
  return handleResponse(res);
};

// ─── Script Generation ──────────────────────────────────────────────

export const generateScript = async (projectId: string, userNote?: string) => {
  const res = await fetch(`${API}/projects/${projectId}/generate-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userNote ? { userNote } : {}),
  });
  return handleResponse(res);
};

export const writeShotPrompts = async (projectId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/write-shot-prompts`, { method: 'POST' });
  return handleResponse(res);
};

// ─── Shot Image & Video ─────────────────────────────────────────────

export const refineShotPrompt = async (projectId: string, shotId: string, feedback: string) => {
  const res = await fetch(`${API}/projects/${projectId}/shots/${shotId}/refine-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback })
  });
  return handleResponse(res);
};

export const generateShotImage = async (projectId: string, shotId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/shots/${shotId}/generate-image`, { method: 'POST' });
  return handleResponse(res);
};

export const generateShotVideo = async (projectId: string, shotId: string, promptOverride?: string) => {
  const res = await fetch(`${API}/projects/${projectId}/shots/${shotId}/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(promptOverride ? { promptOverride } : {}),
  });
  return handleResponse(res);
};

export const updateShot = async (projectId: string, shotId: string, updates: Record<string, any>) => {
  const res = await fetch(`${API}/projects/${projectId}/shots/${shotId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};

export const lockShot = async (projectId: string, shotId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/shots/${shotId}/lock`, { method: 'POST' });
  return handleResponse(res);
};

export const unlockShot = async (projectId: string, shotId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/shots/${shotId}/unlock`, { method: 'POST' });
  return handleResponse(res);
};

// ─── X-Ray ──────────────────────────────────────────────────────────

export const getXRayCalls = async (projectId: string) => {
  const res = await fetch(`${API}/projects/${projectId}/xray`);
  return handleResponse(res);
};

// ─── Chat ───────────────────────────────────────────────────────────

export const sendChatMessage = async (projectId: string, message: string) => {
  const res = await fetch(`${API}/projects/${projectId}/chat`, {
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
  const res = await fetch(`${API}/queue?${params}`);
  return handleResponse(res);
};

export const getQueueDeities = async (): Promise<string[]> => {
  const res = await fetch(`${API}/queue/deities`);
  return handleResponse(res);
};

export const startProduction = async (queueId: string) => {
  const res = await fetch(`${API}/queue/${queueId}/start`, { method: 'POST' });
  return handleResponse(res);
};

export const updateQueueItem = async (queueId: string, updates: Record<string, any>) => {
  const res = await fetch(`${API}/queue/${queueId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return handleResponse(res);
};
