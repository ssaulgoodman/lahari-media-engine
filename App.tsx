
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppStep, ApiProject, VideoShot, GenerationStatus, ChatMessage } from './types';
import { AnalysisEditor } from './components/AnalysisEditor';
import { Storyboard } from './components/Storyboard';
import { StepRender } from './components/StepRender';
import { ChatAssistant } from './components/ChatAssistant';
import { XRayPanel } from './components/XRayPanel';
import { Dashboard } from './components/Dashboard';
import { PromptsLibrary } from './components/PromptsLibrary';
import { RendersModal } from './components/RendersModal';
import { getVideoModel } from './constants/videoModels';
import { useAuth } from './contexts/AuthContext';
import * as api from './services/api';
import { notifyBulkComplete } from './lib/notify';

const PIPELINE_STEPS = [
  { id: AppStep.UPLOAD, label: 'Queue' },
  { id: AppStep.BLUEPRINT, label: 'Blueprint' },
  { id: AppStep.STUDIO, label: 'Studio' },
  { id: AppStep.RENDER, label: 'Render' },
];

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: 'easeOut' as const },
};

type ProjectSummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
  parentProjectId?: string;
  renderCount?: number;
};

// Humanize a timestamp: "3m ago", "2h ago", "yesterday", "Mar 4".
const relativeTime = (iso?: string): string => {
  if (!iso) return '';
  const then = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  uploaded: { label: 'Uploaded', color: 'text-zinc-400' },
  analyzed: { label: 'Analyzed', color: 'text-zinc-400' },
  concept_locked: { label: 'Concept', color: 'text-blue-400' },
  scripted: { label: 'Scripted', color: 'text-indigo-400' },
  style_locked: { label: 'Styled', color: 'text-purple-400' },
  characters_locked: { label: 'Characters', color: 'text-pink-400' },
  environments_locked: { label: 'Environments', color: 'text-emerald-400' },
};

const appOrigin = () => window.location.origin;

const mcpUrl = () => `${appOrigin()}/mcp`;

type Harness = 'codex' | 'claude';
type CodexPlatform = 'mac' | 'win' | 'linux' | 'cli';

const detectPlatform = (): CodexPlatform => {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return 'win';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'mac';
};

const platformLabel = (p: CodexPlatform): string => {
  if (p === 'mac') return 'macOS';
  if (p === 'win') return 'Windows';
  if (p === 'linux') return 'Linux';
  return 'CLI';
};

const ConnectPage: React.FC<{
  user: { id: string; email?: string | null } | null;
  signInWithGoogle: (redirectTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
}> = ({ user, signInWithGoogle, signOut }) => {
  const [tokens, setTokens] = useState<any[]>([]);
  const [created, setCreated] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenConfirmed, setTokenConfirmed] = useState(false);
  const [tokenRevealed, setTokenRevealed] = useState(true);
  const [activeHarness, setActiveHarness] = useState<Harness>('codex');
  const [codexPlatform, setCodexPlatform] = useState<CodexPlatform>('mac');
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    setCodexPlatform(detectPlatform());
  }, []);

  const loadTokens = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const body = await api.listMcpTokens();
      setTokens(body.tokens || []);
    } catch (err: any) {
      setError(err.message || 'Could not load MCP tokens');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const createToken = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    setTokenConfirmed(false);
    setTokenRevealed(true);
    try {
      const token = await api.createMcpToken({ label: 'Codex / Claude', expiresInDays: 30 });
      setCreated(token);
      await loadTokens();
    } catch (err: any) {
      setError(err.message || 'Could not create MCP token');
    } finally {
      setLoading(false);
    }
  };

  const revokeToken = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.revokeMcpToken(id);
      if (created?.id === id) setCreated(null);
      await loadTokens();
    } catch (err: any) {
      setError(err.message || 'Could not revoke MCP token');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Copied');
      window.setTimeout(() => setMessage(null), 1600);
    } catch {
      setMessage('Select and copy manually');
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#141418] flex items-center justify-center px-6 relative overflow-hidden">
        {/* Subtle ambient glow */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-white/[0.015] blur-3xl" />
        </div>

        <div className="w-full max-w-md text-center relative">
          <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-6">Lahari Connect</p>
          <h1 className="text-3xl font-display text-white mb-4 tracking-tight">Connect Lahari to your agent</h1>
          <p className="text-sm text-zinc-400 mb-10 leading-relaxed max-w-sm mx-auto">
            Sign in to mint an account-scoped MCP token for Codex Desktop or Claude Code. No service keys. No engine repo.
          </p>
          <button
            onClick={() => signInWithGoogle(`${window.location.origin}/connect`)}
            className="inline-flex items-center gap-3 px-6 py-3 bg-white text-black rounded-lg font-medium text-sm hover:bg-zinc-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const token = created?.token;
  const tokenPlaceholder = token || '<token>';
  const mcpEndpoint = mcpUrl();
  const tokenMaskedSuffix = token ? token.slice(-6) : '';

  // Codex install variants
  const codexAppFields = `Name: lahari
Type: Streamable HTTP
URL: ${mcpEndpoint}
Bearer token env var: leave blank
Header key: Authorization
Header value: Bearer ${tokenPlaceholder}`;
  const codexCliInstall = `export LAHARI_MCP_TOKEN=${tokenPlaceholder}
codex mcp add lahari --url ${mcpEndpoint} --bearer-token-env-var LAHARI_MCP_TOKEN`;
  const codexWindowsInstall = `[Environment]::SetEnvironmentVariable("LAHARI_MCP_TOKEN", "${tokenPlaceholder}", "User")
codex mcp remove lahari
codex mcp add lahari --url ${mcpEndpoint} --bearer-token-env-var LAHARI_MCP_TOKEN
codex mcp get lahari --json
Get-Process *codex* -ErrorAction SilentlyContinue | Stop-Process -Force`;

  // Claude install
  const claudeInstall = `export LAHARI_MCP_TOKEN=${tokenPlaceholder}
claude mcp add-json lahari '{"type":"http","url":"${mcpEndpoint}","headers":{"Authorization":"Bearer ${'${LAHARI_MCP_TOKEN}'}"}}'`;
  const claudeFallback = `claude mcp add lahari --transport http --header "Authorization: Bearer ${tokenPlaceholder}" ${mcpEndpoint}`;

  const CodeBlock: React.FC<{ value: string; copyLabel?: string; small?: boolean }> = ({ value, copyLabel, small }) => (
    <div className="relative group">
      <pre className={`surface-inset rounded-md ${small ? 'p-3' : 'p-4'} overflow-x-auto text-xs font-mono text-zinc-200 leading-relaxed whitespace-pre pr-20`}>{value}</pre>
      <button
        onClick={() => copy(value)}
        className="absolute top-2.5 right-2.5 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] rounded transition-colors backdrop-blur"
      >
        {copyLabel || 'Copy'}
      </button>
    </div>
  );

  const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full surface-inset flex items-center justify-center text-xs text-zinc-300 font-mono">{n}</div>
      <div className="flex-1 min-w-0 pt-0.5 space-y-3">
        <p className="text-sm text-white font-medium leading-snug">{title}</p>
        {children}
      </div>
    </div>
  );

  // Codex tab content per platform
  const codexContent = (() => {
    if (codexPlatform === 'mac' || codexPlatform === 'linux') {
      return (
        <div className="space-y-5">
          <Step n={1} title="Open Codex Desktop → Settings → MCP Servers → Add server">
            <CodeBlock value={codexAppFields} copyLabel="Copy fields" />
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Select <span className="text-zinc-300">Streamable HTTP</span>. Leave bearer-token env var blank — the Authorization header carries it directly.
            </p>
          </Step>
          <Step n={2} title="Save and fully restart Codex Desktop">
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Quit completely (not just close the window). Reopen and start a new chat.
            </p>
          </Step>
        </div>
      );
    }
    if (codexPlatform === 'win') {
      return (
        <div className="space-y-5">
          <Step n={1} title="Open PowerShell and run">
            <CodeBlock value={codexWindowsInstall} copyLabel="Copy script" />
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Stores the token in your Windows user environment, registers the MCP server, then stops Codex so the reopened app inherits the token.
            </p>
          </Step>
          <Step n={2} title="Reopen Codex Desktop">
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Start a new chat. The Lahari tools should appear when triggered.
            </p>
          </Step>
        </div>
      );
    }
    // CLI advanced
    return (
      <div className="space-y-5">
        <Step n={1} title="In your terminal, run">
          <CodeBlock value={codexCliInstall} copyLabel="Copy CLI" />
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Sets the env var for this shell session and registers the MCP server with Codex CLI.
          </p>
        </Step>
        <Step n={2} title="Restart Codex Desktop">
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            CLI registration takes effect on next launch. Quit fully, then reopen.
          </p>
        </Step>
      </div>
    );
  })();

  const claudeContent = (
    <div className="space-y-5">
      <Step n={1} title="In your terminal, run">
        <CodeBlock value={claudeInstall} copyLabel="Copy commands" />
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Single quotes keep <span className="font-mono text-zinc-300">${'{'}LAHARI_MCP_TOKEN{'}'}</span> unexpanded so Claude writes the env reference into <span className="font-mono text-zinc-300">.mcp.json</span>.
        </p>
      </Step>
      <Step n={2} title="Restart Claude Code in your project folder">
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Open any empty folder you want to use as your Lahari workspace.
        </p>
        <button
          onClick={() => setShowFallback(s => !s)}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors select-none inline-flex items-center gap-1"
        >
          <span className={`inline-block transition-transform ${showFallback ? 'rotate-90' : ''}`}>›</span>
          {showFallback ? 'Hide' : 'Show'} fallback for older Claude Code
        </button>
        {showFallback && <CodeBlock value={claudeFallback} copyLabel="Copy fallback" small />}
      </Step>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#141418] text-white px-6 py-12 relative overflow-hidden">
      {/* Subtle ambient glow */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[400px] rounded-full bg-white/[0.012] blur-3xl" />
      </div>

      <div className="max-w-3xl mx-auto relative">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-12">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-3">Lahari Connect</p>
            <h1 className="text-3xl font-display text-white mb-2 tracking-tight">Connect your agent</h1>
            <p className="text-sm text-zinc-300">{user.email || user.id}</p>
          </div>
          <button
            onClick={signOut}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white surface-inset rounded-md hover:bg-white/[0.06] transition-colors flex-shrink-0"
          >
            Switch account
          </button>
        </div>

        {error && (
          <div className="mb-6 text-sm text-amber-200/90 surface-inset rounded-md px-3 py-2 border-l-2 border-amber-400/60">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-6 text-xs text-zinc-300 surface-inset rounded-md px-3 py-2 border-l-2 border-white/20">
            {message}
          </div>
        )}

        {/* Step 1 — Mint a token */}
        <div className="surface rounded-xl p-7 mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-2">Step 1</p>
              <h2 className="text-xl font-display text-white tracking-tight">Mint your access token</h2>
              <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">Shown once. Treat it like a password — anyone with it can act as you in Lahari.</p>
            </div>
            <button
              onClick={createToken}
              disabled={loading}
              className="px-4 py-2 bg-white text-black rounded-md text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 transition-colors flex-shrink-0"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />
                  Working
                </span>
              ) : token ? 'Mint another' : 'Mint 30-day token'}
            </button>
          </div>

          {token && (
            <div className="mt-6 space-y-3">
              {tokenRevealed ? (
                <>
                  <div className="relative group">
                    <pre className="surface-inset rounded-md p-4 overflow-x-auto text-xs font-mono text-zinc-200 leading-relaxed whitespace-pre pr-24">{token}</pre>
                    <button
                      onClick={() => copy(token)}
                      className="absolute top-2.5 right-2.5 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] rounded transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-[11px] text-zinc-400">
                      Expires {created.expiresAt ? new Date(created.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'in 30 days'}
                    </p>
                    {!tokenConfirmed ? (
                      <button
                        onClick={() => { setTokenConfirmed(true); setTokenRevealed(false); }}
                        className="px-3 py-1.5 text-xs text-emerald-300 hover:text-emerald-200 bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12] rounded-md transition-colors inline-flex items-center gap-2"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        I've copied it safely
                      </button>
                    ) : (
                      <button
                        onClick={() => setTokenRevealed(false)}
                        className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                      >
                        Hide token
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="surface-inset rounded-md p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs font-mono text-zinc-300">{tokenMaskedSuffix ? `lahari_mcp_••••••${tokenMaskedSuffix}` : 'lahari_mcp_••••••'}</p>
                    <p className="text-[11px] text-zinc-400 mt-1">Stored in your hands. Keep going.</p>
                  </div>
                  <button
                    onClick={() => setTokenRevealed(true)}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Reveal again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 2 — Install (only after confirmation, but we show always when token exists; confirmation just collapses token) */}
        {token && (
          <div className="surface rounded-xl p-7 mb-5">
            <div className="mb-6">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-2">Step 2</p>
              <h2 className="text-xl font-display text-white tracking-tight">Install in your harness</h2>
              <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">Pick the harness you use. Restart it once after install.</p>
            </div>

            {/* Harness tabs */}
            <div className="flex gap-6 border-b border-white/[0.06] mb-6">
              {(['codex', 'claude'] as Harness[]).map(h => (
                <button
                  key={h}
                  onClick={() => setActiveHarness(h)}
                  className="relative pb-3 text-sm transition-colors"
                >
                  <span className={activeHarness === h ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}>
                    {h === 'codex' ? 'Codex Desktop' : 'Claude Code'}
                  </span>
                  {activeHarness === h && (
                    <span className="absolute bottom-0 left-0 right-0 h-px bg-white/70" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeHarness === 'codex' ? (
              <>
                {/* Platform sub-toggle */}
                <div className="flex items-center gap-1.5 mb-6 flex-wrap">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-400 mr-1.5">Platform</span>
                  {(['mac', 'win', 'linux', 'cli'] as CodexPlatform[]).map(p => (
                    <button
                      key={p}
                      onClick={() => setCodexPlatform(p)}
                      className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                        codexPlatform === p
                          ? 'bg-white text-black'
                          : 'surface-inset text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                      }`}
                    >
                      {platformLabel(p)}
                    </button>
                  ))}
                  <span className="text-[10px] text-zinc-400 ml-2">Detected: {platformLabel(detectPlatform())}</span>
                </div>

                {codexContent}
              </>
            ) : (
              claudeContent
            )}
          </div>
        )}

        {/* Step 3 — Verify */}
        {token && (
          <div className="rounded-xl p-7 mb-5 relative overflow-hidden" style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.04), rgba(255, 255, 255, 0.02))',
            boxShadow: 'inset 0 0 0 1px rgba(16, 185, 129, 0.12), inset 0 0 0 1px rgba(255, 255, 255, 0.02)'
          }}>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-300/80 mb-1.5">Step 3 — Verify</p>
                <h2 className="text-lg font-display text-white tracking-tight mb-3">You're connected when this works</h2>
                <p className="text-sm text-zinc-300 leading-relaxed mb-3">In your harness chat, ask:</p>
                <div className="surface-inset rounded-md px-4 py-3 mb-3">
                  <p className="text-sm text-white font-mono">List my Lahari projects</p>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  If you see your projects, you're connected. Then try: <span className="text-zinc-300">"Open &lt;song name&gt;"</span> — your agent will materialize a Lahari workspace in the current folder.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Troubleshooting */}
        {token && (
          <details className="surface rounded-xl p-6 mb-5 group">
            <summary className="cursor-pointer flex items-center justify-between gap-3 select-none">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-1">Troubleshooting</p>
                <h3 className="text-base font-display text-white tracking-tight">Something not working?</h3>
              </div>
              <span className="text-zinc-400 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div className="mt-5 space-y-5 text-sm">
              <div>
                <p className="text-zinc-200 font-medium mb-1.5">MCP tools don't appear after restart</p>
                <ul className="text-xs text-zinc-400 leading-relaxed space-y-1 ml-4 list-disc">
                  <li>Fully <span className="text-zinc-300">quit</span> the harness — closing the window isn't enough.</li>
                  <li>Open a new chat (existing chats may not pick up newly-registered MCP servers).</li>
                  <li>Ask the agent: <span className="text-zinc-300">"What MCP servers do you have access to?"</span></li>
                  <li>If the server is listed but tools fail, your token may be expired. Mint a new one.</li>
                </ul>
              </div>
              <div>
                <p className="text-zinc-200 font-medium mb-1.5">Authorization errors</p>
                <ul className="text-xs text-zinc-400 leading-relaxed space-y-1 ml-4 list-disc">
                  <li>Confirm you copied the token completely. The full token is ~50 characters starting with <span className="font-mono text-zinc-300">lahari_mcp_</span>.</li>
                  <li>Check the token is still active in the list below.</li>
                  <li>For Claude Code, make sure the env var is set <span className="text-zinc-300">before</span> launching <span className="font-mono text-zinc-300">claude</span>.</li>
                </ul>
              </div>
              <div>
                <p className="text-zinc-200 font-medium mb-1.5">Different harness or still stuck?</p>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Once connected, the easiest path is to ask your agent to call <span className="font-mono text-zinc-300">lahari_capture_issue</span> with what you tried. Lahari engineering reads these.
                </p>
              </div>
            </div>
          </details>
        )}

        {/* Existing tokens */}
        <div className="surface rounded-xl p-7">
          <div className="flex items-baseline justify-between gap-3 mb-5">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-1.5">Tokens</p>
              <h2 className="text-base font-display text-white tracking-tight">Your active tokens</h2>
            </div>
            {tokens.length > 0 && (
              <p className="text-xs text-zinc-400">{tokens.filter(t => t.active).length} active · {tokens.length} total</p>
            )}
          </div>

          {tokens.length === 0 && !loading ? (
            <p className="text-sm text-zinc-400">No tokens minted yet.</p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {tokens.map(t => (
                <div key={t.id} className="py-3.5 flex items-center justify-between gap-4 group">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      <p className="text-sm text-white truncate">{t.label}</p>
                      <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        t.active
                          ? 'text-emerald-300/90 bg-emerald-500/10'
                          : 'text-zinc-400 bg-white/[0.04]'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${t.active ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                        {t.active ? 'Active' : t.revokedAt ? 'Revoked' : 'Expired'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 font-mono truncate">{t.tokenPrefix}…</p>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      {t.expiresAt ? `Expires ${new Date(t.expiresAt).toLocaleDateString()}` : 'No expiry'}
                      {t.lastUsedAt ? ` · used ${new Date(t.lastUsedAt).toLocaleDateString()}` : ' · never used'}
                    </p>
                  </div>
                  {!t.revokedAt && (
                    <button
                      onClick={() => revokeToken(t.id)}
                      className="px-3 py-1.5 text-xs text-zinc-400 hover:text-amber-200 surface-inset rounded-md hover:bg-amber-500/[0.06] transition-colors flex-shrink-0 opacity-60 group-hover:opacity-100"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();

  // Auth gate — show sign-in screen if not authenticated
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#141418] flex items-center justify-center">
        <div className="text-zinc-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (window.location.pathname === '/connect') {
    return <ConnectPage user={user} signInWithGoogle={signInWithGoogle} signOut={signOut} />;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#141418] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-display text-white mb-2">Lahari Media Engine</h1>
          <p className="text-zinc-400 text-sm mb-8">AI-powered devotional music video production</p>
          <button
            onClick={() => signInWithGoogle()}
            className="inline-flex items-center gap-3 px-6 py-3 bg-white text-black rounded-lg font-medium text-sm hover:bg-zinc-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return <AppMain user={user} signOut={signOut} />;
};

const AppMain: React.FC<{ user: { id: string; email?: string; user_metadata?: any }; signOut: () => Promise<void> }> = ({ user, signOut }) => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.UPLOAD);
  const [project, setProjectRaw] = useState<ApiProject | null>(null);
  const activeProjectId = React.useRef<string | null>(null);

  // Guarded setter — drops stale updates from in-flight API calls
  // when the user has already switched to a different project.
  const setProject = React.useCallback((update: ApiProject | ((prev: ApiProject | null) => ApiProject | null) | null) => {
    setProjectRaw(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (!next) { activeProjectId.current = null; return next; }
      // Explicit project switch (navigation, start production) — always accept
      if (!prev || next.id !== prev.id) { activeProjectId.current = next.id; return next; }
      // Same project — accept if it matches the active one
      if (next.id === activeProjectId.current) return next;
      // Stale update for a different project — drop
      return prev;
    });
  }, []);
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Character look candidates per cast member
  const [lookCandidates, setLookCandidates] = useState<Record<string, { id: string; url: string }[]>>({});
  // Per-member loading state for parallel character generation
  const [looksLoading, setLooksLoading] = useState<Set<string>>(new Set());
  // X-Ray panel
  const [xrayOpen, setXrayOpen] = useState(false);
  // Prompts library — full-page overlay, not tied to a project
  const [promptsOpen, setPromptsOpen] = useState(false);
  // Bulk-queue state — shot IDs waiting for a worker to pick them up.
  // Order matters: position in the array = visible "Nth in line" badge.
  // Worker pulls from the front; UI reads indexOf for the badge.
  const [frameQueue, setFrameQueue] = useState<string[]>([]);
  const [videoQueue, setVideoQueue] = useState<string[]>([]);
  const [storyboardPromptQueue, setStoryboardPromptQueue] = useState<string[]>([]);
  const [storyboardImageQueue, setStoryboardImageQueue] = useState<string[]>([]);
  const [bulkStopNotice, setBulkStopNotice] = useState<string | null>(null);
  const bulkStopRef = useRef({ requested: false, controllers: new Set<AbortController>() });
  // Studio scene navigation
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  // Renders viewer (popup) — opened from Dashboard rows or sidebar entries.
  const [rendersFor, setRendersFor] = useState<{ id: string; title: string } | null>(null);

  // Project sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [projectListLoading, setProjectListLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const startRename = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameDraft(currentTitle);
  };
  const cancelRename = () => { setRenamingId(null); setRenameDraft(''); };
  const saveRename = async () => {
    const id = renamingId;
    const next = renameDraft.trim();
    if (!id || !next) { cancelRename(); return; }
    // Optimistic — flip both the list entry and (if applicable) the active
    // project so the header updates without waiting.
    setProjectList(list => list.map(p => p.id === id ? { ...p, title: next } : p));
    setProject(cur => cur && cur.id === id ? { ...cur, title: next } : cur);
    cancelRename();
    try { await api.updateProject(id, { title: next }); }
    catch (err: any) { setError(err.message); }
  };

  // Auto-dismiss error toast
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Persist project + step to localStorage so refresh stays on the same page
  const persistState = useCallback((projectId: string | null, step: AppStep) => {
    if (projectId) localStorage.setItem('lahari:projectId', projectId);
    else localStorage.removeItem('lahari:projectId');
    localStorage.setItem('lahari:step', String(step));
  }, []);

  // On mount: restore from localStorage, fall back to most recent project
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedId = params.get('project') || params.get('projectId');
    const linkedStep = params.get('step');
    const linkedShot = params.get('shot') || params.get('shotId');
    const savedId = localStorage.getItem('lahari:projectId');
    const savedStepRaw = localStorage.getItem('lahari:step');
    const savedStep = savedStepRaw !== null ? Number(savedStepRaw) as AppStep : null;
    const stepFromParam = (value: string | null): AppStep | null => {
      if (value === 'queue') return AppStep.UPLOAD;
      if (value === 'blueprint') return AppStep.BLUEPRINT;
      if (value === 'studio') return AppStep.STUDIO;
      if (value === 'render') return AppStep.RENDER;
      return null;
    };
    const focusLinkedShot = (p: ApiProject) => {
      if (!linkedShot) return;
      const sceneIndex = p.scenes.findIndex(scene => scene.shots.some(shot => shot.id === linkedShot));
      if (sceneIndex >= 0) setActiveSceneIdx(sceneIndex);
    };

    const load = async () => {
      try {
        const preferredId = linkedId || savedId;
        if (preferredId) {
          const p = await api.getProject(preferredId);
          if (p) {
            setProject(p);
            focusLinkedShot(p);
            const linkedStepValue = stepFromParam(linkedStep);
            if (linkedStepValue !== null) {
              setCurrentStep(linkedStepValue);
            } else if (!linkedId && savedStep !== null && savedStep >= AppStep.UPLOAD && savedStep <= AppStep.RENDER) {
              setCurrentStep(savedStep);
            } else {
              navigateToPhase(p);
            }
            return;
          }
        }
        // Fallback: load most recent project
        const projects = await api.listProjects();
        if (projects.length > 0) {
          const p = await api.getProject(projects[0].id);
          if (p) {
            setProject(p);
            navigateToPhase(p);
          }
        }
      } catch {
        // No projects yet, stay on upload
      }
    };
    load();
  }, []);

  // Persist to localStorage whenever project or step changes
  useEffect(() => {
    persistState(project?.id || null, currentStep);
  }, [project?.id, currentStep, persistState]);

  // Determine which step to show based on project phase
  const navigateToPhase = (p: ApiProject) => {
    let step: AppStep;
    if ((p.status === 'characters_locked' || p.status === 'environments_locked') && p.scenes.length > 0) {
      step = AppStep.STUDIO;
    } else if (p.conceptOptions.length > 0 || p.status === 'concept_locked' || p.status === 'scripted' || p.status === 'style_locked' || p.status === 'characters_locked' || p.status === 'environments_locked') {
      step = AppStep.BLUEPRINT;
    } else {
      step = AppStep.UPLOAD;
    }
    setCurrentStep(step);
  };

  // ─── Upload & Analyze ───────────────────────────────────────────

  const handleFileUpload = async (file: File, metadata?: { title?: string; context?: string; language?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.createProject(file, metadata);
      setProject(p);
      setCurrentStep(AppStep.UPLOAD);
    } catch (err: any) {
      setError(err.message || 'Failed to analyze audio.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Generate Concepts (separate from analysis) ────────────────

  // One active AbortController per op key. Clicking "Stop" on any pending
  // generate button calls abortOp(key) → the fetch rejects with AbortError,
  // which isCancelled() catches so no error toast. Server-side work keeps
  // running for now (harmless, still logged), but the UI unblocks instantly.
  const opsRef = useRef<Record<string, AbortController>>({});
  const startOp = useCallback((key: string): AbortSignal => {
    opsRef.current[key]?.abort();
    const ctrl = new AbortController();
    opsRef.current[key] = ctrl;
    return ctrl.signal;
  }, []);
  const abortOp = useCallback((key: string) => {
    opsRef.current[key]?.abort();
    delete opsRef.current[key];
  }, []);
  const endOp = useCallback((key: string) => {
    delete opsRef.current[key];
  }, []);

  const handleGenerateConcepts = async (opts?: { lyrics?: string; context?: string; language?: string; userNote?: string; directorBrief?: string }) => {
    if (!project) return;
    const signal = startOp('concepts');
    setLoading(true);
    setError(null);
    try {
      const p = await api.generateConcepts(project.id, opts, signal);
      setProject(p);
      setCurrentStep(AppStep.BLUEPRINT);
    } catch (err: any) {
      if (!api.isCancelled(err)) setError(err.message || 'Concept generation failed.');
    } finally {
      endOp('concepts');
      setLoading(false);
    }
  };

  const handleCancelConcepts = () => abortOp('concepts');

  // ─── Concept Lock-in ────────────────────────────────────────────

  const handleLockConcept = async (conceptIndex: number) => {
    if (!project) return;
    const chosen = project.conceptOptions[conceptIndex];
    const prev = project.lockedConcept;
    const switching = prev && JSON.stringify(prev) !== JSON.stringify(chosen);
    const hasScenes = project.scenes.length > 0;
    const hasMedia = project.scenes.some(s => s.shots.some((x: any) => x.imageUrl || x.videoUrl));

    // Destructive only when switching AWAY from a previously locked concept
    // with downstream work. Picking for the first time, re-picking the same
    // concept, or switching before any script exists is all a plain lock.
    if (switching && hasScenes) {
      setDestructive({
        title: 'Switch to a different concept?',
        description: hasMedia
          ? 'The script, style, cast, environments, and ALL generated images/videos were built around the old concept — switching makes them invalid and they will be discarded. Fork first to keep a snapshot.'
          : 'The script, style, cast, and environments were built around the old concept — switching invalidates them and they will be wiped. Fork first to keep a snapshot.',
        run: ({ fork }) => api.lockConcept(project.id, conceptIndex, { fork }),
      });
      return;
    }
    setLoading(true); setError(null);
    try {
      const p = await api.lockConcept(project.id, conceptIndex);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Destructive action dialog state ────────────────────────────
  // The 3-option dialog (Fork primary / Overwrite / Cancel) is opened via
  // setDestructive({...}). We store what to do on each choice.
  type DestructiveAction = {
    title: string;
    description: string;
    // Fork-capable flows: 3 buttons (Fork & change · Overwrite · Cancel)
    // Simple confirms: 2 buttons (confirmLabel · Cancel)
    mode?: 'fork' | 'simple';
    confirmLabel?: string;      // used in 'simple' mode
    overwriteLabel?: string;    // used in 'fork' mode
    run: (opts: { fork: boolean }) => Promise<any> | any;
    onDone?: (result: any) => void;  // handles result when the action is not a project mutation
  };
  const [destructive, setDestructive] = useState<DestructiveAction | null>(null);

  const runDestructive = async (fork: boolean) => {
    if (!destructive) return;
    const action = destructive;
    setDestructive(null);
    setLoading(true);
    setError(null);
    try {
      const result = await action.run({ fork });
      if (action.onDone) {
        action.onDone(result);
      } else if (result && typeof result === 'object' && 'id' in result) {
        // Default: treat result as updated project
        setProject(result);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // All unlocks are pure navigation now — no dialog, no data loss.
  // Destructive events happen when the user actively picks or regenerates
  // something (lock-concept with a different choice, generate-script re-run).
  const handleUnlockConcept = () => doUnlock(() => api.unlockConcept(project!.id));

  const handleRefineConcept = async (feedback: string) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.refineConcept(project.id, feedback);
      setProject(p);
    } catch (err: any) {
      setError(`Concept refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateConcept = async (updates: Record<string, any>) => {
    if (!project) return;
    // Optimistic: merge updates into locked concept
    const prevConcept = project.lockedConcept;
    if (prevConcept) {
      setProject(prev => prev ? { ...prev, lockedConcept: { ...prev.lockedConcept!, ...updates } } : prev);
    }
    try {
      await api.updateConcept(project.id, updates);
    } catch (err: any) {
      if (prevConcept) setProject(prev => prev ? { ...prev, lockedConcept: prevConcept } : prev);
      setError(`Concept update failed: ${err.message}`);
    }
  };

  const handleUnlockScript = () => doUnlock(() => api.unlockScript(project!.id));
  const handleUnlockCharacters = () => doUnlock(() => api.unlockCharacters(project!.id));
  const handleUnlockEnvironments = () => doUnlock(() => api.unlockEnvironments(project!.id));

  const doUnlock = async (fn: () => Promise<any>) => {
    if (!project) return;
    setError(null);
    try {
      const result = await fn();
      // Minimal response: apply status change optimistically
      if (result?.ok && result?.status) {
        setProject(prev => prev ? { ...prev, status: result.status } : prev);
      } else {
        setProject(result);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Style Lock ────────────────────────────────────────────────

  const handleLockStyle = async (assetId: string, styleDescription?: string) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.lockStyle(project.id, assetId, styleDescription);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockStyle = async () => { await doUnlock(() => api.unlockStyle(project!.id)); };

  // ─── Character Look Generation & Lock ───────────────────────────

  const handleGenerateLooks = async (castMemberId: string, feedback?: string, refImage?: File) => {
    if (!project) return;
    setLooksLoading(prev => new Set(prev).add(castMemberId));
    setError(null);
    try {
      const result = await api.generateLooks(project.id, castMemberId, feedback, undefined, refImage);
      setLookCandidates(prev => ({ ...prev, [castMemberId]: result.looks }));
      setProject(result.project);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLooksLoading(prev => { const next = new Set(prev); next.delete(castMemberId); return next; });
    }
  };

  const handleLockCharacter = async (castMemberId: string, assetId: string) => {
    if (!project) return;
    try {
      await api.lockCharacter(project.id, castMemberId, assetId);
      // Optimistic: set the reference on the cast member
      setProject(prev => prev ? {
        ...prev,
        cast: prev.cast.map(c => c.id === castMemberId ? { ...c, referenceImageUrl: lookCandidates[castMemberId]?.find(l => l.id === assetId)?.url || c.referenceImageUrl } : c)
      } : prev);
      setLookCandidates(prev => ({ ...prev, [castMemberId]: [] }));
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Cast Management ────────────────────────────────────────────

  const handleAddCast = async (name: string, description: string) => {
    if (!project) return;
    try {
      const p = await api.addCastMember(project.id, name, description);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateCast = async (memberId: string, updates: { name?: string; description?: string }) => {
    if (!project) return;
    try {
      const p = await api.updateCastMember(project.id, memberId, updates);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteCast = async (memberId: string) => {
    if (!project) return;
    const prevCast = project.cast;
    setProject(prev => prev ? { ...prev, cast: prev.cast.filter(c => c.id !== memberId) } : prev);
    try {
      await api.deleteCastMember(project.id, memberId);
    } catch (err: any) {
      setProject(prev => prev ? { ...prev, cast: prevCast } : prev);
      setError(err.message);
    }
  };

  // ─── Script Generation ──────────────────────────────────────────

  const handleUpdateScene = async (sceneId: string, updates: { narrativeDescription?: string }) => {
    if (!project) return;
    // Optimistic update
    setProject(prev => prev ? {
      ...prev,
      scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, ...updates } : s)
    } : prev);
    api.updateScene(project.id, sceneId, updates).catch(console.error);
  };

  const handleRefineScript = async (feedback: string) => {
    if (!project) return;
    const signal = startOp('script');
    setLoading(true); setError(null);
    try {
      const p = await api.refineScript(project.id, feedback, signal);
      setProject(p);
    } catch (err: any) {
      if (!api.isCancelled(err)) setError('Script refinement failed: ' + err.message);
    } finally { endOp('script'); setLoading(false); }
  };

  const handleGenerateScript = async (userNote?: string) => {
    if (!project) return;
    // First-time gen: no existing script to destroy, just run.
    if (project.scenes.length === 0) {
      const signal = startOp('script');
      setLoading(true); setError(null);
      try {
        const p = await api.generateScript(project.id, userNote, undefined, signal);
        setProject(p);
      } catch (err: any) {
        if (!api.isCancelled(err)) setError('Script generation failed: ' + err.message);
      } finally { endOp('script'); setLoading(false); }
      return;
    }
    // Re-gen: destructive (wipes cast + deletes scenes/shots). Offer fork.
    const hasMedia = project.scenes.some(s => s.shots.some((x: any) => x.imageUrl || x.videoUrl));
    setDestructive({
      title: 'Regenerate script?',
      description: hasMedia
        ? 'This wipes the cast, deletes every scene and shot, and DISCARDS all generated images and videos. Fork first to keep a snapshot.'
        : 'This wipes the cast and deletes every scene and shot. Fork first to keep a snapshot.',
      run: ({ fork }) => api.generateScript(project.id, userNote, { fork }),
    });
  };

  // ─── Advance past Characters / Environments ────────────────────

  const handleAdvanceCharacters = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const result = await api.advanceCharacters(project.id);
      if (result?.ok && result?.status) {
        setProject(prev => prev ? { ...prev, status: result.status } : prev);
      } else { setProject(result); }
    } catch (err: any) {
      setError('Failed to advance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdvanceEnvironments = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const result = await api.advanceEnvironments(project.id);
      if (result?.ok && result?.status) {
        setProject(prev => prev ? { ...prev, status: result.status } : prev);
      } else { setProject(result); }
    } catch (err: any) {
      setError('Failed to advance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Launch Studio (write shot prompts first) ──────────────────

  const handleLaunchStudio = async () => {
    if (!project) return;
    if (project.videoModel?.startsWith('seedance')) {
      setCurrentStep(AppStep.STUDIO);
      return;
    }
    // Skip bulk prompt regeneration if every shot already has a prompt written.
    // User just clicking Launch Studio again after coming back from Blueprint
    // shouldn't burn a Claude call. The explicit "Rewrite all" button in Studio
    // covers the deliberate-regen case.
    const allShotsHavePrompts = project.scenes.length > 0
      && project.scenes.every(s => s.shots.length > 0 && s.shots.every(x => !!x.visualPrompt));
    if (allShotsHavePrompts) {
      setCurrentStep(AppStep.STUDIO);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await api.writeShotPrompts(project.id);
      setProject(p);
      setCurrentStep(AppStep.STUDIO);
    } catch (err: any) {
      setError('Failed to prepare shot prompts: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUsePrevLastFrame = async (shotId: string) => {
    if (!project) return;
    setError(null);
    try {
      const p = await api.usePrevLastFrame(project.id, shotId);
      setProject(p);
    } catch (err: any) {
      setError('Failed to copy frame: ' + err.message);
    }
  };

  const updateShotOptimistic = (shotId: string, updates: Partial<VideoShot>) => {
    setProject(prev => prev ? {
      ...prev,
      scenes: prev.scenes.map(s => ({
        ...s,
        shots: s.shots.map(sh => sh.id === shotId ? { ...sh, ...updates } : sh)
      }))
    } : prev);
  };

  const handleClearShotFrame = async (shotId: string) => {
    if (!project) return;
    setError(null);
    const shot = project.scenes.flatMap(s => s.shots).find(s => s.id === shotId);
    const prev = { imageUrl: shot?.imageUrl, imageStatus: shot?.imageStatus, locked: shot?.locked };
    updateShotOptimistic(shotId, { imageUrl: undefined, imageStatus: GenerationStatus.IDLE, locked: false });
    try {
      await api.clearShotFrame(project.id, shotId);
    } catch (err: any) {
      updateShotOptimistic(shotId, prev as any);
      setError('Failed to clear frame: ' + err.message);
    }
  };

  const handleGenerateEndFrame = async (shotId: string, refs?: api.ShotRefInput[]) => {
    if (!project) return;
    updateShotOptimistic(shotId, { endImageStatus: GenerationStatus.LOADING });
    try {
      const p = await api.generateEndFrame(project.id, shotId, refs);
      setProject(p);
    } catch (err: any) {
      updateShotOptimistic(shotId, { endImageStatus: GenerationStatus.ERROR });
      setError(`End frame generation failed: ${err.message}`);
    }
  };

  const handleClearEndFrame = async (shotId: string) => {
    if (!project) return;
    const shot = project.scenes.flatMap(s => s.shots).find(s => s.id === shotId);
    const prev = { endImageUrl: shot?.endImageUrl, endImageStatus: shot?.endImageStatus, videoStatus: shot?.videoStatus };
    updateShotOptimistic(shotId, { endImageUrl: undefined, endImageStatus: GenerationStatus.IDLE, videoStatus: GenerationStatus.STALE });
    try {
      await api.clearEndFrame(project.id, shotId);
    } catch (err: any) {
      updateShotOptimistic(shotId, prev as any);
      setError(`Clear end frame failed: ${err.message}`);
    }
  };

  const handleClearExtractedFrame = async (shotId: string) => {
    if (!project) return;
    const shot = project.scenes.flatMap(s => s.shots).find(s => s.id === shotId);
    const prev = { extractedLastFrameUrl: shot?.extractedLastFrameUrl };
    updateShotOptimistic(shotId, { extractedLastFrameUrl: undefined });
    try {
      await api.clearExtractedFrame(project.id, shotId);
    } catch (err: any) {
      updateShotOptimistic(shotId, prev as any);
      setError(`Clear extracted frame failed: ${err.message}`);
    }
  };

  const handleUploadEndFrame = async (shotId: string, file: File) => {
    if (!project) return;
    try {
      const p = await api.uploadEndFrame(project.id, shotId, file);
      setProject(p);
    } catch (err: any) {
      setError(`Upload end frame failed: ${err.message}`);
    }
  };

  const handleUploadShotRef = async (shotId: string, file: File) => {
    if (!project) return;
    try {
      const result = await api.uploadShotRef(project.id, shotId, file);
      // Optimistic: add the ref to the shot
      updateShotOptimistic(shotId, {
        refImages: [...(project.scenes.flatMap(s => s.shots).find(s => s.id === shotId)?.refImages || []), result.ref],
      });
    } catch (err: any) {
      setError(`Upload ref failed: ${err.message}`);
    }
  };

  const handleDeleteShotRef = async (shotId: string, assetId: string) => {
    if (!project) return;
    const shot = project.scenes.flatMap(s => s.shots).find(s => s.id === shotId);
    const prev = shot?.refImages || [];
    updateShotOptimistic(shotId, { refImages: prev.filter(r => r.id !== assetId) });
    try {
      await api.deleteShotRef(project.id, shotId, assetId);
    } catch (err: any) {
      updateShotOptimistic(shotId, { refImages: prev });
      setError(`Delete ref failed: ${err.message}`);
    }
  };

  const handleRewriteShotPrompts = async (userNote?: string) => {
    if (!project) return;
    const signal = startOp('write-prompts');
    setLoading(true);
    setError(null);
    try {
      const p = await api.writeShotPrompts(project.id, userNote, signal);
      setProject(p);
    } catch (err: any) {
      if (!api.isCancelled(err)) setError('Failed to rewrite shot prompts: ' + err.message);
    } finally {
      endOp('write-prompts');
      setLoading(false);
    }
  };

  // ─── Project Settings ───────────────────────────────────────────

  const handleUpdateProject = async (updates: Record<string, any>) => {
    if (!project) return;
    setProject(prev => prev ? { ...prev, ...updates } : prev);
    try {
      await api.updateProject(project.id, updates);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Shot Image & Video ─────────────────────────────────────────

  const handleGenerateImage = async (sceneId: string, shotId: string, refs?: api.ShotRefInput[]) => {
    if (!project) return;
    const opKey = `image:${shotId}`;
    const signal = startOp(opKey);
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, imageStatus: GenerationStatus.LOADING } : sh)
        } : s)
      };
    });
    try {
      const p = await api.generateShotImage(project.id, shotId, refs, signal);
      setProject(p);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map(s => s.id === sceneId ? {
              ...s,
              shots: s.shots.map(sh => sh.id === shotId ? { ...sh, imageStatus: GenerationStatus.IDLE } : sh)
            } : s)
          };
        });
      } else {
        setError(`Image generation failed: ${err.message}`);
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map(s => s.id === sceneId ? {
              ...s,
              shots: s.shots.map(sh => sh.id === shotId ? { ...sh, imageStatus: GenerationStatus.ERROR } : sh)
            } : s)
          };
        });
      }
    } finally {
      endOp(opKey);
    }
  };

  const handleCancelShotImage = (shotId: string) => {
    if (!project) return;
    abortOp(`image:${shotId}`);
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => ({
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, imageStatus: GenerationStatus.IDLE } : sh)
        }))
      };
    });
    void api.cancelShotImage(project.id, shotId).catch((err: any) => {
      setError(`Cancel image failed: ${err.message}`);
    });
  };

  const handleCancelShotVideo = (shotId: string) => {
    if (!project) return;
    abortOp(`video:${shotId}`);
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => ({
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, videoStatus: GenerationStatus.IDLE } : sh)
        }))
      };
    });
    void api.cancelShotVideo(project.id, shotId).catch((err: any) => {
      setError(`Cancel video failed: ${err.message}`);
    });
  };

  const handleRefinePrompt = async (sceneId: string, shotId: string, feedback: string, referenceImage?: File) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.refineShotPrompt(project.id, shotId, feedback, referenceImage);
      setProject(p);
    } catch (err: any) {
      setError(`Prompt refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRefineEndFramePrompt = async (shotId: string, feedback: string, referenceImage?: File) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.refineEndFramePrompt(project.id, shotId, feedback, referenceImage);
      setProject(p);
    } catch (err: any) {
      setError(`End frame refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRefineVideoPrompt = async (shotId: string, feedback: string, referenceImage?: File) => {
    if (!project) return;
    setLoading(true);
    try {
      const result = await api.refineVideoPrompt(project.id, shotId, feedback, referenceImage);
      // Update motion prompt optimistically from response
      if (result?.motionPrompt) {
        updateShotOptimistic(shotId, { motionPrompt: result.motionPrompt });
      }
    } catch (err: any) {
      setError(`Video prompt refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUseAsPrevEnd = async (shotId: string) => {
    if (!project) return;
    try {
      const p = await api.useShotAsPrevEnd(project.id, shotId);
      setProject(p);
    } catch (err: any) {
      setError(`Reverse-chain failed: ${err.message}`);
    }
  };

  const handleRevertVideo = async (shotId: string, assetId: string) => {
    if (!project) return;
    try {
      const p = await api.revertShotVideo(project.id, shotId, assetId);
      setProject(p);
    } catch (err: any) {
      setError(`Revert failed: ${err.message}`);
    }
  };

  const handleLockShot = async (sceneId: string, shotId: string) => {
    if (!project) return;
    const scene = project.scenes.find(s => s.id === sceneId);
    const shot = scene?.shots.find(s => s.id === shotId);
    const wasLocked = shot?.locked;
    // Optimistic update — flip lock state immediately
    setProject(prev => prev ? {
      ...prev,
      scenes: prev.scenes.map(s => s.id === sceneId ? {
        ...s,
        shots: s.shots.map(sh => sh.id === shotId ? { ...sh, locked: !wasLocked } : sh)
      } : s)
    } : prev);
    try {
      wasLocked
        ? await api.unlockShot(project.id, shotId)
        : await api.lockShot(project.id, shotId);
    } catch (err: any) {
      // Revert on failure
      setProject(prev => prev ? {
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, locked: !!wasLocked } : sh)
        } : s)
      } : prev);
      setError(`${wasLocked ? 'Unlock' : 'Lock'} failed: ${err.message}`);
    }
  };

  const handleGenerateVideo = async (sceneId: string, shotId: string, promptOverride?: string, refs?: api.ShotRefInput[]) => {
    if (!project) return;
    const opKey = `video:${shotId}`;
    const signal = startOp(opKey);
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, videoStatus: GenerationStatus.LOADING } : sh)
        } : s)
      };
    });
    try {
      const p = await api.generateShotVideo(project.id, shotId, promptOverride, refs, signal);
      setProject(p);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        // Stop button pressed — roll the video back to idle so it doesn't
        // stay in the loading spinner and doesn't look like an error either.
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map(s => s.id === sceneId ? {
              ...s,
              shots: s.shots.map(sh => sh.id === shotId ? { ...sh, videoStatus: GenerationStatus.IDLE } : sh)
            } : s)
          };
        });
      } else {
        setError(err.message);
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map(s => s.id === sceneId ? {
              ...s,
              shots: s.shots.map(sh => sh.id === shotId ? { ...sh, videoStatus: GenerationStatus.ERROR } : sh)
            } : s)
          };
        });
      }
    } finally {
      endOp(opKey);
    }
  };

  const handleGenerateStoryboard = async (shotId: string) => {
    if (!project) return;
    updateShotOptimistic(shotId, { storyboardStatus: GenerationStatus.LOADING });
    const signal = startOp(`storyboard:${shotId}`);
    try {
      const result = await api.generateStoryboard(project.id, shotId, signal);
      setProject(result.project);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        updateShotOptimistic(shotId, { storyboardStatus: GenerationStatus.IDLE });
        return;
      }
      updateShotOptimistic(shotId, { storyboardStatus: GenerationStatus.ERROR });
      setError(`Storyboard generation failed: ${err.message}`);
    } finally {
      endOp(`storyboard:${shotId}`);
    }
  };

  const handleWriteStoryboardPrompt = async (shotId: string, feedback?: string) => {
    if (!project) return;
    updateShotOptimistic(shotId, { storyboardPromptStatus: GenerationStatus.LOADING, storyboardPromptUserFeedback: feedback });
    const signal = startOp(`storyboard-prompt:${shotId}`);
    try {
      const result = await api.writeStoryboardPrompt(project.id, shotId, feedback, signal);
      setProject(result.project);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        updateShotOptimistic(shotId, { storyboardPromptStatus: GenerationStatus.IDLE });
        return;
      }
      updateShotOptimistic(shotId, { storyboardPromptStatus: GenerationStatus.ERROR });
      setError(`Storyboard prompt write failed: ${err.message}`);
    } finally {
      endOp(`storyboard-prompt:${shotId}`);
    }
  };

  const handleRefineStoryboard = async (
    shotId: string,
    feedback: string,
    previousVersionId?: string,
    refineMode: api.StoryboardRefineMode = 'replan',
    referenceImage?: File
  ) => {
    if (!project || !feedback.trim()) return;
    if (refineMode === 'edit_image') {
      updateShotOptimistic(shotId, { storyboardStatus: GenerationStatus.LOADING, storyboardUserFeedback: feedback });
    } else {
      updateShotOptimistic(shotId, { storyboardPromptStatus: GenerationStatus.LOADING, storyboardPromptUserFeedback: feedback });
    }
    const signal = startOp(`storyboard-refine:${shotId}`);
    try {
      const result = await api.refineStoryboard(project.id, shotId, feedback, previousVersionId, refineMode, referenceImage, signal);
      setProject(result.project);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        updateShotOptimistic(shotId, refineMode === 'edit_image' ? { storyboardStatus: GenerationStatus.IDLE } : { storyboardPromptStatus: GenerationStatus.IDLE });
        return;
      }
      updateShotOptimistic(shotId, refineMode === 'edit_image' ? { storyboardStatus: GenerationStatus.ERROR } : { storyboardPromptStatus: GenerationStatus.ERROR });
      setError(`Storyboard refinement failed: ${err.message}`);
    } finally {
      endOp(`storyboard-refine:${shotId}`);
    }
  };

  /** Single stop affordance for any in-flight storyboard work on a shot.
   *  Only one of {generate, write-prompt, refine} can be running at a time
   *  per shot, so aborting all three keys is safe and avoids the UI having
   *  to know which action is actually live. */
  const handleCancelStoryboard = (shotId: string) => {
    if (!project) return;
    abortOp(`storyboard:${shotId}`);
    abortOp(`storyboard-prompt:${shotId}`);
    abortOp(`storyboard-refine:${shotId}`);
    updateShotOptimistic(shotId, {
      storyboardStatus: GenerationStatus.IDLE,
      storyboardPromptStatus: GenerationStatus.IDLE,
    });
  };

  const handleLockStoryboard = async (shotId: string, versionId?: string) => {
    if (!project) return;
    updateShotOptimistic(shotId, { storyboardLocked: true });
    try {
      const result = await api.lockStoryboard(project.id, shotId, versionId);
      setProject(result.project);
    } catch (err: any) {
      updateShotOptimistic(shotId, { storyboardLocked: false });
      setError(`Storyboard lock failed: ${err.message}`);
    }
  };

  const handleUnlockStoryboard = async (shotId: string) => {
    if (!project) return;
    updateShotOptimistic(shotId, { storyboardLocked: false });
    try {
      const result = await api.unlockStoryboard(project.id, shotId);
      setProject(result.project);
    } catch (err: any) {
      updateShotOptimistic(shotId, { storyboardLocked: true });
      setError(`Storyboard unlock failed: ${err.message}`);
    }
  };

  // Cut plan autosaves on blur — server returns { ok: true } and persists
  // cutPlanText on the active storyboard version's metadata. We don't refresh
  // the project (the new text is local to StoryboardPanel and used at video
  // generation time on the server), but we do let parent surface failures.
  const handleUpdateStoryboardPlan = async (shotId: string, cutPlanText: string, storyboardPrompt?: string) => {
    if (!project) return;
    try {
      const result = await api.updateStoryboardPlan(project.id, shotId, cutPlanText, storyboardPrompt);
      if (result?.project) setProject(result.project);
    } catch (err: any) {
      setError(`Cut plan save failed: ${err.message}`);
      throw err;
    }
  };

  // ─── Bulk Studio actions ────────────────────────────────────────
  // Frank Sinatra doesn't move his pianos — fire everything auto-firable.
  // Each button fires only what's actionable right now; chained shots stay
  // queued until their predecessor's video lands.

  // Worker-pool concurrency limiter. N workers pull jobs from a shared
  // index; when one finishes, the next job in line starts. This is what
  // "5 at a time, queue the rest" actually means — no artificial sleeps,
  // no fixed batches. Rejections are swallowed into the results array so
  // one failure doesn't abort the whole bulk.
  const beginBulkRun = () => {
    bulkStopRef.current.requested = false;
    bulkStopRef.current.controllers.clear();
    setBulkStopNotice(null);
  };

  const stopBulkRun = useCallback(() => {
    bulkStopRef.current.requested = true;
    bulkStopRef.current.controllers.forEach(ctrl => ctrl.abort());
    bulkStopRef.current.controllers.clear();
    setFrameQueue([]);
    setVideoQueue([]);
    setStoryboardPromptQueue([]);
    setStoryboardImageQueue([]);
    setBulkStopNotice('Stopped queued jobs. Active generations may still finish and appear when they complete.');
  }, []);

  const runWithConcurrency = async <T,>(
    items: T[],
    limit: number,
    fn: (item: T, signal: AbortSignal) => Promise<any>,
    onStart?: (item: T) => void,
  ): Promise<void> => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        if (bulkStopRef.current.requested) break;
        const idx = cursor++;
        if (bulkStopRef.current.requested) break;
        if (onStart) onStart(items[idx]);
        const ctrl = new AbortController();
        bulkStopRef.current.controllers.add(ctrl);
        try { await fn(items[idx], ctrl.signal); } catch (err) { /* logged by the handler */ }
        finally { bulkStopRef.current.controllers.delete(ctrl); }
      }
    });
    await Promise.all(workers);
  };

  const getReadyFrameTargets = (p: ApiProject) => {
    const targets: { sceneId: string; shotId: string }[] = [];
    const ignoreContinuity = p.videoModel?.startsWith('seedance');
    for (const scene of p.scenes) {
      scene.shots.forEach((shot, idx) => {
        if (shot.imageUrl) return;
        if (shot.imageStatus === GenerationStatus.LOADING) return;
        if (shot.imageStatus === GenerationStatus.ERROR) return;
        if (!ignoreContinuity && shot.continuityFrom === 'prev_shot' && idx > 0) {
          const prev = scene.shots[idx - 1];
          if (!prev?.videoUrl) return;
        }
        targets.push({ sceneId: scene.id, shotId: shot.id });
      });
    }
    return targets;
  };

  const getReadyStoryboardTargets = (p: ApiProject) => {
    // Image gen needs only the storyboard prompt. Cut plan is for the
    // downstream Seedance step (see c8385a0 — backend no longer gates image
    // gen on it). Locked shots are intentionally skipped — artist already
    // committed to a board. ERROR-status shots ARE included so a single bad
    // shot can be retried as part of the bulk run instead of forcing the
    // artist to click each one manually.
    const targets: { sceneId: string; shotId: string }[] = [];
    for (const scene of p.scenes) {
      scene.shots.forEach((shot) => {
        if (shot.storyboardLocked) return;
        if (!shot.storyboardPrompt?.trim()) return;
        if (shot.storyboardStatus === GenerationStatus.LOADING) return;
        targets.push({ sceneId: scene.id, shotId: shot.id });
      });
    }
    return targets;
  };

  const getReadyStoryboardPromptTargets = (p: ApiProject) => {
    const targets: { sceneId: string; shotId: string }[] = [];
    for (const scene of p.scenes) {
      scene.shots.forEach((shot) => {
        if (shot.storyboardPrompt?.trim()) return;
        if (shot.storyboardPromptStatus === GenerationStatus.LOADING) return;
        targets.push({ sceneId: scene.id, shotId: shot.id });
      });
    }
    return targets;
  };

  const handleBulkWriteStoryboardPrompts = async () => {
    if (!project) return;
    const targets = getReadyStoryboardPromptTargets(project);
    if (targets.length === 0) return;
    beginBulkRun();
    setStoryboardPromptQueue(targets.map(t => t.shotId));
    try {
      await runWithConcurrency(
        targets,
        5,
        (t, signal) => api.writeStoryboardPrompt(project.id, t.shotId, undefined, signal),
        t => {
          setStoryboardPromptQueue(q => q.filter(id => id !== t.shotId));
          updateShotOptimistic(t.shotId, { storyboardPromptStatus: GenerationStatus.LOADING });
        },
      );
      if (bulkStopRef.current.requested) return;
      const latest = await api.getProject(project.id);
      setProject(latest);
      // Bulk-complete notification. Fires regardless of tab focus — the
      // artist may be deep in another shot while this finished. Stopped
      // runs intentionally don't notify; the artist clicked Stop and
      // already knows the state.
      void notifyBulkComplete('Lahari · Prompts done', `${targets.length} storyboard prompt${targets.length === 1 ? '' : 's'} written.`);
    } finally {
      setStoryboardPromptQueue([]);
    }
  };

  const handleBulkGenerateStoryboards = async () => {
    if (!project) return;
    const targets = getReadyStoryboardTargets(project);
    if (targets.length === 0) return;
    beginBulkRun();
    setStoryboardImageQueue(targets.map(t => t.shotId));
    try {
      await runWithConcurrency(
        targets,
        2,
        (t, signal) => api.generateStoryboard(project.id, t.shotId, signal),
        t => {
          setStoryboardImageQueue(q => q.filter(id => id !== t.shotId));
          updateShotOptimistic(t.shotId, { storyboardStatus: GenerationStatus.LOADING });
        },
      );
      if (bulkStopRef.current.requested) return;
      const latest = await api.getProject(project.id);
      setProject(latest);
      void notifyBulkComplete('Lahari · Storyboards done', `${targets.length} board${targets.length === 1 ? '' : 's'} rendered.`);
    } finally {
      setStoryboardImageQueue([]);
    }
  };

  const handleBulkGenerateFrames = async () => {
    if (!project) return;
    let latestProject = project;
    // Multi-pass: each pass picks up newly-unblocked prev_shot frames as
    // earlier shots complete. Accumulate the total processed so the
    // notification body reflects the full job, not just the last pass.
    let totalFired = 0;
    beginBulkRun();
    try {
      while (true) {
        if (bulkStopRef.current.requested) break;
        const targets = getReadyFrameTargets(latestProject);
        if (targets.length === 0) break;
        totalFired += targets.length;
        const queueIds = targets.map(t => t.shotId);
        setFrameQueue(queueIds);
        await runWithConcurrency(
          targets,
          10,
          (t, signal) => api.generateShotImage(latestProject.id, t.shotId, undefined, signal),
          t => {
            setFrameQueue(q => q.filter(id => id !== t.shotId));
            setProject(prev => prev ? {
              ...prev,
              scenes: prev.scenes.map(s => ({
                ...s,
                shots: s.shots.map(sh =>
                  sh.id === t.shotId ? { ...sh, imageStatus: GenerationStatus.LOADING } : sh
                )
              }))
            } : prev);
          },
        );
        if (bulkStopRef.current.requested) break;
        // Refresh to see newly unblocked prev_shot frames
        latestProject = await api.getProject(latestProject.id);
        setProject(latestProject);
      }
      if (!bulkStopRef.current.requested && totalFired > 0) {
        void notifyBulkComplete('Lahari · Frames done', `${totalFired} shot frame${totalFired === 1 ? '' : 's'} generated.`);
      }
    } finally {
      setFrameQueue([]);
    }
  };

  const getReadyVideoTargets = (p: ApiProject) => {
    const targets: { sceneId: string; shotId: string }[] = [];
    const allowStoryboardVideo = p.videoModel?.startsWith('seedance');
    const ignoreContinuity = allowStoryboardVideo;
    for (const scene of p.scenes) {
      scene.shots.forEach((shot, idx) => {
        const hasVideoSource = !!shot.imageUrl || (allowStoryboardVideo && !!shot.storyboardLocked && !!shot.storyboardUrl);
        if (!hasVideoSource || shot.videoUrl) return;
        if (shot.videoStatus === GenerationStatus.LOADING) return;
        if (shot.videoStatus === GenerationStatus.ERROR) return;
        if (!ignoreContinuity && shot.continuityFrom === 'prev_shot' && idx > 0) {
          const prev = scene.shots[idx - 1];
          if (!prev?.videoUrl) return;
        }
        targets.push({ sceneId: scene.id, shotId: shot.id });
      });
    }
    return targets;
  };

  const handleBulkGenerateVideos = async () => {
    if (!project) return;
    let latestProject = project;
    let totalFired = 0;
    beginBulkRun();
    try {
      while (true) {
        if (bulkStopRef.current.requested) break;
        const targets = getReadyVideoTargets(latestProject);
        if (targets.length === 0) break;
        totalFired += targets.length;
        const queueIds = targets.map(t => t.shotId);
        setVideoQueue(queueIds);
        // Throttle to 5 concurrent. Sized for Segmind rate limits.
        await runWithConcurrency(
          targets,
          5,
          (t, signal) => api.generateShotVideo(latestProject.id, t.shotId, undefined, undefined, signal),
          t => {
            setVideoQueue(q => q.filter(id => id !== t.shotId));
            setProject(prev => prev ? {
              ...prev,
              scenes: prev.scenes.map(s => ({
                ...s,
                shots: s.shots.map(sh =>
                  sh.id === t.shotId ? { ...sh, videoStatus: GenerationStatus.LOADING } : sh
                )
              }))
            } : prev);
          },
        );
        if (bulkStopRef.current.requested) break;
        // Refresh to see newly unblocked prev_shot shots
        latestProject = await api.getProject(latestProject.id);
        setProject(latestProject);
      }
      if (!bulkStopRef.current.requested && totalFired > 0) {
        void notifyBulkComplete('Lahari · Videos done', `${totalFired} shot clip${totalFired === 1 ? '' : 's'} generated.`);
      }
    } finally {
      setVideoQueue([]);
    }
  };

  const handleUpdateShot = async (sceneId: string, shotId: string, updates: Partial<VideoShot>) => {
    if (!project) return;
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, ...updates } : sh)
        } : s)
      };
    });
    api.updateShot(project.id, shotId, updates).catch(console.error);
  };

  // ─── Chat ───────────────────────────────────────────────────────

  const handleChatMessage = async (text: string) => {
    if (!project) return;
    setProject(prev => prev ? {
      ...prev,
      chatHistory: [...prev.chatHistory, { role: 'user' as const, text }]
    } : prev);
    setChatLoading(true);
    try {
      const result = await api.sendChatMessage(project.id, text);
      setProject(result.project);
    } catch {
      setProject(prev => prev ? {
        ...prev,
        chatHistory: [...prev.chatHistory, { role: 'model' as const, text: 'Error connecting to AI.' }]
      } : prev);
    } finally {
      setChatLoading(false);
    }
  };

  // ─── Queue: Start Production ──────────────────────────────────────

  const handleStartProduction = async (queueId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.startProduction(queueId);
      setProject(result.project);
      setLookCandidates({});
      setActiveSceneIdx(0);
      // For fresh starts (analyzing) jump to Blueprint; for existing/forked
      // projects route to whatever phase the project is in.
      if (result.project.status === 'analyzing' || result.project.status === 'analyzed') {
        setCurrentStep(AppStep.BLUEPRINT);
      } else {
        navigateToPhase(result.project);
      }
      // Poll for analysis completion if still analyzing
      if (result.project.status === 'analyzing') {
        const projectId = result.project.id;
        const poll = setInterval(async () => {
          try {
            const p = await api.getProject(projectId);
            if (p.status !== 'analyzing') {
              clearInterval(poll);
              setProject(p);
            }
          } catch { /* ignore polling errors */ }
        }, 3000);
        // Safety: stop polling after 2 minutes
        setTimeout(() => clearInterval(poll), 120000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start production');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setLoading(true);
    try {
      const p = await api.getProject(projectId);
      setProject(p);
      setLookCandidates({});
      setActiveSceneIdx(0);
      navigateToPhase(p);
    } catch (err: any) {
      setError('Failed to load project: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Project Sidebar ──────────────────────────────────────────

  const openSidebar = async () => {
    setSidebarOpen(true);
    setProjectListLoading(true);
    try {
      const list = await api.listProjects();
      setProjectList(list);
    } catch {
      setProjectList([]);
    } finally {
      setProjectListLoading(false);
    }
  };

  const loadProject = async (id: string) => {
    if (project?.id === id) { setSidebarOpen(false); return; }
    setLoading(true);
    setSidebarOpen(false);
    try {
      const p = await api.getProject(id);
      setProject(p);
      setLookCandidates({});
      setActiveSceneIdx(0);
      navigateToPhase(p);
    } catch (err: any) {
      setError('Failed to load project: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Navigation ─────────────────────────────────────────────────

  const isStudio = currentStep === AppStep.STUDIO;

  return (
    <div className="min-h-screen bg-obsidian-950 text-zinc-100 font-sans flex flex-col h-screen overflow-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[999] focus:top-2 focus:left-2 focus:bg-white focus:text-black focus:px-4 focus:py-2 focus:rounded-md focus:text-sm">Skip to content</a>
      {/* Header — premium minimalist nav */}
      <header className="h-14 bg-[#141418]/90 backdrop-blur-xl border-b border-white/[0.06] flex-shrink-0 z-50">
        <div className="h-full px-6 flex items-center gap-8">
          {/* Brand + Project breadcrumb */}
          <button
            onClick={openSidebar}
            className="flex items-center gap-2.5 group outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md flex-shrink-0"
          >
            <span className="text-sm font-display font-semibold text-white tracking-tight">Lahari</span>
            {project && (
              <>
                <span className="text-zinc-400/60 text-sm">/</span>
                <span className="text-sm text-zinc-300 group-hover:text-white transition-colors truncate max-w-[200px]">{project.title}</span>
              </>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400/60 group-hover:text-zinc-300 transition-colors flex-shrink-0"><path d="M6 9l6 6 6-6"/></svg>
          </button>

          {/* Pipeline nav — minimal underline indicator, matches blueprint phase tabs */}
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {PIPELINE_STEPS.map((step) => {
              const isActive = currentStep === step.id;
              // Render is gated on a data-derived signal (any shot has a video)
              // instead of project.status because `in_production` is never set
              // server-side and status can otherwise drift on forks / legacy
              // projects, locking artists out of Render even though they have
              // material to assemble. Studio keeps the status check because it
              // gates access to AI-gen surfaces, not to artist-owned assembly.
              const hasRenderableContent = !!project && project.scenes.some(s => s.shots.some(sh => !!sh.videoUrl));
              const isAccessible =
                step.id === AppStep.UPLOAD ||
                (project && step.id === AppStep.BLUEPRINT) ||
                (project && step.id === AppStep.STUDIO && project.scenes.length > 0 && ['characters_locked', 'environments_locked', 'in_production', 'completed'].includes(project.status)) ||
                (project && step.id === AppStep.RENDER && hasRenderableContent);

              return (
                <button
                  key={step.id}
                  disabled={!isAccessible}
                  onClick={() => setCurrentStep(step.id)}
                  className={`relative px-3.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md ${
                    isActive
                      ? 'text-white'
                      : isAccessible
                        ? 'text-zinc-400 hover:text-white'
                        : 'text-zinc-400/40 cursor-not-allowed'
                  }`}
                >
                  {step.label}
                  {isActive && <span aria-hidden="true" className="absolute left-3.5 right-3.5 -bottom-[12px] h-px bg-white/70" />}
                </button>
              );
            })}

            {/* Scene picker lives in the Studio sticky bar — one source of
                truth instead of duplicated in the main nav. */}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Prompts library — always available, cross-project reference. */}
            <button
              onClick={() => setPromptsOpen(true)}
              className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono uppercase tracking-wider"
              title="Prompts — the templates that drive every AI call"
            >
              Prompts
            </button>
            <div className="w-px h-4 bg-white/[0.06]" />
            <button
              onClick={signOut}
              className="flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none group"
              title={`Signed in as ${user.email || 'user'} — click to sign out`}
            >
              {user.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="" className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-300 font-medium">
                  {(user.email || '?')[0].toUpperCase()}
                </div>
              )}
              <span className="text-[11px] text-zinc-400 group-hover:text-white transition-colors hidden lg:inline">{user.email?.split('@')[0]}</span>
            </button>
            {project && <div className="w-px h-4 bg-white/[0.06]" />}
            {project && (
              <>
                <span
                  className="text-[11px] font-mono text-zinc-400 tabular-nums px-2"
                  title="Actual spend so far (logged per AI call)"
                >${project.costEstimate.toFixed(2)}</span>
                {(() => {
                  // Projected cost to finish the remaining pipeline at current
                  // state: frames not yet generated + videos not yet generated
                  // (using the selected video model's per-sec price) + a small
                  // Claude overhead for chain prompt refreshes. Shown alongside
                  // actual spend so artists can decide before mass-firing.
                  const model = getVideoModel(project.videoModel);
                  let framesRemaining = 0;
                  let videoCostRemaining = 0;
                  let chainRefreshesRemaining = 0;
                  for (const scene of project.scenes || []) {
                    for (const shot of scene.shots) {
                      if (!shot.imageUrl) framesRemaining += 1;
                      if (!shot.videoUrl) videoCostRemaining += (shot.duration || model.durations[0]) * model.costPerSec;
                      // Chain refresh fires when a chained shot's predecessor video lands
                      if (shot.continuityFrom === 'prev_shot' && !shot.refinedFromPrevFrame) chainRefreshesRemaining += 1;
                    }
                  }
                  const frameCost = framesRemaining * 0.04; // Gemini 3 Pro Image per 3-call batch
                  const chainCost = chainRefreshesRemaining * 0.01;
                  const projected = frameCost + videoCostRemaining + chainCost;
                  if (projected < 0.01) return null;
                  return (
                    <span
                      className="text-[11px] font-mono text-zinc-400 tabular-nums px-2"
                      title={`Projected remaining at current model (${model.label}): ${framesRemaining} frame${framesRemaining === 1 ? '' : 's'} × $0.04 + videos (${videoCostRemaining.toFixed(2)}) + chain refreshes (${chainCost.toFixed(2)}).`}
                    >
                      + <span className="text-zinc-300">~${projected.toFixed(2)}</span>
                    </span>
                  );
                })()}
                <div className="w-px h-4 bg-white/[0.06]" />
                <button
                  onClick={() => setXrayOpen(true)}
                  className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono uppercase tracking-wider"
                >
                  X-Ray
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main id="main-content" className="flex-1 overflow-y-auto relative">
          {/* Loading overlay — visible during project switch */}
          {loading && !project && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#141418]/80 backdrop-blur-sm">
              <div className="text-sm text-zinc-400 animate-pulse">Loading…</div>
            </div>
          )}
          {loading && project && (
            <div className="absolute top-3 right-4 z-50">
              <div className="text-[11px] text-zinc-500 animate-pulse">Loading…</div>
            </div>
          )}

          <div className="relative z-10 w-full p-8">
            {/* Prompts library — full-page overlay over the current pipeline state. */}
            <AnimatePresence>
              {promptsOpen && (
                <motion.div
                  key="prompts-library"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  <PromptsLibrary onBack={() => setPromptsOpen(false)} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Page transitions — hidden while Prompts library is open to
                preserve pipeline state underneath without double-rendering. */}
            <AnimatePresence mode="wait">
              {!promptsOpen && currentStep === AppStep.UPLOAD && (
                <motion.div key="queue" {...pageTransition}>
                  <Dashboard
                    onStartProduction={handleStartProduction}
                    onOpenProject={handleOpenProject}
                    onViewRenders={(projectId, title) => setRendersFor({ id: projectId, title })}
                  />
                </motion.div>
              )}

              {!promptsOpen && currentStep === AppStep.BLUEPRINT && project && (
                <motion.div key="blueprint" {...pageTransition}>
                  <AnalysisEditor
                    project={project}
                    isLoading={loading}
                    looksLoading={looksLoading}
                    lookCandidates={lookCandidates}
                    onSetLookCandidates={(id, candidates) => setLookCandidates(prev => ({ ...prev, [id]: candidates }))}
                    onDiscardLookCandidates={(id) => setLookCandidates(prev => ({ ...prev, [id]: [] }))}
                    onLockConcept={handleLockConcept}
                    onUnlockConcept={handleUnlockConcept}
                    onRefineConcept={handleRefineConcept}
                    onUpdateConcept={handleUpdateConcept}
                    onUnlockScript={handleUnlockScript}
                    onUnlockCharacters={handleUnlockCharacters}
                    onUnlockEnvironments={handleUnlockEnvironments}
                    onLockStyle={handleLockStyle}
                    onUnlockStyle={handleUnlockStyle}
                    onGenerateLooks={handleGenerateLooks}
                    onLockCharacter={handleLockCharacter}
                    onAddCast={handleAddCast}
                    onUpdateCast={handleUpdateCast}
                    onDeleteCast={handleDeleteCast}
                    onConfirmDestructive={(opts) => setDestructive({
                      title: opts.title,
                      description: opts.description,
                      mode: 'simple',
                      confirmLabel: opts.confirmLabel,
                      run: async () => { await opts.run(); return null; },
                    })}
                    onGenerateScript={handleGenerateScript}
                    onRefineScript={handleRefineScript}
                    onUpdateScene={handleUpdateScene}
                    onUpdateShot={handleUpdateShot}
                    onGenerateConcepts={handleGenerateConcepts}
                    onCancelConcepts={handleCancelConcepts}
                    onCancelScript={() => abortOp('script')}
                    onUpdateProject={handleUpdateProject}
                    onLaunchStudio={handleLaunchStudio}
                    onAdvanceCharacters={handleAdvanceCharacters}
                    onAdvanceEnvironments={handleAdvanceEnvironments}
                    onSetProject={setProject}
                  />
                </motion.div>
              )}

              {!promptsOpen && currentStep === AppStep.STUDIO && project && (
                <motion.div key="studio" {...pageTransition}>
                  <Storyboard
                    scenes={project.scenes}
                    project={project}
                    activeSceneIdx={activeSceneIdx}
                    onSceneChange={setActiveSceneIdx}
                    onUpdateShot={handleUpdateShot}
                    onGenerateImage={handleGenerateImage}
                    onGenerateVideo={handleGenerateVideo}
                    onWriteStoryboardPrompt={handleWriteStoryboardPrompt}
                    onGenerateStoryboard={handleGenerateStoryboard}
                    onRefineStoryboard={handleRefineStoryboard}
                    onCancelStoryboard={handleCancelStoryboard}
                    onLockStoryboard={handleLockStoryboard}
                    onUnlockStoryboard={handleUnlockStoryboard}
                    onUpdateStoryboardPlan={handleUpdateStoryboardPlan}
                    onCancelShotImage={handleCancelShotImage}
                    onCancelShotVideo={handleCancelShotVideo}
                    onLockShot={handleLockShot}
                    onRevertVideo={handleRevertVideo}
                    onUseAsPrevEnd={handleUseAsPrevEnd}
                    onRefinePrompt={handleRefinePrompt}
                    onUpdateProject={handleUpdateProject}
                    onRewriteShotPrompts={handleRewriteShotPrompts}
                    onCancelRewritePrompts={() => abortOp('write-prompts')}
                    onBulkGenerateFrames={handleBulkGenerateFrames}
                    onBulkGenerateVideos={handleBulkGenerateVideos}
                    onBulkWriteStoryboardPrompts={handleBulkWriteStoryboardPrompts}
                    onBulkGenerateStoryboards={handleBulkGenerateStoryboards}
                    onCancelBulk={stopBulkRun}
                    bulkStopNotice={bulkStopNotice}
                    frameQueue={frameQueue}
                    videoQueue={videoQueue}
                    storyboardPromptQueue={storyboardPromptQueue}
                    storyboardImageQueue={storyboardImageQueue}
                    onUsePrevLastFrame={handleUsePrevLastFrame}
                    onClearShotFrame={handleClearShotFrame}
                    onGenerateEndFrame={handleGenerateEndFrame}
                    onClearEndFrame={handleClearEndFrame}
                    onClearExtractedFrame={handleClearExtractedFrame}
                    onUploadEndFrame={handleUploadEndFrame}
                    onRefineEndFramePrompt={handleRefineEndFramePrompt}
                    onRefineVideoPrompt={handleRefineVideoPrompt}
                    onUploadShotRef={handleUploadShotRef}
                    onDeleteShotRef={handleDeleteShotRef}
                    onSetProject={setProject}
                    isLoading={loading}
                  />
                </motion.div>
              )}

              {!promptsOpen && currentStep === AppStep.RENDER && project && (
                <motion.div key="render" {...pageTransition}>
                  <StepRender
                    project={project}
                    onBack={() => setCurrentStep(AppStep.STUDIO)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Co-Director sidebar — commented out, not wired yet
        {isStudio && (
          <aside className="w-80 lg:w-96 flex-shrink-0 z-20 shadow-2xl bg-obsidian-950/80 backdrop-blur-xl shadow-[inset_1px_0_0_0_rgba(255,255,255,0.04)]">
            <ChatAssistant
              messages={project?.chatHistory || []}
              onSendMessage={handleChatMessage}
              isLoading={chatLoading}
            />
          </aside>
        )}
        */}
      </div>

      {/* Destructive action dialog — Fork is primary, Overwrite is secondary */}
      <AnimatePresence>
        {destructive && (
          <>
            <motion.div
              key="destructive-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="fixed inset-0 bg-black/70 z-[200] backdrop-blur-sm"
              onClick={() => setDestructive(null)}
            />
            <motion.div
              key="destructive-dialog"
              initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.15 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,480px)] surface-raised rounded-xl z-[201] p-6 space-y-5"
            >
              <div className="space-y-2">
                <h3 className="text-lg font-medium text-white">{destructive.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{destructive.description}</p>
              </div>
              {destructive.mode !== 'simple' && (
                <div className="surface-inset rounded-md p-3 text-xs text-zinc-400 leading-relaxed">
                  <strong className="text-zinc-300">Fork</strong> creates a copy with a new name and performs the change on it. Original stays frozen as a snapshot you can open from the sidebar.
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setDestructive(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-300 px-3 py-2 rounded-md transition-colors"
                >Cancel</button>
                {destructive.mode === 'simple' ? (
                  <button
                    onClick={() => runDestructive(false)}
                    className="text-xs font-semibold bg-red-500/90 text-white hover:bg-red-500 px-4 py-2 rounded-md transition-colors"
                  >{destructive.confirmLabel || 'Confirm'}</button>
                ) : (
                  <>
                    <button
                      onClick={() => runDestructive(false)}
                      className="text-xs text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] px-3 py-2 rounded-md transition-colors"
                    >{destructive.overwriteLabel || 'Overwrite'}</button>
                    <button
                      onClick={() => runDestructive(true)}
                      className="text-xs font-semibold bg-white text-black hover:bg-zinc-200 px-4 py-2 rounded-md transition-colors"
                    >Fork & change</button>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Project Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              key="sidebar-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-black/60 z-[100]"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              key="sidebar-panel"
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              className="fixed top-0 left-0 bottom-0 w-80 bg-obsidian-900 border-r border-white/[0.06] z-[101] flex flex-col"
            >
              <div className="h-14 px-5 flex items-center justify-between border-b border-white/[0.06] flex-shrink-0">
                <span className="text-sm font-medium text-white">Projects</span>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="text-zinc-400 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md p-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {projectListLoading ? (
                  <div className="space-y-2 p-2">
                    {[1, 2, 3].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}
                  </div>
                ) : projectList.length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-8">No projects yet</p>
                ) : (() => {
                  // Build lineage tree: orig -> children -> grandchildren, flattened
                  // with depth so we can indent. Families sort by latest activity
                  // anywhere in the lineage, so the thing you just touched floats up.
                  const childrenOf = new Map<string, ProjectSummary[]>();
                  projectList.forEach(p => {
                    if (p.parentProjectId) {
                      const arr = childrenOf.get(p.parentProjectId) || [];
                      arr.push(p);
                      childrenOf.set(p.parentProjectId, arr);
                    }
                  });
                  const byId = new Map(projectList.map(p => [p.id, p]));
                  const roots = projectList.filter(p => !p.parentProjectId || !byId.has(p.parentProjectId));
                  const flat: { project: ProjectSummary; depth: number }[] = [];
                  const activityMs = (p: ProjectSummary) => new Date(p.lastActivityAt || p.updatedAt || p.createdAt).getTime();
                  const subtreeActivityMs = (p: ProjectSummary): number => Math.max(
                    activityMs(p),
                    ...(childrenOf.get(p.id) || []).map(subtreeActivityMs)
                  );
                  const sortByActivity = (a: ProjectSummary, b: ProjectSummary) => subtreeActivityMs(b) - subtreeActivityMs(a);
                  const walk = (p: ProjectSummary, depth: number) => {
                    flat.push({ project: p, depth });
                    const kids = (childrenOf.get(p.id) || []).sort(sortByActivity);
                    kids.forEach(k => walk(k, depth + 1));
                  };
                  roots.sort(sortByActivity).forEach(r => walk(r, 0));

                  return (
                    <div className="space-y-px">
                      {flat.map(({ project: p, depth }) => {
                        const isActive = project?.id === p.id;
                        const isFork = !!p.parentProjectId && byId.has(p.parentProjectId);
                        const lastActivityAt = p.lastActivityAt || p.updatedAt || p.createdAt;
                        const lastActivityDate = new Date(lastActivityAt.includes('T') || lastActivityAt.includes('Z') ? lastActivityAt : lastActivityAt.replace(' ', 'T') + 'Z');
                        return (
                          <div
                            key={p.id}
                            className={`group relative rounded-md transition-colors ${
                              isActive
                                ? 'bg-white/[0.08]'
                                : 'hover:bg-white/[0.03]'
                            }`}
                            style={{ paddingLeft: depth * 14 }}
                          >
                            {/* Fork guide line */}
                            {depth > 0 && (
                              <span
                                aria-hidden="true"
                                className="absolute left-3 top-0 bottom-0 w-px bg-white/[0.08]"
                                style={{ left: (depth - 1) * 14 + 14 }}
                              />
                            )}
                            {renamingId === p.id ? (
                              <div className="w-full px-3 py-2 flex items-center gap-2">
                                {isFork && (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 flex-shrink-0" aria-hidden="true">
                                    <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9v1a4 4 0 0 1-4 4H8"/><path d="M6 8v7"/>
                                  </svg>
                                )}
                                <input
                                  autoFocus
                                  value={renameDraft}
                                  onChange={e => setRenameDraft(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
                                    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                                  }}
                                  onBlur={saveRename}
                                  className="flex-1 bg-white/[0.04] text-sm text-white border border-white/[0.12] rounded px-2 py-1 outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                                />
                              </div>
                            ) : (
                              <button
                                onClick={() => loadProject(p.id)}
                                className="w-full text-left px-3 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {isFork && (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 flex-shrink-0" aria-hidden="true">
                                      <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9v1a4 4 0 0 1-4 4H8"/><path d="M6 8v7"/>
                                    </svg>
                                  )}
                                  <span className={`text-sm truncate ${isActive ? 'text-white font-medium' : 'text-zinc-300 group-hover:text-white'}`}>
                                    {p.title}
                                  </span>
                                  <span className="text-[11px] text-zinc-400 flex-shrink-0 ml-auto group-hover:invisible" title={`Last activity ${lastActivityDate.toLocaleString()}`}>
                                    {relativeTime(lastActivityAt)}
                                  </span>
                                </div>
                              </button>
                            )}
                            {/* Delete button — hover reveal, does not shift layout */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDestructive({
                                  title: `Delete "${p.title}"?`,
                                  description: 'Removes the project from the list. Generated files stay on disk and can be re-linked later if needed.',
                                  mode: 'simple',
                                  confirmLabel: 'Delete',
                                  run: async () => {
                                    await api.deleteProject(p.id);
                                    setProjectList(list => list.filter(x => x.id !== p.id));
                                    if (project?.id === p.id) setProject(null);
                                  },
                                });
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Delete project"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                              </svg>
                            </button>
                            {/* Rename — pencil sits just left of delete. */}
                            {renamingId !== p.id && (
                              <button
                                onClick={(e) => { e.stopPropagation(); startRename(p.id, p.title); }}
                                className="absolute right-9 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Rename project"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                                </svg>
                              </button>
                            )}
                            {/* Renders — film icon, opens popup viewer. Only
                                shown when this project has at least one render. */}
                            {renamingId !== p.id && (p.renderCount ?? 0) > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setRendersFor({ id: p.id, title: p.title }); }}
                                className="absolute right-16 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
                                title="View renders"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Renders viewer popup — accessible from Dashboard rows and sidebar entries */}
      {rendersFor && (
        <RendersModal
          projectId={rendersFor.id}
          projectTitle={rendersFor.title}
          onClose={() => setRendersFor(null)}
        />
      )}

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.15 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-[200] max-w-md w-full px-4"
          >
            <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-center justify-between gap-2 shadow-lg shadow-black/30">
              <span className="text-[12px] text-red-300 line-clamp-2">{error}</span>
              <button onClick={() => setError(null)} className="text-zinc-400 hover:text-white flex-shrink-0 p-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* X-Ray Panel */}
      {project && (
        <XRayPanel
          projectId={project.id}
          isOpen={xrayOpen}
          onClose={() => setXrayOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
