import { createHash } from "node:crypto";
import { EvalDatasetError } from "./errors.js";
import { HARD_DATASET_ITEMS } from "./limits.js";
import type { Dataset, DefineDatasetInput, Split } from "./types.js";
import { copySimulatorBinding } from "./user-simulator.js";
import { canonicalJson } from "./util.js";

export function validateSplit(value: unknown): asserts value is Split {
  if (value !== "dev" && value !== "test" && value !== "heldout") throw new EvalDatasetError("invalid dataset split");
}

function freezeJson<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

/** Create an immutable, content-addressed JSON snapshot. Duplicate item ids fail closed. */
export function defineDataset<TInput = unknown, TExpected = unknown>(
  input: DefineDatasetInput<TInput, TExpected>,
): Dataset<TInput, TExpected> {
  if (!input || typeof input.id !== "string" || !input.id.trim()) throw new EvalDatasetError("dataset id is required");
  if (!Array.isArray(input.items)) throw new EvalDatasetError("dataset items must be an array");
  if (input.items.length > HARD_DATASET_ITEMS) throw new EvalDatasetError(`dataset items exceed ${HARD_DATASET_ITEMS}`);
  if (input.canary !== undefined && (typeof input.canary !== "string" || input.canary.length > 128)) {
    throw new EvalDatasetError("dataset canary must be a string of at most 128 chars");
  }
  const seen = new Set<string>();
  const items = Array.from(input.items).map((item, index) => {
    const itemId = typeof item?.id === "string" ? item.id.trim() : "";
    if (!itemId) throw new EvalDatasetError(`dataset item at index ${index} is missing id`);
    if (seen.has(itemId)) throw new EvalDatasetError(`duplicate dataset item id: ${itemId}`);
    seen.add(itemId);
    if (item.split !== undefined) validateSplit(item.split);
    if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.length > 16
      || Array.from(item.tags).some((tag: unknown) => typeof tag !== "string" || tag.length > 64))) throw new EvalDatasetError("invalid dataset tags");
    if (item.label !== undefined && (!item.label || !["human", "model", "curated", "synthetic"].includes(item.label.source)
      || (item.label.adjudicated !== undefined && typeof item.label.adjudicated !== "boolean")
      || (item.label.by !== undefined && typeof item.label.by !== "string"))) throw new EvalDatasetError("invalid dataset label");
    return { ...item, id: itemId };
  });
  try {
    const canonical = canonicalJson(items);
    const snapshot = JSON.parse(canonical) as typeof items;
    items.forEach((item, index) => {
      const source = item.input as { kind?: string; user?: object } | null;
      const target = snapshot[index]!.input as { user?: object } | null;
      if (source?.kind === "scenario" && source.user && target?.user) copySimulatorBinding(source.user, target.user);
    });
    return freezeJson({
      id: input.id.trim(), version: input.version, canary: input.canary,
      contentHash: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
      items: snapshot,
      metadata: input.metadata || input.canary !== undefined ? JSON.parse(canonicalJson({
        ...input.metadata, ...(input.canary !== undefined ? { canary: input.canary } : {}),
      })) : undefined,
    });
  } catch (cause) {
    throw new EvalDatasetError("dataset not serializable", { cause });
  }
}
