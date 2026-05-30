import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  actionSpecsForSurface,
  buildActionSchemaIndex,
  isMaterializedAgentActionSpec,
} from '../server/services/actionRegistry.js';
import { normalizeLeanActionReceipt } from '../server/services/codexStudio/leanReceipt.js';
import { buildNotebookSkillArtifacts } from '../server/services/codexStudio/notebook.js';

type SmokeResult = {
  name: string;
  ok: boolean;
  detail?: string;
};

const args = new Set(process.argv.slice(2));
const repeatArg = process.argv.find((arg) => arg.startsWith('--repeat='));
const repeat = repeatArg ? Math.max(1, Number(repeatArg.split('=')[1]) || 1) : 1;
const verbose = args.has('--verbose');

const materializedActions = () => actionSpecsForSurface().filter(isMaterializedAgentActionSpec);

const assertNoChangedArtifactBodies = (value: unknown) => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(assertNoChangedArtifactBodies);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (obj.kind === 'mirage.notebook.changed_artifact') {
    assert.equal('content' in obj, false, `lean artifact still contains content for ${String(obj.path || '(unknown)')}`);
    assert.equal(typeof obj.path, 'string');
    assert.equal(typeof obj.hash, 'string');
    assert.equal(typeof obj.size, 'number');
  }
  for (const child of Object.values(obj)) assertNoChangedArtifactBodies(child);
};

const runChecks = (): SmokeResult[] => {
  const results: SmokeResult[] = [];

  const check = (name: string, fn: () => void, detail?: string) => {
    fn();
    results.push({ name, ok: true, detail });
  };

  check('agent action surface is focused and current', () => {
    const keys = new Set(materializedActions().map((spec) => spec.key));
    assert.ok(keys.has('apply_text_edits'), 'apply_text_edits must be materialized for agents');
    assert.ok(keys.has('import_storyboard_image'), 'import_storyboard_image must be materialized for agents');
    assert.ok(!keys.has('identify_style'), 'identify_style should stay hidden from agent materialization');
    assert.ok(!keys.has('bulk_generate_storyboards'), 'blocking bulk storyboard generation should stay hidden from agent materialization');
  }, `${materializedActions().length} materialized actions`);

  check('action examples guard known input-shape footguns', () => {
    const generateCandidates = actionSpecsForSurface().find((spec) => spec.key === 'generate_candidates');
    assert.ok(generateCandidates, 'generate_candidates action missing');
    assert.equal('entityIds' in generateCandidates.input, true, 'generate_candidates must document entityIds[]');
    assert.equal('entityId' in generateCandidates.input, false, 'generate_candidates should not imply singular entityId');
    const storyboardImport = actionSpecsForSurface().find((spec) => spec.key === 'import_storyboard_image');
    assert.ok(storyboardImport, 'import_storyboard_image action missing');
    assert.match(storyboardImport.description, /storyboard_image/, 'storyboard import should mention purpose=storyboard_image');
  });

  check('action index stays scan-sized', () => {
    const index = buildActionSchemaIndex(materializedActions());
    const bytes = Buffer.byteLength(JSON.stringify(index), 'utf8');
    assert.ok(bytes < 25000, `action index too large for scan-first use: ${bytes} bytes`);
  }, `${Buffer.byteLength(JSON.stringify(buildActionSchemaIndex(materializedActions())), 'utf8')} bytes`);

  check('versioned notebook skills are stable and complete', () => {
    const first = buildNotebookSkillArtifacts({ id: 'smoke-project' });
    const second = buildNotebookSkillArtifacts({ id: 'smoke-project' });
    assert.equal(first.manifest.version, second.manifest.version, 'skill manifest version should be stable across repeated builds');
    assert.ok(first.files.some((file) => file.path === 'mirage/projects/smoke-project/config/skills.json'), 'config/skills.json missing');
    assert.equal(first.manifest.skills.length > 0, true, 'skill manifest must include skills');
    for (const skill of first.manifest.skills) {
      assert.equal(skill.paths.length, 2, `${skill.name} should materialize for Codex and Claude`);
      assert.ok(skill.paths.some((path) => path.startsWith('.agents/skills/')), `${skill.name} missing Codex path`);
      assert.ok(skill.paths.some((path) => path.startsWith('.claude/skills/')), `${skill.name} missing Claude path`);
      assert.equal(typeof skill.hash, 'string');
      assert.equal(skill.version, skill.hash.slice(0, 12));
    }
  });

  check('lean receipts strip artifact bodies recursively', () => {
    const receipt = normalizeLeanActionReceipt({
      kind: 'smoke',
      changedArtifacts: [{
        path: 'mirage/projects/smoke/script.md',
        content: 'very large body that must not cross MCP receipts',
        mode: 'draft',
        writePolicy: 'review_before_overwrite',
        description: 'script',
      }],
      nested: {
        results: [{
          changedArtifacts: [{
            path: 'mirage/projects/smoke/storyboards/scene-1.md',
            content: 'nested body',
            mode: 'draft',
            writePolicy: 'review_before_overwrite',
            description: 'storyboard scene',
          }],
        }],
      },
    }) as Record<string, any>;
    assert.equal(receipt.changedArtifactSummary.count, 1);
    assert.equal(receipt.changedArtifacts[0].content, undefined);
    assertNoChangedArtifactBodies(receipt);
  });

  check('notebook sync guidance stays on the confident path', () => {
    const mcpRoute = readFileSync('server/routes/mcp.ts', 'utf8');
    assert.match(mcpRoute, /returned command is the reliable path/, 'MCP instructions must trust the returned sync command');
    assert.match(mcpRoute, /Only fall back to MCP file reads when there is no shell\/npx capability/, 'MCP instructions must not invite eager fallback');
    const notebook = readFileSync('server/resources/notebook/AGENTS.template.md', 'utf8');
    assert.match(notebook, /config\/skills\.json/, 'workspace instructions must mention skill manifest');
    assert.match(notebook, /notebook\.json\.skillsHash/, 'workspace instructions must mention aggregate skill hash');
  });

  return results;
};

let total = 0;
for (let i = 1; i <= repeat; i += 1) {
  const results = runChecks();
  total += results.length;
  if (verbose || repeat > 1) {
    console.log(`\nRun ${i}/${repeat}`);
    for (const result of results) console.log(`  ok ${result.name}${result.detail ? ` (${result.detail})` : ''}`);
  }
}

console.log(`Mirage agent contract smoke passed: ${total} checks over ${repeat} run${repeat === 1 ? '' : 's'}.`);
