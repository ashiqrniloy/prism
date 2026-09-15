/**
 * Docker process sessions example — long-running process management with
 * durable recovery inside a Docker sandbox.
 *
 * Demonstrates:
 * - `createDockerSandbox` with `startProcess` wired into `createProcessSessions`
 * - Starting a process, writing stdin, reading streamed output, and waiting for exit
 * - Durable checkpoint/lease plumbing for attested reconnect after host restart
 * - `createDockerProcessRecoveryBackend` with label/workspace/container assertions
 * - Recovery path: live handle attach vs. fail-closed unknown on lost container
 *
 * Requirements: Docker daemon accessible at `docker` on PATH, digest-pinned image
 * with `sleep`, `cat`, `echo`, and a writable `/workspace`.
 */

import { createMemoryCheckpointStore, createMemoryLeaseStore } from "@arnilo/prism";
import { createProcessSessions, type ProcessSessions } from "@arnilo/prism-coding-tools/agent";
import { createDockerProcessRecoveryBackend, createDockerSandbox, type DisposableSandbox } from "@arnilo/prism-coding-tools/security";

// ──── Configuration ────────────────────────────────────────────────────────
// Replace with a real digest-pinned image that has basic shell tools.
const IMAGE = `ubuntu@sha256:${"a".repeat(64)}`;
const SOURCE_ROOT = process.cwd();

async function main(): Promise<void> {
  // ── 1. Create a Docker sandbox ──────────────────────────────────────────
  console.log("Creating Docker sandbox…");
  const sandbox: DisposableSandbox = await createDockerSandbox({
    docker: process.env.DOCKER_PATH ?? "/usr/bin/docker",
    image: IMAGE,
    sourceRoot: SOURCE_ROOT,
    user: "10001:10001",
    labels: { "app.name": "prism-example", "app.version": "0.7.0" },
    limits: {
      wallTimeMs: 5 * 60_000,
      idleTimeoutMs: 2 * 60_000,
    },
  });
  console.log(`Sandbox created: ${sandbox.id}`);

  // ── 2. Wire durable process sessions ────────────────────────────────────
  const checkpoints = createMemoryCheckpointStore();
  const leases = createMemoryLeaseStore();

  // When a sandbox with `attachProcess` is passed, the recovery backend is
  // wired automatically inside `createProcessSessions`. You can also supply
  // an explicit `recoveryBackend` for extra validation:
  const recoveryBackend = createDockerProcessRecoveryBackend(sandbox, {
    expectedContainerId: sandbox.id,
    expectedWorkspace: "/workspace",
    expectedLabels: { "app.name": "prism-example" },
  });

  const sessions: ProcessSessions = createProcessSessions({
    cwd: SOURCE_ROOT,
    checkpoints,
    leases,
    ownerId: `worker-${process.pid}`,
    sandbox,
    recoveryBackend,
    onEvent: (e) => console.log(`  [event] ${e.type} session=${e.sessionId}`),
  });

  // ── 3. Start a long-running process ─────────────────────────────────────
  console.log("\nStarting echo process…");
  const session = await sessions.start({
    command: "/bin/sh",
    args: ["-c", "echo hello-from-docker && cat"],
    lifetimeMs: 60_000,
  });
  console.log(`  Session ${session.id} state=${session.state}`);

  // ── 4. Read output ──────────────────────────────────────────────────────
  // Small delay to let the echo land
  await new Promise((r) => setTimeout(r, 200));
  const chunk = await session.output({ cursor: 0, maxBytes: 4096 });
  console.log(`  Output (cursor=${chunk.cursor}): ${chunk.data.trimEnd()}`);

  // ── 5. Write stdin ──────────────────────────────────────────────────────
  console.log("\nSending stdin…");
  await session.input("ping from host\n");
  await new Promise((r) => setTimeout(r, 200));
  const chunk2 = await session.output({ cursor: chunk.cursor, maxBytes: 4096 });
  console.log(`  Echo back: ${chunk2.data.trimEnd()}`);

  // ── 6. Durable recovery (simulate host restart) ─────────────────────────
  console.log("\nRecovering sessions (same host, live container)…");
  const report = await sessions.recover();
  console.log(`  attached=${report.attached} terminal=${report.terminal} unknown=${report.unknown}`);

  // ── 7. Kill and dispose ─────────────────────────────────────────────────
  console.log("\nKilling session…");
  await session.kill();
  const result = await session.wait({ timeoutMs: 5000 });
  console.log(`  Exit code: ${result.exitCode}, state: ${result.state}`);

  await sessions.dispose();

  // ── 8. Clean up sandbox ─────────────────────────────────────────────────
  console.log("\nClosing sandbox…");
  await sandbox.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
