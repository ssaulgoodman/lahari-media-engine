#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { loadReleaseEnv, requireEnv, rootDir } from './release-env.mjs';

loadReleaseEnv();

const DEFAULT_MIGRATIONS = [
  'migrations/2026-06-08_add_project_timelines.sql',
  'migrations/2026-06-08_add_user_personas.sql',
];

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);

if (hasArg('--help') || hasArg('-h')) {
  console.log(`Usage: npm run migrate:mirage -- [--dry-run] [migration.sql ...]

Applies Mirage Supabase migrations using SUPABASE_DB_URL_MIRAGE.

Defaults to the current release migrations:
  ${DEFAULT_MIGRATIONS.join('\n  ')}

Guards:
  - refuses paths outside migrations/
  - records filename + sha256 in public.mirage_release_migrations
  - skips already-applied identical files
  - fails if an applied filename has different contents`);
  process.exit(0);
}

const dryRun = hasArg('--dry-run');
const positional = args.filter((arg) => !arg.startsWith('-'));
const migrationFiles = positional.length > 0 ? positional : DEFAULT_MIGRATIONS;
const dbUrl = requireEnv(
  'SUPABASE_DB_URL_MIRAGE',
  'Add the Mirage Supabase Postgres URI to .env.release.local.',
);

try {
  new URL(dbUrl);
} catch {
  console.error('Invalid SUPABASE_DB_URL_MIRAGE. If the DB password contains special characters, URL-encode only the password segment in the Postgres URI.');
  process.exit(1);
}

const toMigrationPath = (file) => {
  const resolved = path.resolve(rootDir, file);
  const migrationsDir = path.resolve(rootDir, 'migrations');
  if (!resolved.startsWith(`${migrationsDir}${path.sep}`)) {
    throw new Error(`Refusing non-migration path: ${file}`);
  }
  if (!resolved.endsWith('.sql')) {
    throw new Error(`Migration must be a .sql file: ${file}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Migration file not found: ${file}`);
  }
  return resolved;
};

const migrations = migrationFiles.map((file) => {
  const resolved = toMigrationPath(file);
  const sqlText = fs.readFileSync(resolved, 'utf8');
  return {
    filename: path.relative(rootDir, resolved),
    sqlText,
    sha256: crypto.createHash('sha256').update(sqlText).digest('hex'),
  };
});

const sql = postgres(dbUrl, {
  max: 1,
  prepare: false,
  ssl: 'require',
  idle_timeout: 5,
  connect_timeout: 10,
});

try {
  await sql`select 1`;
  let hasLedger = false;
  const ledger = await sql`select to_regclass('public.mirage_release_migrations') as table_name`;
  hasLedger = Boolean(ledger[0]?.table_name);

  if (!dryRun && !hasLedger) {
    await sql`
      create table if not exists public.mirage_release_migrations (
        filename text primary key,
        sha256 text not null,
        applied_at timestamptz not null default now()
      )
    `;
    hasLedger = true;
  }

  for (const migration of migrations) {
    const existing = hasLedger
      ? await sql`
          select sha256, applied_at
          from public.mirage_release_migrations
          where filename = ${migration.filename}
          limit 1
        `
      : [];

    if (existing.length > 0) {
      if (existing[0].sha256 !== migration.sha256) {
        throw new Error(`Applied migration content changed: ${migration.filename}`);
      }
      console.log(`skip ${migration.filename} (already applied)`);
      continue;
    }

    if (dryRun) {
      console.log(`would apply ${migration.filename} sha256=${migration.sha256.slice(0, 12)}`);
      continue;
    }

    console.log(`applying ${migration.filename}...`);
    await sql.begin(async (tx) => {
      await tx.unsafe(migration.sqlText);
      await tx`
        insert into public.mirage_release_migrations (filename, sha256)
        values (${migration.filename}, ${migration.sha256})
      `;
    });
    console.log(`applied ${migration.filename}`);
  }

  if (dryRun) {
    console.log('Mirage migration dry run complete.');
  } else {
    console.log('Mirage migrations complete.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
