import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { DiscoveredContribution } from "../contracts.js";
import type { ContextSource } from "../context-build.js";
import type { PermissionPolicy, TrustPolicy } from "../security.js";
import { assertPermission, assertTrusted } from "../security.js";
import { isPathInsideReal } from "./trust.js";

export interface LoadInstructionSourceOptions {
  /** Host-owned module loader for declarations with a `module` field. Core never
   *  auto-`import()`s (matches Phase 29's tools/context stance); when a module
   *  source is discovered but no loader is supplied, it is skipped. */
  readonly moduleLoader?: (module: string, exportName?: string) => Promise<Omit<ContextSource, "name">>;
  /** Optional escape hatch for instruction resources outside the contribution dir. */
  readonly resourceTrust?: TrustPolicy;
  readonly permission?: PermissionPolicy;
}

/**
 * Turn a discovered `kind: "instructions"` contribution into a live {@link ContextSource}.
 * Markdown-only contributions (no `module`) load as a static text source; module contributions
 * load through the host-supplied `moduleLoader` (or skipped when absent). Core performs no
 * `import()`; fs reads happen only via this Node adapter, never on plain SDK in-memory use.
 *
 * ponytail: reuses Phase 29's scanner output (DiscoveredContribution); this is
 * only the per-kind adapter, mirroring how skills are realized in core. */
export async function loadInstructionSource(
  contribution: DiscoveredContribution,
  options: LoadInstructionSourceOptions = {},
): Promise<ContextSource | undefined> {
  if (contribution.kind !== "instructions") return undefined;
  const name = contribution.name;
  const decl = contribution.declaration;

  // ponytail: module-referenced source — host owns import(); no core auto-import.
  if (decl?.module) {
    if (!options.moduleLoader) return undefined;
    const loaded = await options.moduleLoader(decl.module, decl.exportName);
    return { name, ...loaded };
  }

  // markdown-only instructions: read resource text → static every-turn source.
  return { name, instructions: await readInstructionsText(contribution, options) };
}

/** Load every discovered `instructions` contribution into context sources.
 *  Same-name merge order (workspace over global) is already resolved by the
 *  Phase 29 scanner (`discoverContributions` dedupes on `(kind, name)`); this
 *  adapter only turns the deduped list into sources. */
export async function loadInstructionSources(
  contributions: readonly DiscoveredContribution[],
  options: LoadInstructionSourceOptions = {},
): Promise<readonly ContextSource[]> {
  const sources: ContextSource[] = [];
  for (const contribution of contributions) {
    if (contribution.kind !== "instructions") continue;
    const source = await loadInstructionSource(contribution, options);
    if (source) sources.push(source);
  }
  return sources;
}

async function readInstructionsText(contribution: DiscoveredContribution, options: LoadInstructionSourceOptions): Promise<string> {
  const dir = dirname(contribution.path);
  const resource = contribution.declaration?.resource;
  // ponytail: resource resolved against the manifest dir; outside reads need explicit host trust.
  const target = resource ? (isAbsolute(resource) ? resource : join(dir, resource)) : join(dir, "INSTRUCTIONS.md");
  if (!(await isPathInsideReal(dir, target))) {
    if (!options.resourceTrust) throw new Error(`Instruction resource escapes contribution directory: ${target}`);
    await assertTrusted(options.resourceTrust, { kind: "resource", target, capability: "instruction-resource" });
  }
  await assertPermission(options.permission, { kind: "resource", action: "load", target });
  return await readFile(target, "utf8");
}
