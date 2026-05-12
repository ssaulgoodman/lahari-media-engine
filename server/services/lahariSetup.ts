import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

type CheckStatus = 'ok' | 'warn' | 'fail';

type SetupCheck = {
  name: string;
  status: CheckStatus;
  message: string;
};

type CommandResult = {
  status: CheckStatus;
  message: string;
};

const MCP_SERVER_NAME = 'lahari';

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'SEGMIND_API_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
];

const RECOMMENDED_ENV = [
  'OPENAI_API_KEY',
];

const SETUP_ENV_KEYS = [
  'LAHARI_ENV_FILE',
  ...REQUIRED_ENV,
  ...RECOMMENDED_ENV,
];

const repoRoot = () => process.cwd();

const stripEmptyEnvValues = (keys: string[]) => {
  for (const key of keys) {
    if (process.env[key]?.trim() === '') delete process.env[key];
  }
};

const resolveEnvFile = (): string | null => {
  stripEmptyEnvValues(SETUP_ENV_KEYS);

  const candidates = [
    process.env.LAHARI_ENV_FILE,
    path.join(repoRoot(), '.env'),
    path.join(repoRoot(), '..', 'lahari-media-engine', '.env'),
    path.join(repoRoot(), '..', '.env'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
};

const loadEnv = (envFile: string | null) => {
  stripEmptyEnvValues(SETUP_ENV_KEYS);
  if (envFile) dotenv.config({ path: envFile, override: false, quiet: true });
  stripEmptyEnvValues(SETUP_ENV_KEYS);
};

const maskPath = (value: string | null) => value || 'not found';
const hasEnv = (key: string) => !!process.env[key]?.trim();

const checkEnvVars = (): SetupCheck[] => {
  const checks: SetupCheck[] = [];
  for (const key of REQUIRED_ENV) {
    checks.push({
      name: `env:${key}`,
      status: hasEnv(key) ? 'ok' : 'fail',
      message: hasEnv(key) ? `${key} is set` : `missing ${key} - see CLAUDE.md`,
    });
  }
  for (const key of RECOMMENDED_ENV) {
    checks.push({
      name: `env:${key}`,
      status: hasEnv(key) ? 'ok' : 'warn',
      message: hasEnv(key) ? `${key} is set` : `missing ${key} - optional unless using GPT image/script providers; see CLAUDE.md`,
    });
  }
  return checks;
};

const checkWorktree = (): SetupCheck[] => {
  const root = repoRoot();
  const checks: SetupCheck[] = [
    {
      name: 'worktree:package',
      status: fs.existsSync(path.join(root, 'package.json')) ? 'ok' : 'fail',
      message: fs.existsSync(path.join(root, 'package.json')) ? `package.json found in ${root}` : `package.json not found in ${root}`,
    },
    {
      name: 'worktree:mcp',
      status: fs.existsSync(path.join(root, 'mcp', 'lahari.ts')) ? 'ok' : 'fail',
      message: fs.existsSync(path.join(root, 'mcp', 'lahari.ts')) ? 'MCP adapter found at mcp/lahari.ts' : 'MCP adapter missing at mcp/lahari.ts',
    },
  ];

  const git = spawnSync('git', ['status', '--short', '--branch'], { cwd: root, encoding: 'utf8' });
  checks.push({
    name: 'worktree:git',
    status: git.status === 0 ? 'ok' : 'warn',
    message: git.status === 0 ? (git.stdout.trim().split('\n')[0] || 'git status ok') : 'git status unavailable; continue only if this is the Lahari worktree',
  });

  return checks;
};

const supabaseFetch = async (pathPart: string, init: RequestInit = {}) => {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required for Supabase checks.');

  return fetch(`${url.replace(/\/$/, '')}${pathPart}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
};

const checkSupabase = async (): Promise<SetupCheck[]> => {
  const checks: SetupCheck[] = [];
  if (!hasEnv('SUPABASE_URL') || !hasEnv('SUPABASE_SERVICE_KEY')) {
    return [{
      name: 'supabase:round-trip',
      status: 'fail',
      message: 'skipped Supabase checks because SUPABASE_URL or SUPABASE_SERVICE_KEY is missing',
    }];
  }

  try {
    const res = await supabaseFetch('/rest/v1/lahari_projects?select=id,title,status&limit=1');
    const body = await res.text();
    checks.push({
      name: 'supabase:projects',
      status: res.ok ? 'ok' : 'fail',
      message: res.ok ? 'listed 1 Lahari project row successfully' : `failed to list projects: ${res.status} ${body.slice(0, 220)}`,
    });
  } catch (error) {
    checks.push({
      name: 'supabase:projects',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const res = await supabaseFetch('/rest/v1/lahari_director_events?select=seq&limit=1');
    const body = await res.text();
    checks.push({
      name: 'supabase:director-events',
      status: res.ok ? 'ok' : 'fail',
      message: res.ok ? 'lahari_director_events is reachable' : `director events table check failed: ${res.status} ${body.slice(0, 220)}`,
    });
  } catch (error) {
    checks.push({
      name: 'supabase:director-events',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const res = await supabaseFetch('/rest/v1/rpc/lahari_rollback_script_preview', {
      method: 'POST',
      body: JSON.stringify({
        p_project_id: '__lahari_setup_probe__',
        p_before_project: { status: 'probe' },
        p_before_rows: { cast: [], environments: [], scenes: [] },
      }),
    });
    const body = await res.text();
    const callable = res.ok || body.includes('project not found: __lahari_setup_probe__');
    checks.push({
      name: 'supabase:rollback-rpc',
      status: callable ? 'ok' : 'fail',
      message: callable ? 'lahari_rollback_script_preview is callable' : `rollback RPC check failed: ${res.status} ${body.slice(0, 220)}`,
    });
  } catch (error) {
    checks.push({
      name: 'supabase:rollback-rpc',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return checks;
};

const run = (command: string, args: string[], cwd = repoRoot()): CommandResult => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.status === 0) return { status: 'ok', message: output || `${command} ${args.join(' ')} ok` };
  return { status: 'fail', message: output || `${command} ${args.join(' ')} failed with status ${result.status}` };
};

const registerCodexMcp = (envFile: string | null): SetupCheck => {
  run('codex', ['mcp', 'remove', MCP_SERVER_NAME]);
  const args = [
    'mcp', 'add',
    '--env', `LAHARI_ENV_FILE=${maskPath(envFile)}`,
    MCP_SERVER_NAME,
    '--',
    'npm', '--prefix', repoRoot(), 'run', 'lahari:mcp',
  ];
  const result = run('codex', args);
  return {
    name: 'mcp:codex',
    status: result.status,
    message: result.status === 'ok'
      ? `registered Codex MCP server "${MCP_SERVER_NAME}" as npm --prefix ${repoRoot()} run lahari:mcp`
      : `failed to register Codex MCP server: ${result.message}`,
  };
};

const registerClaudeMcp = (envFile: string | null): SetupCheck => {
  run('claude', ['mcp', 'remove', '--scope', 'user', MCP_SERVER_NAME]);
  const args = [
    'mcp', 'add',
    '--scope', 'user',
    '-e', `LAHARI_ENV_FILE=${maskPath(envFile)}`,
    MCP_SERVER_NAME,
    '--',
    'npm', '--prefix', repoRoot(), 'run', 'lahari:mcp',
  ];
  const result = run('claude', args);
  return {
    name: 'mcp:claude-code',
    status: result.status,
    message: result.status === 'ok'
      ? `registered Claude Code MCP server "${MCP_SERVER_NAME}" as npm --prefix ${repoRoot()} run lahari:mcp`
      : `failed to register Claude Code MCP server: ${result.message}`,
  };
};

const printCheck = (check: SetupCheck) => {
  const marker = check.status === 'ok' ? 'OK' : check.status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${marker}] ${check.name} - ${check.message}`);
};

export const runLahariSetup = async (opts: { skipRegister?: boolean } = {}) => {
  const envFile = resolveEnvFile();
  loadEnv(envFile);

  const checks: SetupCheck[] = [
    {
      name: 'env:file',
      status: envFile ? 'ok' : 'fail',
      message: envFile ? `using ${envFile}` : 'no .env found - create one here or in ../lahari-media-engine; see CLAUDE.md',
    },
    ...checkWorktree(),
    ...checkEnvVars(),
    ...await checkSupabase(),
  ];

  const validationFailed = checks.some((check) => check.status === 'fail');
  if (!opts.skipRegister && !validationFailed) {
    checks.push(registerCodexMcp(envFile));
    checks.push(registerClaudeMcp(envFile));
  } else if (!opts.skipRegister && validationFailed) {
    checks.push({
      name: 'mcp:registration',
      status: 'warn',
      message: 'skipped because validation failed; fix failures and re-run setup',
    });
  }

  console.log('Lahari setup');
  console.log('');
  for (const check of checks) printCheck(check);

  const failed = checks.filter((check) => check.status === 'fail');
  const warned = checks.filter((check) => check.status === 'warn');
  console.log('');

  if (failed.length) {
    console.log(`Setup incomplete: ${failed.length} failed check(s), ${warned.length} warning(s).`);
    console.log('Fix the failures above and re-run: npm run lahari -- setup');
    process.exitCode = 1;
    return;
  }

  if (warned.length) console.log(`Warnings: ${warned.length}. Review them when using optional providers.`);

  if (opts.skipRegister) {
    console.log(`Ready to register: validation passed for MCP server "${MCP_SERVER_NAME}".`);
    console.log('Next: npm run lahari -- setup');
    return;
  }

  console.log(`Ready: MCP server "${MCP_SERVER_NAME}" is registered for Codex Desktop and Claude Code.`);
  console.log('Next: npm run lahari -- project list 10');
};
