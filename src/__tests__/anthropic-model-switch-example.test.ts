import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "bun:test";

interface SwitchSummary {
  models: string[];
  text: string[];
  status: string[];
  sawKey: boolean;
}

// Plan 152 Task 9: one provider package serves two models from one agent — the second turn switches
// through `RunOptions.model`, the fake Messages endpoint receives both ids, the ref-resolved key
// reaches the wire, and neither turn prints it.
test("anthropic_model_switch_example_hits_both_models", () => {
  const result = spawnSync("bun", ["examples/anthropic-model-switch.ts"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, `anthropic-model-switch.ts exited ${result.status}\n${result.stderr}`);

  const summary = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as SwitchSummary;
  assert.deepEqual(summary.models, ["claude-sonnet-4-5", "claude-haiku-4-5"], "the server saw both model ids");
  assert.deepEqual(summary.status, ["completed", "completed"]);
  assert.equal(summary.sawKey, true, "the fake endpoint saw the resolved key");
  assert.match(summary.text[0] ?? "", /claude-sonnet-4-5/, "the first turn ran the configured model");
  assert.match(summary.text[1] ?? "", /claude-haiku-4-5/, "the second turn ran the switched model");
  assert.ok(!result.stdout.includes("local-demo-key-1234"), "the example must not print the key");
});
