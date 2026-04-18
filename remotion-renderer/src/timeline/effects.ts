// Effects/filters system — mirrors reference repo's approach where effects are
// CSS filter properties stored on track item details and applied during render.

export interface EffectValues {
  brightness: number; // 0–200, default 100 (%)
  blur: number;       // 0–100, default 0 (px)
  opacity: number;    // 0–100, default 100 (%)
  contrast: number;   // 0–200, default 100 (%)
  saturate: number;   // 0–200, default 100 (%)
  grayscale: number;  // 0–100, default 0 (%)
  sepia: number;      // 0–100, default 0 (%)
  hueRotate: number;  // 0–360, default 0 (deg)
  invert: number;     // 0–100, default 0 (%)
}

export const DEFAULT_EFFECTS: EffectValues = {
  brightness: 100,
  blur: 0,
  opacity: 100,
  contrast: 100,
  saturate: 100,
  grayscale: 0,
  sepia: 0,
  hueRotate: 0,
  invert: 0,
};

export interface EffectDef {
  key: keyof EffectValues;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  defaultValue: number;
}

export const EFFECT_DEFS: EffectDef[] = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 200, step: 1, unit: '%', defaultValue: 100 },
  { key: 'contrast',   label: 'Contrast',   min: 0, max: 200, step: 1, unit: '%', defaultValue: 100 },
  { key: 'saturate',   label: 'Saturate',   min: 0, max: 200, step: 1, unit: '%', defaultValue: 100 },
  { key: 'blur',       label: 'Blur',       min: 0, max: 100, step: 1, unit: 'px', defaultValue: 0 },
  { key: 'opacity',    label: 'Opacity',    min: 0, max: 100, step: 1, unit: '%', defaultValue: 100 },
  { key: 'grayscale',  label: 'Grayscale',  min: 0, max: 100, step: 1, unit: '%', defaultValue: 100 },
  { key: 'sepia',      label: 'Sepia',      min: 0, max: 100, step: 1, unit: '%', defaultValue: 0 },
  { key: 'hueRotate',  label: 'Hue Rotate', min: 0, max: 360, step: 1, unit: 'deg', defaultValue: 0 },
  { key: 'invert',     label: 'Invert',     min: 0, max: 100, step: 1, unit: '%', defaultValue: 0 },
];

// Preset filters — one-click presets that set multiple effects at once.
export interface FilterPreset {
  id: string;
  name: string;
  values: Partial<EffectValues>;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none',      name: 'None',       values: {} },
  { id: 'vivid',     name: 'Vivid',      values: { brightness: 110, contrast: 120, saturate: 140 } },
  { id: 'warm',      name: 'Warm',       values: { sepia: 30, brightness: 105, saturate: 120 } },
  { id: 'cool',      name: 'Cool',       values: { hueRotate: 180, saturate: 80, brightness: 105 } },
  { id: 'vintage',   name: 'Vintage',    values: { sepia: 50, contrast: 110, brightness: 90, saturate: 80 } },
  { id: 'bw',        name: 'B&W',        values: { grayscale: 100, contrast: 120 } },
  { id: 'dramatic',  name: 'Dramatic',   values: { contrast: 150, brightness: 90, saturate: 130 } },
  { id: 'faded',     name: 'Faded',      values: { brightness: 120, contrast: 80, saturate: 60 } },
  { id: 'noir',      name: 'Noir',       values: { grayscale: 100, contrast: 150, brightness: 80 } },
  { id: 'dreamy',    name: 'Dreamy',     values: { blur: 1, brightness: 115, saturate: 120, contrast: 90 } },
];

// Build a CSS filter string from effect values.
export const buildFilterCSS = (effects: Partial<EffectValues>): string => {
  const parts: string[] = [];
  const e = { ...DEFAULT_EFFECTS, ...effects };
  if (e.brightness !== 100) parts.push(`brightness(${e.brightness}%)`);
  if (e.contrast !== 100) parts.push(`contrast(${e.contrast}%)`);
  if (e.saturate !== 100) parts.push(`saturate(${e.saturate}%)`);
  if (e.blur !== 0) parts.push(`blur(${e.blur}px)`);
  if (e.grayscale !== 0) parts.push(`grayscale(${e.grayscale}%)`);
  if (e.sepia !== 0) parts.push(`sepia(${e.sepia}%)`);
  if (e.hueRotate !== 0) parts.push(`hue-rotate(${e.hueRotate}deg)`);
  if (e.invert !== 0) parts.push(`invert(${e.invert}%)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
};

// Build opacity CSS from effect values.
export const buildOpacityCSS = (effects: Partial<EffectValues>): number => {
  const opacity = effects.opacity ?? DEFAULT_EFFECTS.opacity;
  return opacity / 100;
};
