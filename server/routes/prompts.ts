import { Router } from 'express';
import { getSB, T } from '../database.js';
import { PROMPT_CATALOG, STAGE_META } from '../prompts/catalog.js';

const router = Router();

const STAGE_AI_CALL_MAP: Record<string, string[]> = {
  'transcribe-lyrics':       ['audio-analysis', 'transcribe'],
  'detect-structure':        ['audio-analysis', 'structure'],
  'summarize-meaning':       ['meaning'],
  'generate-concepts':       ['concept', 'generate-concepts'],
  'plan-scenes':             ['script', 'generate-script'],
  'brainstorm-style-directions': ['style-brainstorm', 'brainstorm-styles'],
  'refine-style-direction':  ['style-refine'],
  'enrich-style-dna':        ['style-enrich', 'analyze-style-image'],
  'character-look':          ['character-look', 'generate-looks'],
  'environment-look':        ['environment-look', 'generate-environment-look'],
  'write-shot-prompts':      ['write-shot-prompts', 'shot-prompts'],
  'shot-start-frame':        ['shot-start-frame', 'generate-image'],
  'refine-shot-prompt':      ['refine-shot-prompt'],
  'chained-shot-refresh':    ['chained-refresh', 'refresh-chained-prompt'],
  'shot-video-assembly':     ['generate-video', 'shot-video'],
  'critique-shot-image':     ['critique'],
  'describe-frame':          ['describe-frame'],
  'analyze-image-style':     ['analyze-image-style'],
  'chat-with-director':      ['chat'],
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

    res.json({ prompts, stages: STAGE_META });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as promptsRouter };
