#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const DEFAULT_API_URL = 'https://mirage-platform-production-05ca.up.railway.app';
const STATE_FILE = '.sync-state.json';
const WORKSPACE_STATE_FILE = '.mirage-workspace-state.json';
const LOCK_DIR = '.sync-state.lock';
const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;

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
    : argv.slice(2);
  const opts = { command, projectId, cwd: process.cwd(), force: false, recoverLock: false };
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
    } else if (arg === '--note') {
      opts.note = optionArgs[i + 1] || '';
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      fail('unknown_arg', `Unknown argument: ${arg}`);
    }
  }
  return opts;
};

const help = () => `Mirage CLI ${pkg.version}

Usage:
  mirage sync <projectId> [--cwd <dir>] [--force] [--recover-lock] [--api-url <url>]
  mirage upload-cast-reference <projectId> <castMemberId> <imagePath> [--note <text>] [--api-url <url>]
  mirage upload-environment-reference <projectId> <environmentId> <imagePath> [--note <text>] [--api-url <url>]

Environment:
  MIRAGE_CLI_TOKEN  Short-lived token from Mirage MCP mint_cli_token
  MIRAGE_TOKEN      Alias for MIRAGE_CLI_TOKEN
  MIRAGE_API_URL    Defaults to ${DEFAULT_API_URL}

Notes:
  sync automatically recovers dead-owner locks. Use --recover-lock only after
  confirming another sync is not actively running.
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

const readTextIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

const isWorkspaceOperatingFile = (relativePath) =>
  relativePath === 'AGENTS.md'
  || relativePath === 'CLAUDE.md'
  || relativePath === 'config/skills.json'
  || relativePath.startsWith('config/actions/')
  || relativePath.startsWith('.agents/skills/')
  || relativePath.startsWith('.claude/skills/');

const workspaceOperatingKind = (relativePath) => {
  if (relativePath === 'AGENTS.md' || relativePath === 'CLAUDE.md') return 'instructions';
  if (relativePath === 'config/skills.json' || relativePath.startsWith('.agents/skills/') || relativePath.startsWith('.claude/skills/')) return 'skills';
  if (relativePath.startsWith('config/actions/')) return 'actions';
  return 'workspace';
};

const canWritePath = (absolutePath) => {
  try {
    if (fs.existsSync(absolutePath)) {
      fs.accessSync(absolutePath, fs.constants.W_OK);
      return true;
    }
    let dir = path.dirname(absolutePath);
    while (!fs.existsSync(dir)) {
      const next = path.dirname(dir);
      if (next === dir) break;
      dir = next;
    }
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const preflightWorkspaceOperatingWrites = (workspace, entries) => {
  const blocked = [];
  for (const entry of entries) {
    if (entry.scope !== 'workspace' || !isWorkspaceOperatingFile(entry.path)) continue;
    const absolutePath = safeJoin(workspace, entry.path);
    if (!canWritePath(absolutePath)) blocked.push({ path: entry.path, kind: workspaceOperatingKind(entry.path) });
  }
  if (!blocked.length) return;
  fail('workspace_operating_files_need_write_access', 'This sync needs to update Mirage operating files. Retry the returned sync command with elevated local write approval, then open a new chat in this workspace so skills/actions reload.', {
    blocked,
    userAction: 'Approve/elevate the same sync command locally; do not use MCP file reads for this case.',
  }, 5);
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

const pruneLegacySkillDirs = (workspace, manifestByPath, pruned) => {
  const legacySkillNames = [
    'continuity-auditor',
    'mirage-director',
    'render-triage',
    'script-doctor',
    'storyboard-prompt-craft',
    'style-ref-critic',
  ];
  for (const root of ['.agents/skills', '.claude/skills']) {
    for (const skillName of legacySkillNames) {
      const relativePath = `${root}/${skillName}`;
      const stillManifested = [...manifestByPath.keys()].some((filePath) => filePath.startsWith(`${relativePath}/`));
      if (stillManifested) continue;
      pruneTree(workspace, relativePath, 'old_workspace_skill', pruned);
    }
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
  const wroteOperating = written.some((item) => isWorkspaceOperatingFile(item.path));
  const wroteSkills = written.some((item) => workspaceOperatingKind(item.path) === 'skills');
  const wroteActions = written.some((item) => workspaceOperatingKind(item.path) === 'actions');
  const wroteInstructions = written.some((item) => workspaceOperatingKind(item.path) === 'instructions');
  const manifestHasSkills = manifest.some((entry) => entry.path === 'config/skills.json' || entry.path.startsWith('.agents/skills/') || entry.path.startsWith('.claude/skills/'));
  const manifestHasActions = manifest.some((entry) => entry.path.startsWith('config/actions/'));
  return {
    instructions: {
      agentsMd: statusFor('AGENTS.md'),
      claudeMd: statusFor('CLAUDE.md'),
    },
    skills: manifestHasSkills ? (wroteSkills ? 'updated' : 'current') : 'not_present',
    actions: manifestHasActions ? (wroteActions ? 'updated' : 'current') : 'not_present',
    sessionReloadNeeded: wroteOperating,
    sessionReloadReason: wroteOperating
      ? [
        wroteInstructions ? 'instructions changed' : null,
        wroteSkills ? 'skills changed on disk' : null,
        wroteActions ? 'action schemas changed on disk' : null,
      ].filter(Boolean).join('; ')
      : null,
    userAction: wroteOperating
      ? 'User should open a new chat/session in this same workspace so Codex/Claude reload updated Mirage instructions, skills, and action schemas.'
      : 'No session reload needed from this sync.',
  };
};

const lockTtlMs = () => {
  const n = Number(process.env.MIRAGE_SYNC_LOCK_TTL_MS || DEFAULT_LOCK_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOCK_TTL_MS;
};

const safeTimestamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

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
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    fs.mkdirSync(lockPath);
    writeText(path.join(lockPath, 'owner.json'), `${JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      cliVersion: pkg.version,
      cwd: process.cwd(),
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
            replacedStaleLock: {
              movedTo,
              reason: recoveryReason,
              previousOwner: owner,
            },
          }, null, 2)}\n`);
        } catch (retryError) {
          if (retryError?.code === 'EEXIST') {
            fail('sync_already_running', 'Another Mirage notebook sync started while replacing a stale lock. Retry once.', { lockPath, movedTo }, 4);
          }
          throw retryError;
        }
      } else {
        fail('sync_already_running', 'Another Mirage notebook sync appears to be running for this project. Wait for it to finish, then retry.', {
          lockPath,
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

const token = () => process.env.MIRAGE_CLI_TOKEN || process.env.MIRAGE_TOKEN || process.env.MIRAGE_MCP_TOKEN || '';
const apiUrl = (opts) => (opts.apiUrl || process.env.MIRAGE_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

const mimeFromPath = (filePath) => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
};

const postNotebookSync = async (opts, knownHashes) => {
  const bearer = token();
  if (!bearer) {
    fail('auth_missing', 'Set MIRAGE_CLI_TOKEN from the Mirage MCP mint_cli_token tool before running sync.');
  }
  const response = await fetch(`${apiUrl(opts)}/api/notebook-sync/projects/${encodeURIComponent(opts.projectId)}/notebook`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-mirage-cli-version': pkg.version,
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

const sync = async (opts) => {
  if (!opts.projectId) fail('missing_project_id', 'Usage: mirage sync <projectId>');
  const workspace = path.resolve(opts.cwd);
  const statePath = safeJoin(workspace, `mirage/projects/${opts.projectId}/${STATE_FILE}`);
  const workspaceStatePath = safeJoin(workspace, WORKSPACE_STATE_FILE);
  const releaseLock = acquireLock(safeJoin(workspace, `mirage/projects/${opts.projectId}/${LOCK_DIR}`), { recoverLock: opts.recoverLock });
  try {
  const previousProjectState = readJson(statePath, { files: {} });
  const previousWorkspaceState = readJson(workspaceStatePath, { files: {} });
  const previousProjectFiles = previousProjectState.files || {};
  const previousWorkspaceFiles = previousWorkspaceState.files || {};
  const previousFiles = { ...previousWorkspaceFiles, ...previousProjectFiles };
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
  const manifest = remote.manifest || [];
  const manifestByPath = new Map(manifest.map((entry) => [entry.path, entry]));
  const contentByPath = new Map((remote.files || []).map((entry) => [entry.path, entry]));
  preflightWorkspaceOperatingWrites(workspace, remote.files || []);
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

    try {
      writeText(absolutePath, incoming.content);
    } catch (error) {
      if ((error?.code === 'EACCES' || error?.code === 'EPERM') && isWorkspaceOperatingFile(entry.path)) {
        fail('workspace_operating_files_need_write_access', 'This sync needs to update Mirage operating files. Retry the returned sync command with elevated local write approval, then open a new chat in this workspace so skills/actions reload.', {
          blocked: [{ path: entry.path, kind: workspaceOperatingKind(entry.path), error: error.code }],
          userAction: 'Approve/elevate the same sync command locally; do not use MCP file reads for this case.',
        }, 5);
      }
      throw error;
    }
    written.push({ path: entry.path, bytes: Buffer.byteLength(incoming.content, 'utf8') });
  }

  const removedCandidates = new Set([
    ...Object.keys(previousFiles).filter((filePath) => !manifestByPath.has(filePath)),
    ...(remote.removedFiles || []),
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
  pruneLegacySkillDirs(workspace, manifestByPath, pruned);
  pruneSyncLockArchives(workspace, opts.projectId, pruned);

  const nextWorkspaceFiles = {};
  const nextProjectFiles = {};
  for (const entry of manifest) {
    const nextFiles = entry.scope === 'workspace' ? nextWorkspaceFiles : nextProjectFiles;
    const scopedPreviousFiles = entry.scope === 'workspace' ? previousWorkspaceFiles : previousProjectFiles;
    if (conflicts.some((conflict) => conflict.path === entry.path)) {
      if (scopedPreviousFiles[entry.path]) nextFiles[entry.path] = scopedPreviousFiles[entry.path];
      continue;
    }
    nextFiles[entry.path] = {
      hash: entry.hash,
      mode: entry.mode,
      scope: entry.scope || 'project',
      writePolicy: entry.writePolicy,
      size: entry.size,
    };
  }
  writeText(workspaceStatePath, `${JSON.stringify({
    kind: 'mirage.notebook.workspace_sync_state',
    notebookVersion: remote.notebookVersion,
    lastProject: remote.project,
    syncedAt: new Date().toISOString(),
    files: nextWorkspaceFiles,
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
      written,
      skipped,
      removed,
      pruned,
      scopes: {
        workspace: Object.keys(nextWorkspaceFiles).length,
        project: Object.keys(nextProjectFiles).length,
      },
    },
  });
  process.exitCode = conflicts.length ? 3 : 0;
  } finally {
    releaseLock();
  }
};

const uploadReference = async (opts) => {
  if (!opts.projectId || !opts.entityId || !opts.filePath) {
    const usage = opts.command === 'upload-environment-reference'
      ? 'Usage: mirage upload-environment-reference <projectId> <environmentId> <imagePath>'
      : 'Usage: mirage upload-cast-reference <projectId> <castMemberId> <imagePath>';
    fail('missing_args', usage);
  }
  const bearer = token();
  if (!bearer) {
    fail('auth_missing', 'Set MIRAGE_CLI_TOKEN from the Mirage MCP mint_cli_token tool before running uploads.');
  }
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
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-mirage-cli-version': pkg.version,
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
  if (opts.command === 'sync') {
    await sync(opts);
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
