/**
 * Shared scope-checking helpers for generate routes.
 * Centralized so auth/scope fixes happen in one place.
 */
import { v4 as uuidv4 } from 'uuid';
import { selectOne, insertRow } from '../database.js';

export const paramStr = (val: string | string[]): string => Array.isArray(val) ? val[0] : val;

export class ScopeError extends Error {
  statusCode: number;
  constructor(msg: string, code: number) { super(msg); this.statusCode = code; }
}

export const requireCastMember = async (projectId: string, memberId: string) => {
  const row = await selectOne('cast_members', { id: memberId });
  if (!row) throw new ScopeError('Cast member not found', 404);
  if (row.project_id !== projectId) throw new ScopeError('Cast member does not belong to this project', 403);
  return row;
};

export const requireEnvironment = async (projectId: string, envId: string) => {
  const row = await selectOne('environments', { id: envId });
  if (!row) throw new ScopeError('Environment not found', 404);
  if (row.project_id !== projectId) throw new ScopeError('Environment does not belong to this project', 403);
  return row;
};

export const requireAsset = async (projectId: string, assetId: string) => {
  const row = await selectOne('assets', { id: assetId });
  if (!row) throw new ScopeError('Asset not found', 404);
  if (row.project_id === projectId) return row;
  // Asset belongs to a different project — check if it's a parent in the fork chain.
  const project = await selectOne('projects', { id: projectId });
  if (project?.parent_project_id) {
    let parentId = project.parent_project_id;
    for (let i = 0; i < 10 && parentId; i++) {
      if (row.project_id === parentId) {
        // Copy the asset to this project so future references work directly
        const newId = uuidv4();
        await insertRow('assets', { id: newId, project_id: projectId, category: row.category, file_path: row.file_path, prompt: row.prompt, metadata: row.metadata });
        return { ...row, id: newId, project_id: projectId };
      }
      const parent = await selectOne('projects', { id: parentId });
      parentId = parent?.parent_project_id;
    }
  }
  throw new ScopeError('Asset does not belong to this project', 403);
};

export const PHASE_ORDER_SERVER = ['uploaded','analyzed','concept_locked','scripted','style_locked','characters_locked','environments_locked','in_production','completed'];
export const atLeast = (cur: string, target: string) => PHASE_ORDER_SERVER.indexOf(cur) >= PHASE_ORDER_SERVER.indexOf(target);
