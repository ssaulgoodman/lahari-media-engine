import type { StoryboardRefMeta } from './storyboard.js';

export type StoryboardPromptSlot =
  | 'workflow_render_contract'
  | 'ref_binding_contract'
  | 'board_prompt'
  | 'edit_instruction';

export type StoryboardPromptSegment = {
  slot: StoryboardPromptSlot;
  label: string;
  text: string;
  source: string;
  editPath: string;
  included: boolean;
};

export type StoryboardPromptImage = {
  ref: string;
  role: string;
  assetId: string | null;
  source: string;
  excludableKey?: string;
};

export type StoryboardPromptComposition = {
  kind: 'mirage.storyboard_prompt_composition';
  phase: 'render';
  text: string;
  segments: StoryboardPromptSegment[];
  images: StoryboardPromptImage[];
  params: Record<string, unknown>;
};

export type StoryboardRenderMode = 'default' | 'hf_music_video';

const SEGMENT_SEPARATOR = '\n\n';

export const storyboardRenderModeFromOverride = (projectStoryboardOverride: string | null): StoryboardRenderMode => {
  const body = String(projectStoryboardOverride || '').toLowerCase();
  if (
    body.includes('final-style storyboard')
    || body.includes('render storyboard in final style')
    || body.includes('same-style storyboard')
  ) {
    return 'default';
  }
  if (
    body.includes('hf music storyboard recipe')
    || (body.includes('strictly black and white') && body.includes('pure white paper'))
  ) {
    return 'hf_music_video';
  }
  return 'hf_music_video';
};

const buildHfStoryboardRenderContract = (isEditImage: boolean): string => [
  'HF STORYBOARD RENDER CONTRACT',
  'Render a planning storyboard sheet, not final production art.',
  'Use a 2x2 or 2x3 grid of 16:9 panels on pure white paper (#FFFFFF), with thin black panel borders and generous gaps.',
  'STRICTLY BLACK AND WHITE: bold black ink linework with optional gray pencil shading only. No color, no cream tint, no sepia, no watercolor, no accent colors, no colored wardrobe, skin, props, headers, or footers.',
  'Hand-drawn pen-and-pencil sketch style. Do not render photorealism, final color grading, cinematic lighting, or final material texture.',
  'Reference images are planning guides for identity, pose, setting layout, composition, geography, props, and shot intent. Strip color and final-render texture from every reference image.',
  'Do not paste, trace, or reproduce reference images directly. Convert all references into the same black-and-white sketch planning language.',
  'Do not render panel numbers, captions, subtitles, arrows, speech bubbles, readable headers, watermarks, or footer text.',
  isEditImage
    ? 'If the previous storyboard image is colored or final-rendered, do not preserve its color, palette, photoreal finish, or texture. Preserve only its panel layout, subject positions, geography, and continuity while converting the result into the HF black-and-white sketch-board style.'
    : '',
].filter(Boolean).join('\n');

export const buildStoryboardRefBindingContract = (
  refMeta: StoryboardRefMeta[],
  opts: { renderMode?: StoryboardRenderMode } = {},
): string => {
  if (!refMeta.length) return '';
  const hfSketchPlanning = opts.renderMode === 'hf_music_video';
  const lines = refMeta.map((ref, index) => {
    const slot = `Image ${index + 1}`;
    if (ref.excludableKey === 'style') {
      if (hfSketchPlanning) {
        return `- ${slot}: ${ref.label}. Use for visual grammar, identity discipline, composition taste, and medium cues only; strip all color, palette, final lighting, and final-render texture into black-and-white sketch form.`;
      }
      return `- ${slot}: ${ref.label}. Use for overall medium, palette, lighting, line quality, and finish only; do not copy its subject.`;
    }
    if (ref.excludableKey?.startsWith('cast:')) {
      if (hfSketchPlanning) {
        return `- ${slot}: ${ref.label}. When the storyboard names this character, bind face structure, body shape, costume silhouette, pose language, and identity; strip all color and final-render texture.`;
      }
      return `- ${slot}: ${ref.label}. When the storyboard names this character, bind the appearance and outfit to this exact reference.`;
    }
    if (ref.excludableKey?.startsWith('env:')) {
      if (hfSketchPlanning) {
        return `- ${slot}: ${ref.label}. When the storyboard names this location, bind geography, architecture, layout, materials, props, and spatial relationships; strip all color and final-render texture.`;
      }
      return `- ${slot}: ${ref.label}. When the storyboard names this location, bind layout, materials, color, and props to this exact reference.`;
    }
    if (ref.excludableKey === 'prev_storyboard') {
      return `- ${slot}: ${ref.label}. Use only for continuity from the previous shot.`;
    }
    return `- ${slot}: ${ref.label}. Use only for the role named here.`;
  });
  return [
    'REFERENCE BINDING CONTRACT',
    ...lines,
    hfSketchPlanning
      ? 'Do not swap identities between reference images. Do not invent alternate outfits, faces, rooms, or props when the matching reference image is present. Do not carry reference colors into the storyboard.'
      : 'Do not swap identities between reference images. Do not invent alternate outfits, faces, rooms, or props when the matching reference image is present.',
  ].join('\n');
};

export const composeStoryboardRenderPrompt = (opts: {
  renderMode: StoryboardRenderMode;
  prompt: string;
  refMeta: StoryboardRefMeta[];
  isEditImage: boolean;
  params?: Record<string, unknown>;
  renderContractSource?: string;
  renderContractEditPath?: string;
}): {
  renderPrompt: string;
  refBindingContract: string;
  renderContract: string;
  composition: StoryboardPromptComposition;
} => {
  const segments: StoryboardPromptSegment[] = [];
  const renderContract = opts.renderMode === 'hf_music_video'
    ? buildHfStoryboardRenderContract(opts.isEditImage)
    : '';
  if (renderContract) {
    segments.push({
      slot: 'workflow_render_contract',
      label: 'Workflow render contract',
      text: renderContract,
      source: opts.renderContractSource || 'engine default canonical storyboard render contract',
      editPath: opts.renderContractEditPath || 'apply_project_prompt_override with a final-style storyboard override',
      included: true,
    });
  }

  const refBindingContract = buildStoryboardRefBindingContract(opts.refMeta, { renderMode: opts.renderMode });
  if (refBindingContract) {
    segments.push({
      slot: 'ref_binding_contract',
      label: 'Reference binding',
      text: refBindingContract,
      source: 'attached storyboard refs',
      editPath: 'lock_reference | storyboard ref chips | contextOverrides',
      included: true,
    });
  }

  segments.push({
    slot: opts.isEditImage ? 'edit_instruction' : 'board_prompt',
    label: opts.isEditImage ? 'Edit instruction' : 'Saved storyboard prompt',
    text: opts.prompt,
    source: opts.isEditImage ? 'refine_storyboard_image.feedback' : 'shots.storyboard_prompt',
    editPath: opts.isEditImage ? 'refine_storyboard_image | apply_storyboard_prompts' : 'apply_storyboard_prompts',
    included: true,
  });

  const text = segments.filter((segment) => segment.included).map((segment) => segment.text).join(SEGMENT_SEPARATOR);
  const images: StoryboardPromptImage[] = opts.refMeta.map((ref, index) => ({
    ref: `Image ${index + 1}`,
    role: ref.label,
    assetId: ref.assetId || null,
    source: ref.excludableKey ? 'project/shot reference' : 'call-specific reference',
    excludableKey: ref.excludableKey,
  }));
  const composition: StoryboardPromptComposition = {
    kind: 'mirage.storyboard_prompt_composition',
    phase: 'render',
    text,
    segments,
    images,
    params: opts.params || {},
  };

  return { renderPrompt: text, refBindingContract, renderContract, composition };
};
