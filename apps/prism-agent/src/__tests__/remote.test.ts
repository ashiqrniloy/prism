import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostConfig } from "../host/index.js";
import { REMOTE_WORKER_BIN } from "../host/remote.js";
import { remoteApprovalThroughLocalHostUi } from "../scenarios/remote-approval-through-local-host-ui.js";
import { REMOTE_ENDPOINT, remoteProcessKill, remoteWorkerAttribution } from "../scenarios/remote-worker-attribution.js";

const MODEL = { provider: "mock", model: "m" };

function config(root: string): HostConfig {
  return {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "ask",
    web: { backend: "obscura" },
  };
}

test("remote_events_carry_origin_remote_and_external", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-rem-"));
  try {
    const { events, gateClaims } = await remoteWorkerAttribution(config(root));
    const tools = events.filter((event) => event.type.startsWith("tool."));
    assert.ok(tools.length >= 2, "the remote tool call must produce tool events");
    for (const event of tools) {
      assert.equal(event.origin?.remote, REMOTE_ENDPOINT, event.type);
      assert.equal(event.origin?.executedBy, "external", event.type);
    }
    assert.deepEqual(gateClaims, [], "the host tool.call gate must not see the remote call");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote_session_is_mirrored_and_indexed", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-rem-mirror-"));
  try {
    const { mirrored } = await remoteWorkerAttribution(config(root));
    assert.equal(mirrored, true, "createSessionIndex(store) must find the mirrored session");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote_approval_answered_locally_resumes", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-rem-approval-"));
  try {
    const { asked, status } = await remoteApprovalThroughLocalHostUi(config(root));
    assert.deepEqual(asked, ["confirm"], "the remote approval request must reach the host HostUi");
    assert.equal(status, "completed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote_process_kill_fails_fast", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-rem-kill-"));
  try {
    assert.equal(await remoteProcessKill(config(root)), "disconnected");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

test("remote_worker_opens_no_port", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-rem-port-"));
  const net = await import("node:net");
  const listened: unknown[] = [];
  const original = net.Server.prototype.listen;
  net.Server.prototype.listen = function (this: Server, ...args: unknown[]) {
    listened.push(args[0]);
    return original.apply(this, args as never);
  } as typeof original;
  try {
    await remoteWorkerAttribution(config(root));
  } finally {
    net.Server.prototype.listen = original;
    rmSync(root, { recursive: true, force: true });
  }
  assert.deepEqual(listened, [], "the host must not open a listener for a stdio remote");
  // The worker bin is stdio-only: no network transport and no listener in its source.
  assert.equal(/kind:\s*["'](?:http|websocket)["']|\.listen\(/.test(readFileSync(REMOTE_WORKER_BIN, "utf8")), false);
});
