import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';
import { clip, workflowContextFor } from './_shared.js';

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

WRITE PROMPTS THAT ARE RENDERABLE.

The visual medium is locked separately via the project's style reference image — the image renderer sees that reference image AND your prompt together. Describe what visibly happens and what the frame contains; do NOT dictate art style, color palette, rendering language, or "cinematic"/"film still" framing in words. Words like "cinematic" pull stylized projects back toward realism.

Every sentence must describe something visible or animateable. Do not write poetry, metaphor, or inner emotion directly. Avoid phrases like "seems to", "as if", or invisible causes such as grace, breath, presence, warmth, or devotion. Describe the visible effect directly.

But do not become schematic. Avoid layout jargon like "left half", "right half", "split-focus", or "perfect symmetry" unless the shot truly depends on that exact arrangement.

Translate emotion into physical evidence: a still face, a hand tightening, a light settling, dust or rain moving through space, a body freezing before it answers, distance between two figures.

EXAMPLES — the boundary between renderable and not:

GOOD visualPrompt:
"Medium side shot: Mina stops at the classroom doorway, one hand still on the frame, while the hallway behind her falls out of focus. Her shoulders are tense and her eyes stay fixed on the empty desk."

GOOD visualPrompt:
"Low wide shot from the workshop floor: the half-built machine fills the background while Ren kneels in the foreground, tools scattered around his knees, staring at the cracked control panel."

GOOD motionPrompt:
"Static hold as Mina tightens her grip on the doorframe; the hallway lights flicker once behind her."

GOOD motionPrompt:
"Slow push-in toward Ren's face as he exhales and reaches for the broken switch."

BAD visualPrompt:
"Mina understands the weight of her destiny." — emotional interpretation, not renderable.

BAD visualPrompt:
"A symmetrical split-focus composition with one character on the left third and the object on the right third." — schematic layout jargon unless the shot truly needs it.

BAD motionPrompt:
"The camera slowly dollies in to heighten the emotional atmosphere." — generic movement and non-visual rationale.

BAD motionPrompt:
"Glowing energy fills the room as cosmic particles swirl around everyone." — generic VFX not grounded in the shot direction.`;

const USER_NOTE_POLICY = `If USER NOTE is present, treat it as a hard creative constraint inside the tool contract and TASTE rules. Apply it consistently across every shot's visualPrompt and motionPrompt.

If the note conflicts with the preset's shot-prompt rules, the locked style reference (no art-style dictation in words), or the source shot direction itself, refuse the conflicting part and translate the rest into the closest valid shot-prompt-layer intent.`;

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
  const items = tail.map((t) => `[${t.id}]: visual: "${t.visualPrompt}" | motion: "${t.motionPrompt}"`).join('\n');
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
    return `SEEDANCE 2.0 PROMPTING MODE:
- Think like a production storyboard: each motionPrompt should read as a timed action cue for this exact shot duration, not a loose mood sentence.
- Seedance follows explicit subject + motion + camera + timing well. Name the subject, the visible change, and the camera move in a clean order.
- Use each shot's listed duration when helpful: "Over 5s..." or "During the final second..." for holds, reveals, and beat hits.
- The finished audio is mixed at render time, and Segmind is called with generate_audio=false. Do NOT ask Seedance to generate music, voiceover, dialogue, or sound effects.
- You may reference the ${timingReference}. Keep it visible and editorial.
- Keep camera choreography simple and physically plausible. Seedance rewards clear cuts, short moves, stable subjects, and consistency locks more than overloaded cinematic adjectives.
- If the start frame must stay consistent, say so positively: "maintain the same face, costume, and environment geometry while..."
- Avoid multi-shot language inside one shot unless the direction explicitly requires a transition. The system stitches separate clips later.`;
  }
  return `VIDEO MODEL PROMPTING MODE:
- The model gets a start frame and the final audio is added in render, so the motionPrompt should describe visible action and camera motion only.
- Do not request generated audio, dialogue, subtitles, or sound effects.`;
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

- visualPrompt: The start frame. Brief but complete: camera position, shot scale, subject placement, spatial relationship, location, one key visible detail. The model already has character/environment/style reference IMAGES — do not describe art style or color palette. Do allow functional lighting when it defines the frame ("lamplight catches the carved cheek", "the face emerges from shadow"). Preserve the shot's real geography. Do not invent corridors, arches, rooms, props, or layouts not implied by the direction or environment. ONLY include characters listed in that shot's Cast field.

- motionPrompt: One sentence. The video model already SEES the start frame. Say only what changes: character action, camera movement, environmental motion, and visible timing against the ${timingNoun} when useful. Name the camera verb when it moves (push-in, pan, tracking, pull-back). Prefer the simplest truthful motion. A static hold is valid when the beat is carried by stillness.

- continuityFrom: 'cut' or 'prev_shot'.
  Use 'prev_shot' when this shot directly intensifies, reveals, or sustains the previous shot's final moment — a gaze becoming a close-up, stillness cracking into recognition, a slow reveal continuing across an edit point.
  Use 'cut' when the shot begins a new beat, scale, angle, or emotional step.
  The first shot of a scene is ALWAYS 'cut'.

BEFORE RETURNING, CHECK THE SEQUENCE:
- No invented geography (corridors, archways, courtyards not in the direction)
- No repeated camera verb across consecutive shots
- No schematic composition shortcuts unless truly necessary
- No generic VFX unless explicitly described in the shot direction
- At least consider 'prev_shot' for direct intensifications — don't default to all cuts
- Every shot must advance the ${timingNoun} arc, story beat, performance beat, or visual idea, not just restate the previous beat

Match the IDs exactly.`;
};

export const buildWriteShotPromptsPrompt = (input: WriteShotPromptsPromptInput): string => composePrompt({
  coreTask: CORE_TASK,
  workflowContext: workflowContextFor(input.preset),
  inputs: formatInputs(input),
  presetTaste: input.preset.studio.shotPromptRules,
  userNotePolicy: USER_NOTE_POLICY,
  outputContract: buildOutputContract(input),
  userNote: input.userNote,
});
