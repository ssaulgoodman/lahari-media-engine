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
  assert.match(prompt, /black-and-white sketch planning sheet/, `${name}: prompt should make sketch planning canonical`);
  assert.match(prompt, /pure white paper/, `${name}: prompt should require white paper`);
  assert.match(prompt, /strict black-and-white ink\/pencil linework/, `${name}: prompt should require black-and-white linework`);
  assert.match(prompt, /stripping their color and final-render texture into sketch guidance/, `${name}: prompt should translate refs into sketch guidance`);
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
  assert.match(localSkill, /Canonical Mirage storyboards are black-and-white sketch planning sheets/, 'skill should make sketch boards canonical');
  assert.match(localSkill, /GPT Image 2 is the default storyboard provider/, 'skill should name GPT Image 2 as default storyboard provider');
  assert.match(localSkill, /Final video style comes later from the locked style\/cast\/environment refs/, 'skill should separate board plan from final video style');
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
