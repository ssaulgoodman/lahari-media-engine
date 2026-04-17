
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { ApiProject } from '../types';
import TimelineEditor, { InitialClip } from './timeline-editor/TimelineEditor';

interface Props {
  project: ApiProject;
  onBack: () => void;
}

export const StepRender: React.FC<Props> = ({ project, onBack }) => {
  const [loaded, setLoaded] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Initializing...");
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [finalBlob, setFinalBlob] = useState<Blob | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ videoUrl: string; queueRowUpdated: boolean } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const ffmpegRef = useRef(new FFmpeg());
  const messageRef = useRef<HTMLParagraphElement>(null);

  const load = async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    const ffmpeg = ffmpegRef.current;

    ffmpeg.on('log', ({ message }) => {
      if (messageRef.current) messageRef.current.innerHTML = message;
      console.log(message);
    });

    ffmpeg.on('progress', ({ progress, time }) => {
       setProgress(Math.round(progress * 100));
    });

    try {
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setLoaded(true);
        setStatusText("Ready to Render");
    } catch (e) {
        console.error(e);
        setStatusText("Failed to load FFmpeg. Check connection.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const renderVideo = async () => {
    if (!project.audioPath) {
        setRenderError('Audio file missing on this project.');
        return;
    }
    setRenderError(null);

    setIsRendering(true);
    setFinalVideoUrl(null);
    const ffmpeg = ffmpegRef.current;

    try {
        const shots = project.scenes.flatMap(s => s.shots).filter(s => s.videoUrl);
        if (shots.length === 0) throw new Error("No videos generated yet.");

        setStatusText("Writing assets to memory...");
        await ffmpeg.writeFile('audio.mp3', await fetchFile(project.audioPath!));

        let fileList = '';
        for (let i = 0; i < shots.length; i++) {
            const shot = shots[i];
            const fileName = `clip_${i}.mp4`;
            setStatusText(`Loading clip ${i + 1}/${shots.length}...`);
            await ffmpeg.writeFile(fileName, await fetchFile(shot.videoUrl!));
            fileList += `file '${fileName}'\n`;
        }

        await ffmpeg.writeFile('concat_list.txt', fileList);

        setStatusText("Stitching video timeline...");
        await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat_list.txt', '-c', 'copy', 'visual_track.mp4']);

        setStatusText("Mastering audio mix...");
        await ffmpeg.exec([
            '-i', 'visual_track.mp4',
            '-i', 'audio.mp3',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-shortest',
            'out.mp4'
        ]);

        const data = await ffmpeg.readFile('out.mp4');
        const blob = new Blob([data as any], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        setFinalBlob(blob);
        setFinalVideoUrl(url);
        setStatusText("Render Complete!");

    } catch (e: any) {
        console.error(e);
        setStatusText(`Error: ${e.message}`);
    } finally {
        setIsRendering(false);
    }
  };

  // Upload the final render to /storage and mark the owning queue row
  // completed (latest-completed-wins: queue points at this fork now).
  const publishToQueue = async () => {
    if (!finalBlob) return;
    setIsPublishing(true);
    setRenderError(null);
    try {
      const form = new FormData();
      form.append('video', new File([finalBlob], 'final.mp4', { type: 'video/mp4' }));
      const res = await fetch(`/api/queue/publish/${project.id}`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Publish failed: ${res.status}`);
      }
      const data = await res.json();
      setPublishResult({ videoUrl: data.videoUrl, queueRowUpdated: data.queueRowUpdated });
    } catch (e: any) {
      console.error(e);
      setRenderError(e.message);
    } finally {
      setIsPublishing(false);
    }
  };

  // Shot videos that the timeline preview should seed with. Derived once from
  // the project; kept stable so the editor only auto-populates on mount.
  const previewClips = useMemo<InitialClip[]>(
    () =>
      project.scenes
        .flatMap((s) => s.shots)
        .filter((s) => !!s.videoUrl)
        .map((s) => ({ src: s.videoUrl!, name: `shot-${s.id}` })),
    // Only re-seed if the set of video URLs actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.scenes.flatMap((s) => s.shots).map((s) => s.videoUrl).join('|')],
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-32">
        <div className="text-center space-y-2 mb-8">
            <h2 className="text-2xl font-display font-medium text-white tracking-tight">Final Render</h2>
            <p className="text-zinc-400 text-sm">Compile your masterpiece locally using FFmpeg WASM.</p>
        </div>

        {previewClips.length > 0 && (
          <div className="surface rounded-xl overflow-hidden" style={{ height: 640 }}>
            <TimelineEditor embedded initialClips={previewClips} />
          </div>
        )}

        <div className="surface rounded-xl p-8 space-y-8 text-center">
            {!loaded ? (
                <div className="py-12 flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
                    <p className="text-zinc-400 text-sm">{statusText}</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {/* Status Monitor */}
                    <div className="surface-inset rounded-lg p-4 font-mono text-[11px] text-zinc-400 h-32 overflow-y-auto text-left">
                        <p className="text-white mb-2">Status: {statusText}</p>
                        <p ref={messageRef} className="opacity-50">...</p>
                    </div>

                    {!finalVideoUrl ? (
                        <div className="flex flex-col items-center gap-4">
                            <p className="text-sm text-zinc-400">
                                Ready to stitch {project.scenes.flatMap(s => s.shots).filter(s => s.videoUrl).length} clips.
                            </p>
                            <button
                                onClick={renderVideo}
                                disabled={isRendering || !project.audioPath}
                                className="bg-white text-black px-10 py-3 rounded-md font-semibold hover:bg-zinc-200 transition-all disabled:opacity-50 text-sm"
                            >
                                {isRendering ? 'Rendering...' : 'Start Render'}
                            </button>
                            {renderError && (
                                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{renderError}</p>
                            )}
                            {isRendering && (
                                <div className="w-full max-w-md h-1 bg-zinc-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-white transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="aspect-video bg-black rounded-lg overflow-hidden border border-white/[0.08] shadow-2xl">
                                <video src={finalVideoUrl} controls className="w-full h-full" />
                            </div>
                            <div className="flex flex-col items-center gap-4">
                                <div className="flex justify-center gap-3 flex-wrap">
                                    <a
                                        href={finalVideoUrl}
                                        download={`lahari_master_${Date.now()}.mp4`}
                                        className="bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] px-6 py-2.5 rounded-md font-semibold transition-all flex items-center gap-2 text-sm"
                                    >
                                        Download Master
                                    </a>
                                    <button
                                        onClick={publishToQueue}
                                        disabled={isPublishing || !!publishResult}
                                        className="bg-white text-black px-8 py-2.5 rounded-md font-semibold hover:bg-zinc-200 transition-all disabled:opacity-50 flex items-center gap-2 text-sm"
                                        title="Upload to Lahari storage and mark the queue row as completed on Supabase"
                                    >
                                        {isPublishing ? 'Publishing…' : publishResult ? 'Published ✓' : 'Publish to queue'}
                                    </button>
                                    <button onClick={() => { setFinalVideoUrl(null); setFinalBlob(null); setPublishResult(null); }} className="text-zinc-400 hover:text-white px-6 py-2.5 text-sm transition-colors">
                                        Discard & Retry
                                    </button>
                                </div>
                                {publishResult && (
                                    <div className="text-xs text-zinc-300 surface-inset rounded-md px-3 py-2 max-w-lg text-center">
                                        {publishResult.queueRowUpdated
                                            ? <>Queue row marked completed. Final URL: <a href={publishResult.videoUrl} target="_blank" rel="noreferrer" className="text-white hover:text-zinc-300 underline underline-offset-2 decoration-white/40">{publishResult.videoUrl}</a></>
                                            : <>Saved to <a href={publishResult.videoUrl} target="_blank" rel="noreferrer" className="text-white hover:text-zinc-300 underline underline-offset-2 decoration-white/40">{publishResult.videoUrl}</a>. No matching queue row found — this project wasn't started from the queue.</>
                                        }
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="pt-6 border-t border-white/[0.06] flex justify-between items-center">
                <button onClick={onBack} className="text-zinc-400 hover:text-white text-sm transition-colors">Back to Studio</button>
                <div className="text-[11px] text-zinc-400 font-mono">
                    @ffmpeg/wasm
                </div>
            </div>
        </div>
    </div>
  );
};
