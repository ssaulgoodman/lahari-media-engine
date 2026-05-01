import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  isToolUIPart,
  getToolName,
  type UIMessage,
} from 'ai';
import { CheckCircle2, ShieldAlert, XCircle, Sparkles, X } from 'lucide-react';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Response } from '@/components/ai-elements/response';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { Button } from '@/components/ui/button';

const THREAD_KEY = 'lahari.aiChat.threadId';
const RESOURCE_KEY = 'lahari.aiChat.resourceId';

const getOrCreate = (key: string) => {
  let v = localStorage.getItem(key);
  if (!v) {
    v = (crypto as any).randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(36).slice(2);
    localStorage.setItem(key, v);
  }
  return v;
};

type Phase = 'queue' | 'blueprint' | 'studio' | 'render';

export type ActiveProjectSnapshot = {
  id: string;
  title: string;
  status: string;
  lockedConceptIndex: number | null;
  hasConceptOptions: boolean;
};

export type ToolResult<T = Record<string, unknown>> = { ok: boolean; message: string } & T;

export interface FloatingAiButtonProps {
  onNavigate?: (phase: Phase) => { ok: boolean; message: string };
  onSwitchProject?: (idOrTitle: string) => Promise<{ ok: boolean; message: string }>;
  listProjects?: () => { id: string; title: string }[];
  // Phase 0 — foundation
  onRefreshProject?: () => Promise<ToolResult>;
  onGetActiveProject?: () => ActiveProjectSnapshot | null;
  // Phase 1a — concept
  onGenerateConcepts?: (opts: { userNote?: string; directorBrief?: string }) => Promise<ToolResult<{ concepts?: unknown[] }>>;
  onLockConcept?: (args: { conceptIndex: number; fork?: boolean }) => Promise<ToolResult>;
  onRefineConcept?: (args: { feedback: string }) => Promise<ToolResult>;
  onUnlockConcept?: () => Promise<ToolResult>;
  // Phase 1b — script
  onGenerateScript?: (args: { userNote?: string; fork?: boolean }) => Promise<ToolResult<{ sceneCount?: number; shotCount?: number }>>;
  onRefineScript?: (args: { feedback: string }) => Promise<ToolResult>;
  onSplitShot?: (args: { shotId: string; splitAt?: number }) => Promise<ToolResult<{ newShotId?: string }>>;
}

type ToolCallApprovalData = {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

function isApprovalPart(part: UIMessage['parts'][number]): part is {
  type: 'data-tool-call-approval';
  id: string;
  data: ToolCallApprovalData;
} {
  return part.type === 'data-tool-call-approval' && 'data' in (part as any);
}

function getApprovalForToolCall(
  parts: UIMessage['parts'],
  toolCallId: string
): ToolCallApprovalData | undefined {
  const part = parts.find((p) => isApprovalPart(p) && p.data.toolCallId === toolCallId);
  return part && isApprovalPart(part) ? part.data : undefined;
}

export const FloatingAiButton: React.FC<FloatingAiButtonProps> = ({
  onNavigate,
  onSwitchProject,
  listProjects,
  onRefreshProject,
  onGetActiveProject,
  onGenerateConcepts,
  onLockConcept,
  onRefineConcept,
  onUnlockConcept,
  onGenerateScript,
  onRefineScript,
  onSplitShot,
}) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');

  const { threadId, resourceId } = useMemo(
    () => ({ threadId: getOrCreate(THREAD_KEY), resourceId: getOrCreate(RESOURCE_KEY) }),
    []
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: 'http://localhost:3000/chat',
        prepareSendMessagesRequest({ messages, body }) {
          const last = messages[messages.length - 1];
          const isToolContinuation =
            last?.role === 'assistant' &&
            Array.isArray(last.parts) &&
            last.parts.some(
              (p: any) => typeof p?.type === 'string' && p.type.startsWith('tool-')
            );
          const out = isToolContinuation ? messages.slice(-2) : last ? [last] : [];
          return {
            body: {
              messages: out,
              memory: { thread: threadId, resource: resourceId },
              ...(body ?? {}),
            },
          };
        },
      }),
    [threadId, resourceId]
  );

  const handlersRef = useRef({
    onNavigate,
    onSwitchProject,
    onRefreshProject,
    onGetActiveProject,
    onGenerateConcepts,
    onLockConcept,
    onRefineConcept,
    onUnlockConcept,
    onGenerateScript,
    onRefineScript,
    onSplitShot,
  });
  useEffect(() => {
    handlersRef.current = {
      onNavigate,
      onSwitchProject,
      onRefreshProject,
      onGetActiveProject,
      onGenerateConcepts,
      onLockConcept,
      onRefineConcept,
      onUnlockConcept,
      onGenerateScript,
      onRefineScript,
      onSplitShot,
    };
  });

  const CLIENT_TOOLS = useMemo(
    () =>
      new Set([
        'navigate',
        'switchProject',
        'refreshProject',
        'getActiveProject',
        'generateConcepts',
        'lockConcept',
        'refineConcept',
        'unlockConcept',
        'generateScript',
        'refineScript',
        'splitShot',
      ]),
    []
  );

  const resolvedRef = useRef<Set<string>>(new Set());

  const resolveClientTool = useCallback(
    async (
      name: string,
      toolCallId: string,
      toolInput: any,
      addToolResult: (args: { tool: string; toolCallId: string; output: any }) => void | PromiseLike<void>
    ) => {
      if (resolvedRef.current.has(toolCallId)) return;
      resolvedRef.current.add(toolCallId);

      const h = handlersRef.current;
      let output: ToolResult = { ok: true, message: 'done' };

      try {
        if (name === 'navigate') {
          const phase = String(toolInput?.phase ?? '').toLowerCase() as Phase;
          output = h.onNavigate?.(phase) ?? { ok: false, message: 'navigate handler not wired' };
        } else if (name === 'switchProject') {
          const ref = String(toolInput?.idOrTitle ?? toolInput?.id ?? toolInput?.title ?? '');
          output = { ok: true, message: `switching to "${ref}"…` };
          // Fire-and-forget side effect — don't block on it.
          h.onSwitchProject?.(ref).catch((e) =>
            console.warn('[FloatingAi] onSwitchProject error', e)
          );
        } else if (name === 'getActiveProject') {
          const snap = h.onGetActiveProject?.() ?? null;
          output = snap
            ? { ok: true, message: `active project: ${snap.title}`, ...snap }
            : { ok: false, message: 'no project loaded' };
        } else if (name === 'refreshProject') {
          output = (await h.onRefreshProject?.()) ?? { ok: false, message: 'refreshProject not wired' };
        } else if (name === 'generateConcepts') {
          output = (await h.onGenerateConcepts?.({
            userNote: toolInput?.userNote,
            directorBrief: toolInput?.directorBrief,
          })) ?? { ok: false, message: 'generateConcepts not wired' };
        } else if (name === 'lockConcept') {
          const conceptIndex = Number(toolInput?.conceptIndex);
          if (!Number.isInteger(conceptIndex) || conceptIndex < 0 || conceptIndex > 2) {
            output = { ok: false, message: 'conceptIndex must be 0, 1, or 2' };
          } else {
            output = (await h.onLockConcept?.({ conceptIndex, fork: !!toolInput?.fork })) ?? {
              ok: false,
              message: 'lockConcept not wired',
            };
          }
        } else if (name === 'refineConcept') {
          const feedback = String(toolInput?.feedback ?? '').trim();
          if (!feedback) {
            output = { ok: false, message: 'feedback is required' };
          } else {
            output = (await h.onRefineConcept?.({ feedback })) ?? { ok: false, message: 'refineConcept not wired' };
          }
        } else if (name === 'unlockConcept') {
          output = (await h.onUnlockConcept?.()) ?? { ok: false, message: 'unlockConcept not wired' };
        } else if (name === 'generateScript') {
          output = (await h.onGenerateScript?.({
            userNote: toolInput?.userNote,
            fork: !!toolInput?.fork,
          })) ?? { ok: false, message: 'generateScript not wired' };
        } else if (name === 'refineScript') {
          const feedback = String(toolInput?.feedback ?? '').trim();
          if (!feedback) {
            output = { ok: false, message: 'feedback is required' };
          } else {
            output = (await h.onRefineScript?.({ feedback })) ?? { ok: false, message: 'refineScript not wired' };
          }
        } else if (name === 'splitShot') {
          const shotId = String(toolInput?.shotId ?? '').trim();
          if (!shotId) {
            output = { ok: false, message: 'shotId is required' };
          } else {
            const splitAt = typeof toolInput?.splitAt === 'number' ? toolInput.splitAt : undefined;
            output = (await h.onSplitShot?.({ shotId, splitAt })) ?? { ok: false, message: 'splitShot not wired' };
          }
        }
      } catch (err: any) {
        console.error('[FloatingAi] resolveClientTool threw', err);
        output = { ok: false, message: err?.message ?? String(err) };
      }

      // Fire-and-forget — awaiting addToolResult hangs the handler while the
      // stream is in flight. The SDK still applies the state update.
      // See docs/floating-ai-chat.md.
      try {
        void addToolResult({ tool: name, toolCallId, output });
      } catch (err) {
        console.error('[FloatingAi] addToolResult threw', err);
      }
    },
    []
  );

  const { messages, sendMessage, addToolResult, status } = useChat({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport,
    onToolCall: async ({ toolCall }) => {
      const name = toolCall.toolName;
      if (!CLIENT_TOOLS.has(name)) return;
      await resolveClientTool(name, toolCall.toolCallId, toolCall.input, (args) => addToolResult(args));
    },
  });

  // Backstop: walks messages and resolves any client-tool call where state
  // reaches input-available but no output-available follows. resolvedRef
  // (declared above) dedupes across onToolCall + this effect.
  const addToolResultRef = useRef(addToolResult);
  const resolveClientToolRef = useRef(resolveClientTool);
  const clientToolsRef = useRef(CLIENT_TOOLS);
  useEffect(() => {
    addToolResultRef.current = addToolResult;
    resolveClientToolRef.current = resolveClientTool;
    clientToolsRef.current = CLIENT_TOOLS;
  });
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.parts)) return;
    for (const part of last.parts) {
      if (!isToolUIPart(part)) continue;
      if (part.state !== 'input-available') continue;
      const name = getToolName(part);
      if (!clientToolsRef.current.has(name)) continue;
      if (resolvedRef.current.has(part.toolCallId)) continue;
      void resolveClientToolRef.current(
        name,
        part.toolCallId,
        (part as any).input,
        addToolResultRef.current
      );
    }
  }, [messages]);

  const isLoading = status === 'streaming' || status === 'submitted';

  const handleApproval = useCallback(
    async (data: ToolCallApprovalData, approved: boolean) => {
      await sendMessage(undefined, {
        body: {
          resumeData: { approved },
          runId: data.runId,
        },
      });
    },
    [sendMessage]
  );

  const handleSubmit = (message: PromptInputMessage) => {
    const text = (message.text ?? '').trim();
    if (!text) return;
    sendMessage({ text });
    setInput('');
  };

  const newThread = () => {
    localStorage.removeItem(THREAD_KEY);
    window.location.reload();
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-300 w-12 h-12 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-black/40 flex items-center justify-center"
        aria-label="AI assistant"
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-300 w-[520px] h-[640px] bg-[#1a1a1f] border border-white/10 rounded-xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between shrink-0">
            <div className="text-sm text-white">AI Chat</div>
            <div className="flex items-center gap-2">
              <button
                onClick={newThread}
                className="text-[11px] text-zinc-400 hover:text-white"
              >
                new thread
              </button>
              <span className="text-[10px] text-zinc-500 font-mono">
                {threadId.slice(0, 8)}
              </span>
            </div>
          </div>

          <Conversation className="flex-1 min-h-0">
            <ConversationContent className="px-3 py-3">
              {messages.length === 0 && (
                <div className="text-xs text-zinc-400">
                  Try: "go to blueprint" or "list my projects"
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className="space-y-2">
                  {message.parts.map((part, i) => {
                    if (part.type === 'text' && part.text.length > 0) {
                      return (
                        <Message key={i} from={message.role}>
                          <MessageContent>
                            <Response>{part.text}</Response>
                          </MessageContent>
                        </Message>
                      );
                    }

                    // Standalone approval data — rendered inline with its tool part below.
                    if (isApprovalPart(part)) {
                      return null;
                    }

                    if (isToolUIPart(part)) {
                      const approval = getApprovalForToolCall(
                        message.parts,
                        part.toolCallId
                      );
                      const toolName = getToolName(part);
                      const header =
                        part.type === 'dynamic-tool' ? (
                          <ToolHeader
                            type="dynamic-tool"
                            state={part.state}
                            toolName={toolName}
                            title={toolName}
                          />
                        ) : (
                          <ToolHeader type={part.type} state={part.state} title={toolName} />
                        );

                      if (!approval) {
                        return (
                          <Tool key={i} defaultOpen={false}>
                            {header}
                            <ToolContent>
                              <ToolInput input={(part as any).input} />
                              <ToolOutput
                                output={(part as any).output}
                                errorText={(part as any).errorText}
                              />
                            </ToolContent>
                          </Tool>
                        );
                      }

                      const awaitingApproval =
                        part.state !== 'output-available' &&
                        part.state !== 'output-error' &&
                        !isLoading;

                      return (
                        <Tool key={i} open={awaitingApproval || undefined} defaultOpen>
                          {header}
                          <ToolContent>
                            <ToolInput input={approval.args} />
                            {part.state === 'output-available' ? (
                              <ToolOutput
                                output={(part as any).output}
                                errorText={(part as any).errorText}
                              />
                            ) : (
                              <div className="p-3 pt-0">
                                <div className="flex items-center gap-2 mb-2 text-xs font-medium text-amber-400">
                                  <ShieldAlert className="size-3.5" />
                                  <span>Approval required</span>
                                </div>
                                {isLoading ? (
                                  <p className="text-xs text-zinc-400">Processing…</p>
                                ) : (
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() => handleApproval(approval, true)}
                                    >
                                      <CheckCircle2 className="size-3.5 mr-1" />
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => handleApproval(approval, false)}
                                    >
                                      <XCircle className="size-3.5 mr-1" />
                                      Decline
                                    </Button>
                                  </div>
                                )}
                              </div>
                            )}
                          </ToolContent>
                        </Tool>
                      );
                    }

                    return null;
                  })}
                </div>
              ))}
              {status === 'submitted' && (
                <div className="text-xs text-zinc-500">…</div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <PromptInput onSubmit={handleSubmit} className="mx-3 mb-3 shrink-0 w-[calc(100%-1.5rem)]">
            <PromptInputBody>
              <PromptInputTextarea
                onChange={(e) => setInput(e.target.value)}
                value={input}
                placeholder="Message…"
              />
            </PromptInputBody>
            <PromptInputFooter>
              <div />
              <PromptInputSubmit disabled={!input.trim() || isLoading} status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      )}
    </>
  );
};
