
export enum AppStep {
  UPLOAD = 0,
  BLUEPRINT = 1,
  STUDIO = 2,
  RENDER = 3,
}

export enum GenerationStatus {
  IDLE = 'idle',
  LOADING = 'loading',
  CRITIQUING = 'critiquing',
  SUCCESS = 'success',
  ERROR = 'error',
  STALE = 'stale',
}

export type ProjectPhase =
  | 'uploaded'
  | 'analyzing'
  | 'analyzed'
  | 'concept_locked'
  | 'style_locked'
  | 'characters_locked'
  | 'environments_locked'
  | 'scripted'
  | 'in_production'
  | 'rendered'
  | 'error';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface MusicalSection {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  energyLevel: 'Low' | 'Medium' | 'High';
  description: string;
}

export interface ShotCritique {
  score: number;
  reasoning: string;
  isConsistent: boolean;
  suggestions: string;
}

// ─── Audio Blueprint (scripted narrative workflow) ──────────────────
// Shapes match ledger §7. Backend table support lands in T3.1.

/** Legacy per-shot audio-plan hint. Runtime uses projectBrief.dialogueVideoMode. */
export type DialogueStrategy = 'lipsync' | 'overlay';
/** Project-level dialogue video path.
 *  'lipsync' = video is prompted to perform native speech/lip movement.
 *  'overlay' = video is prompted to perform dialogue; render mixes generated TTS over the timeline. */
export type DialogueVideoMode = 'lipsync' | 'overlay';

export type TtsStatus = 'pending' | 'generating' | 'success' | 'error';

export interface DialogueLine {
  id: string;
  characterId: string;
  text: string;
  order: number;
  targetSec?: number;
  ttsAssetId: string | null;
  /** Public URL for the generated TTS asset. Hydrated by `getFullProject`
   *  when ttsAssetId is set; absent before generation. */
  ttsAssetUrl?: string;
  ttsStatus: TtsStatus;
  ttsError?: string;
  ttsCharCount?: number;
  ttsDurationSec?: number;
}

export interface AudioPlan {
  dialogueStrategy: DialogueStrategy;
  dialogue: DialogueLine[];
  /** Freeform ambient/SFX notes; flows into video prompt context. */
  soundNotes?: string;
}

export interface VideoShot {
  id: string;
  workflowMode?: 'auto' | 'storyboard' | 'keyframe';
  duration: number;
  direction?: string;
  visualPrompt: string;
  motionPrompt: string;
  castIds: string[];
  imageUrl?: string;
  imageStatus: GenerationStatus;
  endImageUrl?: string;
  endImageStatus: GenerationStatus;
  endVisualPrompt?: string;
  endUserFeedback?: string;
  extractedLastFrameUrl?: string;
  continuityFrom: 'cut' | 'prev_shot';
  refinedFromPrevFrame?: boolean;
  locked: boolean;
  userFeedback?: string;
  environmentId?: string;
  critique?: ShotCritique;
  attemptCount?: number;
  promptsStale?: boolean;
  videoUrl?: string;
  videoStatus: GenerationStatus;
  storyboardUrl?: string;
  storyboardAssetId?: string;
  storyboardVersionId?: string;
  storyboardStatus: GenerationStatus;
  storyboardLocked?: boolean;
  storyboardUserFeedback?: string;
  storyboardPrompt?: string;
  storyboardCutPlan?: string;
  storyboardPromptStatus?: GenerationStatus;
  storyboardPromptUserFeedback?: string;
  lipsyncEnabled?: boolean;
  /** Per-step ref exclusion for storyboard mode. Keys: 'style' |
   *  'cast:<castMemberId>' | 'env:<environmentId>'. Two independent lists
   *  because storyboard image gen and Seedance video gen have different
   *  ref appetites (Seedance often wants only the locked storyboard image). */
  excludedRefs?: { storyboard: string[]; video: string[] };
  /** When true, the previous shot in the same scene's locked storyboard is
   *  attached as a continuity ref — sent to the planner as image input and
   *  to the image renderer as an @imageN ref. */
  usePrevStoryboardRef?: boolean;
  /** Nullable: null means "use smart default" (true when continuity_from is
   *  'prev_shot' and a prev shot exists in scene). True/false override. */
  includePrevCutPlan?: boolean | null;
  useNextAsEndFrame: boolean;
  error?: string;
  lastError?: string;
  refImages?: { id: string; url: string }[];
  /** Scripted narrative workflow: dialogue/SFX plan for this shot. Authored by Codex
   *  (apply_audio_plan) or backend write-audio-plan. Absent on music_video. */
  audioPlan?: AudioPlan;
  /** True when upstream script edits invalidate the existing audio_plan. */
  audioPlanStale?: boolean;
}

export interface VideoScene {
  id: string;
  sectionLabel: string;
  startTime: string;
  endTime: string;
  lyrics: string;
  narrativeDescription: string;
  shots: VideoShot[];
}

export interface ConceptOption {
  title: string;
  language: string;
  subject?: string;
  primarySubject?: string;
  /** @deprecated Legacy devotional projects used this as the primary subject. */
  deity?: string;
  mood: string;
  theme: string;
  lyricsSummary?: string;
  conceptDirection: string;
  description?: string;
  /** @deprecated — replaced by description. Kept for backward compat with old projects. */
  visualSuggestions?: {
    physicalDescription?: string;
    artStyle?: string;
    colorPalette?: string;
  };
}

export interface StylePreset {
  key: string;
  title: string;
  description: string;
  /** Curated static anchor image — what this preset generally looks like, shown
   *  before the artist runs a project-specific visualize. Resolved server-side. */
  previewImageUrl?: string;
}

/** Per-project cache of preset visualizations. Keyed by preset key.
 *  Survives unlock so the artist can revisit without paying for regen. */
export interface PresetSlotCache {
  [presetKey: string]: { imageUrl?: string; assetId?: string };
}

export interface CastMember {
  id: string;
  name: string;
  description: string;
  generationPrompt?: string;
  promptsStale?: boolean;
  referenceAssetId?: string;
  referenceImageUrl?: string;
  /** Scripted narrative workflow: voice provider for TTS generation. v1 = 'elevenlabs'. */
  voiceProvider?: 'elevenlabs';
  /** Provider's raw voice ID (e.g. ElevenLabs voice_id). */
  voiceId?: string;
  /** Human-readable label for the voice. */
  voiceName?: string;
}

export interface Environment {
  id: string;
  name: string;
  description: string;
  generationPrompt?: string;
  promptsStale?: boolean;
  referenceAssetId?: string;
  referenceImageUrl?: string;
}

/** The full project state as returned by the API */
export interface ApiProject {
  id: string;
  title: string;
  status: ProjectPhase;
  /** Workflow recipe driving the pipeline. */
  workflowKey: 'music_led' | 'scripted_narrative' | 'music_video' | 'anime_scripted';
  /** What the project was seeded from. */
  seedKind: 'audio' | 'script' | 'brief' | 'document' | 'idea';
  /** Preset providing taste + defaults. */
  presetKey: 'music_video_default' | 'anime_default';
  projectBrief?: {
    title?: string;
    context?: string;
    directorBrief?: string;
    dialogueVideoMode?: DialogueVideoMode;
    targetRuntime?: number;
    targetDuration?: number;
    logline?: string;
    [key: string]: unknown;
  } | null;
  sourcePayload?: {
    kind?: string;
    title?: string;
    originalName?: string;
    [key: string]: unknown;
  } | null;
  audioPath: string;
  lyrics?: string;
  meaning?: string;
  musicalStructure: MusicalSection[];
  conceptOptions: ConceptOption[];
  lockedConcept: ConceptOption | null;
  styleDescription?: string;
  styleAssetUrl?: string;
  styleGenerationPrompt?: string;
  styleExploration?: { slots: { title: string; description: string; imageUrl?: string; assetId?: string }[]; userSlot?: { title: string; description: string; imageUrl?: string; assetId?: string }; presetSlots?: PresetSlotCache } | null;
  colorPalette?: string;
  songType?: string;
  isNarrative?: boolean;
  isMeditative?: boolean;
  analysisStep?: string;
  imageModel: string;
  storyboardProvider: import('./constants/storyboardProviders').StoryboardProviderKey;
  videoModel: string;
  textProvider: import('./constants/textProviders').TextProviderKey;
  aspectRatio: '16:9' | '9:16' | '1:1';
  videoResolution: '720p' | '1080p';
  lastScriptPrompt?: string;
  lastConceptPrompt?: string;
  lastWriteShotsPrompt?: string;
  parentProjectId?: string;
  cast: CastMember[];
  environments: Environment[];
  scenes: VideoScene[];
  chatHistory: ChatMessage[];
  targetDuration: number;
  costEstimate: number;
  createdAt: string;
  updatedAt: string;
  /** Tool registry projection (D24): tools the agent + UI can run right
   *  now, and tools that are blocked with the assets each needs.
   *  Computed server-side via `availableTools`/`blockedTools` in the
   *  tool registry. Same data the MCP packet surfaces. */
  availableTools: ResolvedTool[];
  blockedTools: BlockedTool[];
}

// ─── Tool Registry (mirror of server/tools/types.ts) ────────────────
// Kept in frontend types.ts to avoid pulling server code into the bundle.

export type AssetKey =
  | 'audio'
  | 'scriptText'
  | 'directorBrief'
  | 'targetRuntime'
  | 'lyrics'
  | 'musicalStructure'
  | 'meaning'
  | 'concept'
  | 'styleDirections'
  | 'styleAsset'
  | 'cast'
  | 'environments'
  | 'scenes'
  | 'shots'
  | 'shotPrompts'
  | 'storyboardPrompts'
  | 'castLooks'
  | 'envLooks'
  | 'audioPlan'
  | 'castVoices'
  | 'ttsAssets'
  | 'storyboards'
  | 'keyframes'
  | 'videos'
  | 'render';

export type ToolSurface = `asset:${string}` | 'agent-only';

export type WorkflowKey = 'music_led' | 'scripted_narrative';

export interface ResolvedTool {
  key: string;
  label: string;
  description: string;
  surface: ToolSurface;
  enabledFor?: WorkflowKey[];
  requires: AssetKey[];
  contextInputs?: AssetKey[];
  produces: AssetKey[];
}

export interface BlockedTool extends ResolvedTool {
  missing: AssetKey[];
}
