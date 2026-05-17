import React, { useState, useEffect, useCallback } from 'react';
import * as api from '../services/api';

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

export const ConnectPage: React.FC<{
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
