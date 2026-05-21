import React, { useMemo } from 'react';
import { ApiProject, BlockedTool, ResolvedTool, ToolSurface } from '../types';
import { useAvailableTools } from '../hooks/useAvailableTools';

interface AssetShelfProps {
  /** Asset shelf surface (e.g. 'asset:concept'). Filters tools to those
   *  the registry tagged with this surface. */
  surface: ToolSurface;
  project: ApiProject;
  /** Fired when an enabled tool is clicked. Parent owns the dispatch:
   *  map tool.key to the existing API call (generate-concept, lock-concept,
   *  refine, etc.). Returning a Promise puts the button in a loading
   *  state until it resolves. */
  onRunTool: (toolKey: string) => void | Promise<void>;
  /** Externally-controlled disabled state for the whole shelf — e.g.
   *  parent's `isLoading` during an active generation. Independently
   *  prevents tool clicks while the parent's flight is in progress, so
   *  callbacks that don't return a Promise still can't race. */
  disabled?: boolean;
  /** Tools to hide from the shelf entirely (e.g. controls the parent
   *  intentionally renders inline). Useful during the migration while
   *  some flows still want bespoke UI for one or two tools. */
  hideToolKeys?: string[];
  /** Render children below the tool row. Bespoke asset displays
   *  (concept cards, style grid, cast cards) live here. */
  children?: React.ReactNode;
  /** Optional className passthrough for the wrapper. */
  className?: string;
}

const ASSET_LABELS: Record<string, string> = {
  audio: 'audio',
  scriptText: 'script',
  directorBrief: 'director brief',
  targetRuntime: 'target runtime',
  lyrics: 'lyrics',
  musicalStructure: 'musical structure',
  meaning: 'meaning',
  concept: 'concept',
  styleDirections: 'style directions',
  styleAsset: 'locked style',
  cast: 'cast',
  environments: 'environments',
  scenes: 'scenes',
  shots: 'shots',
  shotPrompts: 'shot prompts',
  storyboardPrompts: 'storyboard prompts',
  castLooks: 'character looks',
  envLooks: 'environment looks',
  audioPlan: 'audio plan',
  castVoices: 'cast voices',
  ttsAssets: 'dialogue audio',
  storyboards: 'storyboards',
  keyframes: 'keyframes',
  videos: 'videos',
  render: 'final render',
};

const formatMissing = (missing: string[]): string =>
  missing.map((key) => ASSET_LABELS[key] || key).join(', ');

interface ToolButtonProps {
  tool: ResolvedTool | BlockedTool;
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
  title?: string;
}

const ToolButton: React.FC<ToolButtonProps> = ({ tool, disabled, busy, onClick, title }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || busy}
    title={title || tool.description}
    className={[
      'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
      'flex items-center gap-1.5',
      disabled
        ? 'bg-white/[0.02] text-zinc-500 cursor-not-allowed border border-white/[0.04]'
        : 'bg-white/[0.06] text-white hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.16]',
      busy ? 'opacity-60' : '',
    ].filter(Boolean).join(' ')}
  >
    {busy && <span className="w-2.5 h-2.5 border border-zinc-400 border-t-transparent rounded-full animate-spin" />}
    <span>{tool.label}</span>
  </button>
);

export const AssetShelf: React.FC<AssetShelfProps> = ({
  surface, project, onRunTool, disabled, hideToolKeys, children, className,
}) => {
  const { enabled, blocked } = useAvailableTools(project, surface);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const visibleEnabled = useMemo(
    () => hideToolKeys?.length
      ? enabled.filter((tool) => !hideToolKeys.includes(tool.key))
      : enabled,
    [enabled, hideToolKeys],
  );
  const visibleBlocked = useMemo(
    () => hideToolKeys?.length
      ? blocked.filter((tool) => !hideToolKeys.includes(tool.key))
      : blocked,
    [blocked, hideToolKeys],
  );

  const runTool = (toolKey: string) => async () => {
    setBusyKey(toolKey);
    try {
      await Promise.resolve(onRunTool(toolKey));
    } finally {
      setBusyKey((current) => (current === toolKey ? null : current));
    }
  };

  const hasTools = visibleEnabled.length > 0 || visibleBlocked.length > 0;

  // Next-move hint (T10.9): point the artist at the most natural next
  // action on this shelf. Heuristic:
  //   - If any tool is enabled, recommend the first one (registry order
  //     approximates the natural blueprint flow: brainstorm before refine,
  //     plan before write, etc.). Clicking the chip fires the same handler
  //     as the tool button.
  //   - If everything's blocked, name the missing assets from the first
  //     blocked tool. Informational chip — the artist needs to satisfy
  //     those upstream before this shelf can run anything.
  // The chip is a hint that sits above the tool row; the buttons are
  // still the primary affordance.
  const nextMove: { kind: 'run'; tool: ResolvedTool } | { kind: 'blocked'; tool: BlockedTool } | null =
    visibleEnabled[0]
      ? { kind: 'run', tool: visibleEnabled[0] }
      : visibleBlocked[0]
        ? { kind: 'blocked', tool: visibleBlocked[0] }
        : null;

  return (
    <div className={className}>
      {hasTools && (
        <>
          {nextMove && (
            <div className="mb-2">
              {nextMove.kind === 'run' ? (
                <button
                  type="button"
                  onClick={runTool(nextMove.tool.key)}
                  disabled={disabled && busyKey !== nextMove.tool.key}
                  title={nextMove.tool.description}
                  className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="text-zinc-500">→ Next:</span>
                  <span className="font-medium">{nextMove.tool.label}</span>
                </button>
              ) : (
                <div
                  className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500"
                  title={nextMove.tool.description}
                >
                  <span>→ Waiting on:</span>
                  <span className="font-medium text-zinc-400">{formatMissing(nextMove.tool.missing)}</span>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {visibleEnabled.map((tool) => (
              <ToolButton
                key={tool.key}
                tool={tool}
                busy={busyKey === tool.key}
                disabled={disabled && busyKey !== tool.key}
                onClick={runTool(tool.key)}
              />
            ))}
            {visibleBlocked.map((tool) => (
              <ToolButton
                key={tool.key}
                tool={tool}
                disabled
                title={`needs ${formatMissing(tool.missing)} · ${tool.description}`}
              />
            ))}
          </div>
        </>
      )}
      {children}
    </div>
  );
};
