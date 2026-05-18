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

const REQUIRED_PROVIDERS: Record<string, ProviderInfo[]> = {
  music_video: [
    {
      key: 'segmind',
      label: 'Segmind',
      description: 'Image generation (Nano Banana Pro/2) and video generation (Seedance, Veo)',
      docsUrl: 'https://www.segmind.com/api-keys',
      placeholder: 'SG_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    },
    {
      key: 'gemini',
      label: 'Google AI Studio',
      description: 'Audio analysis, transcription, and structure detection',
      docsUrl: 'https://aistudio.google.com/apikey',
      placeholder: 'AIzaSy...',
    },
  ],
  anime_scripted: [
    {
      key: 'segmind',
      label: 'Segmind',
      description: 'Image generation (Nano Banana Pro/2) and video generation (Seedance, Veo)',
      docsUrl: 'https://www.segmind.com/api-keys',
      placeholder: 'SG_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    },
    {
      key: 'elevenlabs',
      label: 'ElevenLabs',
      description: 'Text-to-speech for character dialogue',
      docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
      placeholder: 'sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    },
  ],
};

const OPTIONAL_PROVIDERS: ProviderInfo[] = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    description: 'Powers Generate Concept, Script, Refine, and other AI buttons in the web studio',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-api03-...',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    description: 'GPT Image 2 storyboards and optional GPT script writer',
    docsUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-proj-...',
  },
];

const allRequiredProviders = (): ProviderInfo[] => {
  const seen = new Set<ProviderKey>();
  const result: ProviderInfo[] = [];
  for (const providers of Object.values(REQUIRED_PROVIDERS)) {
    for (const p of providers) {
      if (!seen.has(p.key)) {
        seen.add(p.key);
        result.push(p);
      }
    }
  }
  return result;
};

const KeyRow: React.FC<{
  provider: ProviderInfo;
  status: KeyStatus | undefined;
  onSet: (provider: ProviderKey) => void;
  onDelete: (provider: ProviderKey) => void;
  deleting: boolean;
}> = ({ provider, status, onSet, onDelete, deleting }) => {
  const isSet = status?.isSet ?? false;

  return (
    <div className="flex items-start justify-between gap-4 py-4 group">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 mb-1">
          <p className="text-sm text-white font-medium">{provider.label}</p>
          <span
            className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isSet
                ? 'text-emerald-300/90 bg-emerald-500/10'
                : 'text-amber-300/90 bg-amber-500/10'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isSet ? 'bg-emerald-400' : 'bg-amber-400'}`}
            />
            {isSet ? 'Set' : 'Not set'}
          </span>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">{provider.description}</p>
        {status?.lastUsedAt && (
          <p className="text-[11px] text-zinc-500 mt-1">
            Last used {new Date(status.lastUsedAt).toLocaleDateString()}
          </p>
        )}
        {status?.lastError && (
          <p className="text-[11px] text-red-400/80 mt-1">Last error: {status.lastError}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
        <button
          onClick={() => onSet(provider.key)}
          className="px-3 py-1.5 text-xs text-zinc-300 hover:text-white surface-inset rounded-md hover:bg-white/[0.06] transition-colors"
        >
          {isSet ? 'Rotate' : 'Set key'}
        </button>
        {isSet && (
          <button
            onClick={() => onDelete(provider.key)}
            disabled={deleting}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-red-300 surface-inset rounded-md hover:bg-red-500/[0.06] transition-colors disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
};

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
    if (!trimmed) return;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md surface-raised rounded-xl p-6">
        <h3 className="text-lg font-display text-white tracking-tight mb-1">
          {provider.label} API Key
        </h3>
        <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
          Paste your key below. It will be encrypted at rest and never shown again.
        </p>

        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
              API Key
            </label>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={provider.placeholder}
              autoFocus
              className="w-full px-3 py-2.5 text-sm font-mono text-zinc-200 surface-inset rounded-md border-0 outline-none focus:ring-1 focus:ring-white/20 placeholder:text-zinc-600"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
              Label <span className="text-zinc-500 normal-case tracking-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`e.g. "personal", "team account"`}
              className="w-full px-3 py-2.5 text-sm text-zinc-200 surface-inset rounded-md border-0 outline-none focus:ring-1 focus:ring-white/20 placeholder:text-zinc-600"
            />
          </div>
        </div>

        <p className="text-[11px] text-zinc-500 mb-4 leading-relaxed">
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

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!value.trim() || saving}
            className="px-4 py-2 bg-white text-black rounded-md text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save key'}
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
      const data = await api.listApiKeys();
      setKeys(data.keys || []);
    } catch (err: any) {
      setError(err.message || 'Could not load API keys');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

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

  if (!user) return null;

  const required = allRequiredProviders();
  const optional = OPTIONAL_PROVIDERS;

  return (
    <div className="min-h-screen bg-[#141418] text-white px-6 py-12 relative overflow-hidden">
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[400px] rounded-full bg-white/[0.012] blur-3xl" />
      </div>

      <div className="max-w-2xl mx-auto relative">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-10">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-3">
              Account
            </p>
            <h1 className="text-3xl font-display text-white mb-2 tracking-tight">API Keys</h1>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-md">
              Mirage uses your own API keys for every paid provider. Keys are encrypted at rest and
              never logged.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <a
              href="/"
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white surface-inset rounded-md hover:bg-white/[0.06] transition-colors"
            >
              Studio
            </a>
            <button
              onClick={signOut}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white surface-inset rounded-md hover:bg-white/[0.06] transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 text-sm text-amber-200/90 surface-inset rounded-md px-3 py-2 border-l-2 border-amber-400/60">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-3 text-xs text-zinc-400 hover:text-white"
            >
              dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="surface rounded-xl p-6">
                <div className="skeleton h-4 w-24 rounded mb-2" />
                <div className="skeleton h-3 w-48 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Required keys */}
            <div className="surface rounded-xl p-7 mb-5">
              <div className="mb-4">
                <h2 className="text-base font-display text-white tracking-tight mb-1">
                  Required
                </h2>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  These providers power core generation. You need at least the keys for your
                  workflow before anything runs.
                </p>
              </div>

              {/* Workflow badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(REQUIRED_PROVIDERS).map(([workflow, providers]) => {
                  const allSet = providers.every((p) => getStatus(p.key)?.isSet);
                  return (
                    <span
                      key={workflow}
                      className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2 py-1 rounded-md ${
                        allSet
                          ? 'text-emerald-300/80 bg-emerald-500/[0.08]'
                          : 'text-zinc-400 bg-white/[0.03]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          allSet ? 'bg-emerald-400' : 'bg-zinc-500'
                        }`}
                      />
                      {workflow.replace('_', ' ')}
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
            <div className="surface rounded-xl p-7">
              <div className="mb-4">
                <h2 className="text-base font-display text-white tracking-tight mb-1">
                  Optional
                </h2>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Only needed if you use the web studio AI buttons (Generate Concept, Refine Script,
                  etc.) without Codex Desktop or Claude Code. Both harnesses bring their own LLM
                  subscription.
                </p>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {optional.map((p) => (
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
