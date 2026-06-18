import path from 'path';
import { getSB, selectAll, selectOne } from '../database.js';
import { storageUrl } from '../storage.js';

type ZipEntry = {
  name: string;
  data: Buffer;
};

type TimelineItem = {
  id: string;
  type: string;
  name: string;
  src: string;
  fileName?: string;
  fromMs: number;
  toMs: number;
  trimFromMs: number;
  trimToMs: number;
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date = new Date()) => {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { dosTime, dosDate };
};

const createZip = (entries: ZipEntry[]) => {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/^\/+/, ''), 'utf8');
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 filenames
    local.writeUInt16LE(0, 8); // store, no compression
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    chunks.push(local, data);

    const c = Buffer.alloc(46 + name.length);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(dosTime, 12);
    c.writeUInt16LE(dosDate, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(offset, 42);
    name.copy(c, 46);
    central.push(c);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, end]);
};

const safeName = (value: string, fallback = 'clip') =>
  (value || fallback)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || fallback;

const extFromUrl = (url: string, fallback = '.mp4') => {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    return ext || fallback;
  } catch {
    const ext = path.extname(url.split('?')[0] || '');
    return ext || fallback;
  }
};

const xml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const time = (ms: number, fps: number) => {
  const frames = Math.max(0, Math.round((ms / 1000) * fps));
  return `${frames}/${fps}s`;
};

const urlForStoragePath = (filePath: string | null | undefined) => {
  if (!filePath) return null;
  if (/^https?:\/\//i.test(filePath)) return filePath;
  return storageUrl(filePath);
};

const download = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

const timelineItemsFromSnapshot = (snapshot: any): TimelineItem[] => {
  const ids = Array.isArray(snapshot?.trackItemIds) ? snapshot.trackItemIds : [];
  const map = snapshot?.trackItemsMap || {};
  return ids
    .map((id: string) => {
      const item = map[id];
      const src = item?.details?.src;
      if (!item || typeof src !== 'string') return null;
      const fromMs = Number(item.display?.from ?? 0);
      const toMs = Number(item.display?.to ?? fromMs);
      const trimFromMs = Number(item.trim?.from ?? 0);
      const trimToMs = Number(item.trim?.to ?? Math.max(0, toMs - fromMs));
      return {
        id,
        type: String(item.type || 'video'),
        name: String(item.details?.displayName || item.details?.name || id),
        src,
        fromMs,
        toMs,
        trimFromMs,
        trimToMs,
      };
    })
    .filter(Boolean) as TimelineItem[];
};

const fallbackItemsFromProject = async (projectId: string): Promise<TimelineItem[]> => {
  const scenes = await selectAll('scenes', { project_id: projectId }, { orderBy: 'sort_order', ascending: true });
  const sceneIds = scenes.map((scene: any) => scene.id);
  if (!sceneIds.length) return [];
  const shots = await selectAll('shots', { scene_id: sceneIds }, { orderBy: 'sort_order', ascending: true });
  const assets = await selectAll('assets', { project_id: projectId, category: 'shot_video' });
  const assetById = new Map(assets.map((asset: any) => [asset.id, asset]));
  const sceneIndex = new Map(scenes.map((scene: any, index: number) => [scene.id, index + 1]));

  let cursor = 0;
  const rows: TimelineItem[] = [];
  for (const shot of shots) {
    const asset: any = assetById.get(shot.video_asset_id);
    const src = urlForStoragePath(asset?.file_path);
    if (!src) continue;
    const durationMs = Math.max(1000, Math.round(Number(shot.duration || 10) * 1000));
    const sceneNo = sceneIndex.get(shot.scene_id) || 0;
    const shotNo = Number(shot.sort_order || 0) + 1;
    const name = shot.is_extra || /extra/i.test(String(scenes.find((s: any) => s.id === shot.scene_id)?.section_label || ''))
      ? `Extra ${shotNo}`
      : `S${sceneNo}.${shotNo}`;
    rows.push({
      id: shot.id,
      type: 'video',
      name,
      src,
      fromMs: cursor,
      toMs: cursor + durationMs,
      trimFromMs: 0,
      trimToMs: durationMs,
    });
    cursor += durationMs;
  }
  return rows;
};

const buildFcpXml = (opts: {
  projectTitle: string;
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  items: TimelineItem[];
}) => {
  const media = opts.items.filter((item) => item.fileName && (item.type === 'video' || item.type === 'image' || item.type === 'audio'));
  const resources = media.map((item, i) => {
    const hasVideo = item.type !== 'audio' ? '1' : '0';
    const hasAudio = item.type === 'audio' || item.type === 'video' ? '1' : '0';
    return `    <asset id=\"r${i + 2}\" name=\"${xml(item.name)}\" src=\"file://./media/${xml(item.fileName)}\" start=\"0s\" duration=\"${time(Math.max(1, item.trimToMs), opts.fps)}\" hasVideo=\"${hasVideo}\" hasAudio=\"${hasAudio}\" format=\"r1\" />`;
  }).join('\n');

  const clips = media
    .filter((item) => item.type !== 'audio')
    .sort((a, b) => a.fromMs - b.fromMs)
    .map((item, i) => {
      const idx = media.indexOf(item);
      const duration = Math.max(1, item.toMs - item.fromMs);
      return `        <asset-clip name=\"${xml(item.name)}\" ref=\"r${idx + 2}\" offset=\"${time(item.fromMs, opts.fps)}\" start=\"${time(item.trimFromMs, opts.fps)}\" duration=\"${time(duration, opts.fps)}\" />`;
    })
    .join('\n');

  const audio = media
    .filter((item) => item.type === 'audio')
    .map((item) => {
      const idx = media.indexOf(item);
      const duration = Math.max(1, item.toMs - item.fromMs);
      return `        <asset-clip name=\"${xml(item.name)}\" ref=\"r${idx + 2}\" offset=\"${time(item.fromMs, opts.fps)}\" start=\"${time(item.trimFromMs, opts.fps)}\" duration=\"${time(duration, opts.fps)}\" lane=\"-1\" />`;
    })
    .join('\n');

  return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<fcpxml version=\"1.10\">
  <resources>
    <format id=\"r1\" name=\"FFVideoFormat${opts.height}p${opts.fps}\" frameDuration=\"1/${opts.fps}s\" width=\"${opts.width}\" height=\"${opts.height}\" />
${resources}
  </resources>
  <library>
    <event name=\"${xml(opts.projectTitle)}\">
      <project name=\"${xml(opts.projectTitle)}\">
        <sequence format=\"r1\" duration=\"${time(opts.durationMs, opts.fps)}\" tcStart=\"0s\" tcFormat=\"NDF\" audioLayout=\"stereo\" audioRate=\"48k\">
          <spine>
${clips}
${audio}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
};

export const buildPremiereExportPackage = async (projectId: string) => {
  const project: any = await selectOne('projects', { id: projectId });
  if (!project) throw new Error('Project not found');

  const { data: timelineRow, error } = await getSB()
    .from('lahari_project_timelines')
    .select('snapshot, version, updated_at')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw new Error(`Timeline read failed: ${error.message}`);

  const snapshot = timelineRow?.snapshot || null;
  const fps = Number(snapshot?.fps || 30);
  const width = Number(snapshot?.size?.width || 1920);
  const height = Number(snapshot?.size?.height || 1080);
  let items = snapshot ? timelineItemsFromSnapshot(snapshot) : [];

  if (!items.length) items = await fallbackItemsFromProject(projectId);

  const entries: ZipEntry[] = [];
  const manifestItems: any[] = [];
  const usedNames = new Set<string>();

  for (const item of items) {
    if (!item.src || (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image')) continue;
    const ext = extFromUrl(item.src, item.type === 'audio' ? '.mp3' : item.type === 'image' ? '.png' : '.mp4');
    const base = safeName(`${String(Math.round(item.fromMs)).padStart(8, '0')}_${item.name}_${item.id}`);
    let fileName = `${base}${ext}`;
    let suffix = 2;
    while (usedNames.has(fileName)) fileName = `${base}_${suffix++}${ext}`;
    usedNames.add(fileName);
    const data = await download(item.src);
    entries.push({ name: `media/${fileName}`, data });
    item.fileName = fileName;
    manifestItems.push({
      id: item.id,
      type: item.type,
      name: item.name,
      fileName,
      sourceUrl: item.src,
      fromMs: item.fromMs,
      toMs: item.toMs,
      trimFromMs: item.trimFromMs,
      trimToMs: item.trimToMs,
      bytes: data.length,
    });
  }

  const durationMs = Math.max(
    Number(snapshot?.duration || 0),
    ...items.map((item) => item.toMs || 0),
    1000,
  );
  const manifest = {
    kind: 'lahari.premiere_export',
    project: { id: project.id, title: project.title },
    exportedAt: new Date().toISOString(),
    source: timelineRow ? 'saved_timeline' : 'shot_order_fallback',
    timelineVersion: timelineRow?.version || null,
    timelineUpdatedAt: timelineRow?.updated_at || null,
    fps,
    size: { width, height },
    durationMs,
    items: manifestItems,
  };

  entries.push({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2)),
  });
  entries.push({
    name: 'timeline.json',
    data: Buffer.from(JSON.stringify(snapshot || { fallback: true, items }, null, 2)),
  });
  entries.push({
    name: 'timeline.fcpxml',
    data: Buffer.from(buildFcpXml({
      projectTitle: project.title || 'Lahari export',
      fps,
      width,
      height,
      durationMs,
      items,
    })),
  });
  entries.push({
    name: 'README.txt',
    data: Buffer.from([
      `${project.title || 'Lahari project'} — Premiere export`,
      '',
      'Contents:',
      '- media/ — downloaded clips from the saved Lahari render timeline',
      '- timeline.fcpxml — experimental Premiere/FCPXML import sequence',
      '- timeline.json — raw Lahari timeline snapshot',
      '- manifest.json — file map and timing data',
      '',
      'Premiere workflow:',
      '1. Unzip this folder.',
      '2. In Premiere Pro, import timeline.fcpxml.',
      '3. If Premiere asks for relinked media, point it at the media/ folder.',
      '4. If XML import is imperfect, import media/ manually and use manifest.json/timeline.json as the edit map.',
      '',
      `Source: ${timelineRow ? `saved timeline version ${timelineRow.version}` : 'shot-order fallback because no saved render timeline was found'}.`,
    ].join('\n')),
  });

  return {
    fileName: `${safeName(project.title || 'lahari-project')}-premiere-export.zip`,
    buffer: createZip(entries),
    manifest,
  };
};
