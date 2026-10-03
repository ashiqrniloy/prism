import { definePackage } from "@arnilo/prism";

/**
 * The LLM compactor is a `compaction` slot assignment, not a package contribution: pass
 * `createLlmCompactor(options)` to `createAgent({ slots: { compaction } })`. This package is the
 * inert name the old extension registered. Task 1 found no registrar side calls, so it declares
 * no `slot:compaction` capability and provides no slot.
 */
export const llmCompaction = definePackage({
  name: "@arnilo/prism-memory.llm-compaction",
  version: "0.12.1",
  requires: { prism: "^0.12.1 || ^0.13.0-0" },
  setup() {},
});
