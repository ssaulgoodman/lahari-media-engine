import React, { useState, useEffect, useCallback } from 'react';
import * as api from '../services/api';

type ProviderKey = 'segmind' | 'gemini' | 'elevenlabs' | 'anthropic' | 'openai';

type KeyStatus = {
  provider: ProviderKey;
  label: string;
  isSet: boolean;
  lastUsedAt: string | null;
  lastError: string | null;
};

type ProviderInfo = {
  key: ProviderKey;
  label: string;
  description: string;
  docsUrl: string;
  placeholder: string;
};

// Workflow → required-provider list. Used both for the per-workflow readiness
// pill at the top of the Required section and for deriving the unique required
// provider set.
const REQUIRED_PROVIDERS: Record<string, { label: string; providers: ProviderInfo[] }> = {
  music_led: {
    label: 'Music Video',
    providers: [
      {
        key: 'segmind',
        label: 'Segmind',
        description: 'Image generation (Nano Banana Pro/2) and video generation (Seedance, Veo).',
        docsUrl: 'https://www.segmind.com/api-keys',
        placeholder: 'SG_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
      {
        key: 'gemini',
        label: 'Google AI Studio',
        description: 'Audio analysis, transcription, and structure detection.',
        docsUrl: 'https://aistudio.google.com/apikey',
        placeholder: 'AIzaSy...',
      },
    ],
  },
  scripted_narrative: {
    label: 'Scripted Narrative',
    providers: [
      {
        key: 'segmind',
        label: 'Segmind',
        description: 'Image generation (Nano Banana Pro/2) and video generation (Seedance, Veo).',
        docsUrl: 'https://www.segmind.com/api-keys',
        placeholder: 'SG_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
      {
        key: 'elevenlabs',
        label: 'ElevenLabs',
        description: 'Text-to-speech for character dialogue.',
        docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
        placeholder: 'sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
    ],
  },
};

const OPTIONAL_PROVIDERS: ProviderInfo[] = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    description: 'Powers Generate Concept, Script, Refine, and other AI buttons in the web studio.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-api03-...',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    description: 'GPT Image 2 storyboards and optional GPT script writer.',
    docsUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-proj-...',
  },
];

const allRequiredProviders = (): ProviderInfo[] => {
  const seen = new Set<ProviderKey>();
  const result: ProviderInfo[] = [];
  for (const workflow of Object.values(REQUIRED_PROVIDERS)) {
    for (const p of workflow.providers) {
      if (!seen.has(p.key)) {
        seen.add(p.key);
        result.push(p);
      }
    }
  }
  return result;
};

// Single-line, dense row. Provider name → (i) tooltip → status pill →
// inline last-used / last-error. Rotate/Set + Remove on the right.
const KeyRow: React.FC<{
  provider: ProviderInfo;
  status: KeyStatus | undefined;
  onSet: (provider: ProviderKey) => void;
  onDelete: (provider: ProviderKey) => void;
  deleting: boolean;
}> = ({ provider, status, onSet, onDelete, deleting }) => {
  const isSet = status?.isSet ?? false;

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 group">
      <div className="min-w-0 flex-1 flex items-center gap-2.5 flex-wrap">
        <span className="text-sm text-white font-medium">{provider.label}</span>
        <span
          className="text-zinc-400/70 hover:text-zinc-200 cursor-help transition-colors"
          title={provider.description}
          aria-label={provider.description}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
          </svg>
        </span>
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
            isSet
              ? 'text-emerald-300/90 bg-emerald-500/10'
              : 'text-amber-300/90 bg-amber-500/10'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isSet ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          {isSet ? 'Set' : 'Not set'}
        </span>
        {status?.lastUsedAt && (
          <span className="text-[11px] text-zinc-400 truncate" title={`Last used ${new Date(status.lastUsedAt).toLocaleString()}`}>
            · used {new Date(status.lastUsedAt).toLocaleDateString()}
          </span>
        )}
        {status?.lastError && (
          <span className="text-[11px] text-red-400/80 truncate" title={status.lastError}>· last call errored</span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onSet(provider.key)}
          className="px-2.5 py-1 text-xs text-zinc-300 hover:text-white surface-inset rounded-md hover:bg-white/[0.06] transition-colors"
        >
          {isSet ? 'Rotate' : 'Set key'}
        </button>
        {isSet && (
          <button
            onClick={() => onDelete(provider.key)}
            disabled={deleting}
            className="px-2.5 py-1 text-xs text-zinc-400 hover:text-red-300 surface-inset rounded-md hover:bg-red-500/[0.06] transition-colors disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
};

// Field styling matches the platform's input density (BlueprintContextBar,
// ScriptPhase, StartProject share this exact shape).
const FIELD_BASE = 'w-full surface-inset rounded-md px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-1 focus-visible:ring-white/20';

const SetKeyModal: React.FC<{
  provider: ProviderInfo;
  onSave: (value: string, label?: string) => Promise<void>;
  onClose: () => void;
}> = ({ provider, onSave, onClose }) => {
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed, label.trim() || undefined);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save key');
    } finally {
      setSaving(false);
    }
  };

  // Escape closes, Enter on the key input submits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="setkey-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md surface-raised rounded-xl p-5">
        <h3 id="setkey-title" className="text-lg font-display text-white tracking-tight mb-1">
          {provider.label} API Key
        </h3>
        <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
          Encrypted at rest and never shown again after save.
        </p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">API key</label>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
              placeholder={provider.placeholder}
              autoFocus
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={`${FIELD_BASE} font-mono`}
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
              Label <span className="text-zinc-400 normal-case tracking-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
              placeholder={`e.g. "personal", "team account"`}
              className={FIELD_BASE}
            />
          </div>
        </div>

        <p className="text-[11px] text-zinc-400 mb-4 leading-relaxed">
          Get your key at{' '}
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-300 hover:text-white underline underline-offset-2 transition-colors"
          >
            {provider.docsUrl.replace('https://', '').split('/')[0]}
          </a>
        </p>

        {error && (
          <div className="mb-4 text-xs text-red-300 surface-inset rounded-md px-3 py-2 border-l-2 border-red-400/60">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!value.trim() || saving}
            className="px-4 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-40 transition-colors inline-flex items-center gap-2"
          >
            {saving && <span className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save key'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const AccountKeys: React.FC<{
  user: { id: string; email?: string | null } | null;
  signOut: () => Promise<void>;
}> = ({ user, signOut }) => {
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalProvider, setModalProvider] = useState<ProviderInfo | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<ProviderKey | null>(null);

  const loadKeys = useCallback(async () => {
    if (!user) return;
    try {
      const resp = await api.listApiKeys();
      setKeys(resp.data?.providers || []);
    } catch (err: any) {
      setError(err.message || 'Could not load API keys');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const handleSet = (providerKey: ProviderKey) => {
    const all = [...allRequiredProviders(), ...OPTIONAL_PROVIDERS];
    const info = all.find((p) => p.key === providerKey);
    if (info) setModalProvider(info);
  };

  const handleSave = async (value: string, label?: string) => {
    if (!modalProvider) return;
    await api.setApiKey(modalProvider.key, value, label);
    await loadKeys();
  };

  const handleDelete = async (providerKey: ProviderKey) => {
    setDeletingProvider(providerKey);
    try {
      await api.deleteApiKey(providerKey);
      await loadKeys();
    } catch (err: any) {
      setError(err.message || 'Could not delete key');
    } finally {
      setDeletingProvider(null);
    }
  };

  const getStatus = (providerKey: ProviderKey) => keys.find((k) => k.provider === providerKey);

  // history.back() returns the user to wherever they came from (their open
  // project, /connect, etc.). If they typed the URL directly with no history,
  // fall back to "/".
  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  };

  if (!user) return null;

  const required = allRequiredProviders();

  return (
    <div className="min-h-screen bg-[#141418] text-white px-6 py-12 relative overflow-hidden">
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[400px] rounded-full bg-white/[0.012] blur-3xl" />
      </div>

      <div className="max-w-2xl mx-auto relative">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-3">Account</p>
            <h1 className="text-2xl font-display text-white mb-1.5 tracking-tight">API Keys</h1>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-md">
              Mirage uses your own API keys for every paid provider. Keys are encrypted at rest and never logged.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={goBack}
              className="px-2.5 py-1 text-xs text-zinc-400 hover:text-white surface-inset rounded-md hover:bg-white/[0.06] transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={signOut}
              className="px-2.5 py-1 text-xs text-zinc-400 hover:text-white surface-inset rounded-md hover:bg-white/[0.06] transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-5 px-3 py-2 rounded-md surface-inset border-l-2 border-amber-400/60 flex items-start gap-3 text-sm text-amber-200/90">
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-[11px] text-zinc-400 hover:text-white transition-colors"
            >
              dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="surface rounded-xl p-5">
                <div className="skeleton h-3.5 w-20 rounded mb-3" />
                <div className="skeleton h-9 w-full rounded" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Required keys */}
            <div className="surface rounded-xl p-5 mb-4">
              <div className="mb-3">
                <h2 className="text-sm font-medium text-white mb-1">Required</h2>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Core generation needs these. Complete at least one workflow lane before anything runs.
                </p>
              </div>

              {/* Workflow readiness pills */}
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(REQUIRED_PROVIDERS).map(([workflowKey, workflow]) => {
                  const allSet = workflow.providers.every((p) => getStatus(p.key)?.isSet);
                  return (
                    <span
                      key={workflowKey}
                      className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2 py-1 rounded-md ${
                        allSet
                          ? 'text-emerald-300/80 bg-emerald-500/[0.08]'
                          : 'text-zinc-400 bg-white/[0.03]'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${allSet ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                      {workflow.label}
                    </span>
                  );
                })}
              </div>

              <div className="divide-y divide-white/[0.06]">
                {required.map((p) => (
                  <KeyRow
                    key={p.key}
                    provider={p}
                    status={getStatus(p.key)}
                    onSet={handleSet}
                    onDelete={handleDelete}
                    deleting={deletingProvider === p.key}
                  />
                ))}
              </div>
            </div>

            {/* Optional keys */}
            <div className="surface rounded-xl p-5">
              <div className="mb-3">
                <h2 className="text-sm font-medium text-white mb-1">Optional</h2>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Only needed for web-studio AI buttons (Generate Concept, Refine Script, etc.) without a harness.
                  Codex Desktop and Claude Code bring their own LLM subscription.
                </p>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {OPTIONAL_PROVIDERS.map((p) => (
                  <KeyRow
                    key={p.key}
                    provider={p}
                    status={getStatus(p.key)}
                    onSet={handleSet}
                    onDelete={handleDelete}
                    deleting={deletingProvider === p.key}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {modalProvider && (
        <SetKeyModal provider={modalProvider} onSave={handleSave} onClose={() => setModalProvider(null)} />
      )}
    </div>
  );
};
