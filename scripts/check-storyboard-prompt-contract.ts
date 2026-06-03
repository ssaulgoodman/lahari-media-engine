import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import type { PipelinePreset } from '../server/presets.js';
import { buildStoryboardPlannerPrompt } from '../server/prompts/storyboard.js';

const args = new Set(process.argv.slice(2));
const repeatArg = process.argv.find((arg) => arg.startsWith('--repeat='));
const repeat = repeatArg ? Math.max(1, Number(repeatArg.split('=')[1]) || 1) : 1;
const verbose = args.has('--verbose');

const preset = {
  key: 'smoke',
  label: 'Smoke',
  workflowKey: 'scripted_narrative',
} as unknown as PipelinePreset;

const fixtures = [
  {
    name: 'fresh shot with style notes',
    input: {
      sourceBrief: [
        'Shot: The Boss enters the Red Den Room while The Knife Orchid waits at the desk.',
        'Cast: The Boss, The Knife Orchid.',
        'Environment: Red Den Room.',
      ].join('\n'),
      styleNotes: 'Use the locked style reference for medium and finish. Keep noir contrast restrained.',
      preset,
    },
  },
  {
    name: 'previous storyboard continuity',
    input: {
      sourceBrief: 'Shot: The Boss crosses from the doorway to the desk in the Red Den Room.',
      hasPreviousStoryboardRef: true,
      previousCutPlanTail: 'Panel 4 — The Boss pauses at the doorway; The Knife Orchid remains seated.',
      preset,
    },
  },
  {
    name: 'artist reference refinement',
    input: {
      sourceBrief: 'Shot: The Knife Orchid reaches for the hidden envelope on the desk.',
      artistNote: 'Make the hand movement more readable and keep the desk geography clear.',
      hasArtistReference: true,
      preset,
    },
  },
  {
    name: 'current prompt rewrite',
    input: {
      sourceBrief: 'Shot: The Boss turns toward the red window as sirens pass outside.',
      currentPrompt: 'Old draft: cinematic room, dramatic mood, character looks worried.',
      currentCutPlan: 'Panel 1 — old beat',
      artistNote: 'Rewrite as a clean 2x2 board with clearer blocking.',
      preset,
    },
  },
  {
    name: 'dense action candidate',
    input: {
      sourceBrief: 'Shot: The Boss and The Knife Orchid cross the Red Den Room in opposite directions while a glass breaks.',
      styleNotes: 'The style reference uses flat graphic shapes and controlled warm highlights.',
      preset,
    },
  },
];

const assertPlannerPromptContract = (name: string, prompt: string) => {
  assert.match(prompt, /canonical graph names/, `${name}: prompt should teach canonical graph names`);
  assert.match(prompt, /locked style reference image as the primary style source/, `${name}: prompt should make style image primary`);
  assert.match(prompt, /short clarification derived from that image/, `${name}: prompt should keep style text derivative`);
  assert.match(prompt, /Do not introduce a new genre, medium, palette, lighting scheme, or finish/, `${name}: prompt should block competing style text`);
  assert.match(prompt, /2x2, 2x3, or 3x3 grid/, `${name}: prompt should require supported grid layouts`);
  assert.match(prompt, /Do not use 3-panel boards/, `${name}: prompt should reject 3-panel boards`);
  assert.match(prompt, /no captions, numbers, labels, arrows, speech bubbles, subtitles, readable text, logos, or watermarks/, `${name}: prompt should preserve no-text rule`);
  assert.doesNotMatch(prompt, /Image [12]\s*=/, `${name}: prompt should not teach saved image-number labels`);
};

const assertSkillContract = () => {
  const localSkill = readFileSync('.agents/skills/storyboarding/SKILL.md', 'utf8');
  const packagedSkill = readFileSync('server/resources/skills/storyboarding/SKILL.md', 'utf8');
  assert.equal(localSkill, packagedSkill, 'local and packaged storyboarding skills must match');
  assert.match(localSkill, /Use exact project names for those references; Mirage binds those names to the attached images at render time\./, 'skill should teach graph-name binding positively');
  assert.match(localSkill, /Style wording should come from the locked style reference\./, 'skill should make style ref primary');
  assert.match(localSkill, /do not invent a separate genre, palette, lighting scheme, or finish/, 'skill should reject competing style text');
  assert.match(localSkill, /No board exists yet/, 'skill should separate missing board from bad premise');
  assert.match(localSkill, /The board premise is wrong/, 'skill should fix bad premise before paid regen');
  assert.doesNotMatch(localSkill, /whole premise is wrong/, 'skill should not tell agents to regenerate vague bad premises');
  assert.doesNotMatch(localSkill, /Do not write `Image 1`/, 'skill should avoid defensive image-label scolding');
};

for (let run = 1; run <= repeat; run += 1) {
  for (const fixture of fixtures) {
    const prompt = buildStoryboardPlannerPrompt(fixture.input);
    assertPlannerPromptContract(fixture.name, prompt);
    if (verbose) {
      const bytes = Buffer.byteLength(prompt, 'utf8');
      console.log(`ok run ${run}/${repeat}: ${fixture.name} (${bytes} bytes)`);
    }
  }
  assertSkillContract();
}

console.log(`Storyboard prompt contract check passed: ${fixtures.length * repeat} planner builds + ${repeat} skill check${repeat === 1 ? '' : 's'}.`);
