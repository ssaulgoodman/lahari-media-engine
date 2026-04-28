# Floating AI Chat — Mastra + AI SDK v5 client tools

The floating AI assistant in `components/FloatingAiButton.tsx` talks to a Mastra agent via `@ai-sdk/react`'s `useChat`. The agent runs server-side; tools that can only execute in the browser (UI navigation, switching the loaded project, etc.) are **client-side tools**: the server emits the call, the client executes it, and the agent sees the result.

This doc captures the gotchas we hit while wiring this up so we don't relearn them.

## Mental model

| Side | Lives in | Implements | Has `execute`? |
|------|----------|------------|----------------|
| Server tool | `src/mastra/tools/*` (project's Mastra repo) | DB query, external API, anything not requiring the browser | ✅ Yes |
| Client tool | Same dir, but imported from `@mastra/client-js` | UI navigation, app state mutations, browser-only side effects | ❌ No |

Server tools stream their output back. The client only renders. For client tools the client runs the side effect, calls `addToolResult` so the agent can see what happened, and the chat continues.

Reference: [`mastra-ai/ui-dojo`](https://github.com/mastra-ai/ui-dojo) — `src/mastra/tools/color-change-tool.ts` + `src/pages/client-tools/ai-sdk.tsx` are the canonical example. `src/pages/ai-sdk/tool-approval.tsx` shows the human-in-the-loop pattern.

## Server: defining a client tool

```ts
// src/mastra/tools/navigate-tool.ts
import { createTool } from '@mastra/client-js';   // ← MUST be client-js, not core
import { z } from 'zod';

export const navigate = createTool({
  id: 'navigate',
  description: 'Navigate the Lahari UI to a pipeline phase.',
  inputSchema: z.object({
    phase: z.enum(['queue', 'blueprint', 'studio', 'render']),
  }),
  // No `execute`.
  // No `outputSchema` — adding one changes how Mastra streams the call
  //   in some versions; the working ui-dojo example omits it.
});

export const clientTools = { navigate, switchProject };
```

Register on the agent like any other tool:

```ts
import { clientTools } from '../tools/client-tools';
import { listProjectsTool } from '../tools/list-projects-tool';

export const laharyAgent = new Agent({
  ...,
  tools: { ...clientTools, listProjectsTool },
  // The keys (`navigate`, `switchProject`, `listProjectsTool`) become the
  // tool names the LLM sees, NOT the `id` field.
});
```

Use `chatRoute` from `@mastra/ai-sdk` — it's what knows about client tool semantics:

```ts
import { chatRoute } from '@mastra/ai-sdk';
// in apiRoutes:
chatRoute({ path: '/chat/:agentId', sendReasoning: true }),
```

## Client: handling a client tool call

`FloatingAiButton.tsx` resolves client tools via two paths, both deduped by `toolCallId`:

1. **`onToolCall`** in `useChat({ onToolCall })` — fires when the SDK recognises the tool call.
2. **Message-walker `useEffect`** (backstop) — watches the latest assistant message; when a tool part hits `state === 'input-available'` with a name in `CLIENT_TOOLS` and no output yet, it resolves the call itself.

The backstop is needed because the AI SDK doesn't always fire `onToolCall` for Mastra-streamed client tools (depending on SDK / Mastra versions, `dynamic: false` static-tool calls may not fire it). With both paths in place, `resolvedRef` ensures the handler runs at most once per `toolCallId`.

### The non-obvious bits

- **Don't `await addToolResult`.** Its returned PromiseLike sometimes never resolves while a stream is still in flight — awaiting hangs the handler and any code below it. Fire and forget; the SDK still applies the state update internally.
- **Run the side effect first, `addToolResult` last.** Because we don't await, code order = execution order. Anything that *must* happen (page navigation, project switch) goes before the `addToolResult` call so it runs unconditionally.
- **Shape of `addToolResult`:** `{ tool: name, toolCallId, output }`. The `output` should match anything the agent reasonably expects — for fire-and-forget tools we send `{ ok, message }`.
- **The tool card may stay "Running" in the UI** even after the side effect succeeds. That's a Mastra/AI-SDK rendering quirk for client tools; functionally everything works.

### Adding a new client tool — checklist

1. Define the tool in `src/mastra/tools/*` using `createTool` from `@mastra/client-js`. No `execute`. Skip `outputSchema` unless you have a specific reason. Export from `clientTools`.
2. Register on the agent's `tools` map.
3. In `FloatingAiButton.tsx`:
   - Add the tool name to the `CLIENT_TOOLS` set.
   - Add a branch in `resolveClientTool` that does the side effect synchronously (or fires-and-forgets if it returns a Promise) and sets `output`.
   - If the tool needs an external handler, add it to `FloatingAiButtonProps` (like `onNavigate` / `onSwitchProject`) and the `handlersRef`.
4. Pass the handler from the parent component (`App.tsx`).

### Common mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Imported `createTool` from `@mastra/core/tools` instead of `@mastra/client-js` | Stream emits `tool-input-available`, finishes with no `tool-output-available`, UI sits forever | Switch the import |
| Awaited `addToolResult` | Handler hangs at the await; side effect after it never fires | Don't await — fire and forget |
| Side effect placed after `addToolResult` (with await) | UI navigation/switch never happens | Move side effect first |
| Same logical tool defined both server-side and client-side (e.g. `listProjects` vs `listProjectsTool`) | Agent randomly picks one — sometimes works, sometimes hangs | Pick one; if both are needed, give them obviously distinct names + descriptions |
| Mismatched names — `id` ≠ object key on `tools: {}` | The LLM uses the object key. The `id` field is informational; the key is the wire-level name | Use the object key as your client `CLIENT_TOOLS` entry |

## Tool approval (human-in-the-loop)

The component also handles the `data-tool-call-approval` data part Mastra emits for tools that require user approval. When present, the tool card renders Approve/Decline buttons; clicking calls `sendMessage(undefined, { body: { resumeData: { approved }, runId } })`, which is Mastra's standard resume contract.

This is independent of the client-tool flow — server tools wrapped in an approval gate use this; pure client tools don't.

Reference: ui-dojo `src/pages/ai-sdk/tool-approval.tsx`.

## Markdown rendering

Assistant messages render through `components/ai-elements/response.tsx`, a thin wrapper around `Streamdown`. We can't use the `prose` Tailwind classes because Tailwind is loaded via CDN with no `@tailwindcss/typography` plugin, so the response component styles markdown with explicit child selectors (`[&_h2]:...`, `[&_ul]:...`, etc.).

If you ever switch to a real Tailwind build with the typography plugin, the `Response` component can be reduced to `prose prose-sm prose-invert`.

## File layout

| File | Role |
|------|------|
| `components/FloatingAiButton.tsx` | Floating button, panel layout, useChat config, client-tool dispatch, approval rendering |
| `components/ai-elements/conversation.tsx` | Message list + auto-scroll |
| `components/ai-elements/message.tsx` | User/assistant bubble styling |
| `components/ai-elements/prompt-input.tsx` | Composer + status-aware submit |
| `components/ai-elements/tool.tsx` | Collapsible tool-call cards with state badges |
| `components/ai-elements/response.tsx` | Streaming markdown renderer |
| `lib/utils.ts` | `cn()` helper for shadcn/ui components |
