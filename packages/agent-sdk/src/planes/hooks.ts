import { readFile } from "node:fs/promises";
import {
  activateKernel,
  createExtensionKernel,
  type Guardrails,
  type InstructionInjector,
  type MiddlewareRegistry,
  type StopHook,
  type TrustPolicy,
} from "@arnilo/prism";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";
import { createHooksExtension, parseHooksConfig } from "@arnilo/prism-hooks";
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
  readonly guardrails?: Guardrails;
  readonly middleware?: MiddlewareRegistry;
  readonly instructionInjectors?: readonly InstructionInjector[];
  readonly stopHooks?: readonly StopHook[];
}

/**
 * Assemble hooks plane: validates the hooks file path against the trust policy,
 * compiles hooks.json via `@arnilo/prism-hooks`, loads it into an extension kernel,
 * and activates the resulting middleware, guardrails, stop hooks, and instruction injectors.
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

  const parsed = parseHooksConfig(content);
  const hooksExt = createHooksExtension(parsed);
  const kernel = createExtensionKernel();
  await kernel.load([hooksExt]);
  const activated = activateKernel(kernel);

  return {
    guardrails: hooksExt.guardrails,
    middleware: activated.middleware,
    instructionInjectors: activated.instructionInjectors,
    stopHooks: activated.stopHooks,
  };
}
