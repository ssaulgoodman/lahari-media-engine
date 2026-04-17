
import React, { useMemo } from 'react';
// FFMPEG RENDER — temporarily disabled. Kept commented so we can restore once
// the timeline editor becomes authoritative for the final stitch.
// import { FFmpeg } from '@ffmpeg/ffmpeg';
// import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { ApiProject } from '../types';
import TimelineEditor, { InitialClip } from './timeline-editor/TimelineEditor';

interface Props {
  project: ApiProject;
  onBack: () => void;
}

export const StepRender: React.FC<Props> = ({ project, onBack }) => {
  /* ── FFMPEG RENDER (disabled) ────────────────────────────────────────────
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
  ────────────────────────────────────────────────────────────────────────── */

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
    <div className="max-w-5xl mx-auto space-y-6 pb-32">
      <div className="text-center space-y-2 mb-4">
        <h2 className="text-2xl font-display font-medium text-white tracking-tight">Final Render</h2>
        <p className="text-zinc-400 text-sm">Arrange, trim, and preview your timeline. Stitching is temporarily disabled.</p>
      </div>

      {previewClips.length > 0 ? (
        <div className="surface rounded-xl overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 640 }}>
          <TimelineEditor embedded initialClips={previewClips} />
        </div>
      ) : (
        <div className="surface rounded-xl p-8 text-center">
          <p className="text-zinc-400 text-sm">No shot videos available yet. Generate videos in the Studio first.</p>
        </div>
      )}

      <div className="surface rounded-xl px-6 py-4 flex justify-between items-center">
        <button onClick={onBack} className="text-zinc-400 hover:text-white text-sm transition-colors">Back to Studio</button>
        <div className="text-[11px] text-zinc-400 font-mono">timeline-editor preview</div>
      </div>
    </div>
  );
};
