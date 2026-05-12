#!/usr/bin/env tsx
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, Type } from '@google/genai';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { downloadToTmp, uploadFromTmp, storageUrl, saveBuffer } from '../server/storage.js';
import { generateOpenAIImageWithResponses, OpenAIRefImage } from '../server/services/openai-image.js';
import { planScenes } from '../server/services/claude.js';
import { getModelMinDuration } from '../server/services/segmind.js';
import {
  SEEDANCE_SCRIPT_TOOL,
  ScriptPromptVariant,
  StoryboardPromptVariant,
  SeedancePromptVariant,
  StoryboardRdInput,
  buildPromptPack,
  buildSeedanceScriptWriterPrompt,
  buildSeedanceStoryboardVideoPrompt,
  buildStoryboardPrompt,
} from '../server/services/seedance-storyboard-rd.js';

type Args = Record<string, string | boolean>;

const OUT_DIR = '.lahari/seedance-rd';
const SEGMIND_BASE = 'https://api.segmind.com/v1';

let readClient: SupabaseClient | null = null;
const getReadClient = (): SupabaseClient => {
  if (readClient) return readClient;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/VITE_SUPABASE_URL and key required');
  readClient = createClient(url, key);
  return readClient;
};

const tableName = (table: string): string => {
  if (table === 'projects') return 'lahari_projects';
  if (table === 'scenes') return 'lahari_scenes';
  if (table === 'shots') return 'lahari_shots';
  if (table === 'cast_members') return 'lahari_cast_members';
  if (table === 'environments') return 'lahari_environments';
  if (table === 'assets') return 'lahari_assets';
  return table;
};

const readOne = async (table: string, filters: Record<string, any>): Promise<any | null> => {
  let q = getReadClient().from(tableName(table)).select('*');
  for (const [key, value] of Object.entries(filters)) q = q.eq(key, value);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(`Read ${table}: ${error.message}`);
  return data;
};

const readAll = async (
  table: string,
  filters: Record<string, any> = {},
  opts?: { orderBy?: string; ascending?: boolean }
): Promise<any[]> => {
  let q = getReadClient().from(tableName(table)).select('*');
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) q = q.in(key, value);
    else q = q.eq(key, value);
  }
  if (opts?.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending ?? true });
  const { data, error } = await q;
  if (error) throw new Error(`Read ${table}: ${error.message}`);
  return data || [];
};

const parseArgs = (): Args => {
  const args: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
};

const requireArg = (args: Args, key: string): string => {
  const value = args[key];
  if (!value || value === true) throw new Error(`Missing --${key}`);
  return String(value);
};

const numArg = (args: Args, key: string): number | undefined => {
  const value = args[key];
  if (!value || value === true) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid --${key}: ${value}`);
  return n;
};

const parseTimestamp = (ts: string): number => {
  const parts = String(ts || '0').split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(ts) || 0;
};

const run = (cmd: string, args: string[]): Promise<void> => new Promise((resolve, reject) => {
  const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.on('error', reject);
  proc.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
  });
});

const ensureOut = (projectId: string, shotId: string): string => {
  const dir = path.join(OUT_DIR, projectId, shotId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const resolveAssetPath = async (assetId: string | null | undefined): Promise<string | undefined> => {
  if (!assetId) return undefined;
  const asset = await readOne('assets', { id: assetId });
  return asset?.file_path;
};

const loadShotContext = async (projectId: string, shotId: string, durationOverride?: number): Promise<{
  input: StoryboardRdInput;
  project: any;
  shot: any;
  scene: any;
  refs: {
    style?: string;
    cast: { name: string; path: string }[];
    environment?: { name: string; path: string };
  };
  clipStartSec: number;
  clipDuration: number;
  wholeScene?: boolean;
}> => {
  const project = await readOne('projects', { id: projectId });
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const shot = await readOne('shots', { id: shotId });
  if (!shot) throw new Error(`Shot not found: ${shotId}`);
  const scene = await readOne('scenes', { id: shot.scene_id });
  if (!scene) throw new Error(`Scene not found for shot: ${shotId}`);

  const concept = JSON.parse(project.locked_concept || '{}');
  const castIds: string[] = JSON.parse(shot.cast_ids || '[]');
  const allCast = await readAll('cast_members', { project_id: projectId }, { orderBy: 'sort_order' });
  const activeCast = allCast.filter((c: any) => castIds.includes(c.id));
  const env = shot.environment_id ? await readOne('environments', { id: shot.environment_id }) : null;

  const sceneShots = await readAll('shots', { scene_id: scene.id }, { orderBy: 'sort_order' });
  const priorDuration = sceneShots
    .filter((s: any) => Number(s.sort_order) < Number(shot.sort_order))
    .reduce((sum: number, s: any) => sum + Number(s.duration || 0), 0);

  const clipDuration = durationOverride || Number(shot.duration || 15);
  const clipStartSec = parseTimestamp(scene.start_time) + priorDuration;

  const castRefs: { name: string; path: string }[] = [];
  for (const c of activeCast) {
    const p = await resolveAssetPath(c.reference_asset_id);
    if (p) castRefs.push({ name: c.name, path: p });
  }

  const envPath = await resolveAssetPath(env?.reference_asset_id);
  const stylePath = await resolveAssetPath(project.style_asset_id);

  return {
    input: {
      title: project.title || 'Untitled Lahari project',
      concept: concept.conceptDirection || concept.theme || concept.title || 'Locked concept',
      mood: concept.mood || project.style_description || undefined,
      songType: project.song_type || undefined,
      sceneLabel: scene.section_label || 'Scene',
      sceneStart: scene.start_time || '0:00',
      sceneEnd: scene.end_time || '0:00',
      sceneNarrative: scene.narrative_description || '',
      sceneLyrics: scene.lyrics || '',
      clipDirection: shot.direction || shot.visual_prompt || '',
      clipDuration,
      castNames: activeCast.map((c: any) => c.name),
      environmentName: env?.name,
    },
    project,
    shot,
    scene,
    refs: {
      style: stylePath,
      cast: castRefs,
      environment: envPath && env ? { name: env.name, path: envPath } : undefined,
    },
    clipStartSec,
    clipDuration,
  };
};

const writeText = (filePath: string, content: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log(filePath);
};

const extractAudioSegment = async (project: any, startSec: number, durationSec: number, outDir: string): Promise<string> => {
  if (!project.audio_path) throw new Error('Project has no audio_path');
  const inputPath = await downloadToTmp(project.audio_path);
  const localOut = path.join(outDir, `audio-${Math.round(startSec)}-${durationSec}-${uuidv4().slice(0, 8)}.mp3`);
  await run('ffmpeg', [
    '-y',
    '-ss', String(Math.max(0, startSec)),
    '-t', String(durationSec),
    '-i', inputPath,
    '-vn',
    '-acodec', 'libmp3lame',
    '-b:a', '192k',
    localOut,
  ]);
  return uploadFromTmp(localOut, 'audio', 'mp3');
};

const buildStoryboardRefs = (ctx: Awaited<ReturnType<typeof loadShotContext>>): OpenAIRefImage[] => {
  const refs: OpenAIRefImage[] = [];
  if (ctx.refs.style) refs.push({ label: 'Locked style reference', imagePath: ctx.refs.style });
  for (const c of ctx.refs.cast) refs.push({ label: `Character reference: ${c.name}`, imagePath: c.path });
  if (ctx.refs.environment) refs.push({ label: `Environment reference: ${ctx.refs.environment.name}`, imagePath: ctx.refs.environment.path });
  return refs;
};

const runScriptDryRun = async (
  input: StoryboardRdInput,
  variant: ScriptPromptVariant,
): Promise<{ prompt: string; result: any; model: string }> => {
  const prompt = buildSeedanceScriptWriterPrompt(input, variant);
  const prefer = String(process.env.SEEDANCE_RD_LLM || 'openai').toLowerCase();

  const runOpenAI = async () => {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
    const model = process.env.OPENAI_SCRIPT_MODEL || 'gpt-5.2';
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await (client.responses.create as any)({
      model,
      input: [{
        role: 'user',
        content: `${prompt}

Return ONLY valid JSON matching this shape:
{
  "clips": [
    {
      "duration": 15,
      "clipDirection": "...",
      "beatCue": "...",
      "internalCuts": [{"time": "00:00-00:04", "beat": "..."}],
      "castNames": ["..."],
      "environmentName": "...",
      "rationale": "..."
    }
  ]
}`,
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'seedance_storyboard_clip_plan',
          schema: SEEDANCE_SCRIPT_TOOL.input_schema,
          strict: true,
        },
      },
    });
    const text = response.output_text || response.output?.flatMap((item: any) => item.content || []).find((c: any) => c.type === 'output_text')?.text;
    if (!text) throw new Error('OpenAI did not return text');
    return { prompt, result: JSON.parse(text), model };
  };

  const runAnthropic = async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required');
    const model = 'claude-opus-4-7';
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      tools: [SEEDANCE_SCRIPT_TOOL],
      tool_choice: { type: 'tool', name: 'plan_seedance_storyboard_clips' },
      messages: [{ role: 'user', content: prompt }],
    });
    const toolBlock = response.content.find((b: any) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') throw new Error('Claude did not return clip plan');
    return { prompt, result: toolBlock.input, model };
  };

  const runGemini = async () => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY required');
    const model = process.env.GEMINI_SCRIPT_MODEL || 'gemini-3-pro-preview';
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            clips: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  duration: { type: Type.NUMBER },
                  clipDirection: { type: Type.STRING },
                  beatCue: { type: Type.STRING },
                  internalCuts: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        time: { type: Type.STRING },
                        beat: { type: Type.STRING },
                      },
                      required: ['time', 'beat'],
                    },
                  },
                  castNames: { type: Type.ARRAY, items: { type: Type.STRING } },
                  environmentName: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: ['duration', 'clipDirection', 'beatCue', 'internalCuts', 'castNames', 'environmentName', 'rationale'],
              },
            },
          },
          required: ['clips'],
        },
      },
    });
    if (!response.text) throw new Error('Gemini did not return text');
    return { prompt, result: JSON.parse(response.text), model };
  };

  const runXai = async () => {
    const key = process.env.XAI_API_KEY
      || (fs.existsSync(path.join(process.env.HOME || '', '.config/xai/api_key'))
        ? fs.readFileSync(path.join(process.env.HOME || '', '.config/xai/api_key'), 'utf8').trim()
        : '');
    if (!key) throw new Error('XAI_API_KEY or ~/.config/xai/api_key required');
    const model = process.env.XAI_SCRIPT_MODEL || 'grok-4-1-fast';
    const res = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        input: [{
          role: 'user',
          content: `${prompt}

Return ONLY valid JSON matching this shape:
{
  "clips": [
    {
      "duration": 15,
      "clipDirection": "...",
      "beatCue": "...",
      "internalCuts": [{"time": "00:00-00:04", "beat": "..."}],
      "castNames": ["..."],
      "environmentName": "...",
      "rationale": "..."
    }
  ]
}`,
        }],
      }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`xAI ${res.status}: ${body.slice(0, 800)}`);
    const json = JSON.parse(body);
    const text = json.output?.flatMap((item: any) => item.content || [])
      .find((c: any) => c.type === 'output_text')?.text;
    if (!text) throw new Error('xAI did not return output_text');
    const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    return { prompt, result: JSON.parse(cleaned), model };
  };

  if (prefer === 'anthropic') {
    try {
      return await runAnthropic();
    } catch (err: any) {
      if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) throw err;
      console.warn(`Anthropic dry-run failed, falling back to OpenAI: ${err.message}`);
      try {
        return await runOpenAI();
      } catch (openAiErr: any) {
        if (!process.env.GEMINI_API_KEY && !process.env.XAI_API_KEY) throw openAiErr;
        console.warn(`OpenAI dry-run failed, falling back to Gemini: ${openAiErr.message}`);
        try {
          return await runGemini();
        } catch (geminiErr: any) {
          console.warn(`Gemini dry-run failed, falling back to xAI: ${geminiErr.message}`);
          return runXai();
        }
      }
    }
  }

  try {
    return await runOpenAI();
  } catch (err: any) {
    console.warn(`OpenAI dry-run failed, falling back to Gemini: ${err.message}`);
    try {
      return await runGemini();
    } catch (geminiErr: any) {
      console.warn(`Gemini dry-run failed, falling back to xAI: ${geminiErr.message}`);
      try {
        return await runXai();
      } catch (xaiErr: any) {
        if (!process.env.ANTHROPIC_API_KEY) throw xaiErr;
        console.warn(`xAI dry-run failed, falling back to Anthropic: ${xaiErr.message}`);
        return runAnthropic();
      }
    }
  }
};

const directSeedance = async (params: {
  model: 'seedance-2.0-fast' | 'seedance-2.0';
  prompt: string;
  referenceImagePaths: string[];
  referenceAudioPaths?: string[];
  duration: number;
  aspectRatio: '16:9' | '9:16';
  resolution: '480p' | '720p';
  generateAudio: boolean;
}): Promise<string> => {
  const key = process.env.SEGMIND_API_KEY;
  if (!key) throw new Error('SEGMIND_API_KEY required');

  const body = {
    prompt: params.prompt,
    duration: params.duration,
    resolution: params.resolution,
    aspect_ratio: params.aspectRatio,
    generate_audio: params.generateAudio,
    seed: Math.floor(Math.random() * 1000000),
    reference_images: params.referenceImagePaths.map(storageUrl),
    reference_audios: (params.referenceAudioPaths || []).map(storageUrl),
  };

  const res = await fetch(`${SEGMIND_BASE}/${params.model}`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(`Seedance ${res.status}: ${buffer.toString('utf8').slice(0, 800)}`);
  }
  if (buffer.length < 1000 && buffer.toString('utf8').trim().startsWith('{')) {
    throw new Error(`Seedance returned JSON instead of video: ${buffer.toString('utf8').slice(0, 800)}`);
  }
  return saveBuffer(buffer, 'videos', 'mp4');
};

const main = async () => {
  const args = parseArgs();
  const mode = String(args.mode || 'help');

  if (mode === 'help') {
    console.log(`Seedance storyboard R&D

Modes:
  full-script-dry-run --project-id ID
  script-dry-run      --project-id ID --shot-id ID [--duration 15] [--variant clip_blocks|clip_blocks_combine_short|clip_blocks_freeform|all]
  prompt-pack          --project-id ID --shot-id ID [--duration 15]
  extract-audio        --project-id ID --shot-id ID [--duration 15]
  generate-storyboard  --project-id ID --shot-id ID --variant four_panel_clean|six_panel_music_video|filmstrip_minimal_cuts [--duration 15]
  seedance-test        --project-id ID --shot-id ID --storyboard-path images/... --variant board_plus_timing|board_plus_audio_rhythm|board_plus_audio_lipsync|follow_board_only|shot_timing_only [--audio-path audio/...] [--duration 15] [--model seedance-2.0-fast] [--generate-audio]

Outputs are printed as storage keys/paths and mirrored in ${OUT_DIR}.`);
    return;
  }

  const projectId = requireArg(args, 'project-id');

  if (mode === 'full-script-dry-run') {
    const project = await readOne('projects', { id: projectId });
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const concept = JSON.parse(project.locked_concept || '{}');
    const outDir = path.join(OUT_DIR, projectId, 'full-script');
    fs.mkdirSync(outDir, { recursive: true });
    const result = await planScenes({
      concept,
      videoMode: project.video_mode || 'montage',
      lyrics: project.lyrics || '',
      meaning: project.meaning || '',
      musicalStructure: project.musical_structure || '',
      basePacing: project.target_duration || 8,
      minShotDuration: getModelMinDuration(project.video_model),
      videoModel: project.video_model || undefined,
      userNote: args['user-note'] && args['user-note'] !== true ? String(args['user-note']) : undefined,
      songType: project.song_type || undefined,
      isNarrative: project.is_narrative ?? undefined,
      isMeditative: project.is_meditative ?? undefined,
    });
    writeText(path.join(outDir, 'full-script.prompt.txt'), result.prompt);
    writeText(path.join(outDir, 'full-script.json'), JSON.stringify({
      cast: result.cast,
      environments: result.environments,
      scenes: result.scenes,
    }, null, 2));
    writeText(path.join(outDir, 'full-script.md'), `# Full Script Dry Run

Project: ${projectId}
Title: ${project.title}
Video model: ${project.video_model}
Image model: ${project.image_model}
Generated: ${new Date().toISOString()}

\`\`\`json
${JSON.stringify({ cast: result.cast, environments: result.environments, scenes: result.scenes }, null, 2)}
\`\`\`
`);
    return;
  }

  const shotId = requireArg(args, 'shot-id');
  const duration = numArg(args, 'duration');
  const ctx = await loadShotContext(projectId, shotId, duration);
  if (args['whole-scene'] === true) {
    ctx.input.clipDirection = `Plan the full "${ctx.input.sceneLabel}" scene into Seedance storyboard clips. Use the scene story and music timing as the source of truth, not the existing Lahari shot direction.`;
    ctx.input.clipDuration = Math.min(15, Math.max(4, parseTimestamp(ctx.input.sceneEnd) - parseTimestamp(ctx.input.sceneStart)));
  }
  const outDir = ensureOut(projectId, shotId);

  if (mode === 'script-dry-run') {
    const requested = String(args.variant || 'all');
    const variants: ScriptPromptVariant[] = requested === 'all'
      ? ['clip_blocks', 'clip_blocks_combine_short', 'clip_blocks_freeform']
      : [requested as ScriptPromptVariant];

    const report: string[] = [`# Seedance Script Dry Run\n\nProject: ${projectId}\nShot: ${shotId}\nGenerated: ${new Date().toISOString()}\n`];
    for (const variant of variants) {
      const { prompt, result, model } = await runScriptDryRun(ctx.input, variant);
      writeText(path.join(outDir, `script-${variant}.prompt.txt`), prompt);
      writeText(path.join(outDir, `script-${variant}.json`), JSON.stringify(result, null, 2));
      report.push(`## ${variant}\n\nModel: ${model}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
    }
    writeText(path.join(outDir, 'script-dry-run.md'), report.join('\n\n'));
    return;
  }

  if (mode === 'prompt-pack') {
    const pack = buildPromptPack(ctx.input);
    writeText(path.join(outDir, 'prompt-pack.md'), pack);
    return;
  }

  if (mode === 'extract-audio') {
    const audioPath = await extractAudioSegment(ctx.project, ctx.clipStartSec, ctx.clipDuration, outDir);
    console.log(audioPath);
    console.log(storageUrl(audioPath));
    return;
  }

  if (mode === 'generate-storyboard') {
    const variant = String(args.variant || 'four_panel_clean') as StoryboardPromptVariant;
    const prompt = buildStoryboardPrompt(ctx.input, variant);
    writeText(path.join(outDir, `storyboard-${variant}.prompt.txt`), prompt);
    const result = await generateOpenAIImageWithResponses(prompt, {
      aspectRatio: ctx.project.aspect_ratio || '16:9',
      refs: buildStoryboardRefs(ctx),
      action: 'generate',
    });
    const [storyboardPath] = result.imagePaths;
    writeText(path.join(outDir, `storyboard-${variant}.response.json`), JSON.stringify({
      responseId: result.responseId,
      imageGenerationCallIds: result.imageGenerationCallIds,
      reasoningModel: result.reasoningModel,
      imageModel: result.imageModel,
      storyboardPath,
    }, null, 2));
    console.log(storyboardPath);
    console.log(storageUrl(storyboardPath));
    return;
  }

  if (mode === 'seedance-test') {
    const storyboardPath = requireArg(args, 'storyboard-path');
    const variant = String(args.variant || 'board_plus_timing') as SeedancePromptVariant;
    const prompt = buildSeedanceStoryboardVideoPrompt(ctx.input, variant);
    writeText(path.join(outDir, `seedance-${variant}.prompt.txt`), prompt);

    const refs = [storyboardPath];
    if (ctx.refs.style) refs.push(ctx.refs.style);
    for (const c of ctx.refs.cast) refs.push(c.path);
    if (ctx.refs.environment) refs.push(ctx.refs.environment.path);

    const audioPath = args['audio-path'] && args['audio-path'] !== true
      ? String(args['audio-path'])
      : undefined;

    const videoPath = await directSeedance({
      model: (String(args.model || 'seedance-2.0-fast') as 'seedance-2.0-fast' | 'seedance-2.0'),
      prompt,
      referenceImagePaths: refs.slice(0, 9),
      referenceAudioPaths: audioPath ? [audioPath] : undefined,
      duration: ctx.clipDuration,
      aspectRatio: ctx.project.aspect_ratio === '9:16' ? '9:16' : '16:9',
      resolution: String(args.resolution || '720p') === '480p' ? '480p' : '720p',
      generateAudio: args['generate-audio'] === true,
    });
    console.log(videoPath);
    console.log(storageUrl(videoPath));
    return;
  }

  throw new Error(`Unknown --mode ${mode}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
