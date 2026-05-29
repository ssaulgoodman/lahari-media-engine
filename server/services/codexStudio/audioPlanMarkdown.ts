import { audioPlanHash, shotLabel, type Project } from './core.js';
import type { AudioPlan, AudioPlanApplyInput } from './audioPlan.js';
import { applyError, type ApplyError } from './applies/helpers.js';

export const buildAudioPlanMarkdownDraft = (project: Project): string => {
  const sections = project.scenes.flatMap((scene, sceneIndex) => scene.shots.map((shot, shotIndex) => {
    const audioPlan: AudioPlan = shot.audioPlan || {
      dialogueStrategy: 'overlay',
      dialogue: [],
      soundNotes: '',
    };
    return `## ${shotLabel(sceneIndex, shotIndex)}: ${(shot.direction || 'Shot').replace(/\n/g, ' ').slice(0, 120)}
<!-- shot_id: ${shot.id} -->
<!-- base_hash: ${audioPlanHash(shot)} -->

\`\`\`json
${JSON.stringify(audioPlan, null, 2)}
\`\`\`
`;
  })).join('\n');

  return `# Audio Plan Draft

Project ID: ${project.id}
Project: ${project.title}

Edit the JSON block for each shot, then apply with run_action(apply_audio_plan) using this markdown. Preserve shot_id and base_hash comments unless you intentionally pass force: true after reviewing drift.

${sections || 'No shots saved.'}
`;
};

export const parseAudioPlanMarkdownDraft = (markdown: string): { projectId?: string; shots: AudioPlanApplyInput[] } | ApplyError => {
  const projectId = markdown.match(/^Project ID:\s*(.+)$/m)?.[1]?.trim();
  const sections = markdown.split(/^##\s+/m).slice(1);
  const shots: AudioPlanApplyInput[] = [];
  for (const section of sections) {
    const shotId = section.match(/<!--\s*shot_id:\s*([^>]+?)\s*-->/)?.[1]?.trim();
    const baseHash = section.match(/<!--\s*base_hash:\s*([^>]+?)\s*-->/)?.[1]?.trim();
    const jsonBlock = section.match(/```json\s*([\s\S]*?)```/)?.[1]?.trim();
    if (!shotId) return applyError('validation_failed', 'Audio plan section is missing shot_id comment.', { field: 'shot_id' });
    if (!jsonBlock) return applyError('validation_failed', `Audio plan section for shot ${shotId} is missing a json block.`, { shotId, field: 'audioPlan' });
    try {
      shots.push({
        shotId,
        baseHash,
        audioPlan: JSON.parse(jsonBlock),
      });
    } catch (error) {
      return applyError('validation_failed', `Audio plan JSON failed to parse for shot ${shotId}: ${error instanceof Error ? error.message : String(error)}`, { shotId, field: 'audioPlan' });
    }
  }
  return { projectId, shots };
};
