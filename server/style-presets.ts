export type StylePreset = {
  key: string;
  title: string;
  description: string;
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    key: 'sacred-golden-serenity',
    title: 'Sacred Golden Serenity',
    description: 'A warm devotional daylight style with soft gold highlights, gentle peach skin tones, muted temple stone, brass accents, and calm aqua-blue atmosphere.',
  },
  {
    key: 'pure-temple-morning',
    title: 'Pure Temple Morning',
    description: 'A soft natural devotional style with clean whites, gentle stone neutrals, warm brass details, fresh flower color, and calm morning light.',
  },
  {
    key: 'warm-incense-devotion',
    title: 'Warm Incense Devotion',
    description: 'A rich temple-interior style with golden lamp light, soft incense haze, deep warm shadows, brass texture, and intimate prayer close-ups.',
  },
  {
    key: 'sacred-teal-riverlight',
    title: 'Sacred Teal Riverlight',
    description: 'A cool-warm devotional style with teal shadows, soft golden highlights, aged stone texture, gentle river haze, and earthy human realism.',
  },
];

export const getStylePreset = (key: string): StylePreset | undefined =>
  STYLE_PRESETS.find((preset) => preset.key === key);
