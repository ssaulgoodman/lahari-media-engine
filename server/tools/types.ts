import type { CanonicalWorkflowRecipeKey, PipelinePresetKey } from '../presets.js';

export type WorkflowKey = CanonicalWorkflowRecipeKey;
export type PresetKey = PipelinePresetKey;
export type ToolProject = Record<string, any>;

export type AssetKey =
  | 'audio'
  | 'scriptText'
  | 'directorBrief'
  | 'targetRuntime'
  | 'lyrics'
  | 'musicalStructure'
  | 'meaning'
  | 'concept'
  | 'styleDirections'
  | 'styleAsset'
  | 'cast'
  | 'environments'
  | 'scenes'
  | 'shots'
  | 'shotPrompts'
  | 'storyboardPrompts'
  | 'castLooks'
  | 'envLooks'
  | 'audioPlan'
  | 'castVoices'
  | 'ttsAssets'
  | 'storyboards'
  | 'keyframes'
  | 'videos'
  | 'render';

export type ToolSurface = `asset:${string}` | 'agent-only';

export type PromptBuilder = (project: ToolProject, userNote?: string) => string;

export type ToolManifest = {
  key: string;
  label: string;
  description: string;
  enabledFor?: WorkflowKey[];
  requires: AssetKey[];
  contextInputs?: AssetKey[];
  produces: AssetKey[];
  surface: ToolSurface;
  buildPrompt?: PromptBuilder;
};

export type ResolvedTool = {
  key: string;
  label: string;
  description: string;
  surface: ToolSurface;
  enabledFor?: WorkflowKey[];
  requires: AssetKey[];
  contextInputs?: AssetKey[];
  produces: AssetKey[];
};

export type BlockedTool = ResolvedTool & {
  missing: AssetKey[];
};
