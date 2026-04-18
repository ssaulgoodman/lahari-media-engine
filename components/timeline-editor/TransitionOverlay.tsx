import React, { useState, useRef, useEffect, useCallback } from 'react';
import { timeMsToUnits } from '@designcombo/timeline';
import { generateId } from '@designcombo/timeline';
import { ITransition } from '@designcombo/types';
import { TRANSITIONS } from './transitions-data';
import useStore from './store';

type CutPoint = {
  fromId: string;
  toId: string;
  trackId: string;
  centerMs: number;
  trackIndex: number;
  existingTransition: ITransition | null;
};

const TRACK_HEIGHT = 42;
const POPOVER_WIDTH = 296;

const TransitionOverlay: React.FC<{ scrollLeft: number }> = ({ scrollLeft }) => {
  const { trackItemsMap, trackItemIds, transitionsMap, tracks, scale, addTransition } = useStore();
  const [openCutId, setOpenCutId] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const zoom = scale.zoom;

  // Position the popover above the button after it opens
  useEffect(() => {
    if (!openCutId) { setPopoverPos(null); return; }
    const btn = buttonRefs.current[openCutId];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const popoverHeight = popoverRef.current?.offsetHeight || 280;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - POPOVER_WIDTH / 2, window.innerWidth - POPOVER_WIDTH - 8));
    const top = rect.top - popoverHeight - 6;
    setPopoverPos({ top, left });
  }, [openCutId]);

  // Re-measure if popover renders and we didn't have its height yet.
  // No deps = runs every render; we bail out via functional setState when
  // the position hasn't changed so React doesn't schedule another render.
  useEffect(() => {
    if (!openCutId || !popoverRef.current) return;
    const btn = buttonRefs.current[openCutId];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const popoverHeight = popoverRef.current.offsetHeight;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - POPOVER_WIDTH / 2, window.innerWidth - POPOVER_WIDTH - 8));
    const top = rect.top - popoverHeight - 6;
    setPopoverPos((cur) => (cur && cur.top === top && cur.left === left ? cur : { top, left }));
  });

  // Close popover on click outside
  useEffect(() => {
    if (!openCutId) return;
    const handler = (e: MouseEvent) => {
      const btn = buttonRefs.current[openCutId];
      if (btn && btn.contains(e.target as Node)) return;
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) return;
      setOpenCutId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openCutId]);

  // Build cut points
  const cutPoints: CutPoint[] = [];
  const tracksHaveItems = tracks.some((t) => t.items && t.items.length > 0);

  if (tracksHaveItems) {
    tracks.forEach((track, trackIndex) => {
      if (!track.items || track.items.length < 2) return;
      const items = track.items
        .map((id: string) => trackItemsMap[id])
        .filter(Boolean)
        .sort((a, b) => a.display.from - b.display.from);
      for (let i = 0; i < items.length - 1; i++) {
        const from = items[i];
        const to = items[i + 1];
        const existing = Object.values(transitionsMap).find(
          (t) => t.fromId === from.id && t.toId === to.id && t.kind !== 'none',
        ) || null;
        cutPoints.push({
          fromId: from.id, toId: to.id, trackId: track.id,
          centerMs: (from.display.to + to.display.from) / 2,
          trackIndex, existingTransition: existing,
        });
      }
    });
  } else {
    const visualItems = trackItemIds
      .map((id) => trackItemsMap[id]).filter(Boolean)
      .filter((it) => it.type === 'video' || it.type === 'image')
      .sort((a, b) => a.display.from - b.display.from);
    for (let i = 0; i < visualItems.length - 1; i++) {
      const from = visualItems[i];
      const to = visualItems[i + 1];
      const existing = Object.values(transitionsMap).find(
        (t) => t.fromId === from.id && t.toId === to.id && t.kind !== 'none',
      ) || null;
      cutPoints.push({
        fromId: from.id, toId: to.id, trackId: tracks[0]?.id || '',
        centerMs: (from.display.to + to.display.from) / 2,
        trackIndex: 0, existingTransition: existing,
      });
    }
  }

  if (cutPoints.length === 0) return null;

  const handleApply = (cut: CutPoint, transition: (typeof TRANSITIONS)[number]) => {
    // Preserve the existing duration when swapping kinds so the user's
    // tuning survives a palette click. Falls back to the preset default.
    const existingMs = cut.existingTransition?.duration;
    const durationMs = existingMs && existingMs > 0 ? existingMs : transition.duration * 1000;
    addTransition({
      id: generateId(), kind: transition.kind,
      fromId: cut.fromId, toId: cut.toId, trackId: cut.trackId,
      type: 'transition', duration: durationMs,
      ...(transition.direction ? { direction: transition.direction } : {}),
    } as ITransition);
  };

  const handleDurationChange = (cut: CutPoint, durationMs: number) => {
    if (!cut.existingTransition) return;
    const prev = cut.existingTransition;
    addTransition({
      id: generateId(),
      kind: prev.kind,
      fromId: cut.fromId,
      toId: cut.toId,
      trackId: cut.trackId,
      type: 'transition',
      duration: Math.max(50, Math.round(durationMs)),
      ...((prev as any).direction ? { direction: (prev as any).direction } : {}),
    } as ITransition);
  };

  const handleRemove = (cut: CutPoint) => {
    if (!cut.existingTransition) return;
    addTransition({
      id: generateId(), kind: 'none',
      fromId: cut.fromId, toId: cut.toId, trackId: cut.trackId,
      type: 'transition', duration: 0,
    } as ITransition);
    setOpenCutId(null);
  };

  // Find the open cut for popover content
  const openCut = openCutId ? cutPoints.find((c) => `${c.fromId}-${c.toId}` === openCutId) : null;

  return (
    <>
      {/* Buttons layer — inside the timeline track area */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          overflow: 'visible', zIndex: 5, pointerEvents: 'none',
        }}
      >
        {cutPoints.map((cut) => {
          const cutId = `${cut.fromId}-${cut.toId}`;
          const centerPx = timeMsToUnits(cut.centerMs, zoom) - scrollLeft;
          const trackY = cut.trackIndex * TRACK_HEIGHT;
          const isOpen = openCutId === cutId;
          const has = cut.existingTransition != null;

          if (centerPx < -40 || centerPx > 4000) return null;

          const existingDef = has
            ? TRANSITIONS.find((t) =>
                t.kind === cut.existingTransition!.kind &&
                (t.direction || undefined) === ((cut.existingTransition as any).direction || undefined))
            : null;
          const existingLabel = existingDef?.name || existingDef?.kind || cut.existingTransition?.kind;

          return (
            <button
              key={cutId}
              ref={(el) => { buttonRefs.current[cutId] = el; }}
              onClick={() => setOpenCutId(isOpen ? null : cutId)}
              style={{
                position: 'absolute',
                left: centerPx - 12,
                top: trackY + 5,
                width: 24,
                height: TRACK_HEIGHT - 10,
                background: has ? 'rgba(129,140,248,0.2)' : 'rgba(255,255,255,0.06)',
                border: isOpen
                  ? '1px solid rgba(129,140,248,0.7)'
                  : has ? '1px solid rgba(129,140,248,0.35)' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: 5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                zIndex: isOpen ? 12 : 6,
                pointerEvents: 'auto',
                transition: 'background 0.15s, border-color 0.15s',
              }}
              title={has ? `${existingLabel} — click to change` : 'Add transition'}
            >
              {has ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect x="1" y="4" width="7" height="8" rx="1.5" stroke="rgba(129,140,248,0.9)" strokeWidth="1.2" />
                  <rect x="8" y="4" width="7" height="8" rx="1.5" stroke="rgba(129,140,248,0.9)" strokeWidth="1.2" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2.5v7M2.5 6h7" stroke="#71717a" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Popover — rendered as fixed, positioned above the button */}
      {openCut && popoverPos && (
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top: popoverPos.top,
            left: popoverPos.left,
            width: POPOVER_WIDTH,
            background: '#1c1c20',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 200,
            overflow: 'hidden',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e5e5e5' }}>Transition</span>
            {openCut.existingTransition && (
              <button
                onClick={() => handleRemove(openCut)}
                style={{
                  fontSize: 11, color: '#ef4444', background: 'none',
                  border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
                }}
              >
                Remove
              </button>
            )}
          </div>

          {/* Per-transition duration slider. Only shown once a kind is chosen
              — duration has no meaning for a cut. Writes back via addTransition
              which upserts the existing record in the store. */}
          {openCut.existingTransition && (
            <div
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 11, color: '#a1a1aa', flexShrink: 0 }}>Duration</span>
              <input
                type="range"
                min={100}
                max={3000}
                step={50}
                value={openCut.existingTransition.duration || 500}
                onChange={(e) => handleDurationChange(openCut, parseInt(e.target.value, 10))}
                style={{ flex: 1, accentColor: '#a1a1aa', cursor: 'pointer' }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: '#e5e5e5',
                  fontFamily: 'monospace',
                  minWidth: 38,
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {((openCut.existingTransition.duration || 500) / 1000).toFixed(2)}s
              </span>
            </div>
          )}
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 4, padding: 8, maxHeight: 220, overflowY: 'auto',
            }}
          >
            {TRANSITIONS.filter((t) => t.kind !== 'none').map((t) => {
              const has = openCut.existingTransition != null;
              const isActive = has
                && openCut.existingTransition!.kind === t.kind
                && ((openCut.existingTransition as any).direction || undefined) === (t.direction || undefined);
              return (
                <button
                  key={t.id}
                  onClick={() => handleApply(openCut, t)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 3, padding: 4, borderRadius: 6,
                    border: isActive ? '1.5px solid rgba(129,140,248,0.7)' : '1.5px solid transparent',
                    background: isActive ? 'rgba(129,140,248,0.1)' : 'transparent',
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}
                  title={t.name || t.kind}
                >
                  <img
                    src={t.preview} alt={t.name || t.kind}
                    style={{ width: 42, height: 42, borderRadius: 4, objectFit: 'cover', background: 'rgba(255,255,255,0.02)' }}
                    draggable={false} loading="lazy"
                  />
                  <span style={{
                    fontSize: 9, color: isActive ? '#c7d2fe' : '#71717a',
                    textTransform: 'capitalize', lineHeight: '12px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
                  }}>
                    {t.name || t.kind}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};

export default TransitionOverlay;
