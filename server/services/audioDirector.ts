import { v4 as uuidv4 } from 'uuid';
import type { PipelinePreset } from '../presets.js';

export type AudioPlanDialogueStrategy = 'lipsync' | 'overlay';
export type AudioPlanDialogueLine = {
  id: string;
  characterId: string;
  text: string;
  delivery?: string;
  emotion?: string;
  order: number;
  paceHint?: 'slow' | 'natural' | 'fast';
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

type SceneRow = {
  id: string;
  section_label?: string | null;
  lyrics?: string | null;
  narrative_description?: string | null;
};

type ShotRow = {
  id: string;
  direction?: string | null;
  visual_prompt?: string | null;
  duration?: number | null;
  cast_ids?: string | null;
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
          delivery: { type: 'string' },
          emotion: { type: 'string' },
          order: { type: 'number' },
          paceHint: { type: 'string', enum: ['slow', 'natural', 'fast'] },
          targetSec: { type: 'number' },
        },
        required: ['characterId', 'text', 'order'],
      },
    },
    soundNotes: { type: 'string' },
  },
  required: ['dialogue'],
} as const;

const parseCastIds = (raw?: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const clip = (value: unknown, max: number): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
};

const normalizePace = (value: unknown): 'slow' | 'natural' | 'fast' => {
  if (value === 'slow' || value === 'fast') return value;
  return 'natural';
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
        delivery: clip(line?.delivery, 200) || undefined,
        emotion: clip(line?.emotion, 100) || undefined,
        order: Number.isFinite(Number(line?.order)) ? Number(line.order) : idx + 1,
        paceHint: normalizePace(line?.paceHint),
        targetSec: Number.isFinite(targetSec) && targetSec > 0 ? Math.min(targetSec, 30) : undefined,
        ttsAssetId: null,
        ttsStatus: 'pending',
      };
    })
    .filter(Boolean) as AudioPlanDialogueLine[];

  dialogue.sort((a, b) => a.order - b.order);
  dialogue.forEach((line, idx) => { line.order = idx + 1; });

  return {
    dialogueStrategy: inferDialogueStrategy(dialogue, castById),
    dialogue,
    soundNotes: clip(raw?.soundNotes, 1000) || undefined,
  };
};

export const buildAudioPlanPrompt = (
  project: any,
  scene: SceneRow,
  shot: ShotRow,
  cast: CastRow[],
  preset: PipelinePreset,
): string => {
  const shotCastIds = parseCastIds(shot.cast_ids);
  const shotCast = cast.filter((member) => shotCastIds.includes(member.id));
  const allowedCast = shotCast.length > 0 ? shotCast : cast;
  const sourcePayload = typeof project.source_payload === 'string'
    ? project.source_payload
    : JSON.stringify(project.source_payload || {}, null, 2);

  return `You are the audio director for ${preset.label}.

Write the per-shot audio plan for ONE shot. This is production data, not prose.

Hard rules:
- Use only the listed cast IDs. Do not invent characters.
- Preserve uploaded script intent. If source payload includes dialogue for this beat, extract it as close to verbatim as possible.
- Dialogue text is what TTS will speak. Never include delivery labels, camera notes, speaker names, or parenthetical directions inside dialogue text.
- delivery is a short performance cue, not spoken text.
- soundNotes are restrained ambient/SFX guidance for video prompts; do not create a structured SFX list.
- If the shot has no spoken line, return an empty dialogue array and optional soundNotes.
- Keep each dialogue text under 500 characters.

Project:
Title: ${project.title || 'Untitled'}
Workflow: ${project.workflow_key || preset.workflowKey}
Preset rules: ${preset.source.rules}
Dialogue rules: ${preset.audio?.dialogueRules || ''}
Sound rules: ${preset.audio?.soundRules || ''}
Strategy rules: ${preset.audio?.strategyRules || ''}

Scene:
Label: ${scene.section_label || 'Scene'}
Narrative: ${scene.narrative_description || ''}
Lyrics/source text: ${scene.lyrics || ''}

Shot:
ID: ${shot.id}
Duration: ${shot.duration || 0}s
Direction: ${shot.direction || ''}
Visual prompt: ${shot.visual_prompt || ''}

Allowed cast:
${allowedCast.map((member) => `- ${member.id} | ${member.name} | hasLook=${!!member.reference_asset_id} | voice=${member.voice_provider && member.voice_id ? `${member.voice_provider}:${member.voice_name || member.voice_id}` : 'unset'} | ${member.description || ''}`).join('\n') || '- No cast available'}

Source payload:
${sourcePayload.slice(0, 6000)}

Return only the structured audio plan JSON.`;
};
