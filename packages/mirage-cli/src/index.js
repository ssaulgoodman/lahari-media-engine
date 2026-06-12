#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const DEFAULT_API_URL = 'https://mirage-platform-production-05ca.up.railway.app';
const STATE_FILE = '.sync-state.json';
const WORKSPACE_STATE_FILE = '.mirage-workspace-state.json';
const LOCK_DIR = '.sync-state.lock';
const WORKSPACE_LOCK_DIR = '.mirage-workspace-state.lock';
const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.mirage');
const AUTH_FILE = process.env.MIRAGE_AUTH_FILE || path.join(process.env.MIRAGE_AUTH_DIR || DEFAULT_AUTH_DIR, 'auth.json');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeSlash = (value) => value.split(path.sep).join('/');
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

class CliFailure extends Error {
  constructor(code, message, details = undefined, exitCode = 1) {
    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

const fail = (code, message, details = undefined, exitCode = 1) => {
  throw new CliFailure(code, message, details, exitCode);
};

const parseArgs = (argv) => {
  const [command, projectId, maybeEntityId, maybeFilePath, ...rest] = argv;
  const optionArgs = (command === 'upload-cast-reference' || command === 'upload-environment-reference')
    ? rest
    : command === 'status' || command === 'doctor' || command === 'init'
      ? (projectId && !projectId.startsWith('-') ? argv.slice(2) : argv.slice(1))
      : command === 'login' || command === 'logout'
        ? argv.slice(1)
        : command === 'auth'
          ? (projectId && !projectId.startsWith('-') ? argv.slice(2) : argv.slice(1))
      : argv.slice(2);
  const opts = { command, projectId, cwd: process.cwd(), force: false, recoverLock: false };
  if ((command === 'status' || command === 'doctor' || command === 'init') && projectId?.startsWith('-')) {
    opts.projectId = undefined;
  }
  if (command === 'auth') {
    opts.subcommand = projectId && !projectId.startsWith('-') ? projectId : 'status';
    opts.projectId = undefined;
  }
  if (command === 'login' || command === 'logout') {
    opts.projectId = undefined;
  }
  if (command === 'init') {
    opts.projectId = undefined;
  }
  if (command === 'upload-cast-reference' || command === 'upload-environment-reference') {
    opts.entityId = maybeEntityId;
    opts.filePath = maybeFilePath ? path.resolve(maybeFilePath) : undefined;
  }
  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i];
    if (arg === '--cwd') {
      opts.cwd = path.resolve(optionArgs[i + 1] || '');
      i += 1;
    } else if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--recover-lock') {
      opts.recoverLock = true;
    } else if (arg === '--api-url') {
      opts.apiUrl = optionArgs[i + 1];
      i += 1;
    } else if (arg === '--token') {
      opts.loginToken = optionArgs[i + 1] || '';
      i += 1;
    } else if (arg === '--stdin') {
      opts.tokenFromStdin = true;
    } else if (arg === '--note') {
      opts.note = optionArgs[i + 1] || '';
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (command === 'login' && !opts.loginToken && !arg.startsWith('-')) {
      opts.loginToken = arg;
    } else {
      fail('unknown_arg', `Unknown argument: ${arg}`);
    }
  }
  return opts;
};

const help = () => `Mirage CLI ${pkg.version}

Usage:
  mirage login [--token <mcpToken> | --stdin] [--api-url <url>]
  mirage auth status [--api-url <url>]
  mirage logout
  mirage init [--cwd <dir>] [--force]
  mirage sync <projectId> [--cwd <dir>] [--force] [--recover-lock] [--api-url <url>]
  mirage status [projectId] [--cwd <dir>]
  mirage upload-cast-reference <projectId> <castMemberId> <imagePath> [--note <text>] [--api-url <url>]
  mirage upload-environment-reference <projectId> <environmentId> <imagePath> [--note <text>] [--api-url <url>]

Environment:
  MIRAGE_CLI_TOKEN  Optional one-off short-lived project token
  MIRAGE_TOKEN      Alias for MIRAGE_CLI_TOKEN
  MIRAGE_MCP_TOKEN  Optional account token fallback when not logged in
  MIRAGE_API_URL    Defaults to ${DEFAULT_API_URL}
  MIRAGE_AUTH_FILE  Optional credential-store path; defaults to ${AUTH_FILE}

Notes:
  login stores your account token locally with 0600 permissions.
  sync mints a short-lived project token automatically after login.
  init writes token-free workspace instructions once.
  sync refreshes project files only and automatically recovers dead-owner locks.
  Use --recover-lock only after confirming another sync is not actively running.
`;

const workspaceInstructions = () => `# Mirage Workspace

Mirage is an agent-operated AI video studio. This folder is a local workbench for one or more Mirage projects under \`mirage/projects/<projectId>/\`.

Your job is to move one Mirage project forward: read the current state, make smart creative decisions, choose the smallest safe Mirage action, and keep project files synced with what Mirage saves.

Mirage server state is canonical. Local files are for reading, drafting, review, generation traces, and handoff. A local edit becomes real only when you persist it with a Mirage action.

## Start Here

1. Confirm Mirage MCP is connected.
2. Call \`mirage_doctor\` on first contact.
3. Choose or create one project with \`list_projects\`, \`open_project\`, or \`create_project\`.
4. If project files are missing or stale, run \`mirage sync <projectId>\` from this folder. If the CLI is not logged in, run \`mirage login\` with the token from Mirage \`/connect\`.
5. Use synced files for long bodies and traces. Use MCP for live state and actions.

## Tools

Use cockpit tools to orient: \`mirage_doctor\`, \`list_projects\`, \`list_personas\`, \`create_project_from_persona\`, \`open_project\`, \`get_project_state\`, \`mint_cli_token\`, \`get_job\`, and \`mirage_capture_issue\`. Prefer \`mirage sync <projectId>\` after \`mirage login\`; \`mint_cli_token\` remains the one-off fallback.

Use action tools to change things: \`run_action(actionKey, input)\` for free/persistence actions, \`start_job(actionKey, input)\` for paid media generation, and \`describe_action(actionKey)\` for the one live schema you are about to use.

Action schemas are live in MCP. Do not expect local \`config/actions/*\` files in this workspace.

## Common Moves

- Concept: write the project spine, then \`run_action(apply_concept)\`.
- Script topology: before visual work exists, use \`run_action(apply_script)\`.
- Script wording after refs/boards/videos exist: use \`run_action(apply_text_edits)\`.
- Storyboard prompt work: edit \`storyboards/*.md\`, then \`run_action(apply_storyboard_prompts)\`.
- Style: use \`generate_style_candidates\`, \`apply_style_direction\`, style notes, or project prompt overrides.
- Cast/environment refs: use \`generate_candidates\`, \`list_results\`, \`lock_reference\`, or upload an artist image.
- Native storyboard image: upload with \`purpose=storyboard_image\`, then \`run_action(import_storyboard_image)\`.
- Repeatable formats: use \`run_action(list_workflows)\`, then \`run_action(apply_project_workflow)\` to apply one such as Yapper.
- Saved personas: when the artist says "make a <persona> clip about <topic>" or "run Padma/Yapper," call \`list_personas\`, then \`create_project_from_persona\` with the persona and topic. Personas own reusable identity; workflow recipes own the production format.
- Video: dry-run first with \`run_action(generate_video, { dryRun: true })\`, then \`start_job(generate_video)\` after approval.
- Audio: use \`apply_audio_plan\`, \`apply_cast_voice\`, and \`generate_dialogue_audio\` when producing dialogue/narration.

## Choosing The Lever

Do not solve every problem by regenerating. Use the smallest lever that addresses the failure.

- Use \`contextOverrides\` for one call's input bundle: include an extra guide/ref, exclude a wrong ref, drop the style image, include previous storyboard, or change style-note sections.
- Use \`promptOverride\` when one paid call needs an exact final model prompt.
- Use personas for repeated identity so the artist does not re-upload the same character image, re-enter the same voice id, or re-explain the same tone lane.
- Use style notes for reusable taste or model phrasing.
- Use image edit/refine when the asset is mostly right. Regenerate when staging, premise, panel structure, or reference use is wrong.
- Use native imagegen plus \`import_storyboard_image\` when outside image work beats Mirage generation.
- Add extra uploaded refs for unusual shot needs such as a painting, product, logo, prop, or special environment detail.

Reference language should stay clean. The renderer receives attached images with explicit roles; prompt text should use graph names and object roles, not long wardrobe/style re-descriptions.

## Files

Project files live under \`mirage/projects/<projectId>/\`:

- \`state/\` — read-only snapshots from Mirage. Do not edit.
- \`state/generation-traces/\` — recent model calls with final prompt, refs, model, outputs, duration, and cost.
- \`script.md\`, \`audio-plan.md\`, \`storyboards/*.md\` — editable drafts. Persist them with apply actions.
- \`config/style-notes.json\` — reusable per-surface taste notes.
- \`config/preferences.json\` — model/provider preferences.
- \`config/prompts/*.md\` — optional project prompt overrides. This is not a prompt log.
- \`notebook.json\` — project metadata and hashes.
- \`journal.md\` — local handoff notes. Helpful, not canonical truth.

Skills come from the installed Mirage plugin. Load the relevant skill for non-trivial creative work: concept-writer, script-writer, art-director, casting-director, sound-director, audio-director, storyboarding, or video-director.

## Working Rules

- Ask before paid generation, locks/unlocks, replacing approved assets, prompt override changes, publishing, or script topology rebuilds.
- Preserve downstream work. Once refs, boards, videos, or audio exist, prefer narrow edits that mark affected outputs stale instead of wiping them.
- Use generation traces before guessing why a look, board, or video drifted.
- Sync after important mutations.
- Capture product/tool bugs with \`mirage_capture_issue\`.

Be concise and specific. Name the artifact, the issue, why it matters, and the next action.
`;

const safeJoin = (root, relativePath) => {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error(`Unsafe notebook path: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  const rootWithSep = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Notebook path escapes workspace: ${relativePath}`);
  }
  return resolved;
};

const readJson = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const readAuth = () => readJson(AUTH_FILE, null);

const writeAuth = (auth) => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(AUTH_FILE, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(AUTH_FILE, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
};

const removeAuth = () => {
  if (fs.existsSync(AUTH_FILE)) fs.rmSync(AUTH_FILE, { force: true });
};

const envCliToken = () => process.env.MIRAGE_CLI_TOKEN || process.env.MIRAGE_TOKEN || '';
const envMcpToken = () => process.env.MIRAGE_MCP_TOKEN || '';

const storedMcpToken = () => {
  const auth = readAuth();
  return auth?.mcpToken || '';
};

const accountToken = () => envMcpToken() || storedMcpToken();

const tokenPrefix = (value) => value ? value.slice(0, 18) : null;

const readTextIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

const workspaceInitFiles = () => {
  const content = workspaceInstructions();
  return [
    {
      path: 'AGENTS.md',
      content,
      mode: 'instructions',
      writePolicy: 'create_if_missing',
      scope: 'workspace',
    },
    {
      path: 'CLAUDE.md',
      content,
      mode: 'instructions',
      writePolicy: 'create_if_missing',
      scope: 'workspace',
    },
  ];
};

const workspaceFileKind = (relativePath) => {
  if (relativePath === 'AGENTS.md' || relativePath === 'CLAUDE.md') return 'instructions';
  return 'workspace';
};

const collectFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) return stat.isFile() ? [dirPath] : [];
  const files = [];
  for (const name of fs.readdirSync(dirPath)) {
    files.push(...collectFiles(path.join(dirPath, name)));
  }
  return files;
};

const removeEmptyDirsUpTo = (dirPath, stopDir) => {
  let current = path.resolve(dirPath);
  const stop = path.resolve(stopDir);
  while (current.startsWith(stop) && current !== stop) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
};

const pruneTree = (workspace, relativePath, reason, pruned) => {
  const absolutePath = safeJoin(workspace, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  fs.rmSync(absolutePath, { recursive: true, force: true });
  pruned.push({ path: relativePath, reason });
};

const pruneSyncLockArchives = (workspace, projectId, pruned) => {
  const projectDir = safeJoin(workspace, `mirage/projects/${projectId}`);
  if (!fs.existsSync(projectDir)) return;
  for (const name of fs.readdirSync(projectDir)) {
    if (!name.startsWith(`${LOCK_DIR}.stale-`) && !name.startsWith(`${LOCK_DIR}.orphan-`)) continue;
    pruneTree(workspace, `mirage/projects/${projectId}/${name}`, 'old_sync_lock_archive', pruned);
  }
};

const summarizeSyncForOperator = (manifest, written, skipped) => {
  const currentByPath = new Map(skipped.map((item) => [item.path, item.reason]));
  const writtenPaths = new Set(written.map((item) => item.path));
  const statusFor = (path) => {
    if (writtenPaths.has(path)) return 'updated';
    const reason = currentByPath.get(path);
    if (reason === 'local_matches_server' || reason === 'unchanged') return 'current';
    if (reason) return reason;
    return 'not_present';
  };
  return {
    projectFiles: {
      total: manifest.length,
      written: written.length,
      skipped: skipped.length,
    },
    operatingFiles: {
      source: 'plugin_or_init',
      touchedBySync: false,
      skills: 'plugin',
      actions: 'mcp',
    },
    sessionReloadNeeded: false,
    sessionReloadReason: null,
    userAction: 'Project files are synced. No fresh chat is needed from project sync; update/restart only after installing or updating the Mirage plugin.',
  };
};

const lockTtlMs = () => {
  const n = Number(process.env.MIRAGE_SYNC_LOCK_TTL_MS || DEFAULT_LOCK_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOCK_TTL_MS;
};

const safeTimestamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const relativeFromWorkspace = (workspace, absolutePath) => normalizeSlash(path.relative(workspace, absolutePath));

const readLockOwner = (lockPath) => {
  const owner = readJson(path.join(lockPath, 'owner.json'), null);
  let stat = null;
  try {
    stat = fs.statSync(lockPath);
  } catch {
    // Best effort; owner metadata is enough when present.
  }
  const createdAt = owner?.createdAt || (stat?.mtime ? stat.mtime.toISOString() : null);
  const createdMs = createdAt ? Date.parse(createdAt) : NaN;
  const ageMs = Number.isFinite(createdMs) ? Date.now() - createdMs : null;
  return {
    ...owner,
    createdAt,
    ageMs,
    lockPath,
  };
};

const describeLock = (lockPath) => {
  if (!fs.existsSync(lockPath)) {
    return { present: false, state: 'clear', path: lockPath };
  }
  const owner = readLockOwner(lockPath);
  const ownerPidStatus = pidStatus(owner.pid);
  const ttlMs = lockTtlMs();
  const staleReason = ownerPidStatus === 'dead'
    ? 'dead_pid'
    : owner.ageMs != null && owner.ageMs > ttlMs
      ? 'ttl_expired'
      : null;
  return {
    present: true,
    state: staleReason ? 'stale' : 'active',
    staleReason,
    ownerPidStatus,
    lockTtlMs: ttlMs,
    owner,
    path: lockPath,
  };
};

const pidStatus = (pid) => {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return 'unknown';
  try {
    process.kill(n, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead';
    if (error?.code === 'EPERM') return 'alive';
    return 'unknown';
  }
};

const moveStaleLockAside = (lockPath, owner) => {
  const suffix = safeTimestamp(owner?.createdAt ? new Date(owner.createdAt) : new Date());
  let target = `${lockPath}.stale-${suffix}`;
  if (fs.existsSync(target)) target = `${target}-${process.pid}`;
  fs.renameSync(lockPath, target);
  return target;
};

const acquireLock = (lockPath, opts = {}) => {
  const scopeLabel = opts.scopeLabel || 'project';
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    fs.mkdirSync(lockPath);
    writeText(path.join(lockPath, 'owner.json'), `${JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      cliVersion: pkg.version,
      cwd: process.cwd(),
      scope: scopeLabel,
    }, null, 2)}\n`);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const owner = readLockOwner(lockPath);
      const ttlMs = lockTtlMs();
      const ownerPidStatus = pidStatus(owner.pid);
      const recoveryReason = opts.recoverLock
        ? 'forced'
        : ownerPidStatus === 'dead'
          ? 'dead_pid'
          : owner.ageMs != null && owner.ageMs > ttlMs
            ? 'ttl_expired'
            : null;
      if (recoveryReason) {
        const movedTo = moveStaleLockAside(lockPath, owner);
        try {
          fs.mkdirSync(lockPath);
          writeText(path.join(lockPath, 'owner.json'), `${JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
            cliVersion: pkg.version,
            cwd: process.cwd(),
            scope: scopeLabel,
            replacedStaleLock: {
              movedTo,
              reason: recoveryReason,
              previousOwner: owner,
            },
          }, null, 2)}\n`);
        } catch (retryError) {
          if (retryError?.code === 'EEXIST') {
            fail('sync_already_running', `Another Mirage notebook sync started while replacing a stale ${scopeLabel} lock. Retry once.`, { lockPath, scope: scopeLabel, movedTo }, 4);
          }
          throw retryError;
        }
      } else {
        fail('sync_already_running', `Another Mirage notebook sync appears to be running for this ${scopeLabel}. Wait for it to finish, then retry.`, {
          lockPath,
          scope: scopeLabel,
          owner,
          ownerPidStatus,
          lockTtlMs: ttlMs,
          recovery: 'If you have confirmed no sync is running, retry with --recover-lock.',
        }, 4);
      }
    } else {
      throw error;
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fs.rmSync(lockPath, { recursive: true, force: true });
  };
};

const apiUrl = (opts) => (opts.apiUrl || process.env.MIRAGE_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

const authFetchJson = async (url, opts = {}) => {
  const response = await fetch(url, opts);
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    fail('invalid_response', `Mirage returned a non-JSON response with HTTP ${response.status}. Is the latest server deployed?`, { status: response.status }, 1);
  }
  if (!response.ok || json?.ok === false) {
    const err = json?.error || { code: 'request_failed', message: `Request failed with HTTP ${response.status}`, details: json };
    fail(err.code || 'request_failed', err.message || 'Request failed', err.details || err, response.status === 401 ? 2 : 1);
  }
  return json.data;
};

const verifyAccountToken = async (opts, bearer) => authFetchJson(`${apiUrl(opts)}/api/notebook-sync/auth/status`, {
  method: 'GET',
  headers: {
    authorization: `Bearer ${bearer}`,
    'x-mirage-cli-version': pkg.version,
  },
});

const mintProjectCliToken = async (opts) => {
  const oneOffToken = envCliToken();
  if (oneOffToken) return { token: oneOffToken, source: 'env_cli_token' };
  const bearer = accountToken();
  if (!bearer) {
    fail(
      'auth_missing',
      'Run `mirage login` with the token from Mirage /connect, or set MIRAGE_CLI_TOKEN for a one-off sync.',
      { authFile: AUTH_FILE },
      2,
    );
  }
  const data = await authFetchJson(`${apiUrl(opts)}/api/notebook-sync/projects/${encodeURIComponent(opts.projectId)}/cli-token`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-mirage-cli-version': pkg.version,
    },
    body: JSON.stringify({ ttlMinutes: 60 }),
  });
  return { token: data.token, source: envMcpToken() ? 'env_mcp_token' : 'stored_mcp_token', tokenPrefix: data.tokenPrefix, expiresAt: data.expiresAt };
};

const readLoginToken = async (opts) => {
  if (opts.loginToken) return opts.loginToken.trim();
  if (opts.tokenFromStdin || !process.stdin.isTTY) {
    return fs.readFileSync(0, 'utf8').trim();
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('Paste Mirage token from /connect: ')).trim();
  } finally {
    rl.close();
  }
};

const login = async (opts) => {
  const bearer = await readLoginToken(opts);
  if (!bearer) fail('auth_missing', 'No token provided. Run `mirage login` and paste the token from Mirage /connect.', undefined, 2);
  if (!bearer.startsWith('mirage_mcp_') && !bearer.startsWith('lahari_mcp_')) {
    fail('invalid_token', 'That does not look like a Mirage MCP token from /connect.', { tokenPrefix: tokenPrefix(bearer) }, 2);
  }
  const status = await verifyAccountToken(opts, bearer);
  if (status.tokenKind !== 'mcp') {
    fail('wrong_token_kind', 'mirage login requires an account-scoped MCP token from /connect, not a short-lived project token.', status, 2);
  }
  const auth = {
    kind: 'mirage.cli.auth',
    apiUrl: apiUrl(opts),
    mcpToken: bearer,
    tokenPrefix: tokenPrefix(bearer),
    savedAt: new Date().toISOString(),
    cliVersion: pkg.version,
  };
  writeAuth(auth);
  output({
    ok: true,
    kind: 'mirage.cli.login',
    apiUrl: auth.apiUrl,
    authFile: AUTH_FILE,
    tokenPrefix: auth.tokenPrefix,
    savedAt: auth.savedAt,
    next: 'Run `mirage init` once in a workspace, then `mirage sync <projectId>` without calling mint_cli_token.',
  });
};

const logout = async () => {
  removeAuth();
  output({
    ok: true,
    kind: 'mirage.cli.logout',
    authFile: AUTH_FILE,
    loggedOutAt: new Date().toISOString(),
  });
};

const authStatus = async (opts) => {
  const auth = readAuth();
  const bearer = envMcpToken() || auth?.mcpToken || '';
  if (!bearer) {
    output({
      ok: false,
      kind: 'mirage.cli.auth.status',
      authenticated: false,
      authFile: AUTH_FILE,
      userAction: 'Run `mirage login` and paste the token from Mirage /connect.',
    });
    process.exitCode = 2;
    return;
  }
  const status = await verifyAccountToken(opts, bearer);
  output({
    ok: true,
    kind: 'mirage.cli.auth.status',
    authenticated: true,
    apiUrl: apiUrl(opts),
    authFile: AUTH_FILE,
    tokenSource: envMcpToken() ? 'env:MIRAGE_MCP_TOKEN' : 'stored',
    tokenKind: status.tokenKind,
    scopeProjectId: status.scopeProjectId,
    tokenPrefix: status.tokenPrefix || tokenPrefix(bearer),
    canAutoMintProjectTokens: status.tokenKind === 'mcp',
  });
};

const mimeFromPath = (filePath) => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
};

const postNotebookSync = async (opts, knownHashes) => {
  const auth = await mintProjectCliToken(opts);
  const response = await fetch(`${apiUrl(opts)}/api/notebook-sync/projects/${encodeURIComponent(opts.projectId)}/notebook`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${auth.token}`,
      'content-type': 'application/json',
      'x-mirage-cli-version': pkg.version,
      'x-mirage-cli-auth-source': auth.source,
    },
    body: JSON.stringify({ knownHashes }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.ok === false) {
    const err = json?.error || { code: 'notebook_sync_failed', message: `Notebook sync failed with HTTP ${response.status}`, details: json };
    fail(err.code || 'notebook_sync_failed', err.message || 'Notebook sync failed', err.details || err, response.status === 401 ? 2 : 1);
  }
  return json.data;
};

const fileStatusFromState = (workspace, files = {}) => {
  const rows = [];
  let missing = 0;
  let modified = 0;
  let current = 0;
  let local = 0;
  for (const [relativePath, entry] of Object.entries(files)) {
    let status = 'unknown';
    try {
      const absolutePath = safeJoin(workspace, relativePath);
      const content = readTextIfExists(absolutePath);
      if (content == null) {
        status = 'missing';
        missing += 1;
      } else if (sha256(content) === entry.hash) {
        status = 'current';
        current += 1;
      } else if (entry.writePolicy === 'create_if_missing') {
        status = 'local';
        local += 1;
      } else {
        status = 'modified';
        modified += 1;
      }
    } catch {
      status = 'unsafe_path';
      modified += 1;
    }
    rows.push({ path: relativePath, scope: entry.scope || 'project', status, kind: workspaceFileKind(relativePath) });
  }
  return {
    current,
    local,
    modified,
    missing,
    total: rows.length,
    files: rows,
    modifiedFiles: rows.filter((row) => row.status === 'modified').map((row) => row.path).slice(0, 20),
    missingFiles: rows.filter((row) => row.status === 'missing').map((row) => row.path).slice(0, 20),
  };
};

const discoverProjectIds = (workspace) => {
  const projectsDir = safeJoin(workspace, 'mirage/projects');
  if (!fs.existsSync(projectsDir)) return [];
  return fs.readdirSync(projectsDir)
    .filter((name) => {
      try {
        return fs.statSync(path.join(projectsDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
};

const readProjectNotebookSummary = (workspace, projectId) => {
  const notebookPath = safeJoin(workspace, `mirage/projects/${projectId}/notebook.json`);
  const notebook = readJson(notebookPath, null);
  if (!notebook) return null;
  return {
    path: relativeFromWorkspace(workspace, notebookPath),
    project: notebook.project || null,
    generatedAt: notebook.generatedAt || null,
    syncedAt: notebook.syncedAt || null,
    notebookSchemaVersion: notebook.notebookSchemaVersion || notebook.notebookVersion || null,
    skillsHash: notebook.skillsHash || null,
    actionsHash: notebook.actionsHash || null,
  };
};

const init = async (opts) => {
  const workspace = path.resolve(opts.cwd);
  const workspaceStatePath = safeJoin(workspace, WORKSPACE_STATE_FILE);
  const previousWorkspaceState = readJson(workspaceStatePath, { files: {} });
  const written = [];
  const skipped = [];
  const conflicts = [];
  const files = workspaceInitFiles();

  for (const entry of files) {
    const absolutePath = safeJoin(workspace, entry.path);
    const localContent = readTextIfExists(absolutePath);
    const localHash = localContent == null ? null : sha256(localContent);
    const incomingHash = sha256(entry.content);
    const lastKnownHash = previousWorkspaceState.files?.[entry.path]?.hash || null;

    if (localHash === incomingHash) {
      skipped.push({ path: entry.path, reason: 'local_matches_init_template' });
      continue;
    }

    if (localContent != null && !opts.force) {
      const localChanged = lastKnownHash ? localHash !== lastKnownHash : true;
      if (localChanged) {
        conflicts.push({ path: entry.path, reason: 'local_file_exists', localHash, templateHash: incomingHash });
        continue;
      }
    }

    writeText(absolutePath, entry.content);
    written.push({ path: entry.path, bytes: Buffer.byteLength(entry.content, 'utf8') });
  }

  const nextFiles = {
    ...(previousWorkspaceState.files || {}),
  };
  for (const entry of files) {
    if (conflicts.some((conflict) => conflict.path === entry.path)) continue;
    nextFiles[entry.path] = {
      hash: sha256(entry.content),
      mode: entry.mode,
      scope: entry.scope,
      writePolicy: entry.writePolicy,
      size: Buffer.byteLength(entry.content, 'utf8'),
      source: 'mirage_cli_init',
    };
  }

  writeText(workspaceStatePath, `${JSON.stringify({
    kind: 'mirage.notebook.workspace_state',
    workspaceInitializedAt: previousWorkspaceState.workspaceInitializedAt || new Date().toISOString(),
    workspaceUpdatedAt: new Date().toISOString(),
    cliVersion: pkg.version,
    operatingSource: 'mirage_cli_init',
    lastProject: previousWorkspaceState.lastProject || null,
    files: nextFiles,
  }, null, 2)}\n`);

  output({
    ok: conflicts.length === 0,
    kind: 'mirage.cli.init',
    cwd: workspace,
    initializedAt: new Date().toISOString(),
    written: written.length,
    skipped: skipped.length,
    conflicted: conflicts.length,
    conflicts,
    summary: {
      operatingFiles: written.length ? 'updated' : 'current',
      tokenRequired: false,
      next: conflicts.length
        ? 'Review existing AGENTS.md/CLAUDE.md, then rerun with --force only if you want Mirage to replace them.'
        : 'Workspace is initialized. Use Mirage MCP to open a project, then run mirage sync <projectId>. If not logged in, run mirage login first.',
    },
    details: { written, skipped },
  });
  process.exitCode = conflicts.length ? 3 : 0;
};

const status = async (opts) => {
  const workspace = path.resolve(opts.cwd);
  const workspaceStatePath = safeJoin(workspace, WORKSPACE_STATE_FILE);
  const workspaceState = readJson(workspaceStatePath, null);
  const expectedWorkspaceFiles = Object.fromEntries(workspaceInitFiles().map((entry) => [
    entry.path,
    {
      hash: sha256(entry.content),
      mode: entry.mode,
      scope: entry.scope,
      writePolicy: entry.writePolicy,
      size: Buffer.byteLength(entry.content, 'utf8'),
      source: 'mirage_cli_init',
    },
  ]));
  const workspaceFiles = fileStatusFromState(workspace, expectedWorkspaceFiles);
  const projectIds = discoverProjectIds(workspace);
  const projectSummaries = projectIds.map((projectId) => {
    const statePath = safeJoin(workspace, `mirage/projects/${projectId}/${STATE_FILE}`);
    const state = readJson(statePath, null);
    const files = fileStatusFromState(workspace, state?.files || {});
    const notebook = readProjectNotebookSummary(workspace, projectId);
    return {
      projectId,
      title: notebook?.project?.title || state?.project?.title || null,
      statePath: relativeFromWorkspace(workspace, statePath),
      initialized: !!state,
      syncedAt: state?.syncedAt || notebook?.syncedAt || null,
      generatedAt: notebook?.generatedAt || null,
      notebookSchemaVersion: notebook?.notebookSchemaVersion || state?.notebookVersion || null,
      skillsHash: notebook?.skillsHash || null,
      actionsHash: notebook?.actionsHash || null,
      files: {
        current: files.current,
        local: files.local,
        modified: files.modified,
        missing: files.missing,
        total: files.total,
        modifiedFiles: files.modifiedFiles,
        missingFiles: files.missingFiles,
      },
      lock: describeLock(safeJoin(workspace, `mirage/projects/${projectId}/${LOCK_DIR}`)),
    };
  });
  const selectedProjectId = opts.projectId || workspaceState?.lastProject?.id || projectSummaries[0]?.projectId || null;
  const selectedProject = selectedProjectId
    ? projectSummaries.find((project) => project.projectId === selectedProjectId) || {
      projectId: selectedProjectId,
      initialized: false,
      files: { current: 0, local: 0, modified: 0, missing: 0, total: 0, modifiedFiles: [], missingFiles: [] },
      lock: describeLock(safeJoin(workspace, `mirage/projects/${selectedProjectId}/${LOCK_DIR}`)),
    }
    : null;
  const workspaceLock = describeLock(safeJoin(workspace, WORKSPACE_LOCK_DIR));
  const hasAgentsMd = fs.existsSync(safeJoin(workspace, 'AGENTS.md'));
  const hasClaudeMd = fs.existsSync(safeJoin(workspace, 'CLAUDE.md'));
  const rootIssues = [
    !workspaceState ? 'workspace_not_initialized' : null,
    workspaceFiles.modified ? 'workspace_files_modified_since_sync' : null,
    workspaceFiles.missing ? 'workspace_files_missing_since_sync' : null,
    workspaceLock.state === 'active' ? 'workspace_sync_running' : null,
    workspaceLock.state === 'stale' ? 'stale_workspace_lock' : null,
  ].filter(Boolean);
  const projectIssues = selectedProject ? [
    !selectedProject.initialized ? 'project_not_synced' : null,
    selectedProject.files.modified ? 'project_files_modified_since_sync' : null,
    selectedProject.files.missing ? 'project_files_missing_since_sync' : null,
    selectedProject.lock.state === 'active' ? 'project_sync_running' : null,
    selectedProject.lock.state === 'stale' ? 'stale_project_lock' : null,
  ].filter(Boolean) : ['no_project_selected'];
  const issues = [...rootIssues, ...projectIssues];
  const operatingReady = !!workspaceState
    && hasAgentsMd
    && hasClaudeMd
    && workspaceFiles.missing === 0
    && workspaceFiles.modified === 0;
  const projectReady = !!selectedProject?.initialized
    && selectedProject.files.missing === 0
    && selectedProject.files.modified === 0;
  const staleLocks = [workspaceLock, selectedProject?.lock].filter((lock) => lock?.state === 'stale');
  const verdict = issues.length === 0
    ? 'ready'
    : staleLocks.length && issues.every((issue) => issue.startsWith('stale_'))
      ? 'recover_lock_then_sync'
      : 'needs_attention';
  const userAction = (() => {
    if (!workspaceState || !hasAgentsMd || !hasClaudeMd) return 'Run mirage init in this workspace, then open or sync a Mirage project.';
    if (staleLocks.length) return 'Run the same sync command with --recover-lock only after confirming no sync is active.';
    if (!selectedProject?.initialized) return selectedProjectId ? `Run mirage sync ${selectedProjectId}.` : 'Open or create a Mirage project, then sync it.';
    if (workspaceFiles.modified || workspaceFiles.missing || selectedProject.files.modified || selectedProject.files.missing) return 'Run mirage sync for the active project. Review conflicts if the sync reports local edits.';
    return 'Workspace is ready. Continue with Mirage MCP actions; sync after important mutations.';
  })();

  output({
    ok: verdict === 'ready',
    kind: 'mirage.cli.status',
    checkedAt: new Date().toISOString(),
    cli: {
      package: pkg.name,
      version: pkg.version,
    },
    workspace: {
      cwd: workspace,
      initialized: !!workspaceState,
      statePath: WORKSPACE_STATE_FILE,
      syncedAt: workspaceState?.syncedAt || null,
      notebookSchemaVersion: workspaceState?.notebookVersion || null,
      lastProject: workspaceState?.lastProject || null,
      files: {
        current: workspaceFiles.current,
        local: workspaceFiles.local,
        modified: workspaceFiles.modified,
        missing: workspaceFiles.missing,
        total: workspaceFiles.total,
        modifiedFiles: workspaceFiles.modifiedFiles,
        missingFiles: workspaceFiles.missingFiles,
      },
      operatingFiles: {
        agentsMd: hasAgentsMd,
        claudeMd: hasClaudeMd,
        skillsSource: 'plugin',
        actionsSource: 'mcp',
      },
      lock: workspaceLock,
    },
    project: selectedProject,
    projects: projectSummaries.map((project) => ({
      projectId: project.projectId,
      title: project.title,
      syncedAt: project.syncedAt,
      generatedAt: project.generatedAt,
      ready: project.initialized && project.files.modified === 0 && project.files.missing === 0 && project.lock.state === 'clear',
    })),
    freshness: {
      skillsHash: selectedProject?.skillsHash || null,
      actionsHash: selectedProject?.actionsHash || null,
      skillsSource: 'plugin',
      actionsSource: 'mcp',
      freshChatRecommended: false,
      note: 'Skills come from the installed Mirage plugin. Action schemas come from live MCP list_actions/describe_action.',
    },
    verdict: {
      status: verdict,
      operatingReady,
      projectReady,
      issues,
      userAction,
    },
  });
};

const sync = async (opts) => {
  if (!opts.projectId) fail('missing_project_id', 'Usage: mirage sync <projectId>');
  const workspace = path.resolve(opts.cwd);
  const statePath = safeJoin(workspace, `mirage/projects/${opts.projectId}/${STATE_FILE}`);
  const workspaceStatePath = safeJoin(workspace, WORKSPACE_STATE_FILE);
  let releaseWorkspaceLock = null;
  let releaseProjectLock = null;
  const lockReceipt = {
    workspace: { path: WORKSPACE_LOCK_DIR, acquired: false },
    project: { path: `mirage/projects/${opts.projectId}/${LOCK_DIR}`, acquired: false },
  };
  try {
  releaseWorkspaceLock = acquireLock(safeJoin(workspace, WORKSPACE_LOCK_DIR), { recoverLock: opts.recoverLock, scopeLabel: 'workspace' });
  lockReceipt.workspace.acquired = true;
  releaseProjectLock = acquireLock(safeJoin(workspace, `mirage/projects/${opts.projectId}/${LOCK_DIR}`), { recoverLock: opts.recoverLock, scopeLabel: 'project' });
  lockReceipt.project.acquired = true;
  const previousProjectState = readJson(statePath, { files: {} });
  const previousWorkspaceState = readJson(workspaceStatePath, { files: {} });
  const previousProjectFiles = previousProjectState.files || {};
  const previousFiles = { ...previousProjectFiles };
  const knownHashes = {};
  for (const [relativePath, entry] of Object.entries(previousFiles)) {
    try {
      const absolutePath = safeJoin(workspace, relativePath);
      if (fs.existsSync(absolutePath)) knownHashes[relativePath] = entry.hash;
    } catch {
      // Ignore stale unsafe paths from old state files.
    }
  }

  const remote = await postNotebookSync(opts, knownHashes);
  const remoteManifest = remote.manifest || [];
  const manifest = remoteManifest.filter((entry) => (entry.scope || 'project') !== 'workspace');
  const manifestByPath = new Map(manifest.map((entry) => [entry.path, entry]));
  const contentByPath = new Map((remote.files || [])
    .filter((entry) => (entry.scope || 'project') !== 'workspace')
    .map((entry) => [entry.path, entry]));
  const written = [];
  const skipped = [];
  const removed = [];
  const pruned = [];
  const conflicts = [];

  for (const entry of manifest) {
    const absolutePath = safeJoin(workspace, entry.path);
    const incoming = contentByPath.get(entry.path);
    const localContent = readTextIfExists(absolutePath);
    const localHash = localContent == null ? null : sha256(localContent);
    const lastKnownHash = previousFiles[entry.path]?.hash || null;

    if (!incoming) {
      skipped.push({ path: entry.path, reason: 'unchanged' });
      continue;
    }

    if (entry.writePolicy === 'create_if_missing' && localContent != null) {
      skipped.push({ path: entry.path, reason: 'exists_create_if_missing' });
      continue;
    }

    if (localContent != null && localHash === entry.hash) {
      skipped.push({ path: entry.path, reason: 'local_matches_server' });
      continue;
    }

    if (entry.writePolicy === 'review_before_overwrite' && localContent != null && !opts.force) {
      const localChanged = lastKnownHash && localHash !== lastKnownHash;
      const serverChanged = lastKnownHash && entry.hash !== lastKnownHash;
      if (localChanged && serverChanged) {
        conflicts.push({ path: entry.path, reason: 'local_and_server_changed', localHash, lastKnownHash, serverHash: entry.hash });
        continue;
      }
      if (!lastKnownHash && localHash !== entry.hash) {
        conflicts.push({ path: entry.path, reason: 'untracked_local_file', localHash, serverHash: entry.hash });
        continue;
      }
    }

    writeText(absolutePath, incoming.content);
    written.push({ path: entry.path, bytes: Buffer.byteLength(incoming.content, 'utf8') });
  }

  const removedCandidates = new Set([
    ...Object.keys(previousFiles).filter((filePath) => !manifestByPath.has(filePath)),
    ...(remote.removedFiles || []).filter((filePath) => {
      const entry = remoteManifest.find((row) => row.path === filePath);
      return (entry?.scope || 'project') !== 'workspace' && filePath.startsWith(`mirage/projects/${opts.projectId}/`);
    }),
  ]);
  for (const relativePath of removedCandidates) {
    const entry = previousFiles[relativePath];
    if (!entry) continue;
    const absolutePath = safeJoin(workspace, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const localHash = sha256(fs.readFileSync(absolutePath, 'utf8'));
    if (localHash !== entry.hash && !opts.force) {
      conflicts.push({ path: relativePath, reason: 'removed_remote_but_local_changed', localHash, lastKnownHash: entry.hash });
      continue;
    }
    fs.unlinkSync(absolutePath);
    removed.push({ path: relativePath });
  }

  const legacyGeneratedPaths = [
    `mirage/projects/${opts.projectId}/config/skills.json`,
    `mirage/projects/${opts.projectId}/config/actions`,
  ];
  for (const relativePath of legacyGeneratedPaths) {
    if (manifestByPath.has(relativePath)) continue;
    const absolutePath = safeJoin(workspace, relativePath);
    for (const filePath of collectFiles(absolutePath)) {
      const fileRelativePath = normalizeSlash(path.relative(workspace, filePath));
      if (manifestByPath.has(fileRelativePath)) continue;
      fs.unlinkSync(filePath);
      removeEmptyDirsUpTo(path.dirname(filePath), path.dirname(absolutePath));
      pruned.push({ path: fileRelativePath, reason: 'old_project_scoped_workspace_file' });
    }
    if (fs.existsSync(absolutePath)) {
      pruneTree(workspace, relativePath, 'old_project_scoped_workspace_file', pruned);
    }
  }
  pruneSyncLockArchives(workspace, opts.projectId, pruned);

  const nextProjectFiles = {};
  for (const entry of manifest) {
    if (conflicts.some((conflict) => conflict.path === entry.path)) {
      if (previousProjectFiles[entry.path]) nextProjectFiles[entry.path] = previousProjectFiles[entry.path];
      continue;
    }
    nextProjectFiles[entry.path] = {
      hash: entry.hash,
      mode: entry.mode,
      scope: entry.scope || 'project',
      writePolicy: entry.writePolicy,
      size: entry.size,
    };
  }
  writeText(workspaceStatePath, `${JSON.stringify({
    kind: previousWorkspaceState.kind || 'mirage.notebook.workspace_state',
    notebookVersion: remote.notebookVersion,
    workspaceInitializedAt: previousWorkspaceState.workspaceInitializedAt || null,
    workspaceUpdatedAt: previousWorkspaceState.workspaceUpdatedAt || previousWorkspaceState.syncedAt || null,
    lastProject: remote.project,
    syncedAt: new Date().toISOString(),
    operatingSource: previousWorkspaceState.operatingSource || 'plugin_or_init',
    files: Object.fromEntries(Object.entries(previousWorkspaceState.files || {})
      .filter(([relativePath]) => workspaceInitFiles().some((entry) => entry.path === relativePath))),
  }, null, 2)}\n`);
  writeText(statePath, `${JSON.stringify({
    kind: 'mirage.notebook.sync_state',
    notebookVersion: remote.notebookVersion,
    project: remote.project,
    syncedAt: new Date().toISOString(),
    files: nextProjectFiles,
  }, null, 2)}\n`);

  output({
    ok: conflicts.length === 0,
    kind: 'mirage.cli.sync',
    projectId: opts.projectId,
    notebookSchemaVersion: remote.notebookVersion,
    generatedAt: remote.generatedAt,
    skillsHash: remote.skillsHash,
    actionsHash: remote.actionsHash,
    syncedAt: new Date().toISOString(),
    written: written.length,
    skipped: skipped.length,
    removed: removed.length,
    pruned: pruned.length,
    conflicted: conflicts.length,
    conflicts,
    summary: summarizeSyncForOperator(manifest, written, skipped),
    details: {
      locks: lockReceipt,
      written,
      skipped,
      removed,
      pruned,
      scopes: {
        workspace: 0,
        project: Object.keys(nextProjectFiles).length,
      },
    },
  });
  process.exitCode = conflicts.length ? 3 : 0;
  } finally {
    releaseProjectLock?.();
    releaseWorkspaceLock?.();
  }
};

const uploadReference = async (opts) => {
  if (!opts.projectId || !opts.entityId || !opts.filePath) {
    const usage = opts.command === 'upload-environment-reference'
      ? 'Usage: mirage upload-environment-reference <projectId> <environmentId> <imagePath>'
      : 'Usage: mirage upload-cast-reference <projectId> <castMemberId> <imagePath>';
    fail('missing_args', usage);
  }
  const auth = await mintProjectCliToken(opts);
  if (!fs.existsSync(opts.filePath)) fail('file_not_found', `Image file not found: ${opts.filePath}`);
  const stat = fs.statSync(opts.filePath);
  if (!stat.isFile()) fail('not_a_file', `Path is not a file: ${opts.filePath}`);
  const maxBytes = Number(process.env.MIRAGE_UPLOAD_MAX_BYTES || 18 * 1024 * 1024);
  if (stat.size > maxBytes) {
    fail('file_too_large', `Image file is ${stat.size} bytes; max is ${maxBytes}. Compress it or set MIRAGE_UPLOAD_MAX_BYTES.`);
  }

  const entityPath = opts.command === 'upload-environment-reference'
    ? `environments/${encodeURIComponent(opts.entityId)}`
    : `cast/${encodeURIComponent(opts.entityId)}`;
  const response = await fetch(`${apiUrl(opts)}/api/notebook-sync/projects/${encodeURIComponent(opts.projectId)}/references/${entityPath}/upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${auth.token}`,
      'content-type': 'application/json',
      'x-mirage-cli-version': pkg.version,
      'x-mirage-cli-auth-source': auth.source,
    },
    body: JSON.stringify({
      filename: path.basename(opts.filePath),
      mimeType: mimeFromPath(opts.filePath),
      base64: fs.readFileSync(opts.filePath).toString('base64'),
      note: opts.note || undefined,
    }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.ok === false) {
    const err = json?.error || json?.data || { code: 'reference_upload_failed', message: `Reference upload failed with HTTP ${response.status}`, details: json };
    fail(err.code || err.error || 'reference_upload_failed', err.message || 'Reference upload failed', err.details || err, response.status === 401 ? 2 : 1);
  }
  output({
    ok: true,
    kind: `mirage.cli.${opts.command}`,
    projectId: opts.projectId,
    filePath: opts.filePath,
    uploadedAt: new Date().toISOString(),
    result: json.data,
  });
};

try {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.command || opts.help || opts.command === '--help' || opts.command === '-h') {
    process.stdout.write(help());
    process.exit(0);
  }
  if (opts.command === 'login') {
    await login(opts);
  } else if (opts.command === 'logout') {
    await logout(opts);
  } else if (opts.command === 'auth' && opts.subcommand === 'status') {
    await authStatus(opts);
  } else if (opts.command === 'auth') {
    fail('unknown_command', `Unknown auth command: ${opts.subcommand}`, { help: 'Usage: mirage auth status [--api-url <url>]' });
  } else if (opts.command === 'init') {
    await init(opts);
  } else if (opts.command === 'sync') {
    await sync(opts);
  } else if (opts.command === 'status' || opts.command === 'doctor') {
    await status(opts);
  } else if (opts.command === 'upload-cast-reference' || opts.command === 'upload-environment-reference') {
    await uploadReference(opts);
  } else {
    fail('unknown_command', `Unknown command: ${opts.command}`, { help: help() });
  }
} catch (error) {
  if (error instanceof CliFailure) {
    output({ ok: false, code: error.code, message: error.message, details: error.details });
    process.exit(error.exitCode);
  }
  output({
    ok: false,
    code: 'mirage_cli_error',
    message: error?.message || String(error),
  });
  process.exit(1);
}
