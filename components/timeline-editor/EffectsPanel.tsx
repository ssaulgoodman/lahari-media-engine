import React, { useState, useEffect, useCallback } from 'react';
import { dispatch } from '@designcombo/events';
import { EDIT_OBJECT } from '@designcombo/state';
import {
  EFFECT_DEFS,
  FILTER_PRESETS,
  DEFAULT_EFFECTS,
  EffectValues,
  FilterPreset,
} from './effects';
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

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#a1a1aa',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 8,
};

const sliderRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10,
};

const sliderLabel: React.CSSProperties = {
  fontSize: 12,
  color: '#d4d4d8',
  width: 80,
  flexShrink: 0,
};

const sliderInput: React.CSSProperties = {
  flex: 1,
  accentColor: '#fff',
  height: 4,
  cursor: 'pointer',
};

const valueInput: React.CSSProperties = {
  width: 44,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 4,
  color: '#e5e5e5',
  fontSize: 11,
  textAlign: 'center',
  padding: '2px 4px',
  outline: 'none',
};

const presetGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
  gap: 6,
  marginBottom: 16,
};

const presetBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 4px',
  borderRadius: 6,
  border: active ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(255,255,255,0.06)',
  background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
  color: active ? '#fff' : '#a1a1aa',
  fontSize: 10,
  cursor: 'pointer',
  textAlign: 'center',
  transition: 'all 0.15s',
});

const resetBtn: React.CSSProperties = {
  fontSize: 11,
  color: '#71717a',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: '2px 6px',
  marginLeft: 'auto',
};

const EffectsPanel: React.FC = () => {
  const { activeIds, trackItemsMap } = useStore();
  const selectedId = activeIds[0];
  const trackItem = selectedId ? trackItemsMap[selectedId] : null;

  // Local effect state — synced from track item details
  const [effects, setEffects] = useState<EffectValues>({ ...DEFAULT_EFFECTS });
  const [activePreset, setActivePreset] = useState<string>('none');

  // Sync local state when selection changes
  useEffect(() => {
    if (!trackItem) {
      setEffects({ ...DEFAULT_EFFECTS });
      setActivePreset('none');
      return;
    }
    const d = trackItem.details as any;
    setEffects({
      brightness: d.brightness ?? DEFAULT_EFFECTS.brightness,
      blur: d.blur ?? DEFAULT_EFFECTS.blur,
      opacity: d.opacity ?? DEFAULT_EFFECTS.opacity,
      contrast: d.contrast ?? DEFAULT_EFFECTS.contrast,
      saturate: d.saturate ?? DEFAULT_EFFECTS.saturate,
      grayscale: d.grayscale ?? DEFAULT_EFFECTS.grayscale,
      sepia: d.sepia ?? DEFAULT_EFFECTS.sepia,
      hueRotate: d.hueRotate ?? DEFAULT_EFFECTS.hueRotate,
      invert: d.invert ?? DEFAULT_EFFECTS.invert,
    });
    setActivePreset('none');
  }, [selectedId]);

  const applyEffect = useCallback(
    (key: keyof EffectValues, value: number) => {
      if (!selectedId) return;
      setEffects((prev) => ({ ...prev, [key]: value }));
      dispatch(EDIT_OBJECT, {
        payload: {
          [selectedId]: {
            details: { [key]: value },
          },
        },
      });
    },
    [selectedId],
  );

  const applyPreset = useCallback(
    (preset: FilterPreset) => {
      if (!selectedId) return;
      const merged = { ...DEFAULT_EFFECTS, ...preset.values };
      setEffects(merged);
      setActivePreset(preset.id);
      dispatch(EDIT_OBJECT, {
        payload: {
          [selectedId]: {
            details: merged,
          },
        },
      });
    },
    [selectedId],
  );

  const resetAll = useCallback(() => {
    if (!selectedId) return;
    setEffects({ ...DEFAULT_EFFECTS });
    setActivePreset('none');
    dispatch(EDIT_OBJECT, {
      payload: {
        [selectedId]: {
          details: { ...DEFAULT_EFFECTS },
        },
      },
    });
  }, [selectedId]);

  if (!trackItem) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>Effects</div>
        <div style={{ ...scrollStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: '#52525b' }}>Select a clip to apply effects</span>
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ ...headerStyle, display: 'flex', alignItems: 'center' }}>
        <span>Effects</span>
        <button style={resetBtn} onClick={resetAll}>Reset</button>
      </div>
      <div style={scrollStyle}>
        {/* Filter presets */}
        <div style={sectionLabel}>Presets</div>
        <div style={presetGrid}>
          {FILTER_PRESETS.map((p) => (
            <button
              key={p.id}
              style={presetBtn(activePreset === p.id)}
              onClick={() => applyPreset(p)}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Individual effect sliders */}
        <div style={sectionLabel}>Adjustments</div>
        {EFFECT_DEFS.map((def) => (
          <div key={def.key} style={sliderRow}>
            <span style={sliderLabel}>{def.label}</span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={effects[def.key]}
              onChange={(e) => applyEffect(def.key, Number(e.target.value))}
              style={sliderInput}
            />
            <input
              type="number"
              min={def.min}
              max={def.max}
              step={def.step}
              value={effects[def.key]}
              onChange={(e) => {
                const v = Math.min(def.max, Math.max(def.min, Number(e.target.value)));
                applyEffect(def.key, v);
              }}
              style={valueInput}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default EffectsPanel;
