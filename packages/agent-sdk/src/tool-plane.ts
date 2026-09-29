import type { ToolDefinition } from "@arnilo/prism";
import { AgentSdkConfigError } from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A tool plane value: either an already-realized array of tool definitions,
 * or a factory that produces one. Factories are called by the *caller*
 * (`defineAgent`), not inside the resolver — `resolveToolPlane` is pure.
 */
export type ToolPlaneValue = readonly ToolDefinition[] | (() => readonly ToolDefinition[]);

/**
 * Options for {@link resolveToolPlane}.
 *
 * - `planes` — named tool planes in declaration order; each value is
 *   an array of tool definitions or a zero-arg factory returning one.
 * - `exclude` — tool names to drop (exact match, fail-closed on unknown).
 * - `replace` — tool names to swap at their original index. The key must
 *   match `replacement.name` (name/shape stability for ACP classification).
 *   Fail-closed on unknown name or mismatched key.
 * - `add` — tools appended after all planes (host additions).
 */
export interface ResolveToolPlaneOptions {
  readonly planes?: Readonly<Record<string, ToolPlaneValue>>;
  readonly exclude?: readonly string[];
  readonly replace?: Readonly<Record<string, ToolDefinition>>;
  readonly add?: readonly ToolDefinition[];
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Deterministic tool-plane resolution pipeline.
 *
 * Order: `planes` (declaration order) → drop `exclude` names → swap
 * `replace` entries at their original index → append `add`.
 *
 * - Unknown `exclude` or `replace` names fail closed with
 *   {@link AgentSdkConfigError} naming the unknown name.
 * - `replace` key must equal the replacement tool's `name`.
 * - Resolution is a single pass O(tools), pure (no I/O), and never
 *   silently deduplicates — duplicates surface through `createToolRegistry`.
 *
 * @returns Ordered tool definitions ready for `createToolRegistry`.
 */
export function resolveToolPlane(options: ResolveToolPlaneOptions = {}): readonly ToolDefinition[] {
  const { planes, exclude, replace, add } = options;

  // 1. Flatten planes in declaration order. Call factories eagerly.
  const flat: ToolDefinition[] = [];
  if (planes) {
    for (const key of Object.keys(planes)) {
      const value = planes[key];
      const tools = typeof value === "function" ? value() : value;
      for (const tool of tools) flat.push(tool);
    }
  }

  // Build a name set for unknown-key validation.
  const knownNames = new Set(flat.map((t) => t.name));

  // 2. Validate exclude — every name must exist in the flattened planes.
  if (exclude) {
    for (const name of exclude) {
      if (!knownNames.has(name)) {
        throw new AgentSdkConfigError(`exclude: unknown tool name "${name}"`);
      }
    }
  }

  // 3. Validate replace — every key must exist in the flattened planes,
  //    and the key must match the replacement tool's name.
  if (replace) {
    for (const name of Object.keys(replace)) {
      if (!knownNames.has(name)) {
        throw new AgentSdkConfigError(`replace: unknown tool name "${name}"`);
      }
      const replacement = replace[name];
      if (replacement.name !== name) {
        throw new AgentSdkConfigError(`replace: key "${name}" does not match replacement tool name "${replacement.name}"`);
      }
    }
  }

  const excludeSet = exclude ? new Set(exclude) : undefined;

  // 4. Single pass: exclude → replace (at original index).
  const result: ToolDefinition[] = [];
  for (const tool of flat) {
    if (excludeSet?.has(tool.name)) continue;
    if (replace && tool.name in replace) {
      result.push(replace[tool.name]);
    } else {
      result.push(tool);
    }
  }

  // 5. Append host additions.
  if (add) {
    for (const tool of add) result.push(tool);
  }

  return result;
}
