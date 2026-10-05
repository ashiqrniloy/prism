/**
 * `@arnilo/prism-store-jsonl` — one JSONL file per session under a directory, as the `store` slot.
 *
 * ```ts
 * import jsonlStore from "@arnilo/prism-store-jsonl";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model,
 *   packages: [jsonlStore({ dir: ".prism/sessions" })],
 * });
 * ```
 */
import { definePackage, type JsonSchema, type PackageInstance } from "@arnilo/prism";

import {
  createJsonlSessionStore,
  JsonlSessionStoreError,
  JSONL_BYTES_READ,
  JSONL_FILE_READS,
  readJsonlSessionEntries,
  type JsonlSessionStoreOptions,
  type SessionEntryParseError,
  type SessionEntryReadResult,
} from "./jsonl-store.js";

export {
  createJsonlSessionStore,
  JsonlSessionStoreError,
  JSONL_BYTES_READ,
  JSONL_FILE_READS,
  readJsonlSessionEntries,
  type JsonlSessionStoreOptions,
  type SessionEntryParseError,
  type SessionEntryReadResult,
};

/** Validated `packageConfig` for this package. The host resolves `dir` against the process cwd. */
export interface JsonlStoreConfig {
  readonly dir: string;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    dir: { type: "string", minLength: 1, maxLength: 4096 },
  },
  // `dir` is checked in setup rather than declared required: a config schema whose defaults cannot
  // validate would fail package conformance, and the setup error names the field (plan 152 Task 6).
  additionalProperties: false,
};

const definition = definePackage<JsonlStoreConfig>({
  name: "@arnilo/prism-store-jsonl",
  version: "0.12.1",
  description: "One JSONL file per session under a directory, as a durable single-process session store.",
  requires: { prism: "^0.12.1 || ^0.13.0-0" },
  capabilities: ["slot:store"],
  config: configSchema,
  setup: (prism) => {
    const dir = prism.config.dir;
    if (typeof dir !== "string" || dir.length === 0) {
      throw new Error("prism-store-jsonl: config needs dir (the directory holding one JSONL file per session)");
    }
    prism.slots.store.provide(createJsonlSessionStore({ dir }));
  },
});

/** The package definition. Pass `dir` through `packageConfig` or use {@link jsonlStore}. */
export default definition;

/** The package with `dir` baked in, for `packages: [jsonlStore({ dir })]`. */
export function jsonlStore(config: JsonlStoreConfig): PackageInstance {
  return definition(config);
}
