import { readFile } from "node:fs/promises";
import type { PackageInstance, TrustPolicy } from "@arnilo/prism";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";
import { hooksJson } from "@arnilo/prism-hooks-json";
import { AgentSdkConfigError } from "../errors.js";

export interface HooksPlaneConfig {
  /** Path to hooks.json file. */
  readonly file: string;
}

export interface AssembleHooksOptions {
  readonly hooks?: HooksPlaneConfig;
  readonly workspaceRoot?: string;
  readonly trust?: TrustPolicy;
}

export interface AssembledHooksPlane {
  /** Loaded hooks.json package. Pass it in `createAgent({ packages })`. */
  readonly package?: PackageInstance;
}

/**
 * Assemble hooks plane: validates the hooks file path against the trust policy,
 * then returns the `@arnilo/prism-hooks-json` package. The host lists it in `packages`.
 * `SessionStart` maps to `session.opened`. An unlisted command fails when the agent loads.
 */
export async function assembleHooksPlane(options: AssembleHooksOptions = {}): Promise<AssembledHooksPlane> {
  const { hooks, workspaceRoot, trust } = options;

  if (!hooks?.file) {
    return {};
  }

  const target = hooks.file;
  const trustPolicy = trust ?? (workspaceRoot ? createPathTrustPolicy({ trustedRoots: [workspaceRoot] }) : undefined);

  if (!trustPolicy) {
    throw new AgentSdkConfigError(`hooks: loading "${target}" requires an explicit trust policy or workspaceRoot`);
  }

  const decision = await trustPolicy.check({ kind: "resource", target });
  if (!decision.trusted) {
    throw new AgentSdkConfigError(`hooks: file path "${target}" is not trusted (${decision.reason ?? "outside trusted roots"})`);
  }

  let content: string;
  try {
    content = await readFile(target, "utf8");
  } catch (err) {
    throw new AgentSdkConfigError(`hooks: failed to read "${target}": ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new AgentSdkConfigError(`hooks: "${target}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AgentSdkConfigError(`hooks: "${target}" must be a JSON object`);
  }

  return { package: hooksJson({ config: parsed as never }) };
}
