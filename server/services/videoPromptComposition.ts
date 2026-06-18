// Single source of truth for the storyboard-mode video prompt.
//
// A prompt is a list of provenance-annotated segments. The text we send to the
// video model is the rendering of the *included* segments; the same segment list
// IS the audit the director agent reads to decide how to override / edit / redo.
// Composition and audit are the same data structure — you never build a prompt
// and then separately describe it.
//
// Design rules:
//  - One owner per slot. No layer restates another layer's guardrails. Board
//    treatment ("the board is a sketch plan, the style ref is the finish" vs
//    "match the board's finish") lives in the FORMAT slot — owned by the project
//    recipe/override when present, with a sensible engine default otherwise. The
//    engine guardrail is universal and makes NO claim about the board's finish, so
//    it can never contradict the recipe.
//  - Every segment is self-describing: `source` says where it came from, `editPath`
//    says the exact action that changes it. The agent never reverse-engineers the
//    architecture — the segment tells it what it is and which tool edits it.
//  - The `include` map is the seam a video contextOverride drives (e.g. dropping
//    the shot beat). Excluded segments stay in the list (marked not-included) so
//    the audit still shows what was deliberately left out.

export type VideoPromptSlot =
  | 'format'      // board treatment + clip kind: recipe/override when present, engine default otherwise
  | 'animation'   // how to read the board (engine)
  | 'beat'        // shot content (shots.direction)
  | 'refs'        // identity ref bindings (locked storyboard version refs)
  | 'cut_plan'    // panel-to-timing (shots.storyboard_cut_plan)
  | 'audio'       // lipsync / native-audio directive
  | 'guardrail';  // universal don'ts (engine, emitted once, no board-finish claim)

export type VideoPromptSegment = {
  slot: VideoPromptSlot;
  label: string;
  text: string;
  /** Where this segment's text came from. */
  source: string;
  /** The exact action that changes this segment. */
  editPath: string;
  /** Whether this segment was rendered into the final prompt. */
  included: boolean;
};

export type VideoPromptImage = {
  ref: string;          // @image1
  role: string;         // storyboard board | style reference | environment reference | ...
  assetId: string | null;
  source: string;
};

export type VideoPromptComposition = {
  kind: 'mirage.video_prompt_composition';
  mode: 'storyboard';
  /** The string actually sent to the model — render of the included segments. */
  text: string;
  segments: VideoPromptSegment[];
  images: VideoPromptImage[];
  params: Record<string, unknown>;
};

export type ComposeStoryboardVideoInput = {
  toolName: string;
  clipDuration: number;
  clipDirection?: string | null;
  /** Rendered recipe/override text (already slot-filled). When set, it OWNS board
   *  treatment; when absent, the engine emits a default "match the board" line. */
  formatIntent?: string | null;
  formatSource?: string | null;
  refLabels?: string[];
  cutPlanText?: string | null;
  cutPlanFromShot?: boolean;
  presetVideoRules?: string | null;
  lipsyncEnabled?: boolean;
  nativeAudioEnabled?: boolean;
  audioCue?: string | null;
  images?: VideoPromptImage[];
  params?: Record<string, unknown>;
  /** Per-slot include/exclude (the seam a video contextOverride drives). Defaults to all-included. */
  include?: Partial<Record<VideoPromptSlot, boolean>>;
  /** Recipe/workflow defaults before call-level include/exclude. */
  defaultInclude?: Partial<Record<VideoPromptSlot, boolean>>;
};

const SEGMENT_SEPARATOR = '\n\n';

// Engine default board treatment, used only when no recipe/override declares one.
// A storyboard with no recipe is the final aesthetic, so match its finish.
const DEFAULT_BOARD_TREATMENT =
  'The storyboard @image1 carries the target look — match its rendering, palette, line treatment, texture, and finish throughout the clip.';

export const composeStoryboardVideoPrompt = (input: ComposeStoryboardVideoInput): VideoPromptComposition => {
  const dur = input.clipDuration;
  const tool = input.toolName;
  const include = (slot: VideoPromptSlot) => input.include?.[slot] ?? input.defaultInclude?.[slot] ?? true;
  const segments: VideoPromptSegment[] = [];

  // 1. Format — board treatment + clip kind. The recipe/override owns it when
  //    present (it can declare the board a sketch plan and point the finish at
  //    the style ref); otherwise the engine emits the "match the board" default.
  const formatIntent = input.formatIntent?.trim();
  if (formatIntent) {
    segments.push({
      slot: 'format', label: 'Format contract', text: formatIntent,
      source: input.formatSource || 'project video recipe/override',
      editPath: 'apply_project_workflow | apply_project_prompt_override',
      included: include('format'),
    });
  } else {
    segments.push({
      slot: 'format', label: 'Format (engine default)', text: DEFAULT_BOARD_TREATMENT,
      source: 'engine default (no project video recipe)',
      editPath: 'apply_project_workflow | apply_project_prompt_override to change board treatment',
      included: include('format'),
    });
  }

  // 2. Animation — owned by the engine. How to read the board.
  segments.push({
    slot: 'animation', label: 'Animation',
    text: `Animate the storyboard @image1 into one ${dur}s ${tool} clip. Follow the panels left-to-right, then top-to-bottom, as one continuous edited shot.`,
    source: 'engine (composer)', editPath: 'not editable (engine)',
    included: include('animation'),
  });

  // 3. Beat — the shot's content. Owned by shots.direction.
  const beat = input.clipDirection?.trim();
  if (beat) {
    segments.push({
      slot: 'beat', label: 'Shot beat', text: `Shot: ${beat}`,
      source: 'shots.direction',
      editPath: 'apply_text_edits | contextOverrides.includeShotBeat=true/false',
      included: include('beat'),
    });
  }

  // 4. Ref bindings — owned by the locked storyboard version's refs.
  const refLabels = input.refLabels || [];
  const refBindings = refLabels.length
    ? refLabels.map((label, idx) => `- @image${idx + 2} = ${label} — identity anchor only`).join('\n')
    : '- @image2..N = locked style, character, and environment refs — identity anchors only';
  segments.push({
    slot: 'refs', label: 'Identity refs',
    text: `Identity refs (do not redesign):\n${refBindings}\nReference images are guides, not frames. Never insert them into the video — even briefly, even for a single frame. They only anchor likeness, costume, and environment geometry.`,
    source: 'locked storyboard version refs',
    editPath: 'lock_reference | refine_storyboard | excluded_refs',
    included: include('refs'),
  });

  // 5. Cut plan — panel-to-timing. Owned by the shot's saved cut plan.
  const cutPlan = input.cutPlanText?.trim();
  if (cutPlan) {
    segments.push({
      slot: 'cut_plan', label: 'Panel beats', text: `Panel beats:\n${cutPlan}`,
      source: input.cutPlanFromShot ? 'shots.storyboard_cut_plan' : 'engine (derived timing)',
      editPath: input.cutPlanFromShot ? 'refine_storyboard (replan) | contextOverrides.includeCutPlan=false' : 'not editable (engine)',
      included: include('cut_plan'),
    });
  }

  // 6. Audio — lipsync / native-audio directive, if any.
  const audioParts: string[] = [];
  if (input.lipsyncEnabled) {
    audioParts.push('Lip-sync: @audio1 is the song segment — use it only as visual timing for mouth movement on clearly-visible singing faces. Do not generate or preserve audio. Faces turned away or instrumental moments: keep the mouth natural.');
  }
  if (input.nativeAudioEnabled) {
    audioParts.push('Native audio: generate audible synchronized speech, sound, and ambience only for dialogue/sound cues named in this prompt. Keep voices natural and matched to the visible acting.');
  }
  if (input.audioCue?.trim()) audioParts.push(input.audioCue.trim());
  if (audioParts.length) {
    segments.push({
      slot: 'audio', label: 'Audio direction', text: audioParts.join('\n'),
      source: 'shot audio plan / project audio settings',
      editPath: 'apply_audio_plan | apply_cast_voice | nativeAudioMode',
      included: include('audio'),
    });
  }

  // 7. Guardrails — owned by the engine, emitted ONCE, universal. Makes NO claim
  //    about whether to match the board's finish (that is the format slot's job),
  //    so it can never contradict the recipe's board treatment.
  const guardrailParts = [
    'Preserve character identity (face, body, costume, jewelry) and environment geometry across the whole clip — match the locked references throughout, do not let them drift between panels.',
    'Hold one consistent style across the clip — do not drift toward photoreal or a different aesthetic mid-clip. Identity refs are guides for likeness only, never aesthetic targets.',
  ];
  if (input.presetVideoRules?.trim()) guardrailParts.push(input.presetVideoRules.trim());
  guardrailParts.push('Do not render text, panel borders, numbers, gutters, captions, or split-screen artifacts from the board into the video.');
  segments.push({
    slot: 'guardrail', label: 'Guardrails', text: guardrailParts.join('\n'),
    source: 'engine (composer) + preset videoPromptRules',
    editPath: 'preset rule via project preset (not editable per-shot)',
    included: include('guardrail'),
  });

  const text = segments.filter((s) => s.included).map((s) => s.text).join(SEGMENT_SEPARATOR);

  return {
    kind: 'mirage.video_prompt_composition',
    mode: 'storyboard',
    text,
    segments,
    images: input.images || [],
    params: input.params || {},
  };
};
