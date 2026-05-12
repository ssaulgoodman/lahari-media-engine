/**
 * Unified text-generation interface across Anthropic, OpenAI, and Google.
 *
 * Each stage in the pipeline that produces TEXT — concept writer, style
 * brainstorm, script writer, storyboard prompt writer — calls this instead
 * of a vendor-specific SDK directly. The project's `text_provider` column
 * controls which model handles the call.
 *
 * Design choices:
 *
 * - Vendor SDKs already exist and work; we don't replace them. This module
 *   is a thin dispatcher that picks the right SDK per request and surfaces
 *   one consistent response shape.
 *
 * - JSON output is the dominant pattern (every consumer returns structured
 *   data today). We expose a `jsonMode` flag that providers honor natively
 *   when they can (OpenAI Responses, Gemini responseMimeType); for Anthropic
 *   we lean on prompt engineering — the caller still needs to parse with
 *   their existing extractJsonObject() helper.
 *
 * - Vision inputs are passed as HTTP URLs (storage paths resolved by callers
 *   to public storageUrl). Each provider downloads/encodes its own way.
 *
 * - No tool-use abstraction. The existing tool-use callers (concept gen,
 *   style brainstorm, planScenes) continue to use the Anthropic SDK directly
 *   in claude.ts — the dispatcher path is only used by consumers that don't
 *   need tools. We can fold tool-using consumers in later if useful, but
 *   forcing the abstraction now would be premature.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { getTextProvider, type TextProviderKey } from '../../constants/textProviders.js';

export interface TextRequest {
  /** Plain instruction + content text. Most callers stuff everything here. */
  userPrompt: string;
  /** Optional system message. Provider-specific where the prompt actually
   *  goes; Anthropic puts it in `system`, OpenAI prepends as a system role,
   *  Gemini stuffs into the first user content. */
  systemPrompt?: string;
  /** Vision inputs as resolved public HTTP URLs. Each provider fetches and
   *  encodes per its SDK. Pass an empty array or omit when text-only. */
  inputImages?: { url: string; label?: string }[];
  /** Hint that we want strict JSON output. OpenAI and Gemini enforce
   *  natively; Anthropic gets a prompt suffix instructing JSON-only. */
  jsonMode?: boolean;
  /** Reasoning effort hint where supported (OpenAI Responses, Gemini
   *  thinkingConfig). Anthropic supports extended thinking but we don't
   *  pipe it through here — concept/script callers that need it use the
   *  Anthropic SDK directly. */
  reasoning?: 'low' | 'medium' | 'high';
  /** Max output tokens. Falls back to a sensible per-provider default. */
  maxTokens?: number;
}

export interface TextResponse {
  /** Raw text output. Caller parses JSON if it asked for jsonMode. */
  text: string;
  /** Concrete model id used (handy for logCall / telemetry). */
  model: string;
}

export const generateText = async (
  providerKey: string | undefined | null,
  req: TextRequest,
): Promise<TextResponse> => {
  const spec = getTextProvider(providerKey);
  switch (spec.provider) {
    case 'anthropic': return runAnthropic(spec.runtimeModel, req);
    case 'openai':    return runOpenAI(spec.runtimeModel, req);
    case 'google':    return runGoogle(spec.runtimeModel, req);
    default:
      throw new Error(`Unknown text provider: ${spec.provider}`);
  }
};

// ─── Anthropic ─────────────────────────────────────────────────────────────

const runAnthropic = async (model: string, req: TextRequest): Promise<TextResponse> => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // JSON mode: Anthropic has no native JSON-only flag. Append the standard
  // "Return only valid JSON" instruction so the model knows the response
  // should parse cleanly. Caller still uses extractJsonObject() in case the
  // model wraps in code fences or adds explanatory text.
  const userText = req.jsonMode
    ? `${req.userPrompt}\n\nReturn ONLY valid JSON. No surrounding prose, no code fences.`
    : req.userPrompt;

  const content: Anthropic.MessageParam['content'] = [];
  for (const img of req.inputImages ?? []) {
    // Anthropic accepts image URLs directly via type:'image' source url.
    if (img.label) content.push({ type: 'text', text: img.label });
    content.push({ type: 'image', source: { type: 'url', url: img.url } });
  }
  content.push({ type: 'text', text: userText });

  const response = await client.messages.create({
    model,
    max_tokens: req.maxTokens ?? 4096,
    ...(req.systemPrompt ? { system: req.systemPrompt } : {}),
    messages: [{ role: 'user', content }],
  });

  // Concatenate text blocks (Anthropic returns content as an array of typed
  // blocks; we want the plain text union).
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
    // Responses API doesn't have a separate system role; we prepend.
    content.push({ type: 'input_text', text: req.systemPrompt });
  }
  content.push({ type: 'input_text', text: req.userPrompt });
  for (const img of req.inputImages ?? []) {
    if (img.label) content.push({ type: 'input_text', text: img.label });
    content.push({ type: 'input_image', image_url: img.url });
  }

  const response = await (client.responses.create as any)({
    model,
    input: [{ role: 'user', content }],
    ...(req.reasoning ? { reasoning: { effort: req.reasoning } } : {}),
    ...(req.jsonMode ? { text: { format: { type: 'json_object' } } } : {}),
    ...(req.maxTokens ? { max_output_tokens: req.maxTokens } : {}),
  });

  const text = (response.output_text || (response.output || [])
    .filter((item: any) => item.type === 'message')
    .flatMap((item: any) => item.content || [])
    .filter((c: any) => c.type === 'output_text' && c.text)
    .map((c: any) => c.text)
    .join('\n')).trim();

  return { text, model };
};

// ─── Google (Gemini) ───────────────────────────────────────────────────────

const runGoogle = async (model: string, req: TextRequest): Promise<TextResponse> => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY required');
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const parts: any[] = [];
  if (req.systemPrompt) parts.push({ text: req.systemPrompt });
  parts.push({ text: req.userPrompt });
  for (const img of req.inputImages ?? []) {
    if (img.label) parts.push({ text: img.label });
    // Gemini accepts URLs directly via fileData for public HTTPS URLs.
    // This keeps us from having to download + base64 every image on each
    // request — for storyboard refs that's a real cost saving.
    parts.push({ fileData: { mimeType: 'image/png', fileUri: img.url } });
  }

  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      ...(req.jsonMode ? { responseMimeType: 'application/json' } : {}),
      ...(req.reasoning ? { thinkingConfig: { thinkingBudget: req.reasoning === 'high' ? 16384 : req.reasoning === 'medium' ? 8192 : 2048 } } : {}),
      ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
    },
  });

  const text = ((response as any).text || (response as any).candidates?.[0]?.content?.parts
    ?.filter((p: any) => p.text)
    ?.map((p: any) => p.text)
    ?.join('') || '').trim();

  return { text, model };
};

// Re-export for caller convenience so they don't have to import from constants.
export { type TextProviderKey };
