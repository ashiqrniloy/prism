/**
 * Plan 202 Task 4.15: pins the two sources of run-to-run variance in an answer-path replay so two
 * trees can be compared byte for byte: kernel-minted ids (`randomUUID`) and the wall clock.
 * Load with `bun --preload`; `prefix-probe.mjs --capture-answers` refuses to run without it.
 */

import { mock, setSystemTime } from "bun:test";
import * as real from "node:crypto";

setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
let counter = 0;
let tempCounter = 0;
/**
 * Plan 210 Task 0.3: memory-core's `atomicWriteFile` names its temp file with `randomUUID()`. The
 * name is renamed away and never reaches a request, but on one shared counter every write a tree
 * adds or drops (Task 0.2's journal skips whole-map rewrites) shifts every later kernel-minted id,
 * so two trees with identical requests compared unequal. Temp-file names get their own stream.
 */
const randomUUID = () =>
  new Error().stack?.includes("atomicWriteFile")
    ? `00000000-0000-4000-9000-${String(++tempCounter).padStart(12, "0")}`
    : `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
mock.module("node:crypto", () => ({ ...real, default: { ...real, randomUUID }, randomUUID }));
globalThis.__prismEquivalencePinned = true;
