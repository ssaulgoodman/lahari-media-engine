import React, { useEffect, useRef, useState } from 'react';

interface Props {
  videoUrl: string;
  audioUrl?: string;
  globalStartSec: number;
  durationSec: number;
  className?: string;
}

// Two independent audio channels:
// 1. Video native audio (speaker icon) — muted by default, most Veo/Seedance clips are silent
// 2. Song audio (music note icon) — plays the devotional track at the shot's timestamp
export const ShotVideoPreview: React.FC<Props> = ({ videoUrl, audioUrl, globalStartSec, durationSec, className }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [videoMuted, setVideoMuted] = useState(true);
  const [songMuted, setSongMuted] = useState(false);
  const [hovering, setHovering] = useState(false);

  // Sync song audio with video playback
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    const alignAudio = () => {
      audio.currentTime = globalStartSec + Math.min(video.currentTime, durationSec);
    };
    const onPlay = () => {
      alignAudio();
      if (!songMuted) audio.play().catch(() => {});
    };
    const onPause = () => audio.pause();
    const onSeeked = () => alignAudio();
    const onTimeUpdate = () => {
      const target = globalStartSec + video.currentTime;
      if (Math.abs(audio.currentTime - target) > 0.25) audio.currentTime = target;
    };
    const onEnded = () => { audio.currentTime = globalStartSec; };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
      audio.pause();
    };
  }, [globalStartSec, durationSec, audioUrl, videoUrl, songMuted]);

  // Sync video muted state
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = videoMuted;
  }, [videoMuted]);

  // Sync song muted state — pause/resume without losing position
  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio) return;
    if (songMuted) {
      audio.pause();
    } else if (video && !video.paused) {
      audio.play().catch(() => {});
    }
  }, [songMuted]);

  return (
    <div
      className={`relative ${className || ''}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <video ref={videoRef} src={videoUrl} controls loop muted playsInline className="w-full h-auto" />
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}

      {/* Audio controls — bottom-left, visible on hover */}
      <div className={`absolute bottom-2 left-2 flex items-center gap-1 transition-opacity ${hovering ? 'opacity-100' : 'opacity-0'}`}>
        {/* Video native audio (speaker icon) */}
        <button
          onClick={() => setVideoMuted(m => !m)}
          className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${videoMuted ? 'bg-black/60 text-zinc-400' : 'bg-white/20 text-white'}`}
          title={videoMuted ? 'Unmute video audio' : 'Mute video audio'}
        >
          {videoMuted ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/>
              <line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          )}
        </button>

        {/* Song audio (music note icon) — only shown when audioUrl exists */}
        {audioUrl && (
          <button
            onClick={() => setSongMuted(m => !m)}
            className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${songMuted ? 'bg-black/60 text-zinc-400' : 'bg-white/20 text-white'}`}
            title={songMuted ? 'Unmute song audio' : 'Mute song audio'}
          >
            {songMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13"/>
                <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2.5"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13"/>
                <circle cx="6" cy="18" r="3"/>
                <circle cx="18" cy="16" r="3"/>
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
