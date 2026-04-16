import React, { useEffect, useRef } from 'react';

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

  return (
    <div className={className}>
      <video ref={videoRef} src={videoUrl} controls loop muted playsInline className="w-full h-auto" />
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}
    </div>
  );
};
