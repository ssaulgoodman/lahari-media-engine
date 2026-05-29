import { Router } from 'express';
import { getSB, T } from '../database.js';
import { PROMPT_CATALOG, STAGE_META } from '../prompts/catalog.js';
import { TOOL_REGISTRY } from '../tools/registry.js';
import { PIPELINE_PRESETS, WORKFLOW_RECIPES } from '../presets.js';

const router = Router();

const STAGE_AI_CALL_MAP: Record<string, string[]> = {
  'transcribe-lyrics':       ['audio-analysis', 'transcribe'],
  'detect-structure':        ['audio-analysis', 'structure'],
  'summarize-meaning':       ['meaning'],
  'generate-concepts':       ['concept', 'generate-concepts'],
  'plan-scenes':             ['script', 'generate-script'],
  'brainstorm-style-directions': ['style-brainstorm', 'brainstorm-styles'],
  'visualize-style':        ['visualize-style'],
  'refine-style-direction':  ['style-refine'],
  'character-look':          ['character-look', 'generate-looks'],
  'environment-look':        ['environment-look', 'generate-environment-look'],
  'write-shot-prompts':      ['write-shot-prompts', 'shot-prompts'],
  'shot-start-frame':        ['shot-start-frame', 'generate-image'],
  'refine-shot-prompt':      ['refine-shot-prompt'],
  'refine-end-frame-prompt': ['refine-end-frame-prompt'],
  'refine-video-prompt':     ['refine-video-prompt'],
  'refine-concept':          ['refine-concept'],
  'refine-script':           ['refine-script'],
  'chained-shot-refresh':    ['chained-refresh', 'refresh-chained-prompt'],
  'shot-video-assembly':     ['generate-video', 'shot-video'],
  'describe-frame':          ['describe-frame'],
  'analyze-image-style':     ['analyze-image-style'],
};

router.get('/', async (_req, res) => {
  try {
    const allStages = Object.values(STAGE_AI_CALL_MAP).flat();
    // Fetch all matching ai_calls and aggregate in JS (Supabase REST doesn't support GROUP BY)
    const { data: rows, error } = await getSB()
      .from(T.ai_calls)
      .select('stage, duration_ms, cost_estimate, error')
      .in('stage', allStages);
    if (error) throw new Error(error.message);

    const byStage: Record<string, { call_count: number; duration_total: number; total_cost: number; error_count: number }> = {};
    for (const r of (rows || [])) {
      const s = r.stage;
      if (!byStage[s]) byStage[s] = { call_count: 0, duration_total: 0, total_cost: 0, error_count: 0 };
      byStage[s].call_count++;
      byStage[s].duration_total += r.duration_ms || 0;
      byStage[s].total_cost += r.cost_estimate || 0;
      if (r.error) byStage[s].error_count++;
    }

    const prompts = PROMPT_CATALOG.map((p) => {
      const aiStages = STAGE_AI_CALL_MAP[p.id] || [];
      let callCount = 0, durationTotal = 0, totalCost = 0, errorCount = 0;
      for (const s of aiStages) {
        const agg = byStage[s];
        if (!agg) continue;
        callCount += agg.call_count;
        durationTotal += agg.duration_total;
        totalCost += agg.total_cost;
        errorCount += agg.error_count;
      }
      return {
        ...p,
        usage: {
          callCount,
          avgDurationMs: callCount > 0 ? Math.round(durationTotal / callCount) : null,
          totalCost: Math.round(totalCost * 100) / 100,
          errorCount,
        },
      };
    });

    const tools = TOOL_REGISTRY.map((tool) => ({
      key: tool.key,
      label: tool.label,
      description: tool.description,
      enabledFor: tool.enabledFor,
      requires: tool.requires,
      contextInputs: tool.contextInputs || [],
      produces: tool.produces,
      surface: tool.surface,
      hasPromptBuilder: Boolean(tool.buildPrompt),
    }));

    const workflows = Object.values(WORKFLOW_RECIPES).map((workflow) => ({
      key: workflow.key,
      label: workflow.label,
      primarySeed: workflow.primarySeed,
      acceptedSeeds: workflow.acceptedSeeds,
      summary: workflow.summary,
      projectBriefRules: workflow.projectBriefRules,
      shotPlanRules: workflow.shotPlanRules,
    }));

    const presets = Object.values(PIPELINE_PRESETS).map((preset) => ({
      key: preset.key,
      label: preset.label,
      workflowKey: preset.workflowKey,
      sourceKind: preset.source.kind,
      sourceRules: preset.source.rules,
      conceptRules: preset.concept.rules,
      styleRules: preset.style.rules,
      styleBrainstormTaste: preset.style.brainstormTaste || '',
      characterRules: preset.looks.characterRules,
      environmentRules: preset.looks.environmentRules,
      qualityRules: preset.looks.qualityRules,
      shotPromptRules: preset.studio.shotPromptRules,
      storyboardRules: preset.studio.storyboardRules,
      audioRules: [preset.audio.dialogueRules, preset.audio.soundRules, preset.audio.strategyRules].filter(Boolean),
      defaults: preset.defaults,
    }));

    res.json({ prompts, stages: STAGE_META, tools, workflows, presets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as promptsRouter };
