import React from 'react';
import type { PromptComposition, PromptCompositionSegment, PromptCompositionImage } from '../services/api';

type PromptCompositionInspectorProps = {
  title: string;
  composition?: PromptComposition | null;
  note?: string;
  generatedAt?: string | null;
  source?: string;
  segmentControls?: Record<string, {
    value?: boolean;
    disabled?: boolean;
    title?: string;
    onChange: (next: boolean | undefined) => void;
  }>;
};

const textForSegment = (segment: PromptCompositionSegment): string => {
  if (typeof segment.text === 'string') return segment.text;
  if (segment.value === undefined || segment.value === null) return '';
  return typeof segment.value === 'string' ? segment.value : JSON.stringify(segment.value, null, 2);
};

const finalPromptText = (composition?: PromptComposition | null): string => {
  if (!composition) return '';
  return String(composition.text || composition.finalPrompt || composition.prompt || '');
};

const segmentLabel = (segment: PromptCompositionSegment, index: number) =>
  segment.label || segment.slot || `Segment ${index + 1}`;

const imageLabel = (image: PromptCompositionImage, index: number) =>
  image.label || image.role || image.source || `Image ${index + 1}`;

export const PromptCompositionInspector: React.FC<PromptCompositionInspectorProps> = ({
  title,
  composition,
  note,
  generatedAt,
  source,
  segmentControls,
}) => {
  const segments = Array.isArray(composition?.segments) ? composition?.segments || [] : [];
  const images = Array.isArray(composition?.images) ? composition?.images || [] : [];
  const params = composition?.params && typeof composition.params === 'object' ? composition.params : null;
  const text = finalPromptText(composition);

  return (
    <details className="group rounded-md border border-white/[0.07] bg-white/[0.025] overflow-hidden">
      <summary className="list-none cursor-pointer select-none px-3 py-2 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors">
        <span className="min-w-0 flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-zinc-400">{title}</span>
          {composition ? (
            <span className="text-[10px] text-zinc-500 font-mono">
              {segments.length} slots · {images.length} refs
            </span>
          ) : (
            <span className="text-[10px] text-zinc-500">not captured</span>
          )}
        </span>
        <span className="text-zinc-500 group-open:rotate-180 transition-transform" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </summary>

      <div className="border-t border-white/[0.06] px-3 py-3 space-y-3">
        {!composition ? (
          <p className="text-[11px] leading-relaxed text-zinc-500">{note || 'This output predates prompt composition capture, or no generation has completed yet.'}</p>
        ) : (
          <>
            {(note || generatedAt || source) && (
              <div className="text-[10px] leading-relaxed text-zinc-500 space-y-0.5">
                {note && <p>{note}</p>}
                {generatedAt && <p className="font-mono">captured {new Date(generatedAt).toLocaleString()}</p>}
                {source && <p className="font-mono break-all">{source}</p>}
              </div>
            )}

            {images.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Images</div>
                <div className="flex flex-wrap gap-1.5">
                  {images.map((image, index) => (
                    <span
                      key={`${image.assetId || image.url || index}-${index}`}
                      className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                        image.included === false
                          ? 'border-white/[0.05] bg-white/[0.01] text-zinc-500 line-through'
                          : 'border-white/[0.08] bg-white/[0.03] text-zinc-300'
                      }`}
                      title={[image.source, image.assetId].filter(Boolean).join(' · ')}
                    >
                      <span className="font-mono text-zinc-500">{(image as any).ref || `#${index + 1}`}</span>
                      <span className="truncate">{imageLabel(image, index)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {params && Object.keys(params).length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Params</div>
                <pre className="max-h-32 overflow-auto rounded bg-black/20 border border-white/[0.05] px-2 py-1.5 text-[10px] leading-relaxed text-zinc-400 font-mono whitespace-pre-wrap">{JSON.stringify(params, null, 2)}</pre>
              </div>
            )}

            {segments.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Segments</div>
                <div className="space-y-1.5">
                  {segments.map((segment, index) => {
                    const body = textForSegment(segment);
                    const control = segment.slot ? segmentControls?.[segment.slot] : undefined;
                    return (
                      <details key={`${segment.slot || segment.label || index}-${index}`} className="rounded border border-white/[0.06] bg-black/10">
                        <summary className="list-none cursor-pointer px-2 py-1.5 flex items-center justify-between gap-2 hover:bg-white/[0.025] transition-colors">
                          <span className={`min-w-0 flex items-center gap-1.5 text-[11px] ${segment.included === false ? 'text-zinc-500' : 'text-zinc-300'}`}>
                            <span className="font-medium truncate">{segmentLabel(segment, index)}</span>
                            {segment.included === false && <span className="text-[10px] text-zinc-500">excluded</span>}
                          </span>
                          {segment.source && <span className="text-[10px] text-zinc-600 font-mono truncate max-w-[45%]">{segment.source}</span>}
                        </summary>
                        <div className="border-t border-white/[0.05] px-2 py-2 space-y-1">
                          {segment.editPath && <p className="text-[10px] text-zinc-500 font-mono">edit: {segment.editPath}</p>}
                          {control && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                              <span>Next run:</span>
                              {([
                                ['default', undefined],
                                ['on', true],
                                ['off', false],
                              ] as const).map(([label, value]) => {
                                const active = control.value === value;
                                return (
                                  <button
                                    key={label}
                                    type="button"
                                    disabled={control.disabled}
                                    onClick={() => control.onChange(value)}
                                    className={`rounded border px-1.5 py-0.5 transition-colors disabled:opacity-40 ${
                                      active
                                        ? 'border-white/20 bg-white/10 text-zinc-100'
                                        : 'border-white/[0.07] bg-white/[0.02] text-zinc-500 hover:text-zinc-300 hover:border-white/15'
                                    }`}
                                    title={control.title}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {body && <pre className={`text-[11px] leading-relaxed font-mono whitespace-pre-wrap ${segment.included === false ? 'text-zinc-500' : 'text-zinc-300'}`}>{body}</pre>}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            )}

            {text && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Final prompt</div>
                <pre className="max-h-72 overflow-auto rounded bg-black/25 border border-white/[0.06] px-2 py-2 text-[11px] leading-relaxed text-zinc-300 font-mono whitespace-pre-wrap">{text}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
};
