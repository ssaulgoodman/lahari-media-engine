import assert from 'node:assert/strict';
import { composeStoryboardRenderPrompt } from '../server/services/storyboardPromptComposition.js';

const refs = [
  {
    label: 'Locked style reference',
    assetId: 'style_asset',
    filePath: 'images/style.png',
    excludableKey: 'style',
  },
  {
    label: 'Environment reference: Sannidhanam courtyard',
    assetId: 'env_asset',
    filePath: 'images/env.png',
    excludableKey: 'env:sannidhanam',
  },
];

const defaultComposition = composeStoryboardRenderPrompt({
  renderMode: 'default',
  prompt: 'A 2x2 storyboard sheet showing a pilgrim entering the courtyard, then turning toward the shrine.',
  refMeta: refs,
  isEditImage: false,
  params: { model: 'gpt-image-2', storyboardProvider: 'gpt-image-2' },
}).composition;

assert.equal(
  defaultComposition.text,
  defaultComposition.segments.filter((segment) => segment.included).map((segment) => segment.text).join('\n\n'),
  'storyboard prompt text must be the render of included segments',
);

for (const segment of defaultComposition.segments) {
  assert.ok(segment.source, `segment ${segment.slot} missing source`);
  assert.ok(segment.editPath, `segment ${segment.slot} missing editPath`);
}

const defaultSlots = defaultComposition.segments.map((segment) => segment.slot);
assert.deepEqual(defaultSlots, ['ref_binding_contract', 'board_prompt']);
assert.equal(defaultComposition.segments.find((segment) => segment.slot === 'board_prompt')?.source, 'shots.storyboard_prompt');
assert.equal(defaultComposition.images.length, 2);
assert.equal(defaultComposition.images[0].ref, 'Image 1');
assert.equal(defaultComposition.images[0].assetId, 'style_asset');
assert.equal(defaultComposition.params.model, 'gpt-image-2');

const hfComposition = composeStoryboardRenderPrompt({
  renderMode: 'hf_music_video',
  prompt: 'A pure planning board of the courtyard threshold moment.',
  refMeta: refs,
  isEditImage: false,
}).composition;

assert.deepEqual(
  hfComposition.segments.map((segment) => segment.slot),
  ['workflow_render_contract', 'ref_binding_contract', 'board_prompt'],
  'HF render composition must separate workflow contract, refs, and saved prompt',
);
assert.match(hfComposition.segments[0].text, /STRICTLY BLACK AND WHITE/);
assert.match(hfComposition.segments[0].editPath, /apply_project_workflow/);
assert.match(hfComposition.segments[1].text, /strip all color/i);
assert.match(hfComposition.text, /HF STORYBOARD RENDER CONTRACT/);
assert.match(hfComposition.text, /REFERENCE BINDING CONTRACT/);

const editComposition = composeStoryboardRenderPrompt({
  renderMode: 'hf_music_video',
  prompt: 'Edit the provided storyboard image. Keep panel layout, but make the temple entrance clearer.',
  refMeta: refs,
  isEditImage: true,
}).composition;

assert.ok(editComposition.segments.some((segment) => segment.slot === 'edit_instruction'));
assert.ok(!editComposition.segments.some((segment) => segment.slot === 'board_prompt'));
assert.match(editComposition.text, /If the previous storyboard image is colored or final-rendered/);

console.log('storyboard prompt composition contract ok');
