
export enum AppStep {
  UPLOAD = 0,
  ANALYSIS = 1,
  STORYBOARD = 2,
  EXPORT = 3,
}

export enum GenerationStatus {
  IDLE = 'idle',
  LOADING = 'loading',
  SUCCESS = 'success',
  ERROR = 'error',
}

export type VideoMode = 'montage' | 'cinematic';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface MusicalSection {
  id: string;
  label: string; // "Intro", "Verse 1", "Chorus", "Bridge"
  startTime: string; // "00:00"
  endTime: string; // "00:15"
  energyLevel: 'Low' | 'Medium' | 'High'; 
  description: string; // "Soft flute intro" or "Heavy drum crescendo"
}

export interface VideoShot {
  id: string;
  duration: number; // Duration in seconds
  visualPrompt: string; // "Wide angle, Lord Shiva dancing..."
  motionPrompt: string; // "Slow zoom in..."
  
  // Image Generation
  imageUrl?: string;
  imageStatus: GenerationStatus;
  
  // Video Generation
  videoUrl?: string;
  videoStatus: GenerationStatus;
  
  // Continuity
  useNextAsEndFrame: boolean; // If true, uses the next shot's image as the lastFrame
  error?: string;
}

export interface VideoScene {
  id: string;
  sectionLabel: string; // e.g. "Chorus 1"
  startTime: string;
  endTime: string;
  lyrics: string;
  narrativeDescription: string; // "The energy rises as the deity reveals his power"
  shots: VideoShot[];
}

export interface ProjectConcept {
  title: string;
  language: string;
  deity: string;
  mood: string;
  theme: string;
  musicalStructure: MusicalSection[];
  visualSuggestions: {
    physicalDescription: string; // Specific visual traits of the deity
    artStyle: string; // "Cinematic, dark, moody"
    colorPalette: string;
  };
}

export interface VisualIdentity {
  styleDescription: string;
  characterSheet: string;
  colorPalette: string;
  videoMode: VideoMode;
  heroImage?: string; // The "Master Reference" base64
}

export interface ProjectAnalysis {
  concept: ProjectConcept;
  visualIdentity: VisualIdentity;
  targetDuration: number;
}

export interface ProjectState {
  audioFile: File | null;
  audioUrl: string | null;
  analysis: ProjectAnalysis | null;
  scenes: VideoScene[]; // Hierarchical structure
  chatHistory: ChatMessage[];
}
