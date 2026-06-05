import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  actionSpecsForSurface,
  buildActionSchemaIndex,
  isMaterializedAgentActionSpec,
} from '../server/services/actionRegistry.js';
import { normalizeLeanActionReceipt } from '../server/services/codexStudio/leanReceipt.js';
import { buildNotebookResourceVersions, buildNotebookSkillArtifacts } from '../server/services/codexStudio/notebook.js';

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

const runChecks = async (): Promise<SmokeResult[]> => {
  const results: SmokeResult[] = [];

  const check = async (name: string, fn: () => void | Promise<void>, detail?: string) => {
    await fn();
    results.push({ name, ok: true, detail });
  };

  await check('agent action surface is focused and current', () => {
    const keys = new Set(materializedActions().map((spec) => spec.key));
    assert.ok(keys.has('apply_text_edits'), 'apply_text_edits must be materialized for agents');
    assert.ok(keys.has('import_storyboard_image'), 'import_storyboard_image must be materialized for agents');
    assert.ok(!keys.has('identify_style'), 'identify_style should stay hidden from agent materialization');
    assert.ok(!keys.has('bulk_generate_storyboards'), 'blocking bulk storyboard generation should stay hidden from agent materialization');
  }, `${materializedActions().length} materialized actions`);

  await check('action examples guard known input-shape footguns', () => {
    const generateCandidates = actionSpecsForSurface().find((spec) => spec.key === 'generate_candidates');
    assert.ok(generateCandidates, 'generate_candidates action missing');
    assert.equal('entityIds' in generateCandidates.input, true, 'generate_candidates must document entityIds[]');
    assert.equal('entityId' in generateCandidates.input, false, 'generate_candidates should not imply singular entityId');
    const storyboardImport = actionSpecsForSurface().find((spec) => spec.key === 'import_storyboard_image');
    assert.ok(storyboardImport, 'import_storyboard_image action missing');
    assert.match(storyboardImport.description, /storyboard_image/, 'storyboard import should mention purpose=storyboard_image');
  });

  await check('action index stays scan-sized', () => {
    const index = buildActionSchemaIndex(materializedActions());
    const bytes = Buffer.byteLength(JSON.stringify(index), 'utf8');
    assert.ok(bytes < 25000, `action index too large for scan-first use: ${bytes} bytes`);
  }, `${Buffer.byteLength(JSON.stringify(buildActionSchemaIndex(materializedActions())), 'utf8')} bytes`);

  await check('notebook resource hashes are stable while operating files stay out of project sync', () => {
    const first = buildNotebookResourceVersions();
    const second = buildNotebookResourceVersions();
    assert.equal(first.skillsHash, second.skillsHash, 'skill resource hash should be stable across repeated builds');
    assert.equal(first.actionsHash, second.actionsHash, 'action resource hash should be stable across repeated builds');
    assert.equal(first.skills.length > 0, true, 'resource manifest must include Mirage skills for doctor/version checks');
    for (const skill of first.skills) {
      assert.equal(typeof skill.hash, 'string');
      assert.equal(skill.version, skill.hash.slice(0, 12));
    }
  });

  await check('skill artifacts keep version metadata but do not sync operating files', () => {
    const artifacts = buildNotebookSkillArtifacts({ id: 'smoke-project' });
    assert.equal(artifacts.files.length, 0, 'project sync must not materialize plugin-owned skill files');
    assert.equal(artifacts.manifest.skills.length > 0, true, 'manifest must still exist for doctor/version checks');
    assert.equal(artifacts.manifest.refresh.command, 'update Mirage plugin');
  });

  await check('lean receipts strip artifact bodies recursively', () => {
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

  await check('MCP payload is a thin starter; file workflow + sync guidance live in AGENTS.md', () => {
    const mcpRoute = readFileSync('server/routes/mcp.ts', 'utf8');
    assert.match(mcpRoute, /operate from AGENTS\.md/, 'MCP instructions must hand off to AGENTS.md');
    assert.doesNotMatch(mcpRoute, /Append concise decisions to journal\.md/, 'file-workflow detail must not live in the MCP payload');
    const notebook = readFileSync('server/resources/notebook/AGENTS.template.md', 'utf8');
    assert.match(notebook, /run `mirage init` once/, 'AGENTS.md must teach token-free workspace init');
    assert.match(notebook, /Action schemas are live in MCP/, 'AGENTS.md must route schemas through MCP');
    assert.match(notebook, /Project sync is project-data only/, 'AGENTS.md must say sync does not rewrite operating files');
    assert.doesNotMatch(notebook, /commands\.powershellInstalled|config\/skills\.json|Workspace-shared files live/, 'AGENTS.md must not teach the old workspace-sync operating files model');
  });

  return results;
};

let total = 0;
for (let i = 1; i <= repeat; i += 1) {
  const results = await runChecks();
  total += results.length;
  if (verbose || repeat > 1) {
    console.log(`\nRun ${i}/${repeat}`);
    for (const result of results) console.log(`  ok ${result.name}${result.detail ? ` (${result.detail})` : ''}`);
  }
}

console.log(`Mirage agent contract smoke passed: ${total} checks over ${repeat} run${repeat === 1 ? '' : 's'}.`);
