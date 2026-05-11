import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { TimelineRenderProps } from './Video';

const STAGING_CONCURRENCY = 16;
const STAGING_MAX_ATTEMPTS = 4;
const RETRIABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

type ProgressReporter = (stage: string, progress?: number, force?: boolean) => Promise<void>;

export interface StagedTimelineAssets {
  inputProps: TimelineRenderProps;
  count: number;
  bytes: number;
  stagingMs: number;
  cleanup: () => Promise<void>;
}

const isRemoteUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value);

const stagingConcurrency = () => {
  const parsed = Number(process.env.STAGE_CONCURRENCY || STAGING_CONCURRENCY);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : STAGING_CONCURRENCY;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const retryDelayMs = (attempt: number) => {
  const base = 750 * 2 ** (attempt - 1);
  const jitter = Math.round(base * 0.2 * Math.random());
  return base + jitter;
};

const retryAfterDelayMs = (header: string | null) => {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
};

const markRetryable = (err: Error) => {
  (err as Error & { retryable?: boolean }).retryable = true;
  return err;
};

const isRetryableFetchError = (err: unknown) => {
  if (err instanceof Error && (err as Error & { retryable?: boolean }).retryable) return true;
  if (err instanceof TypeError) return true;
  const name = err instanceof Error ? err.name.toLowerCase() : '';
  return name.includes('abort') || name.includes('timeout');
};

const extensionFromContentType = (contentType: string | null) => {
  const normalized = (contentType || '').split(';')[0]?.trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'video/mp4':
      return '.mp4';
    case 'video/quicktime':
      return '.mov';
    case 'video/webm':
      return '.webm';
    case 'audio/mpeg':
      return '.mp3';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return '.m4a';
    case 'audio/wav':
    case 'audio/x-wav':
      return '.wav';
    case 'audio/aac':
      return '.aac';
    case 'audio/ogg':
      return '.ogg';
    default:
      return '.bin';
  }
};

const extensionForUrl = (url: string, contentType: string | null) => {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,6}$/.test(ext)) return ext;
  } catch {
    // Fall through to content-type inference.
  }
  return extensionFromContentType(contentType);
};

const hasKnownMediaExtension = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  return ext !== '' && ext !== '.bin';
};

const contentTypeForExtension = (ext: string) => {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    case '.wav':
      return 'audio/wav';
    case '.aac':
      return 'audio/aac';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
};

const assertUsableContentType = (url: string, contentType: string | null) => {
  const normalized = (contentType || '').split(';')[0]?.trim().toLowerCase();
  if (!normalized) return;
  if (normalized.startsWith('image/') || normalized.startsWith('video/') || normalized.startsWith('audio/')) {
    return;
  }
  if (normalized === 'application/octet-stream' || normalized === 'binary/octet-stream') return;

  // Supabase signed URLs should return media bytes. HTML/JSON/text almost
  // always means an auth, missing-object, or proxy error page that Chromium
  // would later fail to decode with a much less useful message.
  throw new Error(`asset fetch returned non-media content-type ${normalized}: ${url}`);
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    }),
  );

  return results;
};

const collectRemoteAssetUrls = (inputProps: TimelineRenderProps) => {
  const urls = new Set<string>();
  for (const item of Object.values(inputProps.trackItemsMap)) {
    // Lahari's current timeline schema stores image/video/audio media at
    // details.src. If future item types add poster/caption/lottie URLs, extend
    // this collector explicitly so those assets get the same staging behavior.
    const src = (item as any)?.details?.src;
    if (isRemoteUrl(src)) urls.add(src);
  }
  return Array.from(urls);
};

const rewriteTimelineUrls = (
  inputProps: TimelineRenderProps,
  stagedUrlByOriginal: Map<string, string>,
): TimelineRenderProps => {
  const trackItemsMap = Object.fromEntries(
    Object.entries(inputProps.trackItemsMap).map(([id, item]) => {
      const details = (item as any)?.details;
      const src = details?.src;
      const stagedUrl = isRemoteUrl(src) ? stagedUrlByOriginal.get(src) : undefined;
      if (!stagedUrl) return [id, item];

      return [
        id,
        {
          ...item,
          details: {
            ...details,
            src: stagedUrl,
          },
        },
      ];
    }),
  ) as TimelineRenderProps['trackItemsMap'];

  return {
    ...inputProps,
    trackItemsMap,
  };
};

const fetchAssetToFile = async (url: string, filePath: string) => {
  let lastError: unknown;
  let resolvedFilePath = filePath;

  for (let attempt = 1; attempt <= STAGING_MAX_ATTEMPTS; attempt += 1) {
    try {
      resolvedFilePath = filePath;
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) {
        const err = new Error(`asset fetch failed ${res.status}: ${url}`);
        if (RETRIABLE_STATUSES.has(res.status) && attempt < STAGING_MAX_ATTEMPTS) {
          lastError = markRetryable(err);
          const retryAfter = retryAfterDelayMs(res.headers.get('retry-after'));
          await sleep(Math.max(retryDelayMs(attempt), retryAfter ?? 0));
          continue;
        }
        throw err;
      }

      assertUsableContentType(url, res.headers.get('content-type'));

      const contentLength = Number(res.headers.get('content-length') || 0);
      if (res.headers.get('content-length') && (!Number.isFinite(contentLength) || contentLength <= 0)) {
        throw new Error(`asset fetch returned empty content-length: ${url}`);
      }

      const ext = extensionForUrl(url, res.headers.get('content-type'));
      resolvedFilePath = hasKnownMediaExtension(filePath) || ext === '.bin' ? filePath : `${filePath}${ext}`;
      if (!res.body) {
        throw new Error(`asset fetch returned empty body: ${url}`);
      }

      await pipeline(Readable.fromWeb(res.body as any), createWriteStream(resolvedFilePath));
      const fileStat = await stat(resolvedFilePath);
      if (fileStat.size <= 0) {
        throw new Error(`asset fetch returned empty media: ${url}`);
      }
      return { filePath: resolvedFilePath, size: fileStat.size };
    } catch (err) {
      lastError = err;
      await rm(resolvedFilePath, { force: true }).catch(() => {});
      if (attempt < STAGING_MAX_ATTEMPTS && isRetryableFetchError(err)) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`asset fetch failed: ${url}`);
};

const startStagingServer = async (stagingDir: string) => {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const fileName = path.basename(decodeURIComponent(requestUrl.pathname));
        const filePath = path.join(stagingDir, fileName);

        if (!filePath.startsWith(stagingDir + path.sep)) {
          res.writeHead(403).end('forbidden');
          return;
        }

        const fileStat = await stat(filePath);
        const range = req.headers.range;
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('accept-ranges', 'bytes');
        res.setHeader('content-type', contentTypeForExtension(path.extname(fileName)));

        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match) {
            res.writeHead(416).end();
            return;
          }
          const start = match[1] ? Number(match[1]) : 0;
          const end = match[2] ? Number(match[2]) : fileStat.size - 1;
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= fileStat.size) {
            res.writeHead(416, { 'content-range': `bytes */${fileStat.size}` }).end();
            return;
          }
          res.writeHead(206, {
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${fileStat.size}`,
          });
          createReadStream(filePath, { start, end }).pipe(res);
          return;
        }

        res.writeHead(200, { 'content-length': String(fileStat.size) });
        createReadStream(filePath).pipe(res);
      } catch (err: any) {
        console.warn(`[asset staging] ${err?.message || err} for ${req.url || '/'}`);
        if (!res.headersSent) res.writeHead(404);
        res.end('not found');
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('asset staging server failed to bind');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

export const stageTimelineAssets = async (
  inputProps: TimelineRenderProps,
  renderId: string,
  reportProgress?: ProgressReporter,
): Promise<StagedTimelineAssets> => {
  const urls = collectRemoteAssetUrls(inputProps);
  if (urls.length === 0) {
    return {
      inputProps,
      count: 0,
      bytes: 0,
      stagingMs: 0,
      cleanup: async () => {},
    };
  }

  await reportProgress?.('staging_assets', 0.02, true);

  const stagingStartedAt = Date.now();
  const stagingDir = await mkdtemp(path.join(tmpdir(), `lahari-render-${renderId}-`));
  let totalBytes = 0;
  let completed = 0;
  let stagingServer: { baseUrl: string; close: () => Promise<void> } | undefined;

  try {
    const stagedEntries = await mapWithConcurrency(urls, stagingConcurrency(), async (url, index) => {
      const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
      const ext = extensionForUrl(url, null);
      const fileName = ext === '.bin' ? `${index}-${hash}` : `${index}-${hash}${ext}`;
      const filePath = path.join(stagingDir, fileName);
      const stagedFile = await fetchAssetToFile(url, filePath);
      totalBytes += stagedFile.size;
      completed += 1;
      await reportProgress?.('staging_assets', 0.02 + (completed / urls.length) * 0.02);

      return [url, path.basename(stagedFile.filePath)] as const;
    });

    stagingServer = await startStagingServer(stagingDir);
    const stagedUrlByOriginal = new Map<string, string>(
      stagedEntries.map(([url, fileName]) => [
        url,
        `${stagingServer!.baseUrl}/${encodeURIComponent(fileName)}`,
      ]),
    );
    const stagedInputProps = rewriteTimelineUrls(inputProps, stagedUrlByOriginal);
    const stagingMs = Date.now() - stagingStartedAt;
    await reportProgress?.('bundling', 0.04, true);

    console.log(
      `[render ${renderId}] staged ${urls.length} media asset(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MiB in ${stagingMs}ms`,
    );

    return {
      inputProps: stagedInputProps,
      count: urls.length,
      bytes: totalBytes,
      stagingMs,
      cleanup: async () => {
        await stagingServer?.close();
        await rm(stagingDir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    await stagingServer?.close().catch(() => {});
    await rm(stagingDir, { recursive: true, force: true });
    throw err;
  }
};
