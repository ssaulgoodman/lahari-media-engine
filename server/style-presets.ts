export type StylePreset = {
  key: string;
  title: string;
  description: string;
  /** Storage path for the curated anchor preview image. Served via storageUrl()
   *  by the GET /style-presets endpoint. Image is a static reference of the
   *  preset's look, NOT a per-project render — it's what the artist sees BEFORE
   *  they decide to visualize. Upload manually to `lahari-assets` bucket. */
  previewImagePath: string;
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    key: 'sacred-golden-serenity',
    title: 'Sacred Golden Serenity',
    description: 'A warm devotional daylight style with soft gold highlights, gentle peach skin tones, muted temple stone, brass accents, and calm aqua-blue atmosphere.',
    previewImagePath: 'styles/presets/sacred-golden-serenity.png',
  },
  {
    key: 'pure-temple-morning',
    title: 'Pure Temple Morning',
    description: 'A soft natural devotional style with clean whites, gentle stone neutrals, warm brass details, fresh flower color, and calm morning light.',
    previewImagePath: 'styles/presets/pure-temple-morning.png',
  },
  {
    key: 'warm-incense-devotion',
    title: 'Warm Incense Devotion',
    description: 'A rich temple-interior style with golden lamp light, soft incense haze, deep warm shadows, brass texture, and intimate prayer close-ups.',
    previewImagePath: 'styles/presets/warm-incense-devotion.png',
  },
  {
    key: 'sacred-teal-riverlight',
    title: 'Sacred Teal Riverlight',
    description: 'A cool-warm devotional style with teal shadows, soft golden highlights, aged stone texture, gentle river haze, and earthy human realism.',
    previewImagePath: 'styles/presets/sacred-teal-riverlight.png',
  },
];

export const getStylePreset = (key: string): StylePreset | undefined =>
  STYLE_PRESETS.find((preset) => preset.key === key);
