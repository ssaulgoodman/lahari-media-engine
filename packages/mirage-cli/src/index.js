#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const DEFAULT_API_URL = 'https://mirage-platform-production-05ca.up.railway.app';
const STATE_FILE = '.sync-state.json';
const LOCK_DIR = '.sync-state.lock';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeSlash = (value) => value.split(path.sep).join('/');
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

const fail = (code, message, details = undefined, exitCode = 1) => {
  output({ ok: false, code, message, details });
  process.exit(exitCode);
};

const parseArgs = (argv) => {
  const [command, projectId, maybeEntityId, maybeFilePath, ...rest] = argv;
  const optionArgs = (command === 'upload-cast-reference' || command === 'upload-environment-reference')
    ? rest
    : argv.slice(2);
  const opts = { command, projectId, cwd: process.cwd(), force: false };
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
  mirage sync <projectId> [--cwd <dir>] [--force] [--api-url <url>]
  mirage upload-cast-reference <projectId> <castMemberId> <imagePath> [--note <text>] [--api-url <url>]
  mirage upload-environment-reference <projectId> <environmentId> <imagePath> [--note <text>] [--api-url <url>]

Environment:
  MIRAGE_CLI_TOKEN  Short-lived token from Mirage MCP mint_cli_token
  MIRAGE_TOKEN      Alias for MIRAGE_CLI_TOKEN
  MIRAGE_API_URL    Defaults to ${DEFAULT_API_URL}
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

const acquireLock = (lockPath) => {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    fs.mkdirSync(lockPath);
    writeText(path.join(lockPath, 'owner.json'), `${JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('sync_already_running', 'Another Mirage notebook sync appears to be running for this project. Wait for it to finish, then retry.', { lockPath }, 4);
    }
    throw error;
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
  const releaseLock = acquireLock(safeJoin(workspace, `mirage/projects/${opts.projectId}/${LOCK_DIR}`));
  try {
  const previousState = readJson(statePath, { files: {} });
  const previousFiles = previousState.files || {};
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
  const written = [];
  const skipped = [];
  const removed = [];
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

  const nextFiles = {};
  for (const entry of manifest) {
    if (conflicts.some((conflict) => conflict.path === entry.path)) {
      if (previousFiles[entry.path]) nextFiles[entry.path] = previousFiles[entry.path];
      continue;
    }
    nextFiles[entry.path] = {
      hash: entry.hash,
      mode: entry.mode,
      writePolicy: entry.writePolicy,
      size: entry.size,
    };
  }
  writeText(statePath, `${JSON.stringify({
    kind: 'mirage.notebook.sync_state',
    notebookVersion: remote.notebookVersion,
    project: remote.project,
    syncedAt: new Date().toISOString(),
    files: nextFiles,
  }, null, 2)}\n`);

  output({
    ok: conflicts.length === 0,
    kind: 'mirage.cli.sync',
    projectId: opts.projectId,
    notebookVersion: remote.notebookVersion,
    syncedAt: new Date().toISOString(),
    written: written.length,
    skipped: skipped.length,
    removed: removed.length,
    conflicted: conflicts.length,
    conflicts,
    details: { written, skipped, removed },
  });
  process.exit(conflicts.length ? 3 : 0);
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
