#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { loadReleaseEnv, requireEnv } from './release-env.mjs';

loadReleaseEnv();

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const projectId = getArg('--project') || getArg('--project-id');
const apply = args.includes('--apply');
const noShift = args.includes('--no-shift');
const thresholdMs = Number(getArg('--threshold-ms') || 5400);

const wantsHelp = args.includes('--help') || args.includes('-h');

if (!projectId || wantsHelp) {
  console.log(`Usage: node scripts/repair-timeline-durations.mjs --project <projectId> [--apply] [--no-shift]

Dry-runs by default. Repairs canonical render timeline video clips that were
saved with placeholder 5000ms durations by probing the actual media duration.

Options:
  --project <id>       Mirage project id
  --apply              Persist repaired snapshot as a new timeline version
  --no-shift           Do not shift later same-track clips after duration changes
  --threshold-ms <n>   Only repair placeholder-ish clips shorter than this (default 5400)
`);
  process.exit(wantsHelp ? 0 : 2);
}

const dbUrl = requireEnv(
  'SUPABASE_DB_URL_MIRAGE',
  'Add the Mirage Supabase Postgres URI to .env.release.local.',
);
const prefix = process.env.DB_TABLE_PREFIX || 'studio';
const timelinesTable = `${prefix}_project_timelines`;
const versionsTable = `${prefix}_project_timeline_versions`;

const ffprobeDurationMs = (src) => {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    src,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    return { error: (result.stderr || result.stdout || 'ffprobe failed').trim() };
  }
  const seconds = Number(String(result.stdout || '').trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return { error: `invalid duration: ${result.stdout}` };
  return { durationMs: Math.round(seconds * 1000) };
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const spanMs = (item) => Math.max(0, num(item?.display?.to) - num(item?.display?.from));
const isVideoItem = (item) => item?.type === 'video' && typeof item?.details?.src === 'string' && item.details.src.trim();
const isPlaceholderDuration = (item) => {
  const span = spanMs(item);
  const duration = num(item?.duration);
  const trimTo = num(item?.trim?.to);
  return span > 0
    && span <= thresholdMs
    && Math.abs(span - 5000) <= 800
    && (!duration || Math.abs(duration - span) <= 1000)
    && (!trimTo || Math.abs(trimTo - span) <= 1000);
};

const patchItemDuration = (item, newDurationMs) => {
  const from = num(item.display?.from);
  item.display = { ...(item.display || {}), from, to: from + newDurationMs };
  item.duration = newDurationMs;
  item.trim = {
    ...(item.trim || {}),
    from: num(item.trim?.from),
    to: num(item.trim?.from) + newDurationMs,
  };
};

const maxTimelineEnd = (snapshot) => Math.max(
  0,
  ...Object.values(snapshot.trackItemsMap || {}).map((item) => num(item?.display?.to, 0)),
);

const sql = postgres(dbUrl, {
  max: 1,
  prepare: false,
  ssl: 'require',
  idle_timeout: 5,
  connect_timeout: 10,
});

try {
  const rows = await sql.unsafe(
    `select snapshot, version from public.${timelinesTable} where project_id = $1 limit 1`,
    [projectId],
  );
  if (rows.length === 0) {
    console.error(`No canonical timeline found for project ${projectId}.`);
    process.exit(1);
  }

  const original = rows[0].snapshot;
  const snapshot = clone(original);
  const trackItemsMap = snapshot.trackItemsMap || {};
  const itemIds = Array.isArray(snapshot.trackItemIds) ? snapshot.trackItemIds : Object.keys(trackItemsMap);
  const changes = [];

  const itemsByTrack = new Map();
  for (const id of itemIds) {
    const item = trackItemsMap[id];
    if (!item?.trackId) continue;
    const list = itemsByTrack.get(item.trackId) || [];
    list.push({ id, item });
    itemsByTrack.set(item.trackId, list);
  }

  for (const list of itemsByTrack.values()) {
    list.sort((a, b) => num(a.item?.display?.from) - num(b.item?.display?.from));
    let shiftMs = 0;
    for (const entry of list) {
      const { id, item } = entry;
      if (shiftMs && !noShift) {
        item.display = {
          ...(item.display || {}),
          from: num(item.display?.from) + shiftMs,
          to: num(item.display?.to) + shiftMs,
        };
      }
      if (!isVideoItem(item) || !isPlaceholderDuration(item)) continue;

      const src = item.details.src.trim();
      const before = spanMs(item);
      const probed = ffprobeDurationMs(src);
      if (probed.error) {
        changes.push({
          id,
          name: item.metadata?.displayName || item.details?.name || id,
          src,
          oldMs: before,
          error: probed.error,
        });
        continue;
      }
      const newMs = probed.durationMs;
      if (!newMs || Math.abs(newMs - before) < 250) continue;

      patchItemDuration(item, newMs);
      const deltaMs = newMs - before;
      if (!noShift) shiftMs += deltaMs;
      changes.push({
        id,
        name: item.metadata?.displayName || item.details?.name || id,
        shotId: item.metadata?.shotId || null,
        oldMs: before,
        newMs,
        deltaMs,
      });
    }
  }

  snapshot.duration = Math.max(num(snapshot.duration), maxTimelineEnd(snapshot));
  const repairable = changes.filter((change) => !change.error);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    projectId,
    currentVersion: rows[0].version,
    tablePrefix: prefix,
    changed: repairable.length,
    errors: changes.filter((change) => change.error),
    changes: repairable,
    newDurationMs: snapshot.duration,
  }, null, 2));

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to save a new canonical timeline version.');
    process.exit(0);
  }
  if (repairable.length === 0) {
    console.log('No repairable placeholder-duration clips found; nothing saved.');
    process.exit(0);
  }

  const latest = await sql.unsafe(
    `select version from public.${versionsTable} where project_id = $1 order by version desc limit 1`,
    [projectId],
  );
  const nextVersion = Math.max(num(rows[0].version), num(latest[0]?.version)) + 1;
  const summaryItemCount = Array.isArray(snapshot.trackItemIds) ? snapshot.trackItemIds.length : Object.keys(trackItemsMap).length;

  await sql.begin(async (tx) => {
    await tx.unsafe(
      `update public.${timelinesTable}
       set snapshot = $2, version = $3, updated_at = now(), updated_by = null
       where project_id = $1`,
      [projectId, snapshot, nextVersion],
    );
    await tx.unsafe(
      `insert into public.${versionsTable}
       (project_id, version, snapshot, saved_by, source, item_count, duration_ms)
       values ($1, $2, $3, null, 'repair:duration-probe', $4, $5)`,
      [projectId, nextVersion, snapshot, summaryItemCount, Math.round(snapshot.duration)],
    );
  });
  console.log(`Saved repaired timeline version ${nextVersion}.`);
} finally {
  await sql.end({ timeout: 5 });
}
