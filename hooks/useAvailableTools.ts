import { useMemo } from 'react';
import { ApiProject, BlockedTool, ResolvedTool, ToolSurface } from '../types';

/**
 * Surfaces what tools the project can run right now + what's blocked, as
 * computed server-side by the tool registry (D24). Optional `surface`
 * arg filters to a specific asset shelf (e.g. 'asset:concept').
 *
 * The registry is the cross-surface contract: same data flows to the MCP
 * packet (agent surface) and to this hook (web Studio overwatch surface).
 * Components consuming this hook MUST treat it as authoritative — if a
 * tool isn't here, the engine doesn't expose it; never reconstruct the
 * gating logic in the component.
 */
export const useAvailableTools = (
  project: ApiProject,
  surface?: ToolSurface,
): { enabled: ResolvedTool[]; blocked: BlockedTool[] } => useMemo(() => {
  const available = project.availableTools || [];
  const blocked = project.blockedTools || [];
  if (!surface) return { enabled: available, blocked };
  return {
    enabled: available.filter((tool) => tool.surface === surface),
    blocked: blocked.filter((tool) => tool.surface === surface),
  };
}, [project.availableTools, project.blockedTools, surface]);
