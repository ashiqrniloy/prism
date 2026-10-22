import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("prism_agent_usage_exits_2", () => {
  const result = spawnSync("bun", [join(dirname(fileURLToPath(import.meta.url)), "../../bin/prism-agent.ts")], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(`${result.stdout}${result.stderr}`, /Usage/);
});
