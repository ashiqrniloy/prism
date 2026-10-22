/**
 * Plan 168 Task 5 pin: the kernel owns no checkpoint or lease store.
 *
 * The checkpoint and lease contracts, their memory defaults, and the checkpoint-based run-state
 * lifecycle moved to `@arnilo/prism-workflows` and the service contracts store packages provide. A
 * durable run anchors on the store slot's `suspended_run` entry, and the kernel's own in-flight
 * state lives in the private run-state cell. This test fails if the retired files, identifiers, or
 * root exports come back.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("kernel checkpoint retirement (plan 168 Task 5)", () => {
  it("kernel_contains_no_checkpoints_or_leases", () => {
    for (const file of ["src/checkpoints.ts", "src/leases.ts", "src/agent-run-lifecycle.ts"]) {
      assert.equal(existsSync(join(repoRoot, file)), false, `${file} must stay deleted`);
    }
    // `createMemoryCheckpointStore` (the workflows package's factory) is a different name and is allowed;
    // the bare `CheckpointStore`/`LeaseStore` contract identifiers are not.
    const offenders: string[] = [];
    const self = fileURLToPath(import.meta.url)
      .replace(/^dist[/]/, "src/")
      .replace(/\.js$/, ".ts");
    for (const file of tsFiles(join(repoRoot, "src"))) {
      if (file.endsWith("kernel-no-checkpoints.test.ts") || file.endsWith("docs.test.ts") || file === self) continue; // these pins name them on purpose
      const text = readFileSync(file, "utf8");
      for (const name of ["CheckpointStore", "LeaseStore"]) {
        if (new RegExp(`\\b${name}\\b`).test(text)) offenders.push(`${file}: ${name}`);
      }
    }
    assert.deepEqual(offenders, [], `src/ still names a retired store contract:\n${offenders.join("\n")}`);
  });

  it("kernel_root_exports_no_checkpoint_surface", async () => {
    const barrel = readFileSync(join(repoRoot, "src/index.ts"), "utf8");
    for (const name of [
      "createMemoryCheckpointStore",
      "createMemoryLeaseStore",
      "resumeAgentRun",
      "resumeAgentRunStream",
      "createAgentRunLifecycle",
    ]) {
      assert.equal(new RegExp(`\\b${name}\\b`).test(barrel), false, `src/index.ts must not export ${name}`);
    }
    const built = (await import("../index.js")) as Record<string, unknown>;
    for (const name of ["createMemoryCheckpointStore", "createMemoryLeaseStore", "resumeAgentRun", "createAgentRunLifecycle"]) {
      assert.equal(built[name], undefined, `the built barrel must not export ${name}`);
    }
    // Plan 174 Task 4: the runner moved to @arnilo/prism-workflows.
    assert.equal(built.runCheckpointRestoreHooks, undefined);
  });
});
