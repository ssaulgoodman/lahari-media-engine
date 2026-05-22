import { normalizeWorkflowKey } from '../presets.js';
import { getAssetState } from './assetState.js';
import type { AssetKey, BlockedTool, ResolvedTool, ToolManifest, ToolProject, WorkflowKey } from './types.js';

const workflowForProject = (project: ToolProject): WorkflowKey =>
  normalizeWorkflowKey(project.workflowKey) || 'music_led';

const resolveTool = (tool: ToolManifest): ResolvedTool => ({
  key: tool.key,
  label: tool.label,
  description: tool.description,
  surface: tool.surface,
  enabledFor: tool.enabledFor,
  requires: tool.requires,
  contextInputs: tool.contextInputs,
  produces: tool.produces,
});

const missingInputs = (tool: ToolManifest, assets: Set<AssetKey>): AssetKey[] =>
  tool.requires.filter((key) => !assets.has(key));

const isEnabledForWorkflow = (tool: ToolManifest, workflowKey: WorkflowKey): boolean =>
  !tool.enabledFor || tool.enabledFor.includes(workflowKey);

export const TOOL_REGISTRY: ToolManifest[] = [
  {
    key: 'generate-concept',
    label: 'Generate concept',
    description: 'Create or refresh concept options from the project seed, brief, and available source material.',
    requires: [],
    contextInputs: ['scriptText', 'lyrics', 'meaning', 'musicalStructure', 'directorBrief'],
    produces: ['concept'],
    surface: 'asset:concept',
  },
  {
    key: 'refine-concept',
    label: 'Refine concept',
    description: 'Revise the locked concept using a director note while preserving the project source.',
    requires: ['concept'],
    contextInputs: ['scriptText', 'lyrics', 'meaning', 'directorBrief'],
    produces: ['concept'],
    surface: 'asset:concept',
  },
  {
    key: 'plan-scenes-from-music',
    label: 'Plan music-video scenes',
    description: 'Turn analyzed audio, lyrics, and musical structure into production scenes and shots.',
    enabledFor: ['music_led'],
    requires: ['audio', 'musicalStructure'],
    contextInputs: ['lyrics', 'meaning', 'concept'],
    produces: ['scenes', 'shots', 'cast', 'environments'],
    surface: 'asset:script',
  },
  {
    key: 'parse-script',
    label: 'Parse script',
    description: 'Extract scenes, shots, cast, and environments from a script, treatment, or episode seed.',
    enabledFor: ['scripted_narrative'],
    requires: ['scriptText'],
    contextInputs: ['directorBrief', 'targetRuntime'],
    produces: ['scenes', 'shots', 'cast', 'environments'],
    surface: 'asset:script',
  },
  {
    key: 'refine-script',
    label: 'Refine script',
    description: 'Revise the scene and shot plan from a director note while preserving production continuity where possible.',
    requires: ['scenes', 'shots'],
    contextInputs: ['cast', 'environments', 'scriptText', 'lyrics'],
    produces: ['scenes', 'shots', 'cast', 'environments'],
    surface: 'asset:script',
  },
  {
    key: 'brainstorm-style',
    label: 'Brainstorm style',
    description: 'Propose visual style directions for this project. Produces text directions; image visualization is a separate tool.',
    requires: [],
    contextInputs: ['concept', 'scriptText', 'lyrics', 'meaning', 'scenes'],
    produces: ['styleDirections'],
    surface: 'asset:style',
  },
  {
    key: 'visualize-style',
    label: 'Visualize style',
    description: 'Generate a reusable style reference image from one selected style direction.',
    requires: ['styleDirections'],
    contextInputs: ['concept', 'scriptText', 'lyrics', 'meaning'],
    produces: ['styleAsset'],
    surface: 'asset:style',
  },
  {
    key: 'refine-style-direction',
    label: 'Refine style direction',
    description: 'Revise a style direction using a director note before visualizing or locking it.',
    requires: ['styleDirections'],
    contextInputs: ['concept', 'scriptText', 'lyrics', 'meaning'],
    produces: ['styleDirections'],
    surface: 'asset:style',
  },
  {
    key: 'generate-character-looks',
    label: 'Generate character looks',
    description: 'Generate reusable character references for cast members from the locked style and character descriptions.',
    requires: ['cast', 'styleAsset'],
    contextInputs: ['concept', 'scriptText'],
    produces: ['castLooks'],
    surface: 'asset:characters',
  },
  {
    key: 'generate-environment-looks',
    label: 'Generate environment looks',
    description: 'Generate reusable environment/background references from the locked style and environment descriptions.',
    requires: ['environments', 'styleAsset'],
    contextInputs: ['concept', 'scriptText'],
    produces: ['envLooks'],
    surface: 'asset:environments',
  },
  {
    key: 'write-shot-prompts',
    label: 'Write shot prompts',
    description: 'Write production image/video prompts for existing shots using the current script, style, looks, and continuity.',
    requires: ['scenes', 'shots'],
    contextInputs: ['concept', 'styleAsset', 'castLooks', 'envLooks'],
    produces: ['shotPrompts'],
    surface: 'asset:studio',
  },
  {
    key: 'write-storyboard-prompt',
    label: 'Write storyboard prompt',
    description: 'Plan a storyboard board and cut plan for a shot using current project references.',
    requires: ['shots'],
    contextInputs: ['styleAsset', 'castLooks', 'envLooks'],
    produces: ['storyboardPrompts'],
    surface: 'asset:studio',
  },
  {
    key: 'generate-keyframe',
    label: 'Generate keyframe',
    description: 'Generate a start-frame keyframe for shots with available prompt/context.',
    requires: ['shotPrompts'],
    contextInputs: ['styleAsset', 'castLooks', 'envLooks'],
    produces: ['keyframes'],
    surface: 'asset:studio',
  },
  {
    key: 'generate-storyboard',
    label: 'Generate storyboard',
    description: 'Generate storyboard imagery for shots with storyboard prompts.',
    requires: ['storyboardPrompts'],
    contextInputs: ['styleAsset', 'castLooks', 'envLooks'],
    produces: ['storyboards'],
    surface: 'asset:studio',
  },
  {
    key: 'write-audio-plan',
    label: 'Write audio plan',
    description: 'Write per-shot spoken dialogue and restrained sound notes for scripted projects.',
    enabledFor: ['scripted_narrative'],
    requires: ['scenes', 'shots', 'cast'],
    contextInputs: ['scriptText', 'directorBrief'],
    produces: ['audioPlan'],
    surface: 'asset:audio',
  },
  {
    key: 'assign-cast-voice',
    label: 'Assign cast voice',
    description: 'Persist a TTS provider voice ID for a cast member.',
    enabledFor: ['scripted_narrative'],
    requires: ['cast'],
    produces: ['castVoices'],
    surface: 'asset:characters',
  },
  {
    key: 'generate-dialogue-audio',
    label: 'Generate dialogue audio',
    description: 'Generate TTS assets for dialogue lines that have assigned character voices.',
    enabledFor: ['scripted_narrative'],
    requires: ['audioPlan', 'castVoices'],
    produces: ['ttsAssets'],
    surface: 'asset:audio',
  },
  {
    key: 'generate-video-from-keyframe',
    label: 'Generate video from keyframe',
    description: 'Generate video clips from keyframe/start-frame mode.',
    requires: ['keyframes'],
    contextInputs: ['audioPlan', 'ttsAssets'],
    produces: ['videos'],
    surface: 'asset:studio',
  },
  {
    key: 'generate-video-from-storyboard',
    label: 'Generate video from storyboard',
    description: 'Generate video clips from locked storyboard boards.',
    requires: ['storyboards'],
    contextInputs: ['audioPlan', 'ttsAssets'],
    produces: ['videos'],
    surface: 'asset:studio',
  },
  {
    key: 'render-video',
    label: 'Render video',
    description: 'Render the project timeline into a final mp4 once video clips exist.',
    requires: ['videos'],
    contextInputs: ['audio', 'ttsAssets'],
    produces: ['render'],
    surface: 'asset:render',
  },
];

export const allToolsForProject = (project: ToolProject): ToolManifest[] => {
  const workflowKey = workflowForProject(project);
  return TOOL_REGISTRY.filter((tool) => isEnabledForWorkflow(tool, workflowKey));
};

export const availableTools = (project: ToolProject): ResolvedTool[] => {
  const assets = getAssetState(project);
  return allToolsForProject(project)
    .filter((tool) => missingInputs(tool, assets).length === 0)
    .map(resolveTool);
};

export const blockedTools = (project: ToolProject): BlockedTool[] => {
  const assets = getAssetState(project);
  return allToolsForProject(project)
    .map((tool) => ({ tool, missing: missingInputs(tool, assets) }))
    .filter(({ missing }) => missing.length > 0)
    .map(({ tool, missing }) => ({ ...resolveTool(tool), missing }));
};
