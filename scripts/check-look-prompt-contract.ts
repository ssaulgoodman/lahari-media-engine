import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import type { PipelinePreset } from '../server/presets.js';
import { buildCharacterLookPrompt, buildEnvironmentLookPrompt } from '../server/prompts/lookPrompts.js';

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
    name: 'character with style reference',
    prompt: () => buildCharacterLookPrompt({
      entity: { name: 'The Boss', description: 'Older strategist in a charcoal suit, severe bearing, compact build.' },
      styleIdx: 1,
      styleDescription: 'Graphic noir with controlled warm highlights.',
      styleNotes: 'Keep refs neutral and reusable.',
      preset,
    }),
  },
  {
    name: 'character with guide image',
    prompt: () => buildCharacterLookPrompt({
      entity: { name: 'The Knife Orchid', description: 'Elegant assassin, calm posture, minimal jewelry.' },
      styleIdx: 1,
      userRefIdx: 2,
      preset,
    }),
  },
  {
    name: 'object reference',
    prompt: () => buildCharacterLookPrompt({
      entity: { name: 'Red Ledger', description: 'Small worn red notebook with brass corner guards and no readable text.' },
      styleIdx: 1,
      preset,
    }),
  },
  {
    name: 'environment with style reference',
    prompt: () => buildEnvironmentLookPrompt({
      entity: { name: 'Red Den Room', description: 'Compact room with entrance, desk, red window, seating zone, and clear walking space.' },
      styleIdx: 1,
      styleDescription: 'Matte illustrated finish with warm practical light.',
      preset,
    }),
  },
  {
    name: 'environment with guide image',
    prompt: () => buildEnvironmentLookPrompt({
      entity: { name: 'Back Stairwell', description: 'Narrow service stairs with landing, metal rail, and one overhead light.' },
      styleIdx: 1,
      userRefIdx: 2,
      preset,
    }),
  },
];

const assertLookPromptContract = (name: string, prompt: string) => {
  assert.match(prompt, /One isolated reference image/, `${name}: prompt should require isolated reference output`);
  assert.match(prompt, /No collage, grid, text, watermark, or multiple panels/, `${name}: prompt should block non-reference layouts`);
  assert.match(prompt, /Style reference image: Image 1/, `${name}: prompt should name style reference role`);
  assert.match(prompt, /Do not copy its subject, layout, background, or crop/, `${name}: prompt should keep style image from becoming subject`);
  assert.match(prompt, /supplementary; use only when it agrees with the style reference image|Style still comes from Image 1|Extract medium, line, palette, texture, lighting, and finish/, `${name}: prompt should make style text/reference subordinate to style image`);
  assert.doesNotMatch(prompt, /poster|dramatic action scene/i, `${name}: prompt should stay reference-oriented`);
};

const assertSkillContract = () => {
  const localSkill = readFileSync('.agents/skills/casting-director/SKILL.md', 'utf8');
  const packagedSkill = readFileSync('server/resources/skills/casting-director/SKILL.md', 'utf8');
  assert.equal(localSkill, packagedSkill, 'local and packaged casting-director skills must match');
  assert.match(localSkill, /You create and protect the visual anchors/, 'skill should define the job plainly');
  assert.match(localSkill, /Use `entityIds\[\]`/, 'skill should guard generate_candidates plural input');
  assert.match(localSkill, /Mirage saves the generated prompt on the cast\/environment row and logs the exact render prompt/, 'skill should explain the prompt trail');
  assert.match(localSkill, /Style still comes from the locked style reference/, 'skill should keep guide image from replacing style');
  assert.match(localSkill, /Batch `promptOverride`; it only works for one entity at a time/, 'skill should guard promptOverride scope');
};

for (let run = 1; run <= repeat; run += 1) {
  for (const fixture of fixtures) {
    const prompt = fixture.prompt();
    assertLookPromptContract(fixture.name, prompt);
    if (verbose) {
      const bytes = Buffer.byteLength(prompt, 'utf8');
      console.log(`ok run ${run}/${repeat}: ${fixture.name} (${bytes} bytes)`);
    }
  }
  assertSkillContract();
}

console.log(`Look prompt contract check passed: ${fixtures.length * repeat} prompt builds + ${repeat} skill check${repeat === 1 ? '' : 's'}.`);
