import crypto from 'node:crypto';

const artifactHash = (content: string) => crypto.createHash('sha256').update(content).digest('hex');

const leanNotebookArtifact = (artifact: any) => {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) || typeof artifact.path !== 'string') return artifact;
  const content = typeof artifact.content === 'string' ? artifact.content : '';
  return {
    kind: 'mirage.notebook.changed_artifact',
    path: artifact.path,
    hash: typeof artifact.hash === 'string' ? artifact.hash : artifactHash(content),
    size: typeof artifact.size === 'number' ? artifact.size : Buffer.byteLength(content, 'utf8'),
    mode: artifact.mode,
    writePolicy: artifact.writePolicy,
    description: artifact.description,
  };
};

export const normalizeLeanActionReceipt = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizeLeanActionReceipt);
  const obj = value as Record<string, any>;
  const out: Record<string, any> = {};
  for (const [key, child] of Object.entries(obj)) {
    if (key === 'changedArtifacts' && Array.isArray(child)) {
      out.changedArtifacts = child.map(leanNotebookArtifact);
      out.changedArtifactSummary = {
        count: out.changedArtifacts.length,
        paths: out.changedArtifacts.map((artifact: any) => artifact.path),
        sync: out.changedArtifacts.length
          ? 'Run the returned notebook sync command to refresh these changed paths; Supabase remains canonical.'
          : 'No notebook artifacts changed.',
      };
      continue;
    }
    out[key] = normalizeLeanActionReceipt(child);
  }
  return out;
};
