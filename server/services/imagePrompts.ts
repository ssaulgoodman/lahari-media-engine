/**
 * Prompt builders for visual reference generation. These are provider-neutral:
 * active image rendering routes through Segmind Nano Banana 2.
 */

export const buildStylePrompt = (styleDescription: string, subject: string): string => {
  return `Create one reusable visual style reference frame for an Indian devotional music video about ${subject}. ${styleDescription}

The image should demonstrate the style system clearly: lighting behavior, color palette, texture or medium, rendering approach, and atmosphere. Use a devotional visual motif or environment detail, but keep the focus on style rather than story.

It may be photographic, painterly, illustrated, miniature-inspired, or mixed-media if the style direction calls for it. High production value, no text, no watermark.

Do not make a character portrait, storyboard frame, poster, collage, or narrative scene. Keep the composition clean enough that the visual treatment is easy to read and reuse downstream.

Avoid: generic AI fantasy, muddy over-detailing, random divine VFX, incoherent cultural references.`;
};

export const buildCharacterPrompt = (
  character: { name: string; description: string },
  opts?: { styleIdx?: number; userRefIdx?: number }
): string => {
  let prompt = opts?.styleIdx
    ? `Generate ONE character reference portrait. Match the visual style EXACTLY from Image ${opts.styleIdx} — same lighting, color palette, texture, and rendering approach.`
    : `Generate ONE character reference portrait.`;
  prompt += `\n\n${character.name} — ${character.description}`;
  if (opts?.userRefIdx) {
    prompt += `\n\nImage ${opts.userRefIdx} is a reference the director provided for this character — match its identity (face, costume, silhouette, key iconography). The style image (Image ${opts.styleIdx || 1}) is the source of truth for HOW to render them.`;
  }
  prompt += `\n\nThis is a REUSABLE CHARACTER REFERENCE — it will be used across many different shots and scenes.
- Mid-shot portrait: upper body and face clearly visible
- NEUTRAL POSE: hands relaxed at sides or in a natural resting position
- Do NOT show the character holding anything, performing any action, or interacting with objects
- Do NOT include props, weapons, lamps, offerings, or ritual items in hand
- Focus on: face, skin, expression, costume, ornaments, jewelry, crown/headpiece, hair
- Plain or softly blurred background — the character should be isolated for reuse
- Eye-level framing; lighting follows the style image`;
  prompt += `\n\nOne single image. No collage, no grid, no multiple panels. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy.`;
  return prompt;
};

export const buildEnvironmentPrompt = (
  environment: { name: string; description: string },
  opts?: { styleIdx?: number; userRefIdx?: number }
): string => {
  let prompt = opts?.styleIdx
    ? `Generate ONE environment shot. Match the visual style EXACTLY from Image ${opts.styleIdx} — same lighting, color palette, texture, and rendering approach. No characters or figures.`
    : `Generate ONE environment shot. No characters or figures.`;
  prompt += `\n\n${environment.name} — ${environment.description}`;
  if (opts?.userRefIdx) {
    prompt += `\n\nImage ${opts.userRefIdx} is a reference the director provided for this environment — match its geography, architecture, and mood. The style image (Image ${opts.styleIdx || 1}) is the source of truth for HOW it's rendered.`;
  }
  prompt += `\n\nWide establishing shot, full environment visible, empty scene.`;
  prompt += `\n\nOne single image. No collage, no grid, no multiple panels. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy.`;
  return prompt;
};
