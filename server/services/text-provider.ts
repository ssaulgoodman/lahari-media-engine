/**
 * Unified text-generation interface across Anthropic, OpenAI, and Google.
 *
 * Every stage in the pipeline that produces TEXT — concept writer, style
 * brainstorm, all refines, storyboard prompt writer, meaning summary,
 * style-image analysis — calls this instead of a vendor-specific SDK
 * directly. The project's `text_provider` column controls which model
 * handles every call.
 *
 * Three response patterns are unified:
 *
 *   1. Plain text                                      — leave both jsonMode and jsonSchema unset
 *   2. Loose JSON (caller parses with extractJsonObject) — set jsonMode: true
 *   3. Strict structured JSON via vendor-native schema  — set jsonSchema: { name, schema }
 *
 * Schema mode is what concept gen, style brainstorm, and their refines
 * use — each vendor has its own structured-output API and we translate:
 *
 *   Anthropic → tools[] with input_schema, force tool_use, read tool_use.input
 *   OpenAI    → response_format: { type: 'json_schema', json_schema: { ... } }
 *   Gemini    → config.responseSchema + responseMimeType: 'application/json'
 *
 * Refines fall back to each provider's cheap sibling model
 * (TextProviderSpec.refineModel) when useRefineModel is true. Concept gen,
 * style brainstorm, storyboard planner, and meaning summary all use the
 * primary runtimeModel.
 *
 * Script writer is INTENTIONALLY not routed through this module — it uses
 * Anthropic-specific extended thinking + a validation loop that doesn't
 * port cleanly to the other vendors. planScenes / refineScript /
 * writeShotPrompts continue to call Anthropic directly in claude.ts.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { getTextProvider, type TextProviderKey, type TextProviderSpec } from '../../constants/textProviders.js';

export interface TextRequest {
  /** Plain instruction + content text. Most callers stuff everything here. */
  userPrompt: string;
  /** Optional system message. Provider-specific where the prompt actually
   *  goes; Anthropic puts it in `system`, OpenAI prepends as a system role,
   *  Gemini stuffs into the first user content. */
  systemPrompt?: string;
  /** Vision inputs. Provide either `url` (public HTTPS — each provider
   *  fetches it themselves) OR inline `data` + `mimeType` (already
   *  base64-encoded — for artist uploads that haven't been persisted to
   *  storage yet). Pass an empty array or omit when text-only. */
  inputImages?: { url?: string; data?: string; mimeType?: string; label?: string }[];
  /** Hint that we want loose JSON output. OpenAI / Gemini enforce natively;
   *  Anthropic gets a prompt suffix instructing JSON-only. Caller parses.
   *  Ignored when jsonSchema is set (schema implies strict JSON). */
  jsonMode?: boolean;
  /** Strict structured output. When set, the dispatcher uses each vendor's
   *  native structured-output API and returns `parsedJson` already typed
   *  per the schema. Caller does not need to JSON.parse the text. */
  jsonSchema?: { name: string; description?: string; schema: Record<string, any> };
  /** Reasoning effort hint where supported. */
  reasoning?: 'low' | 'medium' | 'high';
  /** Max output tokens. Falls back to a sensible per-provider default. */
  maxTokens?: number;
  /** Refines use the cheap sibling per provider (refineModel) instead of
   *  the primary runtimeModel. Defaults to false. */
  useRefineModel?: boolean;
}

export interface TextResponse {
  /** Raw text output. Always populated. For jsonSchema requests this is the
   *  JSON-serialised structured result. */
  text: string;
  /** Parsed JSON, populated only when jsonSchema was set on the request. */
  parsedJson?: any;
  /** Concrete model id used (handy for logCall / telemetry). */
  model: string;
}

export const generateText = async (
  providerKey: string | undefined | null,
  req: TextRequest,
): Promise<TextResponse> => {
  const spec = getTextProvider(providerKey);
  const model = req.useRefineModel && spec.refineModel ? spec.refineModel : spec.runtimeModel;
  switch (spec.provider) {
    case 'anthropic': return runAnthropic(model, req);
    case 'openai':    return runOpenAI(model, req);
    case 'google':    return runGoogle(model, req);
    default:
      throw new Error(`Unknown text provider: ${spec.provider}`);
  }
};

// ─── Anthropic ─────────────────────────────────────────────────────────────

const runAnthropic = async (model: string, req: TextRequest): Promise<TextResponse> => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const content: Anthropic.MessageParam['content'] = [];
  for (const img of req.inputImages ?? []) {
    if (img.label) content.push({ type: 'text', text: img.label });
    if (img.url) {
      content.push({ type: 'image', source: { type: 'url', url: img.url } });
    } else if (img.data) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: (img.mimeType || 'image/png') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: img.data,
        },
      });
    }
  }

  // jsonMode (loose): suffix the user prompt with an instruction to return
  // only JSON. The caller still parses defensively. jsonSchema (strict)
  // takes precedence — when present, we use tool_use which guarantees the
  // shape and the suffix becomes redundant.
  const userText = req.jsonSchema
    ? req.userPrompt
    : req.jsonMode
      ? `${req.userPrompt}\n\nReturn ONLY valid JSON. No surrounding prose, no code fences.`
      : req.userPrompt;
  content.push({ type: 'text', text: userText });

  // Schema mode: define a single tool whose input_schema is the caller's
  // schema and force the model to use it. Tool use is Anthropic's native
  // path for guaranteed-valid structured output.
  const tools = req.jsonSchema
    ? [{
        name: req.jsonSchema.name,
        description: req.jsonSchema.description || 'Return the structured response',
        input_schema: req.jsonSchema.schema as any,
      }]
    : undefined;
  const toolChoice = req.jsonSchema
    ? { type: 'tool' as const, name: req.jsonSchema.name }
    : undefined;

  const response = await client.messages.create({
    model,
    max_tokens: req.maxTokens ?? 4096,
    ...(req.systemPrompt ? { system: req.systemPrompt } : {}),
    ...(tools ? { tools, tool_choice: toolChoice! } : {}),
    messages: [{ role: 'user', content }],
  });

  if (req.jsonSchema) {
    const toolBlock = response.content.find((b: any) => b.type === 'tool_use') as
      | Anthropic.ToolUseBlock
      | undefined;
    if (!toolBlock) throw new Error('Anthropic returned no tool_use block for jsonSchema request');
    const parsedJson = toolBlock.input;
    return { text: JSON.stringify(parsedJson), parsedJson, model };
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return { text, model };
};

// ─── OpenAI ────────────────────────────────────────────────────────────────

const runOpenAI = async (model: string, req: TextRequest): Promise<TextResponse> => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const content: any[] = [];
  if (req.systemPrompt) {
    content.push({ type: 'input_text', text: req.systemPrompt });
  }
  content.push({ type: 'input_text', text: req.userPrompt });
  for (const img of req.inputImages ?? []) {
    if (img.label) content.push({ type: 'input_text', text: img.label });
    if (img.url) {
      content.push({ type: 'input_image', image_url: img.url });
    } else if (img.data) {
      content.push({ type: 'input_image', image_url: `data:${img.mimeType || 'image/png'};base64,${img.data}` });
    }
  }

  // Output-format dispatch:
  //   jsonSchema → response_format: json_schema (non-strict — see note)
  //   jsonMode   → response_format: json_object (loose)
  //   neither    → plain text
  //
  // strict: true is intentionally OFF. OpenAI's strict mode requires every
  // object to set additionalProperties:false and every defined property to
  // be in `required` — our concept/style/refine schemas have optional
  // fields like `language` and `lyricsSummary` that don't satisfy that
  // constraint, and turning strict on without a recursive schema
  // normalizer 400s the request. Non-strict still passes the schema as a
  // guide; the existing extractJsonObject() / try-catch parse path is
  // robust to the rare cases the model drifts. If we tighten schemas
  // (all-required-with-nullable) later we can flip strict back on.
  const textOpts: Record<string, any> = {};
  if (req.jsonSchema) {
    textOpts.format = {
      type: 'json_schema',
      name: req.jsonSchema.name,
      schema: req.jsonSchema.schema,
    };
  } else if (req.jsonMode) {
    textOpts.format = { type: 'json_object' };
  }

  const response = await (client.responses.create as any)({
    model,
    input: [{ role: 'user', content }],
    ...(req.reasoning ? { reasoning: { effort: req.reasoning } } : {}),
    ...(Object.keys(textOpts).length ? { text: textOpts } : {}),
    ...(req.maxTokens ? { max_output_tokens: req.maxTokens } : {}),
  });

  const text = (response.output_text || (response.output || [])
    .filter((item: any) => item.type === 'message')
    .flatMap((item: any) => item.content || [])
    .filter((c: any) => c.type === 'output_text' && c.text)
    .map((c: any) => c.text)
    .join('\n')).trim();

  let parsedJson: any | undefined;
  if (req.jsonSchema || req.jsonMode) {
    try { parsedJson = JSON.parse(text); } catch { /* leave undefined; caller can fall back to text */ }
  }
  return { text, parsedJson, model };
};

// ─── Google (Gemini) ───────────────────────────────────────────────────────

/** Fetch an HTTPS URL and return base64 + mimeType. Gemini's vision input
 *  uses inlineData (not fileData — fileData.fileUri is for Files API
 *  uploads, not arbitrary public URLs). Matches imagen.ts's pattern. */
const fetchImageAsInline = async (url: string, fallbackMime?: string): Promise<{ mimeType: string; data: string }> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to fetch image for Gemini (${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = (res.headers.get('content-type') || fallbackMime || 'image/png').split(';')[0].trim();
  return { mimeType, data: buffer.toString('base64') };
};

const runGoogle = async (model: string, req: TextRequest): Promise<TextResponse> => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY required');
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const parts: any[] = [];
  if (req.systemPrompt) parts.push({ text: req.systemPrompt });
  parts.push({ text: req.userPrompt });
  for (const img of req.inputImages ?? []) {
    if (img.label) parts.push({ text: img.label });
    if (img.data) {
      // Caller already gave us base64 (artist upload). Use as-is.
      parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data: img.data } });
    } else if (img.url) {
      // Storage URL — fetch and inline. fileData.fileUri does NOT accept
      // arbitrary HTTPS URLs (it's for Files API upload references), so
      // we have to download + base64 here. Done in parallel-ish via the
      // outer Promise.all in image-heavy callers.
      const inline = await fetchImageAsInline(img.url, img.mimeType);
      parts.push({ inlineData: inline });
    }
  }

  // Gemini structured-output dispatch:
  //   jsonSchema → responseSchema + responseMimeType
  //   jsonMode   → responseMimeType only (model decides shape)
  //   neither    → plain text
  const config: Record<string, any> = {};
  if (req.jsonSchema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = req.jsonSchema.schema;
  } else if (req.jsonMode) {
    config.responseMimeType = 'application/json';
  }
  if (req.reasoning) {
    config.thinkingConfig = {
      thinkingBudget: req.reasoning === 'high' ? 16384 : req.reasoning === 'medium' ? 8192 : 2048,
    };
  }
  if (req.maxTokens) config.maxOutputTokens = req.maxTokens;

  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config,
  });

  const text = ((response as any).text || (response as any).candidates?.[0]?.content?.parts
    ?.filter((p: any) => p.text)
    ?.map((p: any) => p.text)
    ?.join('') || '').trim();

  let parsedJson: any | undefined;
  if (req.jsonSchema || req.jsonMode) {
    try { parsedJson = JSON.parse(text); } catch { /* leave undefined */ }
  }
  return { text, parsedJson, model };
};

// Re-export for caller convenience.
export { type TextProviderKey, type TextProviderSpec };
