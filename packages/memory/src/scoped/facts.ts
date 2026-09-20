import { MemoryLimitError, MemoryValidationError } from "../errors.js";
import { appendFabricBlock, assertFabricBlockLabel, readFabricBlock } from "../fabric/blocks.js";
import type { Memory } from "../types.js";
import { gateScopedMemoryContent } from "./trust.js";

export async function rememberScopedFact(input: {
  readonly memory: Memory;
  readonly block: string;
  readonly maxChars: number;
  readonly text: string;
}): Promise<void> {
  assertFabricBlockLabel(input.block);
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new MemoryValidationError("text must be a non-empty string");
  }
  gateScopedMemoryContent(input.text);
  const current = await input.memory.getWorking();
  const existing = readFabricBlock(current, input.block);
  const created = existing === undefined || existing.content.length === 0;
  const content = created ? input.text : `${existing.content}\n${input.text}`;
  if (content.length > input.maxChars) {
    const entries = existing?.content ? existing.content.split("\n") : [];
    throw new MemoryLimitError(`${content.length}/${input.maxChars} chars — consolidate first: ${JSON.stringify(entries)}`);
  }
  // ponytail: check-then-append; two concurrent rememberFacts can overshoot maxChars up to maxEntryTextChars
  await appendFabricBlock(input.memory, input.block, input.text);
}
