import {
  compactText,
  deriveDirectorDiagnosis,
  shotLabel,
  statusCounts,
  webStudioUrl,
  type Project,
} from './core.js';
import { planGenerateStoryboard, planGenerateVideo } from './storyboardOps.js';

export const buildProjectActionList = (project: Project) => {
  const diagnosis = deriveDirectorDiagnosis(project);
  const actions: any[] = [];

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      const label = shotLabel(sceneIndex, shotIndex);
      const beat = compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 180);

      if (shot.storyboardPrompt && (!shot.storyboardUrl || shot.storyboardStatus === 'stale' || shot.storyboardStatus === 'error')) {
        const plan = planGenerateStoryboard(project, shot.id);
        actions.push({
          id: `generate-storyboard:${shot.id}`,
          label: `Generate storyboard board for ${label}`,
          kind: 'generate_storyboard',
          shot: { id: shot.id, label, beat },
          canRun: plan.canRun,
          paid: plan.paid,
          estimatedCost: plan.estimatedCost,
          prerequisites: plan.prerequisites,
          webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-storyboard' }),
          cli: `npm run lahari -- apply generate-storyboard ${project.id} ${shot.id}`,
          mcpTool: 'apply_generate_storyboard',
          plan,
        });
      }

      if (shot.storyboardUrl && !shot.storyboardLocked) {
        actions.push({
          id: `review-storyboard:${shot.id}`,
          label: `Review and lock storyboard board for ${label}`,
          kind: 'review_storyboard',
          shot: { id: shot.id, label, beat },
          canRun: true,
          paid: false,
          webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-storyboard' }),
          prerequisites: [],
          cli: `npm run lahari -- apply lock-storyboard ${project.id} ${shot.id}`,
          mcpTool: 'lock_storyboard',
        });
      }

      if ((!shot.videoUrl || shot.videoStatus === 'stale' || shot.videoStatus === 'error') && !shot.locked) {
        const plan = planGenerateVideo(project, shot.id);
        if (plan.canRun) {
          actions.push({
            id: `generate-video:${shot.id}`,
            label: `Generate video for ${label}`,
            kind: 'generate_video',
            shot: { id: shot.id, label, beat },
            canRun: plan.canRun,
            paid: plan.paid,
            estimatedCost: plan.estimatedCost,
            prerequisites: plan.prerequisites,
            webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-video' }),
            cli: `npm run lahari -- apply generate-video ${project.id} ${shot.id}`,
            mcpTool: 'apply_generate_video',
            plan,
          });
        }
      }

      if (shot.videoUrl && !shot.locked) {
        actions.push({
          id: `review-video:${shot.id}`,
          label: `Review and lock video for ${label}`,
          kind: 'review_video',
          shot: { id: shot.id, label, beat },
          canRun: false,
          paid: false,
          webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-video' }),
          prerequisites: ['No native lock-shot apply tool yet; use the Lahari web studio review control.'],
        });
      }
    }
  }

  return {
    kind: 'lahari.project.actions',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
    },
    diagnosis,
    actions: actions.slice(0, 20),
  };
};

export const buildStoryboardPromptReview = (project: Project) => {
  const items: any[] = [];
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      const promptLength = (shot.storyboardPrompt || '').length;
      const cutPlanLength = (shot.storyboardCutPlan || '').length;
      const issues = [
        !shot.storyboardPrompt ? 'missing storyboard prompt' : null,
        !shot.storyboardCutPlan ? 'missing cut plan' : null,
        shot.promptsStale ? 'prompt stale' : null,
        shot.storyboardPromptStatus === 'error' ? 'prompt writer error' : null,
        shot.storyboardStatus === 'error' ? 'board generation error' : null,
        promptLength > 5000 ? 'prompt likely too long for reliable image following' : null,
        shot.storyboardUrl && !shot.storyboardLocked ? 'board needs review/lock before video' : null,
        project.videoModel?.startsWith('seedance') && !shot.storyboardLocked && !shot.imageUrl ? 'video blocked until board is locked or start frame exists' : null,
      ].filter(Boolean);
      if (!issues.length) continue;
      const boardNeedsGeneration = !shot.storyboardUrl || shot.storyboardStatus === 'stale' || shot.storyboardStatus === 'error';
      const plan = shot.storyboardPrompt && boardNeedsGeneration
        ? planGenerateStoryboard(project, shot.id)
        : null;
      items.push({
        shot: {
          id: shot.id,
          label: shotLabel(sceneIndex, shotIndex),
          scene: scene.sectionLabel,
          beat: compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 220),
          duration: shot.duration,
        },
        issues,
        stats: {
          storyboardPromptChars: promptLength,
          cutPlanChars: cutPlanLength,
          hasBoard: !!shot.storyboardUrl,
          boardLocked: !!shot.storyboardLocked,
          hasVideo: !!shot.videoUrl,
          videoLocked: !!shot.locked,
        },
        nextNativeAction: plan?.canRun ? {
          kind: 'generate_storyboard',
          cli: `npm run lahari -- apply generate-storyboard ${project.id} ${shot.id}`,
          webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-storyboard' }),
          estimatedCost: plan.estimatedCost,
        } : null,
        webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-storyboard-prompt' }),
        rewriteCommand: `npm run lahari -- preview rewrite-storyboard-prompt ${project.id} ${shot.id}`,
      });
    }
  }

  return {
    kind: 'lahari.storyboard_prompt.review',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      storyboardProvider: project.storyboardProvider,
      videoModel: project.videoModel,
    },
    summary: {
      totalIssues: items.reduce((sum, item) => sum + item.issues.length, 0),
      shotsWithIssues: items.length,
    },
    items,
  };
};
