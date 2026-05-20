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

export const STYLE_PRESETS: StylePreset[] = [];

export const getStylePreset = (key: string): StylePreset | undefined =>
  STYLE_PRESETS.find((preset) => preset.key === key);
