import { Router } from 'express';
import db from '../db.js';
import { PROMPT_CATALOG, STAGE_META } from '../prompts/catalog.js';

const router = Router();

// Stage slug → list of ai_calls.stage values that roll up into it, so we can
// aggregate usage stats without committing to one canonical string.
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

router.get('/', (_req, res) => {
  // Roll up aggregates so each prompt card can show live usage at a glance.
  const allStages = Object.values(STAGE_AI_CALL_MAP).flat();
  const rows: any[] = allStages.length
    ? db.prepare(
        `SELECT stage,
                COUNT(*) as call_count,
                AVG(duration_ms) as avg_duration_ms,
                SUM(cost_estimate) as total_cost,
                SUM(CASE WHEN error IS NOT NULL AND error <> '' THEN 1 ELSE 0 END) as error_count
         FROM ai_calls
         WHERE stage IN (${allStages.map(() => '?').join(',')})
         GROUP BY stage`
      ).all(...allStages)
    : [];
  const byStage: Record<string, any> = {};
  for (const row of rows) byStage[row.stage] = row;

  const prompts = PROMPT_CATALOG.map((p) => {
    const aiStages = STAGE_AI_CALL_MAP[p.id] || [];
    let callCount = 0;
    let durationTotal = 0;
    let durationSamples = 0;
    let totalCost = 0;
    let errorCount = 0;
    for (const s of aiStages) {
      const row = byStage[s];
      if (!row) continue;
      callCount += row.call_count || 0;
      if (row.avg_duration_ms) { durationTotal += row.avg_duration_ms * row.call_count; durationSamples += row.call_count; }
      totalCost += row.total_cost || 0;
      errorCount += row.error_count || 0;
    }
    return {
      ...p,
      usage: {
        callCount,
        avgDurationMs: durationSamples > 0 ? Math.round(durationTotal / durationSamples) : null,
        totalCost: Math.round(totalCost * 100) / 100,
        errorCount,
      },
    };
  });

  res.json({ prompts, stages: STAGE_META });
});

export { router as promptsRouter };
