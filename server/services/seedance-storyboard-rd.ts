import { getRuntimePreset, PipelinePreset } from '../presets.js';
import { composeStoryboardVideoPrompt } from './videoPromptComposition.js';

export const SEEDANCE_STORYBOARD_DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const;

export type SeedanceStoryboardDuration = typeof SEEDANCE_STORYBOARD_DURATIONS[number];

export type StoryboardRdInput = {
  title: string;
  concept: string;
  mood?: string;
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
  preset?: PipelinePreset;
};

export type ScriptPromptVariant = 'clip_blocks' | 'clip_blocks_combine_short' | 'clip_blocks_freeform';
export type StoryboardPromptVariant = 'adaptive_numbered_storyboard' | 'four_panel_clean' | 'six_panel_music_video' | 'filmstrip_minimal_cuts';
export type SeedancePromptVariant = 'follow_board_only' | 'shot_timing_only' | 'board_plus_timing';

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

const presetFor = (input: StoryboardRdInput) => input.preset || getRuntimePreset();
const isMusicVideoWorkflow = (input: StoryboardRdInput) => presetFor(input).workflowKey === 'music_led';
const projectLabel = (input: StoryboardRdInput) => isMusicVideoWorkflow(input) ? 'Song' : 'Project';
const sourceExcerptLabel = (input: StoryboardRdInput) => isMusicVideoWorkflow(input) ? 'Lyrics/phrase' : 'Script/source excerpt';

// Scene-scoped context — for the script writer that plans clips across a
// whole scene. Includes scene narrative, scene timestamps, and lyrics
// because the planner needs them to decide clip boundaries and beats.
const sceneContext = (input: StoryboardRdInput) => `${projectLabel(input)}: ${input.title}
Production intent: ${input.concept}
${input.mood ? `Mood: ${input.mood}\n` : ''}Scene: ${input.sceneLabel} (${input.sceneStart}-${input.sceneEnd})
Scene overview: ${input.sceneNarrative}
${input.musicalCue ? `${isMusicVideoWorkflow(input) ? 'Musical structure cue' : 'Timing cue'}: ${input.musicalCue}\n` : ''}${input.sceneLyrics ? `${sourceExcerptLabel(input)}: ${input.sceneLyrics}\n` : ''}Cast available in scene: ${castLine(input)}
Environment: ${input.environmentName || 'unspecified'}`;

// Clip-scoped context — for the storyboard generator and the video model,
// both of which produce a single 4-15s clip. Deliberately drops scene
// narrative, scene timestamps, and lyrics: those describe a
// broader window than this clip and risk leaking events (e.g. another
// character mentioned in the scene narrative) into the storyboard. The
// shot direction alone defines what gets drawn. Optional fields drop
// out when missing instead of leaking defaults.
const clipContext = (input: StoryboardRdInput) => {
  const lines: string[] = [
    `${projectLabel(input)}: ${input.title}`,
    `Production intent: ${input.concept}`,
  ];
  if (input.mood) lines.push(`Mood: ${input.mood}`);
  if (input.musicalCue) lines.push(`${isMusicVideoWorkflow(input) ? 'Musical pacing cue' : 'Timing cue'}: ${input.musicalCue}`);
  lines.push(`Shot description: ${input.clipDirection}`);
  lines.push(`Clip duration: ${input.clipDuration}s`);
  lines.push(`Cast in clip: ${castLine(input)}`);
  lines.push(`Environment: ${input.environmentName || 'unspecified'}`);
  return lines.join('\n');
};

export const buildSeedanceScriptWriterPrompt = (
  input: StoryboardRdInput,
  variant: ScriptPromptVariant
): string => {
  const preset = presetFor(input);
  const combineGuidance = variant === 'clip_blocks_combine_short'
    ? isMusicVideoWorkflow(input)
      ? `If a musical section is shorter than 15 seconds but clearly belongs to the next section, combine them into one storyboard clip. Do not combine sections that have different emotional or musical jobs.`
      : `If a script beat is shorter than 15 seconds but clearly belongs to the next action or reaction, combine them into one storyboard clip. Do not combine beats that change location, objective, or continuity state.`
    : isMusicVideoWorkflow(input)
      ? `Do not force artificial 15 second scenes. Short phrases may become 4, 5, 6, 8, 10, or 12 second clips when that better matches the music.`
      : `Do not force artificial 15 second clips. Short acting beats, reactions, transitions, and action fragments may become 4, 5, 6, 8, 10, or 12 second clips when that better matches the script.`;

  const freedomGuidance = variant === 'clip_blocks_freeform'
    ? `You have freedom to vary clip lengths for taste. Use 15 seconds for cinematic mini-scenes, 10-12 seconds for compact phrases, and 4-8 seconds for transitions, refrains, or quick responses.`
    : `Prefer 15 second storyboard clips when the musical section can support a mini-scene.`;

  const beatCueRule = isMusicVideoWorkflow(input)
    ? `beatCue: what lyric, musical phrase, drum accent, or vocal pulse the edit should hit`
    : `beatCue: what script beat, action beat, reaction, dialogue moment, or continuity handoff the clip should hit`;

  return `You are planning ${preset.toolName} clips for Seedance 2.0 storyboard mode.

In this mode, a ${preset.toolName} "shot" is not always a single continuous camera take. It is a storyboard clip: one 4-15 second edited mini-sequence that may contain internal cuts, multiple angles, and beat hits.

${freedomGuidance}
${combineGuidance}

Use only Seedance-supported durations: ${SEEDANCE_STORYBOARD_DURATIONS.join(', ')} seconds.

For each scene, output storyboard clips. Each clip needs:
- duration
- clipDirection: what happens across the mini-sequence
- ${beatCueRule}
- internalCuts: 3-6 concise cut beats with timestamps
- castNames
- environmentName
- Do not include art style, color palette, rendering language, or architecture not present in the scene/environment.

${sceneContext(input)}

Return a compact JSON object with a "clips" array.`;
};

export const SEEDANCE_SCRIPT_TOOL = {
  name: 'plan_seedance_storyboard_clips',
  description: 'Plan Seedance storyboard clips for project scenes',
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
            beatCue: { type: 'string', description: 'Source beat this clip should hit: lyric/rhythm for music videos, or script/action/dialogue beat for scripted work' },
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
  const preset = input.preset || getRuntimePreset();
  if (variant === 'adaptive_numbered_storyboard') {
    const layout = panelLayout(input.clipDuration);

    // Trimmed prompt — image models choke on long instruction lists with
    // multiple sections of rules. Earlier version was ~4300 chars; this
    // is ~750. Keeps the absolute essentials: layout, subject context,
    // ref discipline, the no-text rule. Drops "storyboard contract"
    // bullets, redundant style instructions, 180° rule explanations,
    // and the heavy panel-by-panel decision checklist — the model
    // does this naturally if asked clearly.
    const charactersLine = input.castNames.length
      ? `Characters: ${input.castNames.join(', ')}`
      : '';
    const settingLine = input.environmentName
      ? `Setting: ${input.environmentName}`
      : '';

    return `${layout.count}-panel storyboard for one ${input.clipDuration}s ${preset.toolName} shot.

Layout: ${layout.rows}×${layout.cols} grid, panels read left-to-right then top-to-bottom. Identical 16:9 panels, thin white borders, white background.

Shot: ${input.clipDirection}
${charactersLine}
${settingLine}

Each panel is a different moment from this same ${input.clipDuration}s shot — different framings, angles, beats — telling one visual arc. Match the reference images for style, character identity, costume, and environment.

${preset.studio.storyboardRules}

No text, captions, arrows, panel numbers, or readable marks inside any panel. The board itself is what we use; descriptions live outside the image.`;
  }

  const panelSpec = variant === 'six_panel_music_video'
    ? `Create a six-panel production storyboard for this one ${input.clipDuration}s ${preset.toolName} clip.`
    : variant === 'filmstrip_minimal_cuts'
      ? `Create a clean horizontal filmstrip storyboard for this one ${input.clipDuration}s ${preset.toolName} clip, using four panels and minimal internal cuts.`
      : `Create a four-panel production storyboard for this one ${input.clipDuration}s ${preset.toolName} clip.`;

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
- Each panel must be its own true 16:9 frame, about 1.78:1.
- All panels must use the exact same width and height.
- Do not make panels panoramic, cinemascope, ultra-wide, or poster-shaped.
- Place the panels on a neutral storyboard board with clean spacing. Unused empty board space is allowed.
- On the wide storyboard canvas, each panel should be about 800x450 px or 900x506 px. Use smaller panels and larger empty margins rather than stretching any panel wider than 16:9.
- Do not stretch, crop, stack vertically, or distort panels just to fill the canvas.
- Read panel order left-to-right across each row. If more than 3 panels are needed, use a second row with balanced spacing. For 5 panels, use 3 panels on top and 2 below, with the bottom panels the same size as the top panels and centered with empty space on both sides. For 6 panels, use 3 panels on top and 3 below.
- Keep a stable spatial map across panels while allowing meaningful angle changes.
- Every cut should reveal new information, deepen emotion, or land a musical beat.
${preset.studio.storyboardRules}
- Do NOT print panel numbers, labels, arrows, captions, subtitles, speech bubbles, logos, watermarks, or readable text inside the storyboard image.
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
    lipsyncEnabled?: boolean;
    nativeAudioEnabled?: boolean;
  }
): string => {
  const preset = input.preset || getRuntimePreset();
  const minimal = variant === 'follow_board_only';

  if (variant === 'follow_board_only') {
    return `Here is the ordered storyboard for a ${input.clipDuration}s ${preset.toolName} clip: @image1.
Follow the panels left-to-right across each row, then continue to the next row if present. If @image1 contains panel numbers, labels, borders, gutters, or guide marks, treat them only as sequencing guides and do not render them into the video. Use all other reference images only to preserve style, character identity, costume, and environment. ${opts?.nativeAudioEnabled ? 'Generate synchronized native audio when the prompt includes spoken dialogue or sound.' : 'No generated audio.'} No subtitles, no readable text.`;
  }

  if (variant === 'shot_timing_only') {
    return `Generate a ${input.clipDuration}s ${preset.toolName} clip.

${clipContext(input)}

${seedanceShotList(input)}

${opts?.nativeAudioEnabled ? 'Generate synchronized native audio when the prompt includes spoken dialogue or sound.' : 'No generated audio.'} No subtitles, no readable text. Preserve all provided reference identities and style.`;
  }

  // board_plus_timing delegates to the shared composer (videoPromptComposition.ts)
  // so there is one source of truth for the storyboard video prompt. With no
  // formatIntent, the composer emits its canonical sketch-plan treatment;
  // special project recipes can still supply a custom format segment.
  const refs = opts?.refs || [];
  return composeStoryboardVideoPrompt({
    toolName: preset.toolName,
    clipDuration: input.clipDuration,
    clipDirection: input.clipDirection,
    refLabels: refs.map((ref) => ref.label),
    cutPlanText: opts?.cutPlanText?.trim() || seedanceShotList(input, minimal),
    cutPlanFromShot: !!opts?.cutPlanText?.trim(),
    presetVideoRules: preset.studio.videoPromptRules,
    lipsyncEnabled: opts?.lipsyncEnabled,
    nativeAudioEnabled: opts?.nativeAudioEnabled,
  }).text;
};

export const buildPromptPack = (input: StoryboardRdInput): string => {
  const scriptVariants: ScriptPromptVariant[] = ['clip_blocks', 'clip_blocks_combine_short', 'clip_blocks_freeform'];
  const storyboardVariants: StoryboardPromptVariant[] = ['adaptive_numbered_storyboard', 'four_panel_clean', 'six_panel_music_video', 'filmstrip_minimal_cuts'];
  const seedanceVariants: SeedancePromptVariant[] = ['follow_board_only', 'shot_timing_only', 'board_plus_timing'];

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
