import { dirname } from "node:path";
import type { SystemPromptContribution, TrustPolicy } from "@arnilo/prism";
import { loadSystemPromptFiles } from "@arnilo/prism/node/system-prompts";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";

export interface InstructionsPlaneConfig {
  /** Base instruction string for the agent. */
  readonly text?: string;
  /**
   * Auto-load `AGENTS.md`. Defaults to true when a workspaceRoot is provided
   * (mirroring CLI runner behavior), or false otherwise.
   */
  readonly agentsMd?: boolean | { readonly path?: string; readonly paths?: readonly string[] };
  /**
   * Auto-load user-level `SYSTEM.md`. Defaults to false.
   * `globalRoot` must be specified explicitly (no automatic home directory traversal).
   */
  readonly systemMd?: boolean | { readonly globalRoot?: string; readonly path?: string; readonly mode?: "append" | "replace" };
  /** Additional system prompt layers. */
  readonly layers?: readonly SystemPromptContribution[];
}

export interface AssembleInstructionsOptions {
  readonly instructions?: string | InstructionsPlaneConfig;
  readonly workspaceRoot?: string;
  readonly trust?: TrustPolicy;
}

export interface AssembledInstructionsPlane {
  readonly instructionsText?: string;
  readonly systemPromptLayers: readonly SystemPromptContribution[];
}

/**
 * Assemble instructions plane: resolves base instructions text and loads
 * trust-gated `AGENTS.md` and `SYSTEM.md` layers as structured prompt contributions.
 */
export async function assembleInstructionsPlane(options: AssembleInstructionsOptions = {}): Promise<AssembledInstructionsPlane> {
  const { instructions, workspaceRoot, trust } = options;

  if (typeof instructions === "string") {
    // If a string is passed, check if workspaceRoot is provided for default AGENTS.md auto-load
    if (!workspaceRoot) {
      return { instructionsText: instructions, systemPromptLayers: [] };
    }
  }

  const planeConfig = typeof instructions === "object" && instructions !== null ? instructions : {};
  const instructionsText = typeof instructions === "string" ? instructions : planeConfig.text;

  // AGENTS.md defaults to on when workspaceRoot is present, unless explicitly disabled.
  const loadAgentsMd =
    planeConfig.agentsMd !== false && (planeConfig.agentsMd === true || typeof planeConfig.agentsMd === "object" || Boolean(workspaceRoot));

  const agentsMdPath = typeof planeConfig.agentsMd === "object" ? planeConfig.agentsMd.path : undefined;
  const agentsMdPaths = typeof planeConfig.agentsMd === "object" ? planeConfig.agentsMd.paths : undefined;

  const loadSystemMd = Boolean(planeConfig.systemMd);
  const globalRoot = typeof planeConfig.systemMd === "object" ? planeConfig.systemMd.globalRoot : undefined;
  const systemMdPath = typeof planeConfig.systemMd === "object" ? planeConfig.systemMd.path : undefined;
  const systemMdMode = typeof planeConfig.systemMd === "object" ? planeConfig.systemMd.mode : undefined;

  if (!loadAgentsMd && !loadSystemMd && !planeConfig.layers?.length) {
    return {
      ...(instructionsText !== undefined ? { instructionsText } : {}),
      systemPromptLayers: [],
    };
  }

  const trustedRoots: string[] = [];
  if (workspaceRoot) trustedRoots.push(workspaceRoot);
  if (globalRoot) trustedRoots.push(globalRoot);
  if (agentsMdPaths) {
    for (const p of agentsMdPaths) {
      trustedRoots.push(dirname(p));
    }
  }

  const trustPolicy = trust ?? (trustedRoots.length > 0 ? createPathTrustPolicy({ trustedRoots }) : undefined);

  const layers = await loadSystemPromptFiles({
    ...(loadAgentsMd && (workspaceRoot || agentsMdPath || agentsMdPaths)
      ? {
          ...(workspaceRoot ? { workspaceRoot } : {}),
          ...(agentsMdPath ? { agentsMdPath } : {}),
          ...(agentsMdPaths ? { agentsMdPaths } : {}),
          ...(trustPolicy ? { trust: trustPolicy } : {}),
        }
      : {}),
    ...(loadSystemMd
      ? {
          ...(globalRoot ? { globalRoot } : {}),
          ...(systemMdPath ? { systemMdPath } : {}),
          ...(systemMdMode ? { systemMdMode } : {}),
          ...(trustPolicy ? { trust: trustPolicy } : {}),
        }
      : {}),
  });

  return {
    ...(instructionsText !== undefined ? { instructionsText } : {}),
    systemPromptLayers: [...layers, ...(planeConfig.layers ?? [])],
  };
}
