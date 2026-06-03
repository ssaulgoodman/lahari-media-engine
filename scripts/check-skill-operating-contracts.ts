import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const skills = [
  'concept-writer',
  'script-writer',
  'art-director',
  'casting-director',
  'sound-director',
  'audio-director',
  'storyboarding',
  'video-director',
];

const readSkill = (name: string) => {
  const local = readFileSync(`.agents/skills/${name}/SKILL.md`, 'utf8');
  const packaged = readFileSync(`server/resources/skills/${name}/SKILL.md`, 'utf8');
  assert.equal(local, packaged, `${name}: local and packaged skill copies must match`);
  return local;
};

const checks: Record<string, Array<[RegExp, string]>> = {
  'concept-writer': [
    [/project spine/i, 'defines concept as project spine'],
    [/run_action\(apply_concept\)/, 'uses apply_concept'],
    [/does not delete script rows, refs, boards, videos, or locks/i, 'states side effects'],
  ],
  'script-writer': [
    [/apply_text_edits/, 'uses safe text edit path'],
    [/apply_script/, 'uses topology path'],
    [/Preserve IDs/i, 'protects continuity IDs'],
    [/marks affected outputs stale/i, 'explains stale behavior'],
  ],
  'art-director': [
    [/generate_style_candidates/, 'uses style candidate action'],
    [/apply_style_direction/, 'uses style lock action'],
    [/contextOverrides/, 'mentions per-call context'],
    [/Video generation has no `contextOverrides`/, 'states video context limit'],
  ],
  'casting-director': [
    [/Use `entityIds\[\]`/, 'guards plural entityIds'],
    [/Mirage saves the generated prompt/, 'explains prompt trail'],
    [/Style still comes from the locked style reference/, 'keeps guide subordinate to style'],
  ],
  'sound-director': [
    [/analyze_audio_transcribe/, 'uses transcription action'],
    [/analyze_audio_structure/, 'uses structure action'],
    [/Uploading audio does not automatically analyze it/, 'states upload-only behavior'],
  ],
  'audio-director': [
    [/apply_audio_plan/, 'uses audio plan apply'],
    [/apply_cast_voice/, 'uses voice assignment'],
    [/generate_dialogue_audio, \{ dryRun: true \}/, 'requires dry-run'],
    [/Seedance native speech\/lipsync/, 'mentions native speech path'],
  ],
  storyboarding: [
    [/Use exact project names/, 'uses graph-name binding'],
    [/Style wording should come from the locked style reference/, 'keeps style image primary'],
    [/No board exists yet/, 'clean missing-board path'],
    [/The board premise is wrong/, 'fixes bad premise before regen'],
  ],
  'video-director': [
    [/generate_video, \{ dryRun: true \}/, 'requires dry-run'],
    [/promptOverride/, 'mentions exact prompt override'],
    [/Seedance cannot use `first_frame_url` and `reference_images` together/, 'states model reference constraint'],
    [/Board\/frame wrong/, 'routes upstream before video retry'],
  ],
};

for (const skill of skills) {
  const body = readSkill(skill);
  for (const [pattern, label] of checks[skill] || []) {
    assert.match(body, pattern, `${skill}: missing ${label}`);
  }
}

console.log(`Skill operating contract check passed: ${skills.length} skills.`);
