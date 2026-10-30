import type { ToolDefinition } from "../contracts.js";

/** OpenAI and Anthropic both accept only this alphabet in a tool name. */
const WIRE_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * A per-request bijection between product tool names (`memory.recall`) and wire-safe names
 * (`memory_recall`). The same map must serialize the request and decode its stream, so two tools
 * can never collapse onto one wire name and a model's reply always resolves to the product tool.
 */
export interface ToolNameMap {
  /** Product name → wire name. Unknown names pass through unchanged. */
  readonly wire: ReadonlyMap<string, string>;
  /** Wire name → product name. Unknown names pass through unchanged. */
  readonly product: ReadonlyMap<string, string>;
}

function safeBase(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "tool";
  return base.length > 56 ? base.slice(0, 56) : base;
}

export function createToolNameMap(tools: readonly Pick<ToolDefinition, "name">[] = []): ToolNameMap {
  const wire = new Map<string, string>();
  const product = new Map<string, string>();
  const taken = new Set(tools.map((tool) => tool.name));
  for (const { name } of tools) {
    if (WIRE_NAME.test(name)) {
      wire.set(name, name);
      product.set(name, name);
      continue;
    }
    const base = safeBase(name);
    let candidate = base;
    for (let suffix = 2; taken.has(candidate) || product.has(candidate); suffix += 1) {
      candidate = `${base}_${suffix}`;
    }
    taken.add(candidate);
    wire.set(name, candidate);
    product.set(candidate, name);
  }
  return { wire, product };
}

/** Serialize a name when no request map is available (single-tool callers and tests). */
export function wireToolName(name: string, map?: ToolNameMap): string {
  return map?.wire.get(name) ?? (WIRE_NAME.test(name) ? name : safeBase(name));
}

export function productToolName(name: string, map?: ToolNameMap): string {
  return map?.product.get(name) ?? name;
}
