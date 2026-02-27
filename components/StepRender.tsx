
import React, { useState, useEffect, useRef } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { ApiProject } from '../types';

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
  const ffmpegRef = useRef(new FFmpeg());
  const messageRef = useRef<HTMLParagraphElement>(null);

  const load = async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    const ffmpeg = ffmpegRef.current;
    
    // Log FFmpeg messages
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
        alert("Audio file missing.");
        return;
    }

    setIsRendering(true);
    setFinalVideoUrl(null);
    const ffmpeg = ffmpegRef.current;

    try {
        // 1. Gather all clips
        const shots = project.scenes.flatMap(s => s.shots).filter(s => s.videoUrl);
        if (shots.length === 0) throw new Error("No videos generated yet.");

        setStatusText("Writing assets to memory...");
        
        // 2. Write Audio
        await ffmpeg.writeFile('audio.mp3', await fetchFile(`/storage/${project.audioPath}`));

        // 3. Write Video Clips & Build Concat List
        let fileList = '';
        for (let i = 0; i < shots.length; i++) {
            const shot = shots[i];
            const fileName = `clip_${i}.mp4`;
            
            setStatusText(`Loading clip ${i + 1}/${shots.length}...`);
            await ffmpeg.writeFile(fileName, await fetchFile(shot.videoUrl!));
            fileList += `file '${fileName}'\n`;
        }
        
        await ffmpeg.writeFile('concat_list.txt', fileList);

        // 4. Stitch Videos (Visual Track)
        setStatusText("Stitching video timeline...");
        // concat demuxer is fast and preserves quality if formats match
        await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat_list.txt', '-c', 'copy', 'visual_track.mp4']);

        // 5. Mix with Audio (Final Master)
        setStatusText("Mastering audio mix...");
        // -c:v copy to keep video quality, -c:a aac for audio compatibility, -shortest to end when video ends
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

        // 6. Read Result
        const data = await ffmpeg.readFile('out.mp4');
        const url = URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: 'video/mp4' }));
        setFinalVideoUrl(url);
        setStatusText("Render Complete!");

    } catch (e: any) {
        console.error(e);
        setStatusText(`Error: ${e.message}`);
    } finally {
        setIsRendering(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-slide-up pb-32">
        <div className="text-center space-y-2 mb-12">
            <h2 className="text-4xl font-display font-medium text-white">Final Render</h2>
            <p className="text-zinc-500">Compile your masterpiece locally using FFmpeg WASM.</p>
        </div>

        <div className="glass p-8 rounded-2xl space-y-8 text-center">
            {!loaded ? (
                <div className="py-12 flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-t-2 border-accent-400 rounded-full animate-spin"></div>
                    <p className="text-zinc-400 animate-pulse">{statusText}</p>
                </div>
            ) : (
                <div className="space-y-8">
                    
                    {/* Status Monitor */}
                    <div className="bg-black/40 rounded-lg p-4 font-mono text-xs text-zinc-400 h-32 overflow-y-auto text-left border border-white/5">
                        <p className="text-accent-400 mb-2">System Status: {statusText}</p>
                        <p ref={messageRef} className="opacity-50">...</p>
                    </div>

                    {/* Action Area */}
                    {!finalVideoUrl ? (
                        <div className="flex flex-col items-center gap-4">
                            <p className="text-sm text-zinc-300">
                                ready to stitch {project.scenes.flatMap(s => s.shots).filter(s => s.videoUrl).length} clips.
                            </p>
                            <button 
                                onClick={renderVideo}
                                disabled={isRendering || !project.audioPath}
                                className="bg-white text-black px-12 py-4 rounded-full font-bold hover:bg-accent-100 transition-all shadow-lg hover:scale-105 disabled:opacity-50 disabled:scale-100"
                            >
                                {isRendering ? 'Rendering...' : 'Start Render'}
                            </button>
                            {isRendering && (
                                <div className="w-full max-w-md h-1 bg-zinc-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-accent-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-6 animate-fade-in">
                            <div className="aspect-video bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl">
                                <video src={finalVideoUrl} controls className="w-full h-full" />
                            </div>
                            <div className="flex justify-center gap-4">
                                <a 
                                    href={finalVideoUrl} 
                                    download={`lahari_master_${Date.now()}.mp4`}
                                    className="bg-accent-600 hover:bg-accent-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg flex items-center gap-2"
                                >
                                    <span>⬇️</span> Download Master
                                </a>
                                <button onClick={() => setFinalVideoUrl(null)} className="text-zinc-400 hover:text-white px-6 py-3">
                                    Discard & Retry
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
            
            <div className="pt-6 border-t border-white/5 flex justify-between items-center">
                <button onClick={onBack} className="text-zinc-500 hover:text-white text-sm">← Back to Studio</button>
                <div className="text-[10px] text-zinc-600">
                    Powered by @ffmpeg/wasm
                </div>
            </div>
        </div>
    </div>
  );
};

