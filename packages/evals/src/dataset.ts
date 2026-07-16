import { EvalDatasetError } from "./errors.js";
import type { Dataset, DefineDatasetInput } from "./types.js";

/** Create an immutable dataset snapshot. Duplicate item ids fail closed. */
export function defineDataset<TInput = unknown, TExpected = unknown>(
  input: DefineDatasetInput<TInput, TExpected>,
): Dataset<TInput, TExpected> {
  const id = input.id.trim();
  if (!id) throw new EvalDatasetError("dataset id is required");
  if (!Array.isArray(input.items)) throw new EvalDatasetError("dataset items must be an array");

  const seen = new Set<string>();
  const items = input.items.map((item, index) => {
    const itemId = item.id?.trim();
    if (!itemId) throw new EvalDatasetError(`dataset item at index ${index} is missing id`);
    if (seen.has(itemId)) throw new EvalDatasetError(`duplicate dataset item id: ${itemId}`);
    seen.add(itemId);
    return Object.freeze({
      id: itemId,
      input: item.input,
      expected: item.expected,
      metadata: item.metadata ? Object.freeze({ ...item.metadata }) : undefined,
    });
  });

  return Object.freeze({
    id,
    version: input.version,
    items: Object.freeze(items),
    metadata: input.metadata ? Object.freeze({ ...input.metadata }) : undefined,
  });
}
