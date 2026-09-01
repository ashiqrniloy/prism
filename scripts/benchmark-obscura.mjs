#!/usr/bin/env node
/**
 * Plan 039 Task 7: Obscura managed startup / search / close benchmark.
 *
 * Network-free: drives a deterministic fake Obscura CLI child. Each leg runs
 * 3x and reports medians against the reviewed ceilings (startup 250ms, CLI
 * search call 100ms, group close 250ms) from docs/performance.md.
 * Machine-dependent — printed evidence leg, not a release gate.
 *
 * Usage: node scripts/benchmark-obscura.mjs [--json scripts/benchmark-obscura.json]
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const { spawnObscuraProcess } = await import("../packages/web-tools/dist/obscura/process.js");
const { createObscuraWebTools } = await import("../packages/web-tools/dist/obscura/web.js");

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const dir = mkdtempSync(join(tmpdir(), "prism-obscura-bench-"));
// Deterministic fake `obscura` binary: emits the same JSON shapes the real CLI
// produces for `search`/`fetch` (see packages/web-tools/src/obscura/__tests__/fake-cli.ts).
const fakePath = join(dir, "fake-cli.mjs");
writeFileSync(
  fakePath,
  `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "fetch") {
  process.stdout.write(JSON.stringify({ url: args[1], status: 200, markdown: "# ok", citations: [{ url: args[1], title: "ok", snippet: "s", index: 0 }] }));
} else {
  process.stdout.write(JSON.stringify({ results: [{ url: "https://example.com/a", title: "A", snippet: "s", index: 0 }] }));
}
`,
  { mode: 0o755 },
);

const toolSet = createObscuraWebTools({ command: process.execPath, argsBefore: [fakePath] });
const ctx = { sessionId: "bench", runId: "bench", toolCallId: "bench" };
const search = toolSet.tools.find((tool) => tool.name === "web_search");

const legs = { managedStartupMs: [], webSearchMs: [], groupCloseMs: [] };

for (let i = 0; i < 3; i++) {
  // Managed startup: spawn a fake `serve` child + bounded ready poll. The probe
  // is an liveness check (SIG 0), so the leg measures spawn-to-first-probe; a
  // real host waits on its actual readiness endpoint inside the same bound.
  const proc = spawnObscuraProcess({
    command: process.execPath,
    args: ["-e", 'require("node:timers").setInterval(()=>{},1e6)', "serve", "--host", "127.0.0.1", "--port", `927${i}`],
  });
  let t0 = performance.now();
  await proc.waitReady(() => {
    try {
      process.kill(proc.pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  legs.managedStartupMs.push(performance.now() - t0);

  // Bounded CLI search call through the public tool surface.
  t0 = performance.now();
  await search.execute({ query: "bench" }, ctx);
  legs.webSearchMs.push(performance.now() - t0);

  // Group-wide SIGTERM drain.
  t0 = performance.now();
  await proc.close({ shutdownTimeoutMs: 250 });
  legs.groupCloseMs.push(performance.now() - t0);
}

rmSync(dir, { recursive: true, force: true });

const result = {
  captured: new Date().toISOString(),
  methodology:
    "fake-Obscura child (deterministic JSON); startup probes SIG-0 liveness, search is one bounded CLI call through the public web tool, close is group SIGTERM drain",
  runs: 3,
  medians: {
    managedStartupMs: +median(legs.managedStartupMs).toFixed(2),
    webSearchMs: +median(legs.webSearchMs).toFixed(2),
    groupCloseMs: +median(legs.groupCloseMs).toFixed(2),
  },
  ceilings: { managedStartupMs: 250, webSearchMs: 100, groupCloseMs: 250 },
  raw: legs,
};
console.log(JSON.stringify(result, null, 2));

const flag = process.argv.indexOf("--json");
if (flag > -1 && process.argv[flag + 1]) writeFileSync(process.argv[flag + 1], `${JSON.stringify(result, null, 2)}\n`);

for (const [leg, ceiling] of Object.entries(result.ceilings)) {
  if (result.medians[leg] > ceiling) {
    console.error(`benchmark-obscura: ${leg} median ${result.medians[leg]}ms exceeds ${ceiling}ms ceiling`);
    process.exit(1);
  }
}
