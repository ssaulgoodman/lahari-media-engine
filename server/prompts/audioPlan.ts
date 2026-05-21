import type { PipelinePreset } from '../presets.js';
import { composePrompt } from './_composer.js';

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

const parseCastIds = (raw?: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const formatSourcePayload = (project: any): string => {
  if (typeof project.source_payload === 'string') return project.source_payload.slice(0, 6000);
  return JSON.stringify(project.source_payload || {}, null, 2).slice(0, 6000);
};

const formatCast = (cast: CastRow[]): string =>
  cast.map((member) => [
    `- ${member.id} | ${member.name}`,
    `hasLook=${!!member.reference_asset_id}`,
    `voice=${member.voice_provider && member.voice_id ? `${member.voice_provider}:${member.voice_name || member.voice_id}` : 'unset'}`,
    member.description || '',
  ].join(' | ')).join('\n') || '- No cast available';

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

  const coreTask = `Write production audio data for one shot.

Write dialogue lines, delivery cues, and restrained sound notes for this shot only.
This is structured production data that will drive TTS, lipsync, overlay audio, and video-generation context. It is not prose and it is not a script rewrite.`;

  const workflowContext = `This is a scripted narrative project. The script/story is the production spine; audio data should support scene beats, acting, dialogue, and continuity.`;

  const inputs = `Project title: ${project.title || 'Untitled'}

Scene label: ${scene.section_label || 'Scene'}
Scene narrative: ${scene.narrative_description || ''}
Scene source text: ${scene.lyrics || ''}

Shot ID: ${shot.id}
Shot duration: ${shot.duration || 0}s
Shot direction: ${shot.direction || ''}
Shot visual prompt: ${shot.visual_prompt || ''}

Allowed cast:
${formatCast(allowedCast)}

Raw source material:
${formatSourcePayload(project)}`;

  const presetTaste = [
    preset.source.rules,
    preset.audio?.dialogueRules,
    preset.audio?.soundRules,
    preset.audio?.strategyRules,
  ].filter(Boolean).join('\n');

  const outputContract = `Hard rules:
- Use only the listed cast IDs. Do not invent characters.
- Preserve uploaded script intent. If source material includes dialogue for this beat, extract it as close to verbatim as possible.
- Dialogue text is exactly what TTS will speak. Never include delivery labels, camera notes, speaker names, or parenthetical directions inside dialogue text.
- delivery is a short performance cue, not spoken text.
- soundNotes are restrained ambient/SFX guidance for video prompts; do not create a structured SFX list.
- If the shot has no spoken line, return an empty dialogue array and optional soundNotes.
- Keep each dialogue text under 500 characters.

Return only structured audio-plan JSON with:
- dialogue: array of { characterId, text, order, delivery?, emotion?, paceHint?, targetSec? }
- soundNotes?: string`;

  return composePrompt({ coreTask, workflowContext, inputs, presetTaste, outputContract });
};
