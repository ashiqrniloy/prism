import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type {
  DiscoveredContribution,
  InstructionInjector,
} from "../contracts.js";
import type { ContributionRegistries, ContributionRegistry } from "../contributions.js";

export interface LoadInstructionInjectorOptions {
  /** Host-owned module loader for declarations with a `module` field. Core never
   *  auto-`import()`s (matches Phase 29's tools/context stance); when a module
   *  injector is discovered but no loader is supplied, it is skipped. */
  readonly moduleLoader?: (module: string, exportName?: string) => Promise<InstructionInjector>;
}

/**
 * Turn a discovered `kind: "instructions"` contribution into a live
 * {@link InstructionInjector}. Markdown-only contributions (no `module`)
 * load as a static `{ instructions, when: "every_turn" }` injector; module
 * contributions load through the host-supplied `moduleLoader` (or skipped when
 * absent). Core performs no `import()`; fs reads happen only via this Node
 * adapter, never on plain SDK in-memory use.
 *
 * ponytail: reuses Phase 29's scanner output (DiscoveredContribution); this is
 * only the per-kind adapter, mirroring how skills are realized in core. */
export async function loadInstructionInjector(
  contribution: DiscoveredContribution,
  options: LoadInstructionInjectorOptions = {},
): Promise<InstructionInjector | undefined> {
  if (contribution.kind !== "instructions") return undefined;
  const name = contribution.name;
  const decl = contribution.declaration;

  // ponytail: module-referenced injector — host owns import(); no core auto-import.
  if (decl?.module) {
    if (!options.moduleLoader) return undefined;
    const loaded = await options.moduleLoader(decl.module, decl.exportName);
    return { ...loaded, name };
  }

  // markdown-only instructions: read resource text → static every_turn injector.
  const text = await readInstructionsText(contribution);
  return {
    name,
    description: `Discovered instruction injector ${name}`,
    apply: () => ({ instructions: text, when: "every_turn" }),
  };
}

/** Load every discovered `instructions` contribution into injectors.
 *  Same-name merge order (workspace over global) is already resolved by the
 *  Phase 29 scanner (`discoverContributions` dedupes on `(kind, name)`); this
 *  adapter only turns the deduped list into injectors. */
export async function loadInstructionInjectors(
  contributions: readonly DiscoveredContribution[],
  options: LoadInstructionInjectorOptions = {},
): Promise<readonly InstructionInjector[]> {
  const injectors: InstructionInjector[] = [];
  for (const contribution of contributions) {
    if (contribution.kind !== "instructions") continue;
    const injector = await loadInstructionInjector(contribution, options);
    if (injector) injectors.push(injector);
  }
  return injectors;
}

/** Load discovered instruction injectors and register them into
 *  `registries.instructionInjectors`. Host-owned entry point — never invoked by
 *  plain SDK in-memory use (which leaves the registry empty). */
export async function registerDiscoveredInstructionInjectors(
  registries: ContributionRegistries,
  contributions: readonly DiscoveredContribution[],
  options: LoadInstructionInjectorOptions = {},
): Promise<void> {
  const injectors = await loadInstructionInjectors(contributions, options);
  const registry: ContributionRegistry<InstructionInjector> = registries.instructionInjectors;
  for (const injector of injectors) registry.register(injector.name, injector);
}

async function readInstructionsText(contribution: DiscoveredContribution): Promise<string> {
  const dir = dirname(contribution.path);
  const resource = contribution.declaration?.resource;
  // ponytail: resource resolved against the manifest dir; falls back to INSTRUCTIONS.md.
  const target = resource ? (isAbsolute(resource) ? resource : join(dir, resource)) : join(dir, "INSTRUCTIONS.md");
  return await readFile(target, "utf8");
}
