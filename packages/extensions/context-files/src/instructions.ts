import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ContextSource, DiscoveredContribution, PermissionPolicy, TrustPolicy } from "@arnilo/prism";
import { assertPermission, assertTrusted, isPathInsideReal } from "@arnilo/prism";

export interface InstructionSourceOptions {
  /** Host-owned module loader for declarations with a `module` field. There is no auto-`import()`:
   *  a module source discovered without a loader is skipped. */
  readonly moduleLoader?: (module: string, exportName?: string) => Promise<Omit<ContextSource, "name">>;
  /** Optional escape hatch for instruction resources outside the contribution directory. */
  readonly resourceTrust?: TrustPolicy;
  readonly permission?: PermissionPolicy;
}

/**
 * Turn a discovered `kind: "instructions"` contribution into a live {@link ContextSource}.
 * Markdown-only contributions (no `module`) load as a static text source; module contributions
 * load through the host-supplied `moduleLoader` (or are skipped when absent). Reads happen only
 * here, never on plain SDK in-memory use.
 */
export async function resolveInstructionSource(
  contribution: DiscoveredContribution,
  options: InstructionSourceOptions = {},
): Promise<ContextSource | undefined> {
  if (contribution.kind !== "instructions") return undefined;
  const name = contribution.name;
  const decl = contribution.declaration;

  if (decl?.module) {
    if (!options.moduleLoader) return undefined;
    const loaded = await options.moduleLoader(decl.module, decl.exportName);
    return { name, ...loaded };
  }

  return { name, instructions: await readInstructionsText(contribution, options) };
}

/** Load every discovered `instructions` contribution into context sources. Same-name merge order
 *  (workspace over global) is resolved by the scanner; this adapter only realizes the list. */
export async function resolveInstructionSources(
  contributions: readonly DiscoveredContribution[],
  options: InstructionSourceOptions = {},
): Promise<readonly ContextSource[]> {
  const sources: ContextSource[] = [];
  for (const contribution of contributions) {
    if (contribution.kind !== "instructions") continue;
    const source = await resolveInstructionSource(contribution, options);
    if (source) sources.push(source);
  }
  return sources;
}

async function readInstructionsText(contribution: DiscoveredContribution, options: InstructionSourceOptions): Promise<string> {
  const dir = dirname(contribution.path);
  const resource = contribution.declaration?.resource;
  const target = resource ? (isAbsolute(resource) ? resource : join(dir, resource)) : join(dir, "INSTRUCTIONS.md");
  if (!(await isPathInsideReal(dir, target))) {
    if (!options.resourceTrust) throw new Error(`Instruction resource escapes contribution directory: ${target}`);
    await assertTrusted(options.resourceTrust, { kind: "resource", target, capability: "instruction-resource" });
  }
  await assertPermission(options.permission, { kind: "resource", action: "load", target });
  return await readFile(target, "utf8");
}
