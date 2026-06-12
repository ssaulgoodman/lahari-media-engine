export interface SrtEntry {
  id: number;
  startTime: string;
  endTime: string;
  text: string;
}

export interface SrtQuality {
  severity: 'good' | 'warning' | 'critical';
  issues: string[];
}

const stripFence = (text: string): string => (
  String(text || '')
    .replace(/^```(?:srt|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
);

export const parseSRT = (data: string): SrtEntry[] => {
  const normalized = stripFence(data).replace(/\r\n/g, '\n');
  if (!normalized) return [];

  const segmentMatches = normalized.split(/\n\s*(?=\d+\n\d{2}:\d{2}:\d{2}[,.]\d{3})/);
  const entries: SrtEntry[] = [];

  for (const segment of segmentMatches) {
    const lines = segment.trim().split('\n');
    if (lines.length < 3) continue;
    const id = Number(lines[0].trim());
    const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
    const text = lines.slice(2).join(' ').replace(/\s+/g, ' ').trim();
    if (Number.isFinite(id) && timeMatch && text) {
      entries.push({
        id,
        startTime: timeMatch[1].replace('.', ','),
        endTime: timeMatch[2].replace('.', ','),
        text,
      });
    }
  }

  return entries;
};

export const stringifySRT = (entries: SrtEntry[]): string => entries
  .map((entry, index) => `${index + 1}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}`)
  .join('\n\n');

export const srtTimestampToSeconds = (timestamp: string): number => {
  const match = String(timestamp || '').trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
};

export const secondsToSrtTimestamp = (seconds: number): string => {
  const total = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};

export const offsetSrtTimestamps = (entries: SrtEntry[], offsetSeconds: number): SrtEntry[] => entries.map((entry) => ({
  ...entry,
  startTime: secondsToSrtTimestamp(srtTimestampToSeconds(entry.startTime) + offsetSeconds),
  endTime: secondsToSrtTimestamp(srtTimestampToSeconds(entry.endTime) + offsetSeconds),
}));

export const stitchSrtChunks = (chunkResults: Array<{ entries: SrtEntry[]; offsetSeconds: number }>): SrtEntry[] => {
  const merged: SrtEntry[] = [];
  let nextId = 1;
  for (const chunk of chunkResults) {
    for (const entry of offsetSrtTimestamps(chunk.entries, chunk.offsetSeconds)) {
      merged.push({ ...entry, id: nextId++ });
    }
  }
  return merged;
};

const lyricTimestamp = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `[${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
  return `[${m}:${String(s).padStart(2, '0')}]`;
};

export const srtToTimestampedLyrics = (entries: SrtEntry[]): string => entries
  .filter((entry) => entry.text.trim())
  .map((entry) => `${lyricTimestamp(srtTimestampToSeconds(entry.startTime))} ${entry.text.trim()}`)
  .join('\n');

export const analyzeSrtQuality = (entries: SrtEntry[], expectedDurationSec?: number | null): SrtQuality => {
  const issues: string[] = [];
  const texts = entries.map((entry) => entry.text.trim()).filter(Boolean);

  if (texts.length === 0) return { severity: 'critical', issues: ['Empty transcription'] };

  const counter: Record<string, number> = {};
  for (const text of texts) counter[text] = (counter[text] || 0) + 1;
  const uniqueRatio = Object.keys(counter).length / texts.length;
  const maxRepeat = Math.max(...Object.values(counter));

  if (uniqueRatio < 0.3) issues.push(`High repetition: ${Math.round(uniqueRatio * 100)}% unique lines`);
  if (maxRepeat > 15) {
    const mostRepeated = Object.entries(counter).find(([, count]) => count === maxRepeat)?.[0] || '';
    issues.push(`Line repeated ${maxRepeat}x: "${mostRepeated.slice(0, 30)}..."`);
  }

  if (expectedDurationSec && expectedDurationSec > 0) {
    const expectedMin = (expectedDurationSec / 60) * 3;
    const expectedMax = (expectedDurationSec / 60) * 8;
    if (entries.length < expectedMin) {
      issues.push(`Too few segments: ${entries.length} (expected ${Math.round(expectedMin)}-${Math.round(expectedMax)})`);
    }
    if (entries.length > expectedMax * 1.5) {
      issues.push(`Too many segments: ${entries.length} (expected ${Math.round(expectedMin)}-${Math.round(expectedMax)})`);
    }
  }

  let shortSegments = 0;
  let longSegments = 0;
  for (const entry of entries) {
    const duration = srtTimestampToSeconds(entry.endTime) - srtTimestampToSeconds(entry.startTime);
    if (duration < 0.5) shortSegments++;
    if (duration > 25) longSegments++;
  }
  if (shortSegments > 3) issues.push(`${shortSegments} segments very short (<0.5s)`);
  if (longSegments > 2) issues.push(`${longSegments} segments very long (>25s)`);

  let severity: SrtQuality['severity'] = issues.length ? 'warning' : 'good';
  if (issues.some((issue) => issue.includes('High repetition') || issue.includes('Empty'))) {
    severity = 'critical';
  }
  return { severity, issues };
};
