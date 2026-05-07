export const SEEDANCE_STORYBOARD_DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const;

export type SeedanceStoryboardDuration = typeof SEEDANCE_STORYBOARD_DURATIONS[number];

export type StoryboardRdInput = {
  title: string;
  concept: string;
  mood?: string;
  songType?: string;
  sceneLabel: string;
  sceneStart: string;
  sceneEnd: string;
  sceneNarrative: string;
  sceneLyrics?: string;
  musicalCue?: string;
  clipDirection: string;
  clipDuration: number;
  castNames: string[];
  environmentName?: string;
};

export type ScriptPromptVariant = 'clip_blocks' | 'clip_blocks_combine_short' | 'clip_blocks_freeform';
export type StoryboardPromptVariant = 'adaptive_numbered_storyboard' | 'four_panel_clean' | 'six_panel_music_video' | 'filmstrip_minimal_cuts';
export type SeedancePromptVariant = 'follow_board_only' | 'shot_timing_only' | 'board_plus_timing' | 'board_plus_audio_rhythm' | 'board_plus_audio_lipsync';

const clampDuration = (seconds: number): SeedanceStoryboardDuration => {
  const valid = [...SEEDANCE_STORYBOARD_DURATIONS].sort((a, b) => a - b);
  return valid.find((d) => d >= seconds) ?? 15;
};

export const chooseSeedanceStoryboardDuration = (seconds: number, preferredMax = 15): SeedanceStoryboardDuration => {
  const max = clampDuration(preferredMax);
  const capped = Math.min(Math.max(1, seconds), max);
  return clampDuration(capped);
};

const castLine = (input: StoryboardRdInput) =>
  input.castNames.length ? input.castNames.join(', ') : 'No recurring character in frame';

const commonContext = (input: StoryboardRdInput) => `Song: ${input.title}
Video intent: ${input.concept}
Mood: ${input.mood || 'cinematic'}
Song type: ${input.songType || 'unknown'}
Scene context only: ${input.sceneLabel} (${input.sceneStart}-${input.sceneEnd})
Scene overview for context: ${input.sceneNarrative}
${input.musicalCue ? `Musical structure cue from audio analysis: ${input.musicalCue}\n` : ''}Exact shot to storyboard: ${input.clipDirection}
Clip duration: ${input.clipDuration}s
Lyrics/phrase: ${input.sceneLyrics || 'instrumental or no lyric cue'}
Cast in clip: ${castLine(input)}
Environment: ${input.environmentName || 'unspecified'}`;

export const buildSeedanceScriptWriterPrompt = (
  input: StoryboardRdInput,
  variant: ScriptPromptVariant
): string => {
  const combineGuidance = variant === 'clip_blocks_combine_short'
    ? `If a musical section is shorter than 15 seconds but clearly belongs to the next section, combine them into one storyboard clip. Do not combine sections that have different emotional or musical jobs.`
    : `Do not force artificial 15 second scenes. Short phrases may become 4, 5, 6, 8, 10, or 12 second clips when that better matches the music.`;

  const freedomGuidance = variant === 'clip_blocks_freeform'
    ? `You have freedom to vary clip lengths for taste. Use 15 seconds for cinematic mini-scenes, 10-12 seconds for compact phrases, and 4-8 seconds for transitions, refrains, or quick devotional responses.`
    : `Prefer 15 second storyboard clips when the musical section can support a mini-scene.`;

  return `You are planning a Lahari music video for Seedance 2.0 storyboard mode.

In this mode, a Lahari "shot" is not a single continuous camera take. It is a storyboard clip: one 4-15 second edited mini-sequence that may contain internal cuts, multiple angles, and beat hits.

${freedomGuidance}
${combineGuidance}

Use only Seedance-supported durations: ${SEEDANCE_STORYBOARD_DURATIONS.join(', ')} seconds.

For each scene, output storyboard clips. Each clip needs:
- duration
- clipDirection: what happens across the mini-sequence
- beatCue: what lyric, musical phrase, drum accent, or chant pulse the edit should hit
- internalCuts: 3-6 concise cut beats with timestamps
- castNames
- environmentName
- Do not include art style, color palette, rendering language, or architecture not present in the scene/environment.

${commonContext(input)}

Return a compact JSON object with a "clips" array.`;
};

export const SEEDANCE_SCRIPT_TOOL = {
  name: 'plan_seedance_storyboard_clips',
  description: 'Plan Seedance storyboard clips for Lahari scenes',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      clips: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            duration: { type: 'number', description: 'One of 4, 5, 6, 8, 10, 12, 15 seconds' },
            clipDirection: { type: 'string', description: 'What happens across the storyboard clip' },
            beatCue: { type: 'string', description: 'Lyric, musical phrase, drum accent, or chant pulse this clip should hit' },
            internalCuts: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  time: { type: 'string', description: 'Timestamp range inside the clip, e.g. 00:00-00:04' },
                  beat: { type: 'string', description: 'Visible cut/action/camera beat' }
                },
                required: ['time', 'beat']
              }
            },
            castNames: { type: 'array', items: { type: 'string' } },
            environmentName: { type: 'string' },
            rationale: { type: 'string', description: 'Why this duration and cut shape fits the music' }
          },
          required: ['duration', 'clipDirection', 'beatCue', 'internalCuts', 'castNames', 'environmentName', 'rationale']
        }
      }
    },
    required: ['clips']
  }
};

export const buildStoryboardPrompt = (
  input: StoryboardRdInput,
  variant: StoryboardPromptVariant
): string => {
  const panelSpec = variant === 'adaptive_numbered_storyboard'
    ? `Create an ordered cinematic storyboard for this exact ${input.clipDuration}s Lahari shot/clip, not the whole scene. Use 3-6 panels, choosing the count that best fits the pacing.`
    : variant === 'six_panel_music_video'
    ? `Create a six-panel cinematic production storyboard for this one ${input.clipDuration}s Lahari music-video clip.`
    : variant === 'filmstrip_minimal_cuts'
      ? `Create a clean horizontal filmstrip storyboard for this one ${input.clipDuration}s Lahari music-video clip, using four panels and minimal internal cuts.`
      : `Create a four-panel cinematic production storyboard for this one ${input.clipDuration}s Lahari music-video clip.`;

  const cutGuidance = variant === 'adaptive_numbered_storyboard'
    ? `First decide the cut plan: emotional turn, action/object continuity, blocking, screen direction, and camera progression.`
    : variant === 'filmstrip_minimal_cuts'
    ? `The panels should imply a calm edited sequence with only 2-3 cuts: opening, one meaningful angle change, emotional landing.`
    : `The panels should imply an edited mini-sequence with distinct camera angles: opening, first movement, emotional/action peak, and landing image.`;

  return `${panelSpec}

${commonContext(input)}

Use the provided reference images as ground truth:
- the locked style reference controls visual language
- character references control identity, body, costume, and jewelry
- the environment reference controls geography and physical space

${cutGuidance}

Storyboard contract:
- Treat the board as one edited scene, not separate concept frames.
- Arrange panels in reading order: left-to-right, then top-to-bottom if there are multiple rows.
- Keep a stable spatial map across panels while allowing meaningful angle changes.
- Every cut should reveal new information, deepen emotion, or land a musical beat.
- Use only objects and gestures that belong to the shot, the references, and the devotional context.
- Do NOT print panel numbers, labels, arrows, captions, subtitles, speech bubbles, logos, watermarks, or readable text inside the storyboard image.
- same characters, costumes, environment, and style across all panels
- every panel must be a plausible frame from the same ${input.clipDuration}s clip
- show actual visible action, camera angle, and emotional progression
- make the board useful as a Seedance reference image, not a poster or concept sheet

Also return a concise cut plan outside the image, in plain text, using this exact shape. Use exactly the same number of panels as the image:
Storyboard cut plan:
Panel 1 [00:00-..] - camera: ...; action: ...; Seedance cue: ...
Panel 2 [...] - camera: ...; action: ...; Seedance cue: ...
Panel 3 [...] - camera: ...; action: ...; Seedance cue: ...
Panel N [...] - camera: ...; action: ...; Seedance cue: ...

Then add:
Continuity notes: one short sentence naming the spatial map and screen direction you preserved.`;
};

const seedanceShotList = (input: StoryboardRdInput, minimal = false): string => {
  const duration = Math.max(4, Math.min(15, input.clipDuration || 15));
  if (minimal) {
    const first = Math.max(1, Math.round(duration * 0.45));
    return `Shot 1 [00:00-00:${String(first).padStart(2, '0')}] - Opening beat: establish ${input.environmentName || 'the setting'} and ${castLine(input)} in the clip's starting emotional state.
Shot 2 [00:${String(first).padStart(2, '0')}-00:${String(duration).padStart(2, '0')}] - Landing beat: continue the action into the visible resolution of "${input.clipDirection}".`;
  }

  const a = Math.max(1, Math.round(duration * 0.25));
  const b = Math.max(a + 1, Math.round(duration * 0.55));
  const c = Math.max(b + 1, Math.round(duration * 0.8));
  return `Shot 1 [00:00-00:${String(a).padStart(2, '0')}] - Opening image: establish the setting, characters, and first visible action.
Shot 2 [00:${String(a).padStart(2, '0')}-00:${String(b).padStart(2, '0')}] - First cut: shift to a new angle as the action deepens.
Shot 3 [00:${String(b).padStart(2, '0')}-00:${String(c).padStart(2, '0')}] - Peak beat: the strongest visual change or emotional action in the clip.
Shot 4 [00:${String(c).padStart(2, '0')}-00:${String(duration).padStart(2, '0')}] - Landing image: resolve the phrase with a clean final frame.`;
};

export const buildSeedanceStoryboardVideoPrompt = (
  input: StoryboardRdInput,
  variant: SeedancePromptVariant,
  opts?: {
    cutPlanText?: string | null;
    refs?: { label: string }[];
  }
): string => {
  const hasAudio = variant === 'board_plus_audio_rhythm' || variant === 'board_plus_audio_lipsync';
  const lipsync = variant === 'board_plus_audio_lipsync';
  const minimal = variant === 'follow_board_only';

  if (variant === 'follow_board_only') {
    return `Here is the ordered storyboard for a ${input.clipDuration}s Lahari music-video clip: @image1.
Follow the panels left-to-right, then top-to-bottom. If @image1 contains panel numbers or labels, treat them only as sequencing guides and do not render them into the video. Use all other reference images only to preserve style, character identity, costume, and environment. No generated audio, no subtitles, no readable text.`;
  }

  if (variant === 'shot_timing_only') {
    return `Generate a ${input.clipDuration}s cinematic Lahari music-video clip.

${commonContext(input)}

${seedanceShotList(input)}

No generated audio, no subtitles, no readable text. Preserve all provided reference identities and style.`;
  }

  const refs = opts?.refs || [];
  const refBindings = refs.length
    ? refs.map((ref, idx) => `- @image${idx + 2} = ${ref.label}; use only as a consistency anchor, not as an alternate composition`).join('\n')
    : '- @image2 and later = locked style, character, and environment references; use only as consistency anchors, not alternate compositions';
  const cutPlan = opts?.cutPlanText?.trim() || seedanceShotList(input, minimal);

  return `Here is the ordered storyboard for this ${input.clipDuration}s Lahari music-video clip: @image1.
Follow @image1 panels left-to-right, then top-to-bottom. Treat @image1 as the source of truth for composition, blocking, screen direction, cut order, and camera progression.
If @image1 contains panel numbers, labels, borders, or guide marks, use them only to understand the edit order. Do not reproduce any visible numbers, labels, borders, captions, or guide marks in the final video.

Reference bindings:
- @image1 = locked ordered storyboard and edit plan
${refBindings}
${hasAudio ? `- @audio1 = song excerpt for rhythm, phrase timing, and edit energy` : ''}

${commonContext(input)}

Storyboard description / cut plan:
${cutPlan}

Timing and motion rules:
- clean internal cuts between storyboard panels are allowed and desired
- preserve character faces, costume, jewelry, and environment geometry across cuts
- camera movement should be simple and physically plausible
- do not replace storyboard composition with a composition from the reference images
- do not invent a different devotional object or character blocking than the storyboard
- no panel numbers, subtitles, readable text, logos, watermark, or storyboard borders
- do not generate new music, dialogue, or sound effects; Lahari will render the final song separately
${hasAudio ? `- use @audio1 only as a rhythm and phrase reference for visual timing` : ''}
${lipsync ? `- if a singer, devotee, or deity mouth is clearly visible, add subtle mouth movement matching @audio1; avoid exaggerated dialogue lip-sync if the face is not featured` : ''}

Generate one cohesive ${input.clipDuration}s edited clip.`;
};

export const buildPromptPack = (input: StoryboardRdInput): string => {
  const scriptVariants: ScriptPromptVariant[] = ['clip_blocks', 'clip_blocks_combine_short', 'clip_blocks_freeform'];
  const storyboardVariants: StoryboardPromptVariant[] = ['adaptive_numbered_storyboard', 'four_panel_clean', 'six_panel_music_video', 'filmstrip_minimal_cuts'];
  const seedanceVariants: SeedancePromptVariant[] = ['follow_board_only', 'shot_timing_only', 'board_plus_timing', 'board_plus_audio_rhythm', 'board_plus_audio_lipsync'];

  return `# Seedance Storyboard Prompt Pack

Generated: ${new Date().toISOString()}

## Context

\`\`\`
${commonContext(input)}
\`\`\`

## Script Writer Variants

${scriptVariants.map((variant) => `### ${variant}\n\n\`\`\`\n${buildSeedanceScriptWriterPrompt(input, variant)}\n\`\`\``).join('\n\n')}

## GPT Image Storyboard Variants

${storyboardVariants.map((variant) => `### ${variant}\n\n\`\`\`\n${buildStoryboardPrompt(input, variant)}\n\`\`\``).join('\n\n')}

## Seedance Prompt Variants

${seedanceVariants.map((variant) => `### ${variant}\n\n\`\`\`\n${buildSeedanceStoryboardVideoPrompt(input, variant)}\n\`\`\``).join('\n\n')}
`;
};
