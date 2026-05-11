
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

export type VideoMode = 'montage' | 'cinematic';

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

export interface VideoShot {
  id: string;
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
  useNextAsEndFrame: boolean;
  error?: string;
  lastError?: string;
  refImages?: { id: string; url: string }[];
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
  deity: string;
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
}

export interface CastMember {
  id: string;
  name: string;
  description: string;
  generationPrompt?: string;
  promptsStale?: boolean;
  referenceAssetId?: string;
  referenceImageUrl?: string;
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
  audioPath: string;
  lyrics?: string;
  meaning?: string;
  musicalStructure: MusicalSection[];
  conceptOptions: ConceptOption[];
  lockedConcept: ConceptOption | null;
  styleDescription?: string;
  styleAssetUrl?: string;
  styleGenerationPrompt?: string;
  styleExploration?: { slots: { title: string; description: string; imageUrl?: string; assetId?: string }[]; userSlot?: { title: string; description: string; imageUrl?: string; assetId?: string } } | null;
  colorPalette?: string;
  videoMode: VideoMode;
  songType?: string;
  isNarrative?: boolean;
  isMeditative?: boolean;
  analysisStep?: string;
  imageModel: string;
  storyboardProvider: import('./constants/storyboardProviders').StoryboardProviderKey;
  videoModel: string;
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
}
