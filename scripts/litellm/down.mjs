/**
 * Stops the free pool (plan 214 Task 5). `--purge` also removes the Postgres volume, which
 * discards the virtual keys and spend logs of that run.
 *
 *   bun scripts/litellm/down.mjs
 *   bun scripts/litellm/down.mjs --purge
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scratchDir } from "./up.mjs";

const TIMEOUT_MS = 120_000;

export function down({ purge = false, dir = scratchDir() } = {}) {
  const composeFile = join(dir, "compose.yaml");
  if (!existsSync(composeFile)) return { stopped: false, reason: `nothing to stop (no ${composeFile})` };
  for (const [command, prefix] of [
    ["docker", ["compose"]],
    ["podman", ["compose"]],
  ]) {
    if (spawnSync(command, [...prefix, "version"], { encoding: "utf8" }).status !== 0) continue;
    const result = spawnSync(command, [...prefix, "-f", "compose.yaml", "down", ...(purge ? ["-v"] : [])], {
      cwd: dir,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
    });
    if (result.status !== 0) throw new Error(`compose down failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`);
    if (purge) rmSync(dir, { recursive: true, force: true });
    return { stopped: true, purged: purge };
  }
  throw new Error("no compose engine found: install docker compose or podman compose");
}

function main() {
  const args = process.argv.slice(2);
  for (const arg of args) if (arg !== "--purge") throw new Error(`unknown argument: ${arg}`);
  const result = down({ purge: args.includes("--purge") });
  console.log(result.stopped ? `pool stopped${result.purged ? " (volume purged, keys and spend logs discarded)" : ""}` : result.reason);
}

if (import.meta.main)
  try {
    main();
  } catch (error) {
    console.error(`${error.name ?? "Error"}: ${error.message}`);
    process.exitCode = 1;
  }
