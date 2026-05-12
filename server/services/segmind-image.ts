import { saveBase64, saveBuffer, storageUrl } from '../storage.js';
import { buildCharacterPrompt, buildEnvironmentPrompt, buildStylePrompt } from './imagen.js';

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };

type RefImage = {
  label: string;
  imagePath?: string;
  inlineData?: { mimeType: string; data: string };
};

const SEGMIND_BASE = 'https://api.segmind.com/v1';
const NANO_BANANA_2_ENDPOINT = `${SEGMIND_BASE}/nano-banana-2`;
const MAX_REFS = 14;

const getApiKey = () => {
  const key = process.env.SEGMIND_API_KEY;
  if (!key) throw new Error('SEGMIND_API_KEY not set in .env');
  return key;
};

const normalizeAspectRatio = (aspectRatio = '16:9'): string => {
  const supported = new Set(['auto', '1:1', '2:3', '3:2', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9']);
  return supported.has(aspectRatio) ? aspectRatio : '16:9';
};

const outputResolution = (): '1K' | '2K' | '4K' => {
  const value = process.env.SEGMIND_IMAGE_RESOLUTION || '1K';
  // Nano Banana 2 advertises 512px, but 16:9/1:1 512px requests fall below
  // the current pixel minimum and are rejected by the upstream model.
  return ['1K', '2K', '4K'].includes(value) ? value as any : '1K';
};

const styleReferenceGuard = (refs: RefImage[]): string => {
  if (!refs.length) return '';
  return `Reference usage rules:
- Use reference images only for the specific role named in the reference list.
- If a reference is labeled "Style reference", extract only lighting, palette, material texture, craft language, rendering medium, and atmosphere.
- Do not copy the style reference's composition, border, arch, pillars, background layout, central motif, or scene geometry unless the prompt explicitly asks for them.
- If a reference is labeled as a character or environment reference, preserve that subject/environment identity more strongly than decorative style details.

Reference images:
${refs.map((ref, idx) => `${idx + 1}. ${ref.label}`).join('\n')}

`;
};

const refToUrl = async (ref: RefImage): Promise<string> => {
  if (ref.imagePath) return storageUrl(ref.imagePath);
  if (!ref.inlineData) throw new Error('Reference image missing image data');

  const ext = ref.inlineData.mimeType.includes('jpeg')
    ? 'jpg'
    : ref.inlineData.mimeType.includes('webp')
      ? 'webp'
      : 'png';
  const key = await saveBase64(ref.inlineData.data, 'images', ext);
  return storageUrl(key);
};

const detectExtFromContentType = (contentType: string): 'png' | 'jpg' => (
  contentType.toLowerCase().includes('png') ? 'png' : 'jpg'
);

const findImageString = (value: any): string | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return value;
    if (/^https?:\/\/.+\.(png|jpe?g|webp)(\?|$)/i.test(value)) return value;
    if (/^[A-Za-z0-9+/=]{1000,}$/.test(value)) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageString(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const priorityKeys = ['image', 'image_url', 'imageUrl', 'url', 'output', 'result', 'data', 'images'];
    for (const key of priorityKeys) {
      const found = findImageString(value[key]);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = findImageString(item);
      if (found) return found;
    }
  }
  return null;
};

const saveImageString = async (image: string): Promise<string> => {
  if (image.startsWith('data:image/')) {
    const match = image.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
    if (!match) throw new Error('Segmind returned an unsupported data URL');
    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    return saveBase64(match[2], 'images', ext);
  }

  if (image.startsWith('http')) {
    const res = await fetch(image);
    if (!res.ok) throw new Error(`Failed to download Segmind image result (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || '';
    return saveBuffer(buffer, 'images', detectExtFromContentType(contentType));
  }

  return saveBase64(image, 'images', 'png');
};

export const generateNanoBanana2 = async (
  prompt: string,
  aspectRatio = '16:9',
  refs: RefImage[] = [],
): Promise<string> => {
  const cappedRefs = refs.slice(0, MAX_REFS);
  const imageUrls = await Promise.all(cappedRefs.map(refToUrl));
  const guardedPrompt = `${styleReferenceGuard(cappedRefs)}${prompt}`;

  console.log(`[segmind-image] nano-banana-2 refs=${imageUrls.length}, aspect=${aspectRatio}, resolution=${outputResolution()}, prompt=${guardedPrompt.slice(0, 90)}...`);

  const res = await fetch(NANO_BANANA_2_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: guardedPrompt,
      image_urls: imageUrls,
      web_search: false,
      aspect_ratio: normalizeAspectRatio(aspectRatio),
      output_format: 'png',
      thinking_level: 'minimal',
      safety_tolerance: 4,
      output_resolution: outputResolution(),
      response_modalities: 'TEXT_AND_IMAGE',
      seed: Math.floor(Math.random() * 1000000),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[segmind-image] ${res.status} ${res.statusText}: ${errText.slice(0, 500)}`);
    throw new Error(`Nano Banana 2 failed (${res.status}). ${errText.slice(0, 180)}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.startsWith('image/')) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return saveBuffer(buffer, 'images', detectExtFromContentType(contentType));
  }

  const json = await res.json().catch(async () => {
    const text = await res.text().catch(() => '');
    throw new Error(`Nano Banana 2 returned an unreadable response: ${text.slice(0, 180)}`);
  });
  const image = findImageString(json);
  if (!image) throw new Error(`Nano Banana 2 returned no image result: ${JSON.stringify(json).slice(0, 300)}`);
  return saveImageString(image);
};

const generateMany = async (
  prompt: string,
  aspectRatio: string,
  refs: RefImage[],
  count: number,
): Promise<string[]> => {
  const settled = await Promise.allSettled(
    Array.from({ length: count }, () => generateNanoBanana2(prompt, aspectRatio, refs))
  );
  const paths = settled
    .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
    .map(result => result.value);

  for (const result of settled) {
    if (result.status === 'rejected') console.error('[segmind-image] Variant failed:', result.reason);
  }
  if (!paths.length) throw new Error('Nano Banana 2 failed to generate any images');
  return paths;
};

export const generateImageWithRefs = async (
  parts: ContentPart[],
  aspectRatio = '16:9'
): Promise<string> => {
  const texts: string[] = [];
  const refs: RefImage[] = [];

  let pendingLabel: string | null = null;
  for (const part of parts) {
    if ('text' in part) {
      texts.push(part.text);
      pendingLabel = part.text.startsWith('Image ') ? part.text.replace(/^Image \d+ = /, '') : null;
    } else {
      refs.push({
        label: pendingLabel || `Reference ${refs.length + 1}`,
        inlineData: part.inlineData,
      });
      pendingLabel = null;
    }
  }

  return generateNanoBanana2(texts.join('\n\n'), aspectRatio, refs);
};

export const generateStyleOptions = async (
  deity: string,
  styleNotes?: string,
): Promise<{ style: string; assetPath: string }[]> => {
  const directions = styleNotes
    ? [
        `${styleNotes}`,
        `${styleNotes}, with dramatic chiaroscuro shadows and sculptural depth`,
        `${styleNotes}, with high-key devotional glow and warm ceremonial atmosphere`,
        `${styleNotes}, as tactile handmade folk-art cinema with natural material texture`,
      ]
    : [
        // Medium-neutral defaults — see docs/cinematic-leak-audit-2026-05-12.md.
        `Devotional reference frame of ${deity}, natural temple light, balanced composition`,
        `${deity} in dramatic chiaroscuro with deep shadows, single warm lamp source`,
        `${deity} in ethereal golden devotional light, soft bloom, ceremonial atmosphere`,
        `${deity} as tactile handmade folk-art, natural pigments, material texture`,
      ];

  const settled = await Promise.allSettled(
    directions.map(async (direction) => {
      const prompt = `Create one reusable visual style reference frame for an Indian devotional music video. ${direction}. Focus on lighting, palette, material texture, rendering approach, and atmosphere. Do not make a character reference portrait, collage, poster, or text image.`;
      const assetPath = await generateNanoBanana2(prompt, '16:9', []);
      return { style: direction, assetPath };
    })
  );

  return settled
    .filter((result): result is PromiseFulfilledResult<{ style: string; assetPath: string }> => result.status === 'fulfilled')
    .map(result => result.value);
};

export const generateSingleStyleImage = async (
  styleDescription: string,
  subject: string,
  generationPrompt?: string,
): Promise<string> => {
  const prompt = generationPrompt || buildStylePrompt(styleDescription, subject);
  return generateNanoBanana2(prompt, '16:9', []);
};

export const generateCharacterLooks = async (
  character: { name: string; description: string },
  styleImagePath?: string,
  userFeedback?: string,
  aspectRatio: string = '16:9',
  userRefImagePath?: string,
  generationPrompt?: string,
): Promise<string[]> => {
  const refs: RefImage[] = [];
  if (styleImagePath) refs.push({ label: 'Style reference only', imagePath: styleImagePath });
  if (userRefImagePath) refs.push({ label: 'User-supplied character identity reference', imagePath: userRefImagePath });

  const styleIdx = styleImagePath ? 1 : undefined;
  const userRefIdx = userRefImagePath ? (styleImagePath ? 2 : 1) : undefined;
  let prompt = generationPrompt || buildCharacterPrompt(character, { styleIdx, userRefIdx });
  if (userFeedback) prompt += `\n\nDirector note: ${userFeedback}`;
  prompt += `\n\nImportant: create a NEW isolated character portrait. Do not use the style reference as a background or layout.`;

  return generateMany(prompt, aspectRatio, refs, 3);
};

export const generateEnvironmentLooks = async (
  environment: { name: string; description: string },
  styleImagePath?: string,
  aspectRatio: string = '16:9',
  userRefImagePath?: string,
  userNote?: string,
  generationPrompt?: string,
): Promise<string[]> => {
  const refs: RefImage[] = [];
  if (styleImagePath) refs.push({ label: 'Style reference only', imagePath: styleImagePath });
  if (userRefImagePath) refs.push({ label: 'User-supplied environment geography reference', imagePath: userRefImagePath });

  const styleIdx = styleImagePath ? 1 : undefined;
  const userRefIdx = userRefImagePath ? (styleImagePath ? 2 : 1) : undefined;
  let prompt = generationPrompt || buildEnvironmentPrompt(environment, { styleIdx, userRefIdx });
  if (userNote) prompt += `\n\nDirector note: ${userNote}`;

  return generateMany(prompt, aspectRatio, refs, 3);
};

export const generateShotStartFrame = async (opts: {
  visualPrompt: string;
  styleImagePath?: string;
  characterRefs: { name: string; imagePath: string }[];
  environmentRef?: { name: string; imagePath: string };
  prevShotEndFramePath?: string;
  continuityDescription?: string;
  userFeedback?: string;
  failedImagePath?: string;
  aspectRatio?: string;
  additionalRefs?: { imagePath: string }[];
}): Promise<string> => {
  const refs: RefImage[] = [];
  for (const ref of opts.characterRefs) refs.push({ label: `Character identity reference: ${ref.name}`, imagePath: ref.imagePath });
  if (opts.styleImagePath) refs.push({ label: 'Style reference only', imagePath: opts.styleImagePath });
  if (opts.environmentRef) refs.push({ label: `Environment reference: ${opts.environmentRef.name}`, imagePath: opts.environmentRef.imagePath });
  for (const ref of opts.additionalRefs || []) refs.push({ label: 'Director reference', imagePath: ref.imagePath });
  if (opts.prevShotEndFramePath) refs.push({ label: 'Continuity reference from previous shot', imagePath: opts.prevShotEndFramePath });
  if (opts.failedImagePath && opts.userFeedback) refs.push({ label: `Rejected previous attempt: ${opts.userFeedback}`, imagePath: opts.failedImagePath });

  // Medium-neutral — the style reference is the visual ground truth. See
  // docs/cinematic-leak-audit-2026-05-12.md.
  let prompt = `Generate one start frame for this Lahari shot.

Scene: ${opts.visualPrompt}

Preserve character identities from character references. Match the environment reference when present. Use the style reference only for palette, lighting, texture, material language, and rendering approach.`;

  if (opts.continuityDescription) {
    prompt += `\n\nPrevious shot ended with: ${opts.continuityDescription}. Begin from that continuity state where possible.`;
  }
  if (opts.userFeedback) prompt += `\n\nDirector note: ${opts.userFeedback}`;
  prompt += `\n\nSingle frame. No text, no watermark. Avoid generic fantasy, excessive AI gloss, and copying reference-image layouts.`;

  return generateNanoBanana2(prompt, opts.aspectRatio || '16:9', refs);
};

export const generateShotEndFrame = async (opts: {
  startFramePath?: string;
  visualPrompt: string;
  motionPrompt: string;
  styleImagePath?: string;
  characterRefs?: { name: string; imagePath: string }[];
  environmentRef?: { name: string; imagePath: string };
  additionalRefs?: { imagePath: string }[];
  userFeedback?: string;
  failedImagePath?: string;
}): Promise<string> => {
  const refs: RefImage[] = [];
  if (opts.startFramePath) refs.push({ label: 'Start frame of this shot', imagePath: opts.startFramePath });
  for (const ref of opts.characterRefs || []) refs.push({ label: `Character identity reference: ${ref.name}`, imagePath: ref.imagePath });
  if (opts.styleImagePath) refs.push({ label: 'Style reference only', imagePath: opts.styleImagePath });
  if (opts.environmentRef) refs.push({ label: `Environment reference: ${opts.environmentRef.name}`, imagePath: opts.environmentRef.imagePath });
  for (const ref of opts.additionalRefs || []) refs.push({ label: 'Director reference', imagePath: ref.imagePath });
  if (opts.failedImagePath && opts.userFeedback) refs.push({ label: `Rejected previous end-frame attempt: ${opts.userFeedback}`, imagePath: opts.failedImagePath });

  let prompt = `Generate the ending frame for this shot.

Scene: ${opts.visualPrompt}
Motion: ${opts.motionPrompt}

The start-frame reference shows the beginning. Generate what the camera sees moments later after the motion. Keep the same characters, costumes, environment, and style.`;
  if (opts.userFeedback) prompt += `\n\nDirector note: ${opts.userFeedback}`;
  prompt += `\n\nSingle frame. No text, no watermark.`;

  return generateNanoBanana2(prompt, '16:9', refs);
};
