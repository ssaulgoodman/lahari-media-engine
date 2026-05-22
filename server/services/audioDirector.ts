import { v4 as uuidv4 } from 'uuid';
export { buildAudioPlanPrompt } from '../prompts/audioPlan.js';

export type AudioPlanDialogueStrategy = 'lipsync' | 'overlay';
export type AudioPlanDialogueLine = {
  id: string;
  characterId: string;
  text: string;
  order: number;
  targetSec?: number;
  ttsAssetId: string | null;
  ttsStatus: 'pending' | 'generating' | 'success' | 'error';
  ttsError?: string;
  ttsCharCount?: number;
  ttsDurationSec?: number;
};

export type AudioPlan = {
  dialogueStrategy: AudioPlanDialogueStrategy;
  dialogue: AudioPlanDialogueLine[];
  soundNotes?: string;
};

type CastRow = {
  id: string;
  name: string;
  description?: string | null;
  reference_asset_id?: string | null;
  voice_provider?: string | null;
  voice_id?: string | null;
  voice_name?: string | null;
};

export const AUDIO_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dialogue: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          characterId: { type: 'string' },
          text: { type: 'string' },
          order: { type: 'number' },
          targetSec: { type: 'number' },
        },
        required: ['characterId', 'text', 'order'],
      },
    },
    soundNotes: { type: 'string' },
  },
  required: ['dialogue'],
} as const;

const clip = (value: unknown, max: number): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
};

export const inferDialogueStrategy = (
  dialogue: Pick<AudioPlanDialogueLine, 'characterId'>[],
  castById: Map<string, CastRow>,
): AudioPlanDialogueStrategy => {
  if (dialogue.length === 0) return 'overlay';
  return dialogue.every((line) => !!castById.get(line.characterId)?.reference_asset_id)
    ? 'lipsync'
    : 'overlay';
};

export const sanitizeAudioPlan = (
  raw: any,
  cast: CastRow[],
  opts: { dialogueStrategy?: AudioPlanDialogueStrategy } = {},
): AudioPlan => {
  const castById = new Map(cast.map((member) => [member.id, member]));
  const dialogueInput = Array.isArray(raw?.dialogue) ? raw.dialogue : [];
  const dialogue: AudioPlanDialogueLine[] = dialogueInput
    .map((line: any, idx: number) => {
      const characterId = clip(line?.characterId, 120);
      const text = clip(line?.text, 500);
      if (!characterId || !castById.has(characterId) || !text) return null;
      const targetSec = Number(line?.targetSec);
      return {
        id: `dlg_${uuidv4().slice(0, 8)}`,
        characterId,
        text,
        order: Number.isFinite(Number(line?.order)) ? Number(line.order) : idx + 1,
        targetSec: Number.isFinite(targetSec) && targetSec > 0 ? Math.min(targetSec, 30) : undefined,
        ttsAssetId: null,
        ttsStatus: 'pending',
      };
    })
    .filter(Boolean) as AudioPlanDialogueLine[];

  dialogue.sort((a, b) => a.order - b.order);
  dialogue.forEach((line, idx) => { line.order = idx + 1; });

  const inferredStrategy = inferDialogueStrategy(dialogue, castById);
  const dialogueStrategy = opts.dialogueStrategy === 'lipsync' && inferredStrategy !== 'lipsync'
    ? inferredStrategy
    : opts.dialogueStrategy || inferredStrategy;

  return {
    dialogueStrategy,
    dialogue,
    soundNotes: clip(raw?.soundNotes, 1000) || undefined,
  };
};
