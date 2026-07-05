import { join } from "node:path";
import type { SystemPromptContribution } from "../contracts.js";
import { assertPermission, isTrusted } from "../security.js";
import type { PermissionPolicy, TrustPolicy } from "../security.js";
import { readOptionalFile } from "./contribution-discovery.js";

export interface SystemPromptFilesOptions {
  /** Workspace root. Reads `<workspaceRoot>/AGENTS.md` (project prompt, `source: "app"`).
   *  Trust-gated via `trust` (untrusted workspace → skipped silently, fail-closed). */
  readonly workspaceRoot?: string;
  /** Global root. Reads `<globalRoot>/.prism/agent/SYSTEM.md` (user/global prompt, `source: "user"`).
   *  User-owned: no workspace trust check; its presence is the user's explicit choice. */
  readonly globalRoot?: string;
  /** Override path for `AGENTS.md` (e.g. `--agents-md-file`). Still `source: "app"`, still trust-gated;
   *  the caller builds `trust` with the file's parent in its trusted roots so the explicit opt-in is honored. */
  readonly agentsMdPath?: string;
  /** Override path for `SYSTEM.md` (e.g. `--system-md-file`). Still `source: "user"`, no trust gate (user-owned). */
  readonly systemMdPath?: string;
  readonly trust?: TrustPolicy;
  readonly permission?: PermissionPolicy;
}

/** Load the standard system/project prompt files as `SystemPromptContribution` layers,
 *  feeding the existing `composeSystemPrompt` pipeline (no parallel mechanism). Returns
 *  `SYSTEM.md` first (`source: "user"`, the Phase 31 base layer) then `AGENTS.md`
 *  (`source: "app"`); the rank order is enforced by `composeSystemPrompt`'s `sourceRank`,
 *  so input order here only matters for the stable tie-break when sources collide.
 *
 *  Standalone SDK use (no `workspaceRoot`/`globalRoot`/override paths) returns `[]` and
 *  performs no filesystem I/O — `AgentConfig.instructions`/`systemPrompt` keep working unchanged.
 *
 *  ponytail: two `readFile` calls max, no `readdir`, no scan, no `import()`. Root-level
 *  singletons don't fit `discoverContributions`' named-subdir scanner, so this is a
 *  sibling loader mirroring `src/node/instruction-injectors.ts`'s per-concern adapter shape. */
export async function loadSystemPromptFiles(
  options: SystemPromptFilesOptions,
): Promise<readonly SystemPromptContribution[]> {
  const agentsPath = options.agentsMdPath
    ?? (options.workspaceRoot !== undefined ? join(options.workspaceRoot, "AGENTS.md") : undefined);
  const systemPath = options.systemMdPath
    ?? (options.globalRoot !== undefined ? join(options.globalRoot, ".prism", "agent", "SYSTEM.md") : undefined);
  const out: SystemPromptContribution[] = [];
  if (systemPath !== undefined) {
    const layer = await readSystemFile(systemPath, options.permission);
    if (layer) out.push(layer);
  }
  if (agentsPath !== undefined) {
    const layer = await readAgentsFile(agentsPath, options.trust, options.permission);
    if (layer) out.push(layer);
  }
  return out;
}

async function readSystemFile(
  path: string,
  permission: PermissionPolicy | undefined,
): Promise<SystemPromptContribution | undefined> {
  await assertPermission(permission, { kind: "resource", action: "load", target: path });
  const text = await readOptionalFile(path);
  if (text === undefined) return undefined;
  return { id: "system-md", source: "user", mode: "append", text };
}

async function readAgentsFile(
  path: string,
  trust: TrustPolicy | undefined,
  permission: PermissionPolicy | undefined,
): Promise<SystemPromptContribution | undefined> {
  // ponytail: trust gate mirrors discoverContributions — untrusted AGENTS.md is skipped silently
  // (fail-closed, no throw). createPathTrustPolicy resolves symlinks internally, so a symlinked
  // AGENTS.md escaping the trusted root fails containment inside the policy.
  if (!(await isTrusted(trust, { kind: "project", target: path }))) return undefined;
  await assertPermission(permission, { kind: "resource", action: "load", target: path });
  const text = await readOptionalFile(path);
  if (text === undefined) return undefined;
  return { id: "agents-md", source: "app", mode: "append", text };
}
