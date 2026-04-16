import React, { useEffect, useRef, useState } from 'react';

interface Props {
  videoUrl: string;
  audioUrl?: string;
  globalStartSec: number;
  durationSec: number;
  className?: string;
}

// Plays a shot's video muted and overlays the song audio at the shot's global
// timestamp so the artist can check sync before rendering. Veo now returns
// silent video (generateAudio=false); we mute the video element anyway so
// older clips with baked-in Veo audio don't double up with the song.
export const ShotVideoPreview: React.FC<Props> = ({ videoUrl, audioUrl, globalStartSec, durationSec, className }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [videoMuted, setVideoMuted] = useState(true);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    const alignAudio = () => {
      audio.currentTime = globalStartSec + Math.min(video.currentTime, durationSec);
    };
    const onPlay = () => {
      alignAudio();
      audio.play().catch(() => {});
    };
    const onPause = () => audio.pause();
    const onSeeked = () => alignAudio();
    const onTimeUpdate = () => {
      // Snap drift back into tolerance; browsers occasionally desync.
      const target = globalStartSec + video.currentTime;
      if (Math.abs(audio.currentTime - target) > 0.25) audio.currentTime = target;
    };
    // Keep audio in sync with video's loop back to 0.
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
  }, [globalStartSec, durationSec, audioUrl, videoUrl]);

  // Sync the muted attribute when state changes
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = videoMuted;
  }, [videoMuted]);

  return (
    <div
      className={`relative ${className || ''}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <video ref={videoRef} src={videoUrl} controls loop muted playsInline className="w-full h-auto" />
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}

      {/* Video audio mute/unmute toggle — bottom-left, visible on hover */}
      <button
        onClick={() => setVideoMuted(m => !m)}
        className={`absolute bottom-2 left-2 w-7 h-7 bg-black/60 rounded flex items-center justify-center text-zinc-300 hover:text-white transition-opacity ${hovering ? 'opacity-100' : 'opacity-0'}`}
        title={videoMuted ? 'Unmute video audio' : 'Mute video audio'}
        aria-label={videoMuted ? 'Unmute video audio' : 'Mute video audio'}
      >
        {videoMuted ? (
          /* Speaker off / muted */
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <line x1="23" y1="9" x2="17" y2="15"/>
            <line x1="17" y1="9" x2="23" y2="15"/>
          </svg>
        ) : (
          /* Speaker on */
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        )}
      </button>
    </div>
  );
};
