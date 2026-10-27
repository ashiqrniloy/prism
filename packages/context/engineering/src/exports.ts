/**
 * The library surface of `@arnilo/prism-context-engineering` (plan 158 Task 7): the four stages the
 * package composes, usable on their own.
 *
 * - `budget.ts` — apply an input budget to a whole draft, with the kernel's drop order and the
 *   fail-closed mandatory prefix.
 * - `fold.ts` — rewrite old tool-result messages in a provider view, with the `"truncate"` and
 *   `{ model }` summarize strategies and the byte-safe summary cap.
 * - `tool-search.ts` — the lexical tool index, its scoring, the disclosure narrowing, and the
 *   `search_tools` activation tool.
 * - `attention.ts` — the ratio gate, the sticky thinking/tool-result stages, the fold ledger and
 *   frontier codecs, and the truncation follow-up policy.
 *
 * The kernel modules of the same names are deleted in plan 158 Task 8; nothing here imports them,
 * so a host can keep using the algorithms after the kernel surface is gone.
 */

export * from "./accounting.js";
export * from "./attention.js";
export * from "./attention-types.js";
export * from "./budget.js";
export * from "./config.js";
export * from "./fold.js";
export * from "./handler.js";
export * from "./search-tools.js";
export * from "./state.js";
export * from "./tool-search.js";

export const packageName = "@arnilo/prism-context-engineering";
