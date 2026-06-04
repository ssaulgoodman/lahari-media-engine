import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const notebookPath = path.join(root, 'server/services/codexStudio/notebook.ts');
const workspaceTemplatePath = path.join(root, 'server/resources/notebook/AGENTS.template.md');
const notebook = fs.readFileSync(notebookPath, 'utf8');
const match = notebook.match(/const MIRAGE_SKILL_NAMES = \[([\s\S]*?)\] as const;/);

if (!match) {
  console.error('Could not find MIRAGE_SKILL_NAMES in notebook.ts');
  process.exit(1);
}

const expected = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
const agentDir = path.join(root, '.agents/skills');
const resourceDir = path.join(root, 'server/resources/skills');
const pluginDir = path.join(root, 'plugins/mirage/skills');
const failures = [];

if (!fs.existsSync(workspaceTemplatePath)) {
  failures.push('missing packaged notebook workspace template: server/resources/notebook/AGENTS.template.md');
}

for (const skill of expected) {
  const agentPath = path.join(agentDir, skill, 'SKILL.md');
  const resourcePath = path.join(resourceDir, skill, 'SKILL.md');
  if (!fs.existsSync(agentPath)) {
    failures.push(`missing local agent skill: ${skill}`);
    continue;
  }
  if (!fs.existsSync(resourcePath)) {
    failures.push(`missing packaged notebook skill: ${skill}`);
    continue;
  }
  const agentBody = fs.readFileSync(agentPath, 'utf8');
  const resourceBody = fs.readFileSync(resourcePath, 'utf8');
  if (agentBody !== resourceBody) {
    failures.push(`packaged skill drifted from .agents source: ${skill}`);
  }

  const pluginPath = path.join(pluginDir, skill, 'SKILL.md');
  if (!fs.existsSync(pluginPath)) {
    failures.push(`missing Mirage plugin skill: ${skill}`);
    continue;
  }
  const pluginBody = fs.readFileSync(pluginPath, 'utf8');
  if (pluginBody !== resourceBody) {
    failures.push(`Mirage plugin skill drifted from packaged skill: ${skill}`);
  }
}

const expectedSet = new Set(expected);
for (const entry of fs.readdirSync(resourceDir, { withFileTypes: true })) {
  if (entry.isDirectory() && !expectedSet.has(entry.name)) {
    failures.push(`extra packaged skill not in MIRAGE_SKILL_NAMES: ${entry.name}`);
  }
}

if (failures.length) {
  console.error('Notebook resource check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Notebook resource check passed: ${expected.length} skills packaged and plugin-synced`);
