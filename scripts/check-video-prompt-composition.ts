import assert from 'node:assert/strict';
import { composeStoryboardVideoPrompt } from '../server/services/videoPromptComposition.js';

const base = {
  toolName: 'music video',
  clipDuration: 13,
  clipDirection: 'The Narmada reflection turns into high Himalayan snow.',
  refLabels: ['Locked style reference', 'Environment reference: Kedarnath'],
  cutPlanText: 'Panel 1 - start in the sanctum.\nPanel 2 - push into the reflection.',
  cutPlanFromShot: true,
  presetVideoRules: 'Do not invent a different object, set piece, or character blocking than the storyboard.',
  nativeAudioEnabled: false,
};

// 1. Composition is the audit AND the prompt: text === render of the included segments.
const c = composeStoryboardVideoPrompt(base);
const rendered = c.segments.filter((s) => s.included).map((s) => s.text).join('\n\n');
assert.equal(c.text, rendered, 'composed text must equal the render of included segments');

// 2. Every segment is self-describing: source + editPath present.
for (const seg of c.segments) {
  assert.ok(seg.source && seg.source.length > 0, `segment ${seg.slot} missing source`);
  assert.ok(seg.editPath && seg.editPath.length > 0, `segment ${seg.slot} missing editPath`);
}

// 3. The beat is attributable to shots.direction with an actionable edit path.
const beat = c.segments.find((s) => s.slot === 'beat');
assert.ok(beat, 'beat segment present when clipDirection set');
assert.equal(beat!.source, 'shots.direction');
assert.match(beat!.editPath, /apply_text_edits/);
assert.match(beat!.editPath, /includeShotBeat/);

// 4. Guardrails emitted ONCE — the universal no-text rule appears a single time.
const noTextHits = c.text.split('Do not render text, panel borders').length - 1;
assert.equal(noTextHits, 1, 'the no-text guardrail must appear exactly once');

// 5. Board treatment lives in the FORMAT slot, NOT in the engine guardrail.
//    The guardrail must make no claim about matching the board's finish.
const guardrail = c.segments.find((s) => s.slot === 'guardrail');
assert.ok(guardrail, 'guardrail segment present');
assert.doesNotMatch(guardrail!.text, /storyboard @image1/, 'guardrail must not reference the board (no board-finish claim)');
assert.doesNotMatch(guardrail!.text, /match.*finish/i, 'guardrail must not claim what finish to match');

// 6. No recipe → engine default format owns board treatment ("match the board").
const fmtDefault = c.segments.find((s) => s.slot === 'format');
assert.ok(fmtDefault, 'a format segment is always present (recipe or engine default)');
assert.match(fmtDefault!.source, /engine default/);
assert.match(fmtDefault!.text, /carries the target look/, 'engine default = match the board');

// 7. Recipe present → the recipe owns format/board treatment, attributed to it.
const withRecipe = composeStoryboardVideoPrompt({
  ...base,
  formatIntent: 'HF MUSIC VIDEO FORMAT\nThe locked storyboard is a black-and-white sketch plan. Render in the style ref finish, not the sketch.',
  formatSource: 'project video recipe: hf_music_video',
});
const fmt = withRecipe.segments.find((s) => s.slot === 'format');
assert.equal(fmt!.source, 'project video recipe: hf_music_video');
assert.match(fmt!.editPath, /apply_project_workflow|apply_project_prompt_override/);
assert.ok(withRecipe.text.startsWith('HF MUSIC VIDEO FORMAT'), 'recipe format intent leads the composed prompt');
// And the engine never adds a competing "match the board's finish" claim.
assert.doesNotMatch(withRecipe.segments.find((s) => s.slot === 'guardrail')!.text, /carries the target look/);

// 8. Cut-plan provenance flips with the source.
const derived = composeStoryboardVideoPrompt({ ...base, cutPlanFromShot: false });
assert.equal(derived.segments.find((s) => s.slot === 'cut_plan')!.source, 'engine (derived timing)');

// 9. The include map is the contextOverride seam: excluding a slot drops it from
//    the text but keeps it in the segment list (marked not-included) for the audit.
const noBeat = composeStoryboardVideoPrompt({ ...base, include: { beat: false } });
assert.doesNotMatch(noBeat.text, /Narmada reflection/, 'excluded beat must not be in the sent text');
assert.equal(noBeat.segments.find((s) => s.slot === 'beat')!.included, false, 'excluded beat stays in the audit, marked not-included');

// 10. Workflow defaults can exclude a slot, but call-level include can opt it back in.
const defaultNoBeat = composeStoryboardVideoPrompt({ ...base, defaultInclude: { beat: false } });
assert.doesNotMatch(defaultNoBeat.text, /Narmada reflection/, 'default-excluded beat must not be in the sent text');
assert.equal(defaultNoBeat.segments.find((s) => s.slot === 'beat')!.included, false, 'default-excluded beat stays in the audit');
const optBeatBackIn = composeStoryboardVideoPrompt({ ...base, defaultInclude: { beat: false }, include: { beat: true } });
assert.match(optBeatBackIn.text, /Narmada reflection/, 'call-level include must override default exclusion');
assert.equal(optBeatBackIn.segments.find((s) => s.slot === 'beat')!.included, true, 'call-level include marks beat included');

console.log('video prompt composition contract ok');
