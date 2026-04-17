import React, { useCallback } from 'react';
import { ITransition } from '@designcombo/types';
import { generateId } from '@designcombo/timeline';
import { TRANSITIONS } from './transitions-data';
import useStore from './store';

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  background: '#1a1a1e',
  borderLeft: '1px solid rgba(255,255,255,0.06)',
  width: 280,
  flexShrink: 0,
};

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  fontSize: 13,
  fontWeight: 600,
  color: '#e5e5e5',
};

const scrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '12px 16px',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
  gap: 8,
};

const itemStyle = (isActive: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: 6,
  borderRadius: 8,
  border: isActive ? '1px solid rgba(255,255,255,0.25)' : '1px solid rgba(255,255,255,0.04)',
  background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
  cursor: 'pointer',
  transition: 'all 0.15s',
});

const previewStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 6,
  objectFit: 'cover',
  background: 'rgba(255,255,255,0.02)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#a1a1aa',
  textTransform: 'capitalize',
  textAlign: 'center',
  lineHeight: '14px',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const helpText: React.CSSProperties = {
  fontSize: 11,
  color: '#52525b',
  lineHeight: '16px',
  marginBottom: 12,
};

const TransitionsPanel: React.FC = () => {
  const { activeIds, trackItemIds, trackItemsMap, transitionsMap, tracks, addTransition } = useStore();

  // Find which pair of adjacent items the selected clip connects to.
  const getAdjacentPair = useCallback((): { fromId: string; toId: string; trackId: string } | null => {
    const selectedId = activeIds[0];
    if (!selectedId) return null;

    const selectedItem = trackItemsMap[selectedId];
    if (!selectedItem) return null;

    // Resolve the track that owns this item
    const owningTrack = tracks.find((t) => t.items?.includes(selectedId));
    const trackId = owningTrack?.id || '';

    // Find items on the same track (or all visual items if no track found),
    // sorted by display.from
    const trackItems = owningTrack
      ? owningTrack.items
          .map((id: string) => trackItemsMap[id])
          .filter(Boolean)
          .sort((a, b) => a.display.from - b.display.from)
      : trackItemIds
          .map((id) => trackItemsMap[id])
          .filter(Boolean)
          .filter((it) => it.type === 'video' || it.type === 'image')
          .sort((a, b) => a.display.from - b.display.from);

    const idx = trackItems.findIndex((it) => it.id === selectedId);
    if (idx < 0 || idx >= trackItems.length - 1) return null;

    return {
      fromId: trackItems[idx].id,
      toId: trackItems[idx + 1].id,
      trackId,
    };
  }, [activeIds, trackItemIds, trackItemsMap, tracks]);

  // Check which transition is currently active between the selected pair
  const getActiveTransition = useCallback((): { kind: string; direction?: string } | null => {
    const pair = getAdjacentPair();
    if (!pair) return null;
    const existing = Object.values(transitionsMap).find(
      (t) => t.fromId === pair.fromId && t.toId === pair.toId,
    );
    if (!existing) return null;
    return { kind: existing.kind, direction: (existing as any).direction };
  }, [getAdjacentPair, transitionsMap]);

  const activeTransition = getActiveTransition();
  const pair = getAdjacentPair();

  const handleApplyTransition = useCallback(
    (transition: (typeof TRANSITIONS)[number]) => {
      if (!pair) return;
      const id = generateId();
      const durationMs = transition.duration * 1000;

      const t: ITransition = {
        id,
        kind: transition.kind,
        fromId: pair.fromId,
        toId: pair.toId,
        trackId: pair.trackId,
        type: 'transition',
        duration: durationMs,
        ...(transition.direction ? { direction: transition.direction } : {}),
      } as ITransition;

      addTransition(t);
    },
    [pair, addTransition],
  );

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Transitions</div>
      <div style={scrollStyle}>
        <p style={helpText}>
          {pair
            ? 'Click a transition to apply it between the selected clip and the next one.'
            : 'Select a clip that has a following clip to apply transitions between them.'}
        </p>
        <div style={gridStyle}>
          {TRANSITIONS.map((t) => {
            const isActive = activeTransition != null
              && activeTransition.kind === t.kind
              && (activeTransition.direction || undefined) === (t.direction || undefined)
              && t.kind !== 'none';
            return (
              <div
                key={t.id}
                style={itemStyle(isActive)}
                onClick={() => pair && handleApplyTransition(t)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pair && handleApplyTransition(t);
                  }
                }}
              >
                <img
                  src={t.preview}
                  alt={t.name || t.kind}
                  style={previewStyle}
                  draggable={false}
                  loading="lazy"
                />
                <span style={labelStyle}>{t.name || t.kind}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TransitionsPanel;
