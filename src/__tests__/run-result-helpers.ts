import assert from "node:assert/strict";
import type { RunResult } from "../index.js";

/**
 * A run that fails after it started resolves to a `failed` or `aborted` result instead of rejecting.
 * Await it, assert it ended that way, and (optionally) match the redacted error message.
 */
export async function failedRun(run: Promise<RunResult>, pattern?: RegExp, status: "failed" | "aborted" = "failed"): Promise<RunResult> {
  const result = await run;
  assert.equal(result.status, status, `expected a ${status} run, got ${result.status}`);
  if (pattern) assert.match(result.error?.message ?? result.abortReason ?? "", pattern);
  return result;
}
