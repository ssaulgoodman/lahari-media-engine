import fs from 'fs';
import { readAsBase64, mimeFromExt } from '../storage.js';
import { GEMINI_AUDIO_ANALYSIS_MODEL, transcribeAudioToSRT, transcribeLyrics } from './gemini.js';
import { probeMediaDurationSec, splitAudioStorageToLocalChunks } from './ffmpeg.js';
import { analyzeSrtQuality, parseSRT, srtToTimestampedLyrics, stitchSrtChunks, stringifySRT, type SrtQuality } from './srt.js';

export const AUDIO_CHUNK_THRESHOLD_SEC = Number(process.env.GEMINI_AUDIO_CHUNK_THRESHOLD_SEC || 420);
export const AUDIO_CHUNK_DURATION_SEC = Number(process.env.GEMINI_AUDIO_CHUNK_DURATION_SEC || 180);

export interface LyricsTranscriptionResult {
  lyrics: string;
  method: 'single' | 'chunked';
  model: string;
  durationSec: number | null;
  chunks: number;
  srt?: string;
  quality?: SrtQuality;
}

export const transcribeLyricsForAudioPath = async (
  audioPath: string,
  language?: string | null,
): Promise<LyricsTranscriptionResult> => {
  const durationSec = await probeMediaDurationSec(audioPath).catch(() => null);

  if (!durationSec || durationSec <= AUDIO_CHUNK_THRESHOLD_SEC) {
    const audioBase64 = await readAsBase64(audioPath);
    const audioMime = mimeFromExt(audioPath);
    const lyrics = await transcribeLyrics(audioBase64, audioMime, language || undefined);
    return {
      lyrics,
      method: 'single',
      model: GEMINI_AUDIO_ANALYSIS_MODEL,
      durationSec,
      chunks: 1,
    };
  }

  const { chunks } = await splitAudioStorageToLocalChunks(audioPath, AUDIO_CHUNK_DURATION_SEC);
  const chunkResults: Array<{ entries: ReturnType<typeof parseSRT>; offsetSeconds: number }> = [];

  for (const chunk of chunks) {
    const base64 = fs.readFileSync(chunk.localPath).toString('base64');
    const srt = await transcribeAudioToSRT(base64, chunk.mimeType, language || undefined, {
      chunkIndex: chunk.index,
      totalChunks: chunks.length,
    });
    const entries = parseSRT(srt);
    chunkResults.push({ entries, offsetSeconds: chunk.startSec });
  }

  const stitched = stitchSrtChunks(chunkResults);
  const quality = analyzeSrtQuality(stitched, durationSec);
  const lyrics = srtToTimestampedLyrics(stitched);
  if (!lyrics.trim()) {
    const err = new Error('Chunked audio transcription returned empty output.');
    (err as any).statusCode = 502;
    (err as any).code = 'audio_transcription_empty';
    (err as any).details = { method: 'chunked', chunks: chunks.length, durationSec, quality };
    throw err;
  }

  return {
    lyrics,
    method: 'chunked',
    model: GEMINI_AUDIO_ANALYSIS_MODEL,
    durationSec,
    chunks: chunks.length,
    srt: stringifySRT(stitched),
    quality,
  };
};
