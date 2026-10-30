/**
 * Plan 202 Task 4.15: pins the two sources of run-to-run variance in an answer-path replay so two
 * trees can be compared byte for byte: kernel-minted ids (`randomUUID`) and the wall clock.
 * Load with `bun --preload`; `prefix-probe.mjs --capture-answers` refuses to run without it.
 */

import { mock, setSystemTime } from "bun:test";
import * as real from "node:crypto";

setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
let counter = 0;
const randomUUID = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
mock.module("node:crypto", () => ({ ...real, default: { ...real, randomUUID }, randomUUID }));
globalThis.__prismEquivalencePinned = true;
