import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { GENERATE_USER_NOTE_POLICY, clip, workflowContextFor } from './_shared.js';

type ShotInput = {
  id: string;
  direction: string;
  duration: number;
  castNames: string[];
  sceneNarrative: string;
  sceneLyrics: string;
};

type PreviousBatchTailItem = {
  id: string;
  visualPrompt: string;
  motionPrompt: string;
};

type WriteShotPromptsPromptInput = {
  shots: ShotInput[];
  cast: { name: string; description: string }[];
  concept: any;
  userNote?: string;
  songType?: string;
  isNarrative?: boolean;
  isMeditative?: boolean;
  videoModel?: string;
  previousBatchTail?: PreviousBatchTailItem[];
  preset: PipelinePreset;
};

const CORE_TASK = `You are an art director / shot writer. The script writer planned what happens in each shot — you decide how it looks on screen and how it moves. Outputs go directly to an image model (visualPrompt) and a video model (motionPrompt).

Every sentence must name a visible subject, an action or change, and a spatial or timing anchor. Translate emotion into physical evidence (a hand tightening, a body freezing before it answers); do not write metaphor, inner state, or invisible causes.

The visual medium is locked separately via the project's style reference image. Do not dictate art style, color palette, or "cinematic"/"film still" framing in words — those words pull stylized projects toward realism. Functional lighting that defines the frame is fine. Avoid schematic layout jargon ("left third", "split-focus", "perfect symmetry") unless the shot truly depends on that arrangement.

Examples — boundary between renderable and not:

GOOD visualPrompt: "Medium side shot: Mina stops at the classroom doorway, one hand still on the frame, while the hallway behind her falls out of focus. Her shoulders are tense and her eyes stay fixed on the empty desk."

GOOD motionPrompt: "Slow push-in toward Ren's face as he exhales and reaches for the broken switch."

BAD visualPrompt: "Mina understands the weight of her destiny." — emotional interpretation, not renderable.

BAD motionPrompt: "The camera slowly dollies in to heighten the emotional atmosphere." — generic movement and non-visual rationale.`;

// User-note policy is shared (_shared.ts). Shot-prompts-specific tail:
// apply consistently across every shot's visualPrompt and motionPrompt.
const USER_NOTE_TAIL = `Apply consistently across every shot's visualPrompt and motionPrompt.`;

const formatShots = (shots: ShotInput[], preset: PipelinePreset): string => {
  const isMusicLed = preset.workflowKey === 'music_led';
  return shots.map((s, i) => {
    const cueLabel = isMusicLed ? 'Lyric/audio cue' : 'Source beat';
    const cueValue = s.sceneLyrics || (isMusicLed ? 'instrumental' : 'not specified');
    return `Shot ${i + 1} [${s.id}]: "${s.direction}" | ${s.duration}s | Cast: ${s.castNames.join(', ') || 'none'} | Scene: ${s.sceneNarrative} | ${cueLabel}: ${cueValue}`;
  }).join('\n');
};

const formatCast = (cast: { name: string; description: string }[]): string =>
  cast.map((c) => `${c.name}: ${c.description}`).join('\n');

const formatPreviousBatchTail = (tail?: PreviousBatchTailItem[]): string => {
  if (!tail?.length) return '';
  // Cap to last 3 shots — long tails inflate prompt size without improving
  // continuity. C1 trim per docs/mirage-composer-audit.md.
  const items = tail.slice(-3).map((t) => `[${t.id}]: visual: "${t.visualPrompt}" | motion: "${t.motionPrompt}"`).join('\n');
  return `PREVIOUS SHOTS (read-only context for continuity — do NOT rewrite these):\n${items}`;
};

const formatSongTypeSignal = (input: WriteShotPromptsPromptInput): string => {
  // Audio-analysis signal; only meaningful for music_led. Scripted_narrative
  // projects don't get an audio classification, so emitting "SONG TYPE: ..."
  // would be music-led chrome leaking into the wrong workflow.
  if (input.preset.workflowKey !== 'music_led') return '';
  const typeLabel = input.songType && input.songType !== 'unknown' ? input.songType : null;
  const traits = [
    input.isNarrative ? 'narrative' : null,
    input.isMeditative ? 'meditative' : null,
  ].filter(Boolean);
  if (!typeLabel && !traits.length) return '';
  return `SONG TYPE: ${[typeLabel, ...traits].filter(Boolean).join(', ')}`;
};

const meditativeGuidance = (isMeditative?: boolean): string => isMeditative
  ? `PATIENT / CONTEMPLATIVE PACING:
- Favor stillness, patience, and negative space. Let the frame breathe.
- Resist the urge to fill every shot with spectacle. A still face, a tightening hand, or a small environmental change can carry more weight than overt VFX.
- Show emotional presence through atmosphere and reaction, not abstract explanation.
- When a supernatural or heightened element appears, keep it grounded in the shot's visible state.`
  : '';

const modelGuidance = (input: WriteShotPromptsPromptInput): string => {
  const isSeedance = input.videoModel?.startsWith('seedance');
  const isMusicLed = input.preset.workflowKey === 'music_led';
  const timingReference = isMusicLed
    ? 'song rhythm visually: "on the vocal phrase", "on the drum accent", "as the line resolves", "with the rhythm pulse"'
    : 'source timing visually: "on the dialogue beat", "as the action lands", "during the reaction beat", "as the scene turns"';

  if (isSeedance) {
    return `SEEDANCE 2.0 PROMPTING:
- Each motionPrompt is a timed action cue for this shot's duration. Name subject, visible change, and camera move in that order.
- Use the listed duration when useful: "Over 5s..." or "During the final second..."
- Audio is mixed at render time. Do not request music, voiceover, dialogue, or SFX.
- Reference visible timing ("${timingReference}") when editorial.
- If the start frame must stay consistent, say so positively: "maintain the same face, costume, and environment geometry while..."`;
  }
  return `VIDEO MODEL: model gets a start frame; audio is added at render. Describe visible action and camera only. No audio, dialogue, subtitles, or SFX requests.`;
};

const formatInputs = (input: WriteShotPromptsPromptInput): string => {
  const sections: string[] = [];

  const songTypeSignal = formatSongTypeSignal(input);
  if (songTypeSignal) sections.push(songTypeSignal);
  sections.push(`Mood: ${clip(input.concept?.mood, 160) || 'unspecified'}`);
  if (input.videoModel) sections.push(`Video model: ${input.videoModel}`);

  sections.push(`CHARACTERS:\n${formatCast(input.cast)}`);

  const tail = formatPreviousBatchTail(input.previousBatchTail);
  if (tail) sections.push(tail);

  sections.push(`SHOTS TO WRITE:\n${formatShots(input.shots, input.preset)}`);

  const model = modelGuidance(input);
  if (model) sections.push(model);

  const meditative = meditativeGuidance(input.isMeditative);
  if (meditative) sections.push(meditative);

  return sections.join('\n\n');
};

const buildOutputContract = (input: WriteShotPromptsPromptInput): string => {
  const timingNoun = input.preset.workflowKey === 'music_led' ? 'music' : 'source';
  return `For EACH shot, return JSON via the write_shot_prompts tool:

- visualPrompt: Start frame. Brief but complete — camera position, shot scale, subject placement, location, one key visible detail. Character/environment/style reference images are already attached. Functional lighting is fine. Preserve the shot's geography; don't invent rooms, props, or layouts not in the direction. ONLY include characters listed in that shot's Cast field.

- motionPrompt: One sentence. The video model sees the start frame already. Say only what changes — character action, camera movement, environmental motion, visible timing against the ${timingNoun} when useful. Name the camera verb when it moves. A static hold is valid when stillness carries the beat.

- continuityFrom: 'cut' (new beat, scale, angle, or emotional step) or 'prev_shot' (this shot directly intensifies / reveals / sustains the previous shot's final moment). First shot of a scene is always 'cut'.

Match the IDs exactly.`;
};

export const buildWriteShotPromptsPrompt = (input: WriteShotPromptsPromptInput): string => composePrompt({
  coreTask: CORE_TASK,
  workflowContext: workflowContextFor(input.preset),
  inputs: formatInputs(input),
  userNotePolicy: `${GENERATE_USER_NOTE_POLICY}\n\n${USER_NOTE_TAIL}`,
  outputContract: buildOutputContract(input),
  userNote: input.userNote,
});
