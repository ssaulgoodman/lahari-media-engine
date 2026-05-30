#!/usr/bin/env node
/**
 * Skill content lint — guards the agent-facing skill surface against the
 * "consistent but bad" failure mode (item 17 of the audit).
 *
 * Versioning keeps the two skill copies in sync; this keeps the SHARED
 * content clean. Without it, a stale/leaky line just gets faithfully
 * distributed to every artist.
 *
 * Checks every SKILL.md under .agents/skills and server/resources/skills for:
 *   1. Banned strings — legacy/renamed tool names, removed workbench paths,
 *      internal jargon, placeholder corruption, and Lahari/devotional
 *      domain leakage that has no place in a general-machine skill.
 *   2. Pair drift — .agents/skills/<x> must byte-match
 *      server/resources/skills/<x>; a fix must land in both.
 *
 * Exit non-zero on any violation. Wire into CI / pre-deploy.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['.agents/skills', 'server/resources/skills'];

// Each entry: { pattern: RegExp, why: string }. Keep messages short.
const BANNED = [
  // Legacy / renamed MCP tools (cockpit redesign)
  { pattern: /\bresolve_project\b/, why: 'legacy tool — use list_projects/open_project' },
  { pattern: /\battach_director_session\b/, why: 'legacy tool — use open_project' },
  { pattern: /\bget_director_session\b/, why: 'legacy tool — use get_project_state' },
  { pattern: /\bget_project_packet\b/, why: 'legacy tool — use get_project_state' },
  { pattern: /\blist_character_look_candidates\b/, why: 'legacy tool — use list_candidates' },
  { pattern: /\blist_environment_look_candidates\b/, why: 'legacy tool — use list_candidates' },
  { pattern: /\bapply_cast_reference\b/, why: 'legacy tool — use lock_reference' },
  { pattern: /\bapply_environment_reference\b/, why: 'legacy tool — use lock_reference' },
  { pattern: /upload-cast-reference/, why: 'legacy CLI — use /api/agent/uploads' },
  { pattern: /upload-environment-reference/, why: 'legacy CLI — use /api/agent/uploads' },
  { pattern: /\bapply_script_markdown\b/, why: 'legacy tool name — use apply_script with markdown' },
  // Removed workbench paths
  { pattern: /\bmirrors\//, why: 'removed path — use state/' },
  { pattern: /\bdrafts\//, why: 'removed path — editable artifacts live at workbench root' },
  // Internal jargon / placeholders that must never ship to artists
  { pattern: /IT SAID OH/, why: 'corrupted placeholder text' },
  { pattern: /\bR2[0-9]\b/, why: 'internal task ref' },
  { pattern: /Doctrine §/, why: 'internal doctrine ref' },
  { pattern: /Saul/, why: 'internal name leak' },
  { pattern: /20\d\d-\d\d-\d\d fix/, why: 'internal dated-fix note' },
  // Lahari / devotional domain leak — general machine, generic examples only
  { pattern: /Shantamma/, why: 'Lahari example leak — use generic names' },
  { pattern: /cotton sari/, why: 'Lahari/devotional example leak' },
  { pattern: /\bdeity\b/i, why: 'devotional domain leak' },
  { pattern: /\bdevotional\b/i, why: 'devotional domain leak' },
  { pattern: /\bBhakti\b/i, why: 'Lahari domain leak' },
  { pattern: /\btemple\b/i, why: 'devotional example leak — use generic locations' },
];

let violations = 0;

const skillFiles = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const dir of fs.readdirSync(root)) {
    const file = path.join(root, dir, 'SKILL.md');
    if (fs.existsSync(file)) skillFiles.push(file);
  }
}

// 1. Banned-string scan
for (const file of skillFiles) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { pattern, why } of BANNED) {
      if (pattern.test(line)) {
        console.error(`✗ ${file}:${i + 1}  [${why}]\n    ${line.trim().slice(0, 120)}`);
        violations += 1;
      }
    }
  });
}

// 2. Pair-drift scan (.agents/skills/<x> must equal server/resources/skills/<x>)
const names = new Set(
  fs.existsSync('.agents/skills') ? fs.readdirSync('.agents/skills') : [],
);
for (const name of names) {
  const a = path.join('.agents/skills', name, 'SKILL.md');
  const b = path.join('server/resources/skills', name, 'SKILL.md');
  if (fs.existsSync(a) && fs.existsSync(b)) {
    if (fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8')) {
      console.error(`✗ PAIR DRIFT: ${a} != ${b} — a fix must land in both copies`);
      violations += 1;
    }
  }
}

if (violations) {
  console.error(`\nSkill content lint failed: ${violations} violation(s). See item 17 in the audit doc.`);
  process.exit(1);
}
console.log(`Skill content lint passed: ${skillFiles.length} skill files clean, pairs in sync.`);
