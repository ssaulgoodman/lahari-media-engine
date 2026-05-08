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

const panelLayout = (seconds: number) => {
  const duration = Number.isFinite(seconds) ? seconds : 15;
  return duration < 10
    ? { count: 4, rows: 2, cols: 2 }
    : { count: 6, rows: 2, cols: 3 };
};

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

// Scene-scoped context — for the script writer that plans clips across a
// whole scene. Includes scene narrative, scene timestamps, and lyrics
// because the planner needs them to decide clip boundaries and beats.
const sceneContext = (input: StoryboardRdInput) => `Song: ${input.title}
Video intent: ${input.concept}
Mood: ${input.mood || 'cinematic'}
${input.songType && input.songType !== 'song' ? `Song type: ${input.songType}\n` : ''}Scene: ${input.sceneLabel} (${input.sceneStart}-${input.sceneEnd})
Scene overview: ${input.sceneNarrative}
${input.musicalCue ? `Musical structure cue: ${input.musicalCue}\n` : ''}${input.sceneLyrics ? `Lyrics/phrase: ${input.sceneLyrics}\n` : ''}Cast available in scene: ${castLine(input)}
Environment: ${input.environmentName || 'unspecified'}`;

// Clip-scoped context — for the storyboard generator and the video model,
// both of which produce a single 4-15s clip. Deliberately drops scene
// narrative, scene timestamps, lyrics, and song type: those describe a
// broader window than this clip and risk leaking events (e.g. another
// character mentioned in the scene narrative) into the storyboard. The
// shot direction alone defines what gets drawn.
const clipContext = (input: StoryboardRdInput) => {
  const lines: string[] = [
    `Song: ${input.title}`,
    `Video intent: ${input.concept}`,
    `Mood: ${input.mood || 'cinematic'}`,
  ];
  if (input.musicalCue) lines.push(`Musical pacing cue: ${input.musicalCue}`);
  lines.push(`Exact shot to storyboard: ${input.clipDirection}`);
  lines.push(`Clip duration: ${input.clipDuration}s`);
  lines.push(`Cast in clip: ${castLine(input)}`);
  lines.push(`Environment: ${input.environmentName || 'unspecified'}`);
  return lines.join('\n');
};

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

${sceneContext(input)}

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
  if (variant === 'adaptive_numbered_storyboard') {
    const layout = panelLayout(input.clipDuration);
    const moodLine = input.mood ? `Mood: ${input.mood}\n` : '';
    const musicalCueLine = input.musicalCue ? `Pacing cue from the music: ${input.musicalCue}\n` : '';
    const sceneContextLine = input.sceneNarrative
      ? `Scene this clip is part of: ${input.sceneNarrative}\n`
      : '';

    return `Create a numbered cinematic storyboard for one Lahari devotional music-video clip.

Use a ${layout.rows}x${layout.cols} grid (${layout.count} panels) read left-to-right, top-to-bottom. Clean white background, thin white borders, generous spacing between and around every panel. Editorial minimalist storyboard layout, professional pitch-deck style.

Song: ${input.title}
Concept: ${input.concept}
${moodLine}${musicalCueLine}${sceneContextLine}Shot description: ${input.clipDirection}
Clip length: ${input.clipDuration}s
Characters in this shot: ${input.castNames.length ? input.castNames.join(', ') : 'no recurring character'}
Setting: ${input.environmentName || 'not specified'}

Reference images:
- Style image — copy its lighting, colors, and art style.
- Character images — match each character's face, body, and outfit.
- Environment image — keep the same place and layout in every panel.

You're directing this clip's visual edit. The scene gives you the wider moment this clip belongs to; the shot description is the specific moment you draw. For each panel, decide:

- the framing (wide / medium / close / extreme close)
- the camera angle (eye / low / high / overhead / over-shoulder)
- whether the camera moves (static, push, pull, pan, tilt, rack-focus) or holds
- where characters stand, where they look, what they do
- which part of the environment is visible and how light falls
- why this cut earns its place — new information, deeper emotion, or a beat hit
- where in the ${input.clipDuration}s window this panel sits

Across the panels, design a coherent arc: open (establish), build (deepen the moment), land (the strongest visual or emotional beat), resolve (a final image that releases the tension). Keep a stable spatial map — characters and key objects on consistent sides of the frame across cuts (the 180° rule).

Storyboard contract:
- Treat the board as one edited scene, not separate concept frames. Every panel must be a plausible frame from the same ${input.clipDuration}s clip.
- Each panel is a true 16:9 cinematic film frame, all panels with identical width and height. Do not stretch, crop, stack vertically, or distort panels to fill the canvas.
- Maintain 100% visual consistency across all panels: same art style, same lighting mood, same character designs, same color palette, same environment details, same costumes and jewelry.
- Only the characters listed in "Characters in this shot" appear with identity in this clip. Other named characters mentioned elsewhere in the brief (concept or scene context) belong to the broader scene, not this clip — don't draw them. Anonymous background figures the shot description itself calls for (crowds of devotees, villagers, distant sages, temple staff) are fine; keep them out of the foreground unless the shot calls for it.
- Use only culturally authentic objects, gestures, and elements that belong to the shot, the references, and the devotional Bhakti context.
- Every panel must show visible action, a clear camera angle, and a step in the emotional progression — not a static repeat of the previous panel.
- Mark each panel with a small clean panel number only — just the digit ("1", "2", "3"…) in a corner. Do not write descriptions, captions, arrows, subtitles, speech bubbles, logos, watermarks, or any other readable text inside the panels. Panel descriptions live outside the image, in the shot progression below.

Style and quality:
- Live-action cinematic realism, high-end Indian devotional film quality.
- Sharp focus, natural skin and fabric detail, real-world materials, physically accurate lighting.
- Spiritually uplifting, emotionally moving, serene yet vibrant Bhakti devotional atmosphere.
- Ultra-high resolution, subtle film grain, masterpiece quality.

Then, outside the image, return a concise shot progression in plain text using this exact shape. Use exactly the same number of panels as the image:

Shot progression:
Panel 1 [MM:SS-MM:SS] - camera: <shot type and any movement>; action: <what happens visibly in this panel>; motion cue: <the specific camera move or beat the video model should preserve, e.g. "slow push-in over 3s" or "rack focus on a chime hit">
Panel 2 [MM:SS-MM:SS] - camera: ...; action: ...; motion cue: ...
(repeat for every panel actually drawn)

Continuity notes: one short sentence naming the spatial map and screen direction you preserved.`;
  }

  const panelSpec = variant === 'six_panel_music_video'
    ? `Create a six-panel cinematic production storyboard for this one ${input.clipDuration}s Lahari music-video clip.`
    : variant === 'filmstrip_minimal_cuts'
      ? `Create a clean horizontal filmstrip storyboard for this one ${input.clipDuration}s Lahari music-video clip, using four panels and minimal internal cuts.`
      : `Create a four-panel cinematic production storyboard for this one ${input.clipDuration}s Lahari music-video clip.`;

  const cutGuidance = variant === 'filmstrip_minimal_cuts'
    ? `The panels should imply a calm edited sequence with only 2-3 cuts: opening, one meaningful angle change, emotional landing.`
    : `The panels should imply an edited mini-sequence with distinct camera angles: opening, first movement, emotional/action peak, and landing image.`;

  return `${panelSpec}

${clipContext(input)}

Use the provided reference images as ground truth:
- the locked style reference controls visual language
- character references control identity, body, costume, and jewelry
- the environment reference controls geography and physical space

${cutGuidance}

Storyboard contract:
- Treat the board as one edited scene, not separate concept frames.
- Each panel must be its own true 16:9 cinematic film frame, about 1.78:1.
- All panels must use the exact same width and height.
- Do not make panels panoramic, cinemascope, ultra-wide, or poster-shaped.
- Place the panels on a neutral storyboard board with clean spacing. Unused empty board space is allowed.
- On the wide storyboard canvas, each panel should be about 800x450 px or 900x506 px. Use smaller panels and larger empty margins rather than stretching any panel wider than 16:9.
- Do not stretch, crop, stack vertically, or distort panels just to fill the canvas.
- Read panel order left-to-right across each row. If more than 3 panels are needed, use a second row with balanced spacing. For 5 panels, use 3 panels on top and 2 below, with the bottom panels the same size as the top panels and centered with empty space on both sides. For 6 panels, use 3 panels on top and 3 below.
- Keep a stable spatial map across panels while allowing meaningful angle changes.
- Every cut should reveal new information, deepen emotion, or land a musical beat.
- Use only objects and gestures that belong to the shot, the references, and the devotional context.
- Small clean panel numbers in a panel corner are allowed. Do NOT print captions, arrows, subtitles, speech bubbles, logos, watermarks, or dense readable text inside the storyboard image.
- same characters, costumes, environment, and style across all panels
- every panel must be a plausible frame from the same ${input.clipDuration}s clip
- show actual visible action, camera angle, and emotional progression
- make the board useful as a Seedance reference image, not a poster or concept sheet

Also return a concise cut plan outside the image, in plain text, using this exact shape. Use exactly the same number of panels as the image. The numbered labels below are for the text cut plan only; do not render them inside the storyboard image:
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
Follow the panels left-to-right across each row, then continue to the next row if present. If @image1 contains panel numbers, labels, borders, gutters, or guide marks, treat them only as sequencing guides and do not render them into the video. Use all other reference images only to preserve style, character identity, costume, and environment. No generated audio, no subtitles, no readable text.`;
  }

  if (variant === 'shot_timing_only') {
    return `Generate a ${input.clipDuration}s cinematic Lahari music-video clip.

${clipContext(input)}

${seedanceShotList(input)}

No generated audio, no subtitles, no readable text. Preserve all provided reference identities and style.`;
  }

  const refs = opts?.refs || [];
  const refBindings = refs.length
    ? refs.map((ref, idx) => `- @image${idx + 2} = ${ref.label} — identity anchor only`).join('\n')
    : '- @image2..N = locked style, character, and environment refs — identity anchors only';
  const cutPlan = opts?.cutPlanText?.trim() || seedanceShotList(input, minimal);
  const layout = panelLayout(input.clipDuration);

  return `Animate this ${layout.rows}×${layout.cols} storyboard grid into one cohesive ${input.clipDuration}s music-video clip. Follow @image1's panels left-to-right across each row, then continue to the next row.

@image1 is the source of truth for composition, blocking, screen direction, cut order, and camera progression. Do not render text, panel numbers, borders, gutters, or split-screen artifacts from the board into the video.

Reference bindings:
- @image1 = the locked storyboard grid
${refBindings}
${hasAudio ? `- @audio1 = song excerpt; read it for rhythm and phrase timing` : ''}

${clipContext(input)}

Locked shot progression (motion and cut guide):
${cutPlan}

Animation contract:
- Camera movement: simple and physically plausible — pushes, pulls, pans, tilts, rack-focus. No impossible swings or vertigo zooms unless the shot progression names them.
- Preserve every character's face, body, costume, and jewelry across cuts to match the references. Preserve environment geometry across cuts.
- The storyboard composes; the references only anchor identity. Render only objects called for by the storyboard or the shot progression text.
- Soft slow-motion feel on emotional, singing, and dancing moments.
- Do not generate audio; the song is mixed separately.${hasAudio ? `
- @audio1 is a timing reference. Read it for rhythm and phrase boundaries; do not pass its audio through to the output.` : ''}${lipsync ? `
- Additionally, if a visible face is singing or chanting, match subtle mouth movement to @audio1's vocal phrasing — no exaggerated lip-sync.` : ''}

Generate one cohesive ${input.clipDuration}s edited clip with smooth cinematic camera movement. 24fps, masterpiece quality.`;
};

export const buildPromptPack = (input: StoryboardRdInput): string => {
  const scriptVariants: ScriptPromptVariant[] = ['clip_blocks', 'clip_blocks_combine_short', 'clip_blocks_freeform'];
  const storyboardVariants: StoryboardPromptVariant[] = ['adaptive_numbered_storyboard', 'four_panel_clean', 'six_panel_music_video', 'filmstrip_minimal_cuts'];
  const seedanceVariants: SeedancePromptVariant[] = ['follow_board_only', 'shot_timing_only', 'board_plus_timing', 'board_plus_audio_rhythm', 'board_plus_audio_lipsync'];

  return `# Seedance Storyboard Prompt Pack

Generated: ${new Date().toISOString()}

## Scene context (used by script writer)

\`\`\`
${sceneContext(input)}
\`\`\`

## Clip context (used by storyboard generator + video model)

\`\`\`
${clipContext(input)}
\`\`\`

## Script Writer Variants

${scriptVariants.map((variant) => `### ${variant}\n\n\`\`\`\n${buildSeedanceScriptWriterPrompt(input, variant)}\n\`\`\``).join('\n\n')}

## GPT Image Storyboard Variants

${storyboardVariants.map((variant) => `### ${variant}\n\n\`\`\`\n${buildStoryboardPrompt(input, variant)}\n\`\`\``).join('\n\n')}

## Seedance Prompt Variants

${seedanceVariants.map((variant) => `### ${variant}\n\n\`\`\`\n${buildSeedanceStoryboardVideoPrompt(input, variant)}\n\`\`\``).join('\n\n')}
`;
};
