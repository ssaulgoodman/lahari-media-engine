/**
 * PromptToolkit — extracted from Storyboard.tsx.
 * Per-shot prompt editing with tabs (First frame / Last frame / Video / Full chain),
 * @mention picker, ref chips, generate button, and refine section.
 */
import React, { useState } from 'react';
import { VideoScene, VideoShot, ApiProject } from '../types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { getVideoModel } from '../constants/videoModels';
import type { ShotRefInput } from '../services/api';

interface PromptToolkitProps {
  project: ApiProject;
  shot: VideoShot;
  scene: VideoScene;
  shotIdx: number;

  // Tab state (parent-owned — key pattern used for refs)
  activeTab: 'image' | 'endframe' | 'video' | 'compiled';
  onTabChange: (tab: 'image' | 'endframe' | 'video' | 'compiled') => void;

  // Video override (parent-owned — used in bulk ops)
  videoOverride?: string;
  onVideoOverrideChange: (override: string | undefined) => void;

  // Ref helpers (parent-owned — shared with other components)
  getActiveRefs: (shot: VideoShot, tab: 'image' | 'endframe' | 'video') => ShotRefInput[];
  setActiveRefs: (shotId: string, tab: string, refs: ShotRefInput[]) => void;
  resolveRefDisplay: (ref: ShotRefInput, shot: VideoShot) => { label: string; url?: string; removable: boolean };

  // Refine state (parent-owned — cross-shot tracking)
  isRefining: boolean;
  onRefineStart: (key: string) => void;
  onRefineEnd: (key: string) => void;

  // Derived state from parent
  isGenerating: boolean;
  hasStartFrame: boolean;
  hasVideo: boolean;
  actionable: boolean;
  modelSupportsLastFrame: boolean;
  autoVeoPrompt: string;

  // Compiled chain data (pre-built by parent)
  compiledRefs: { label: string; url?: string }[];
  compiledText: string;

  // Callbacks
  onGenerateImage: (sceneId: string, shotId: string, refs?: ShotRefInput[]) => void;
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;
  onGenerateEndFrame?: (shotId: string, refs?: ShotRefInput[]) => void | Promise<void>;
  onRefinePrompt: (sceneId: string, shotId: string, feedback: string) => void | Promise<void>;
  onRefineEndFramePrompt?: (shotId: string, feedback: string) => void | Promise<void>;
  onRefineVideoPrompt?: (shotId: string, feedback: string) => void | Promise<void>;
  onUploadShotRef?: (shotId: string, file: File) => void | Promise<void>;
  onDeleteShotRef?: (shotId: string, assetId: string) => void | Promise<void>;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  setModalImage: (url: string | null) => void;
}

export const PromptToolkit: React.FC<PromptToolkitProps> = ({
  project, shot, scene, shotIdx,
  activeTab, onTabChange,
  videoOverride, onVideoOverrideChange,
  getActiveRefs, setActiveRefs, resolveRefDisplay,
  isRefining, onRefineStart, onRefineEnd,
  isGenerating, hasStartFrame, hasVideo, actionable, modelSupportsLastFrame, autoVeoPrompt,
  compiledRefs, compiledText,
  onGenerateImage, onGenerateVideo, onGenerateEndFrame,
  onRefinePrompt, onRefineEndFramePrompt, onRefineVideoPrompt,
  onUploadShotRef, onDeleteShotRef, onUpdateShot, setModalImage,
}) => {
  // Internal state — purely about the prompt UI
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [promptDirty, setPromptDirty] = useState<Record<string, boolean>>({});

  const isFirstFrame = activeTab === 'image';
  const isEndFrame = activeTab === 'endframe';
  const isVideo = activeTab === 'video';

  const currentPrompt = isFirstFrame ? (shot.visualPrompt || '')
    : isEndFrame ? (shot.endVisualPrompt || '')
    : (videoOverride ?? autoVeoPrompt);

  const promptPlaceholder = isFirstFrame ? 'Describe the visual scene…'
    : isEndFrame ? 'Describe what this shot should end on…'
    : 'Video prompt — camera, motion, scene context…';

  const handlePromptChange = (val: string) => {
    if (isFirstFrame) onUpdateShot(scene.id, shot.id, { visualPrompt: val });
    else if (isEndFrame) onUpdateShot(scene.id, shot.id, { endVisualPrompt: val } as any);
    else onVideoOverrideChange(val);
  };

  const handleGenerate = () => {
    const tab = activeTab as 'image' | 'endframe' | 'video';
    const refs = getActiveRefs(shot, tab);
    if (isFirstFrame) onGenerateImage(scene.id, shot.id, refs);
    else if (isEndFrame) onGenerateEndFrame?.(shot.id, refs);
    else {
      onGenerateVideo(scene.id, shot.id, videoOverride && videoOverride !== autoVeoPrompt ? videoOverride : undefined, refs);
    }
  };

  const handleRefine = async (feedback: string) => {
    const key = `${activeTab}:${shot.id}`;
    onRefineStart(key);
    try {
      if (isFirstFrame) await onRefinePrompt(scene.id, shot.id, feedback);
      else if (isEndFrame) await onRefineEndFramePrompt?.(shot.id, feedback);
      else if (isVideo) await onRefineVideoPrompt?.(shot.id, feedback);
    } finally {
      onRefineEnd(key);
    }
  };

  const generateLabel = isFirstFrame
    ? (hasStartFrame ? 'Regenerate frame' : 'Generate frame')
    : isEndFrame
      ? (shot.endImageUrl ? 'Regenerate end frame' : 'Generate end frame')
      : (hasVideo ? 'Regenerate video' : 'Generate video');

  const canGenerate = isFirstFrame ? (!isGenerating && (actionable || shot.locked))
    : isEndFrame ? (!isGenerating && !!currentPrompt)
    : (!isGenerating && hasStartFrame);

  const hasResult = isFirstFrame ? hasStartFrame : isEndFrame ? !!shot.endImageUrl : hasVideo;
  const dirtyKey = `${activeTab}:${shot.id}`;

  return (
    <div className="space-y-3">
      {/* Tab selector */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => onTabChange('image')}
          className={`text-sm font-medium transition-colors ${activeTab === 'image' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
        >First frame</button>
        {modelSupportsLastFrame && (
          <button
            onClick={() => onTabChange('endframe')}
            className={`text-sm font-medium transition-colors ${activeTab === 'endframe' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
          >Last frame</button>
        )}
        <button
          onClick={() => onTabChange('video')}
          className={`text-sm font-medium transition-colors ${activeTab === 'video' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
        >Video</button>
        <button
          onClick={() => onTabChange('compiled')}
          className={`text-sm font-medium transition-colors ${activeTab === 'compiled' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
        >Full chain</button>
      </div>

      {/* ═══ Ref chips — artist-controlled, these are what get sent to generation ═══ */}
      {!shot.locked && activeTab !== 'compiled' && (() => {
        const tab = activeTab as 'image' | 'endframe' | 'video';
        const activeRefList = getActiveRefs(shot, tab);
        const modelSpec = getVideoModel(project?.videoModel);
        const canUploadRef = tab === 'image' || tab === 'endframe' || (tab === 'video' && modelSpec.refsWithFrames);

        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-zinc-500 mr-1">Refs:</span>
            {activeRefList.map((ref, i) => {
              const display = resolveRefDisplay(ref, shot);
              if (!display.url && ref.type !== 'continuity') return null;
              return (
                <div key={`${ref.type}-${ref.id || i}`} className={`group/ref relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border text-zinc-300 cursor-pointer ${ref.type === 'uploaded' ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-white/[0.08] bg-white/[0.02]'}`}
                  onClick={() => display.url && setModalImage(display.url)}>
                  {display.url && <img src={display.url} className="w-4 h-4 rounded-sm object-cover flex-shrink-0" alt="" />}
                  <span>{display.label}</span>
                  {display.removable && (
                    <button
                      className="text-zinc-500 hover:text-red-400 transition-colors ml-0.5"
                      title={`Remove ${display.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveRefs(shot.id, tab, activeRefList.filter((_, idx) => idx !== i));
                        if (ref.type === 'cast' && ref.id) {
                          onUpdateShot(scene.id, shot.id, { castIds: (shot.castIds || []).filter(id => id !== ref.id) });
                        } else if (ref.type === 'env' && ref.id) {
                          onUpdateShot(scene.id, shot.id, { environmentId: null } as any);
                        } else if (ref.type === 'uploaded' && ref.id) {
                          onDeleteShotRef?.(shot.id, ref.id);
                        }
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                  {display.url && (
                    <div className="hidden group-hover/ref:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200] pointer-events-none">
                      <img src={display.url} className="max-w-44 max-h-44 object-contain rounded-lg shadow-xl border border-white/[0.1]" alt={display.label} />
                    </div>
                  )}
                </div>
              );
            })}
            {canUploadRef && (
              <label className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-dashed border-white/[0.12] text-zinc-400 hover:text-zinc-300 hover:border-white/[0.2] bg-white/[0.01] cursor-pointer transition-colors" title="Upload a reference image for this shot">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Ref</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadShotRef?.(shot.id, file);
                  e.target.value = '';
                }} />
              </label>
            )}
          </div>
        );
      })()}

      {/* ═══ Full chain (compiled read-only view) ═══ */}
      {activeTab === 'compiled' ? (
        <div className="space-y-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Inputs &rarr; Gemini 3 Pro Image</div>
          {compiledRefs.length > 0 && (
            <div className="flex gap-2.5 flex-wrap">
              {compiledRefs.map((ref, i) => (
                <div key={i} className="relative group/ref">
                  {ref.url ? (
                    <img src={ref.url} className="w-16 h-16 object-cover rounded-md border border-white/[0.06] cursor-zoom-in" alt={ref.label} onClick={() => ref.url && setModalImage(ref.url)} />
                  ) : (
                    <div className="w-16 h-16 rounded-md border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-[11px] text-zinc-400">?</div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[10px] text-zinc-300 px-1 py-0.5 rounded-b-md truncate text-center font-mono">{ref.label}</div>
                </div>
              ))}
            </div>
          )}
          <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{compiledText}</pre>
          <div className="h-px bg-white/[0.06]" />
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Output &rarr; Start frame</div>
          {shot.imageUrl ? (
            <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="max-h-48 rounded-md border border-white/[0.06] cursor-zoom-in" />
          ) : (
            <div className="text-xs text-zinc-400">Not generated yet</div>
          )}
          <div className="h-px bg-white/[0.06] mt-2" />
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
            Start frame + prompt &rarr; {project?.videoModel?.includes('seedance') ? 'Seedance' : 'Veo'} &rarr; Video
          </div>
          <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{autoVeoPrompt}</pre>
          {shot.videoUrl && (
            <>
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Output &rarr; Video</div>
              <video src={shot.videoUrl} className="max-h-48 rounded-md border border-white/[0.06]" controls muted />
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Extracted-from-video note for last frame with no prompt */}
          {isEndFrame && !shot.endVisualPrompt && shot.extractedLastFrameUrl && (
            <div className="surface-inset rounded-md p-3 text-sm text-zinc-400 italic">
              Extracted from video — no prompt. Write one below to generate a specific end frame.
            </div>
          )}

          {/* Prompt textarea with @mention support */}
          {shot.locked ? (
            <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{currentPrompt || '(empty)'}</pre>
          ) : (
            <div className="relative">
              <textarea
                id={`prompt-${activeTab}-${shot.id}`}
                value={currentPrompt}
                onChange={e => {
                  handlePromptChange(e.target.value);
                  setPromptDirty(prev => ({ ...prev, [dirtyKey]: true }));
                  // @mention detection
                  const val = e.target.value;
                  const cursor = e.target.selectionStart;
                  const before = val.slice(0, cursor);
                  const atIdx = before.lastIndexOf('@');
                  if (atIdx >= 0 && (atIdx === 0 || /\s/.test(before[atIdx - 1]))) {
                    const query = before.slice(atIdx + 1);
                    if (/\s/.test(query)) { setMentionOpen(false); setMentionQuery(''); }
                    else { setMentionOpen(true); setMentionQuery(query.toLowerCase()); }
                  } else { setMentionOpen(false); setMentionQuery(''); }
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape' && mentionOpen) {
                    setMentionOpen(false); setMentionQuery('');
                  }
                }}
                onBlur={() => { setTimeout(() => { setMentionOpen(false); setMentionQuery(''); }, 200); }}
                placeholder={promptPlaceholder}
                className="w-full surface-inset rounded-md p-3 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none min-h-[2.5rem]"
                style={{ height: 'auto', overflow: 'hidden' }}
                ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
              />
              {/* @mention dropdown */}
              {mentionOpen && (() => {
                const tab = activeTab as 'image' | 'endframe' | 'video';
                const currentRefs = getActiveRefs(shot, tab);
                const hasCastRef = (id: string) => currentRefs.some(r => r.type === 'cast' && r.id === id);
                const hasEnvRef = (id: string) => currentRefs.some(r => r.type === 'env' && r.id === id);
                const hasRefType = (t: string) => currentRefs.some(r => r.type === t);

                const castItems = (project?.cast || []).filter(c => !mentionQuery || c.name.toLowerCase().includes(mentionQuery)).map(c => ({ name: c.name, thumb: c.referenceImageUrl, type: 'character' as const, already: hasCastRef(c.id) }));
                const envItems = (project?.environments || []).filter(e => !mentionQuery || e.name.toLowerCase().includes(mentionQuery)).map(e => ({ name: e.name, thumb: e.referenceImageUrl, type: 'environment' as const, already: hasEnvRef(e.id) }));
                const styleItem = project?.styleAssetUrl && (!mentionQuery || 'style'.includes(mentionQuery))
                  ? [{ name: 'Style', thumb: project.styleAssetUrl, type: 'style' as const, already: hasRefType('style') }] : [];
                type MentionItem = { name: string; thumb?: string; type: string; already: boolean };
                const frameItems: MentionItem[] = [];
                if (shot.imageUrl && (!mentionQuery || 'start frame'.includes(mentionQuery)) && !hasRefType('start-frame'))
                  frameItems.push({ name: 'Start frame', thumb: shot.imageUrl, type: 'start-frame', already: false });
                if ((shot.endImageUrl || shot.extractedLastFrameUrl) && (!mentionQuery || 'end frame'.includes(mentionQuery)) && !hasRefType('end-frame'))
                  frameItems.push({ name: 'End frame', thumb: shot.endImageUrl || shot.extractedLastFrameUrl, type: 'end-frame', already: false });
                const items: MentionItem[] = [...styleItem, ...frameItems, ...castItems, ...envItems];
                if (items.length === 0) return null;
                return (
                  <div className="absolute left-0 bottom-full mb-1 z-[200] bg-zinc-900 border border-white/[0.08] rounded-lg shadow-xl max-h-[200px] overflow-y-auto w-64">
                    {items.map((item, i) => (
                      <button key={`${item.type}-${i}`} type="button"
                        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/[0.04] cursor-pointer text-left"
                        onMouseDown={e => {
                          e.preventDefault();
                          const textarea = document.getElementById(`prompt-${activeTab}-${shot.id}`) as HTMLTextAreaElement;
                          if (!textarea) return;
                          const val = textarea.value;
                          const cursor = textarea.selectionStart;
                          const before = val.slice(0, cursor);
                          const atIdx = before.lastIndexOf('@');
                          if (atIdx < 0) return;
                          const newVal = val.slice(0, atIdx) + '@' + item.name + ' ' + val.slice(cursor);
                          handlePromptChange(newVal);
                          setPromptDirty(prev => ({ ...prev, [dirtyKey]: true }));
                          setMentionOpen(false); setMentionQuery('');
                          // Add ref + assign to shot if needed
                          const curRefs = getActiveRefs(shot, tab);
                          if (item.type === 'character') {
                            const charObj = project?.cast?.find(c => c.name === item.name);
                            if (charObj) {
                              if (!curRefs.some(r => r.type === 'cast' && r.id === charObj.id)) {
                                setActiveRefs(shot.id, tab, [...curRefs, { type: 'cast', id: charObj.id }]);
                              }
                              if (!(shot.castIds || []).includes(charObj.id)) {
                                onUpdateShot(scene.id, shot.id, { castIds: [...(shot.castIds || []), charObj.id] });
                              }
                            }
                          } else if (item.type === 'environment') {
                            const envObj = project?.environments?.find(en => en.name === item.name);
                            if (envObj) {
                              if (!curRefs.some(r => r.type === 'env' && r.id === envObj.id)) {
                                setActiveRefs(shot.id, tab, [...curRefs, { type: 'env', id: envObj.id }]);
                              }
                              if (shot.environmentId !== envObj.id) {
                                onUpdateShot(scene.id, shot.id, { environmentId: envObj.id } as any);
                              }
                            }
                          } else if (item.type === 'style') {
                            if (!curRefs.some(r => r.type === 'style')) {
                              setActiveRefs(shot.id, tab, [...curRefs, { type: 'style' }]);
                            }
                          } else if (item.type === 'start-frame') {
                            if (!curRefs.some(r => r.type === 'start-frame')) {
                              setActiveRefs(shot.id, tab, [...curRefs, { type: 'start-frame' }]);
                            }
                          } else if (item.type === 'end-frame') {
                            if (!curRefs.some(r => r.type === 'end-frame')) {
                              setActiveRefs(shot.id, tab, [...curRefs, { type: 'end-frame' }]);
                            }
                          }
                          setTimeout(() => { textarea.focus(); const pos = atIdx + item.name.length + 2; textarea.setSelectionRange(pos, pos); }, 0);
                        }}
                      >
                        {item.thumb ? <img src={item.thumb} className="w-6 h-6 rounded object-cover flex-shrink-0" alt="" /> : <div className="w-6 h-6 rounded bg-white/[0.06] flex-shrink-0" />}
                        <span className="text-sm text-zinc-300 truncate">{item.name}</span>
                        <span className="text-[10px] uppercase text-zinc-400 ml-auto flex-shrink-0">{item.type === 'character' ? 'char' : item.type === 'environment' ? 'env' : item.type === 'start-frame' ? 'frame' : item.type === 'end-frame' ? 'frame' : 'style'}</span>
                        {(item as any).already && <span className="text-[9px] text-zinc-500">added</span>}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Video tab: reset to auto button */}
          {isVideo && videoOverride && videoOverride !== autoVeoPrompt && (
            <button
              onClick={() => { onVideoOverrideChange(undefined); setPromptDirty(prev => ({ ...prev, [`video:${shot.id}`]: true })); }}
              className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
            >Reset to auto-generated prompt</button>
          )}

          {/* Generate button */}
          {!shot.locked && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => { handleGenerate(); setPromptDirty(prev => ({ ...prev, [dirtyKey]: false })); }}
                disabled={!canGenerate}
                className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors flex items-center gap-1.5"
              >
                {isGenerating && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
                {isGenerating ? 'Generating…' : hasResult && !promptDirty[dirtyKey] ? 'Regenerate' : generateLabel}
              </button>
            </div>
          )}

          {/* Refine — plain text feedback, Claude rewrites the prompt */}
          {!shot.locked && (
            <>
              <div className="h-px bg-white/[0.06] my-1" />
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                Refine — describe what's wrong, Claude rewrites the prompt
              </div>
              <div className="flex gap-2">
                <AutoGrowTextarea
                  id={`refine-${activeTab}-${shot.id}`}
                  placeholder={isFirstFrame ? "e.g. 'face not crisp, lighting too flat'" : isEndFrame ? "e.g. 'should end with a wider shot'" : "e.g. 'camera too shaky, slow it down'"}
                  rows={1}
                  disabled={isRefining}
                  className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed disabled:opacity-50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !isRefining && (e.target as HTMLTextAreaElement).value.trim()) {
                      e.preventDefault();
                      handleRefine((e.target as HTMLTextAreaElement).value);
                      (e.target as HTMLTextAreaElement).value = '';
                    }
                  }}
                />
                <button
                  disabled={isRefining}
                  onClick={() => {
                    const input = document.getElementById(`refine-${activeTab}-${shot.id}`) as HTMLTextAreaElement;
                    if (input?.value.trim() && !isRefining) {
                      handleRefine(input.value);
                      input.value = '';
                    }
                  }}
                  className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-400 hover:text-white rounded-md text-xs font-medium transition-colors flex-shrink-0 self-start disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isRefining && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
                  {isRefining ? 'Refining…' : 'Refine'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
