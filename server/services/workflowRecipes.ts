import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ProjectPreferences, ProjectPromptOverrideKind } from './projectConfig.js';

export type WorkflowRecipeVideoConfig = {
  nativeAudioMode?: 'auto' | 'off' | 'on';
  slotDefaults?: Record<string, string>;
  postprocess?: string;
};

export type WorkflowRecipe = {
  name: string;
  label: string;
  description: string;
  version?: string;
  applies: {
    promptOverrides?: Partial<Record<ProjectPromptOverrideKind, string>>;
    preferences?: ProjectPreferences;
    video?: WorkflowRecipeVideoConfig;
  };
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.resolve(moduleDir, '..', 'resources', 'workflows');

const isWorkflowName = (value: string) => /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value);

const readRecipeFile = (filePath: string): WorkflowRecipe => {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as WorkflowRecipe;
  if (!parsed?.name || !isWorkflowName(parsed.name)) {
    throw new Error(`Invalid workflow recipe name in ${filePath}`);
  }
  if (!parsed.label || !parsed.description || !parsed.applies || typeof parsed.applies !== 'object') {
    throw new Error(`Invalid workflow recipe shape in ${filePath}`);
  }
  return parsed;
};

export const listWorkflowRecipes = (): WorkflowRecipe[] => {
  if (!fs.existsSync(workflowDir)) return [];
  return fs.readdirSync(workflowDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readRecipeFile(path.join(workflowDir, entry)))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const getWorkflowRecipe = (name: string): WorkflowRecipe => {
  const safeName = String(name || '').trim().toLowerCase();
  if (!isWorkflowName(safeName)) throw new Error(`Invalid workflow recipe name: ${name}`);
  const recipePath = path.join(workflowDir, `${safeName}.json`);
  if (!fs.existsSync(recipePath)) throw new Error(`Unknown workflow recipe: ${safeName}`);
  return readRecipeFile(recipePath);
};

export const summarizeWorkflowRecipe = (recipe: WorkflowRecipe) => ({
  name: recipe.name,
  label: recipe.label,
  description: recipe.description,
  version: recipe.version || null,
});
