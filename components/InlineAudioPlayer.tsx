import React, { useEffect, useRef, useState } from 'react';

/** Compact audio player styled to fit the dark UI — replaces native
 *  <audio controls> wherever we play audio inline. Extracted from the
 *  song mini-player that's been living in BlueprintContextBar; that
 *  surface still uses this component so the look stays identical.
 *
 *  Layout (left to right):
 *    [play/pause]  [scrubbable progress track]  [duration mono text]
 *
 *  Notes:
 *  - `preload="metadata"` so the duration shows immediately at rest;
 *    audio file bytes don't load until first play.
 *  - Click anywhere on the track to seek.
 *  - No volume control by design — volume is OS-/browser-level, and
 *    a per-clip slider is noise on short TTS lines.
 *  - `size="sm"` is the default and matches dialogue rows. `size="md"`
 *    gives the song-player chrome (slightly larger button, longer track).
 */
type Size = 'sm' | 'md';

interface Props {
  src: string;
  /** Optional className applied to the outer wrapper. */
  className?: string;
  /** Visual size preset. sm = TTS rows, md = song mini-player. */
  size?: Size;
  /** Track width in pixels. Defaults: sm=96, md=112. */
  trackWidth?: number;
}

const formatTime = (sec: number): string => {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const InlineAudioPlayer: React.FC<Props> = ({ src, className, size = 'sm', trackWidth }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Pause + reset state when the src swaps (e.g. regenerating a TTS line).
  // Without this the old element keeps playing in the background and the
  // progress fill points at stale numbers.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = pct * el.duration;
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const btnPx = size === 'md' ? 24 : 20;
  const iconPx = size === 'md' ? 11 : 10;
  const defaultTrack = size === 'md' ? 112 : 96;
  const trackPx = trackWidth ?? defaultTrack;

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        onClick={togglePlay}
        style={{ width: btnPx, height: btnPx }}
        className={`rounded flex items-center justify-center transition-colors flex-shrink-0 ${
          playing ? 'text-white' : 'text-zinc-400 hover:text-white'
        }`}
        title={playing ? 'Pause' : 'Play'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg xmlns="http://www.w3.org/2000/svg" width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
      </button>
      <div
        className="relative h-5 flex items-center cursor-pointer group flex-shrink-0"
        style={{ width: trackPx }}
        onClick={seek}
      >
        <div className="absolute inset-x-0 h-1 rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-white/40 group-hover:bg-white/60 transition-colors"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
      <span className="text-[10px] font-mono text-zinc-400 tabular-nums flex-shrink-0">
        {formatTime(currentTime)}
        {duration > 0 && <span className="text-zinc-500"> / {formatTime(duration)}</span>}
      </span>
    </div>
  );
};
