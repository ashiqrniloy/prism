import type { ContributionRegistry } from "./contributions.js";
import type { ContextBlock, InstructionContext, InstructionContribution, InstructionInjector, SystemPromptContribution } from "./contracts.js";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Instruction injector aborted");
}

function shouldApply(contribution: InstructionContribution, ctx: InstructionContext): boolean {
  if (contribution.when === "first_turn") return ctx.turn === 1;
  if (contribution.when === "every_turn") return true;
  // on_input: predicate optional, absent = apply every turn (default).
  return contribution.predicate ? contribution.predicate(ctx) : true;
}

/** Run each selected injector against `ctx`, returning the matching contributions as
 *  `package`-source `SystemPromptContribution[]` (for `composeSystemPrompt`) and
 *  `ContextBlock[]` (for the context merge). Aborts on `ctx.signal`. Non-matching
 *  injectors contribute nothing; only `instructions`/`contextBlocks` are honored —
 *  injectors cannot register tools, skills, or permissions. */
export function runInstructionInjectors(
  injectors: readonly InstructionInjector[],
  ctx: InstructionContext,
): { readonly instructions: readonly SystemPromptContribution[]; readonly contextBlocks: readonly ContextBlock[] } {
  const instructions: SystemPromptContribution[] = [];
  const contextBlocks: ContextBlock[] = [];
  for (const injector of injectors) {
    throwIfAborted(ctx.signal);
    const contribution = injector.apply(ctx);
    if (!shouldApply(contribution, ctx)) continue;
    // ponytail: only instructions/contextBlocks honored; other fields grant nothing.
    if (contribution.instructions) {
      instructions.push({ id: `injector:${injector.name}`, source: "package", mode: "append", text: contribution.instructions });
    }
    if (contribution.contextBlocks) contextBlocks.push(...contribution.contextBlocks);
  }
  return { instructions, contextBlocks };
}

export interface ResolveInstructionInjectorsOptions {
  /** Explicit injector list (e.g. from AgentConfig/RunOptions). Returned as-is when `names` is absent. */
  readonly configured?: readonly InstructionInjector[];
  /** Registry to resolve `names` against. */
  readonly registry?: ContributionRegistry<InstructionInjector>;
  /** Names resolved against `registry` (fail closed on miss); ignored when `configured` is set. */
  readonly names?: readonly string[];
}

/**
 * Resolve the effective injector list for a run. Mirrors {@link resolveActiveSkills}
 * fail-closed name resolution. When `configured` is provided it wins (RunOptions
 * supplies an explicit list); otherwise names are resolved against `registry`.
 * An unknown name throws `Unknown instruction injector: <name>`.
 *
 * ponytail: no toolNames enforcement — injectors grant no tools (unlike skills).
 */
export function resolveInstructionInjectors(
  options: ResolveInstructionInjectorsOptions,
): readonly InstructionInjector[] {
  if (options.configured) return options.configured;
  if (!options.names || !options.registry) return [];
  return options.names.map((name) => {
    const injector = options.registry!.get(name);
    if (!injector) throw new Error(`Unknown instruction injector: ${name}`);
    return injector;
  });
}
