import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapterConformance } from "@arnilo/prism-hosts/driver-process/testing";
import { hostStreamCli } from "../adapters/stream-cli.js";
import type { HostConfig } from "../host/index.js";
import { externalUnsupportedControl, externalWorkerAttribution } from "../scenarios/external-worker-attribution.js";
import { hostStreamCliDialect, hostStreamCliFixtures } from "../scenarios/stream-cli.dialect.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

function config(root: string): HostConfig {
  return {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "ask",
    web: { backend: "obscura" },
  };
}

test("host_adapter_passes_adapter_conformance", async () => {
  const result = await adapterConformance(hostStreamCli, { dialect: hostStreamCliDialect, fixtures: hostStreamCliFixtures });
  assert.ok(
    result.legs.some((leg) => leg.name === "fixture_replay" && leg.status === "passed"),
    "the copied recorded fixture must replay through the adapter",
  );
  assert.ok(result.legs.every((leg) => leg.status === "passed" || leg.status === "skipped"));
});

test("external_events_are_attributed_external", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-ext-"));
  try {
    const { events, gateClaims } = await externalWorkerAttribution(config(root));
    const toolEvents = events.filter((event) => event.type === "tool.started" || event.type === "tool.completed");
    assert.ok(toolEvents.length >= 2, "the external tool call must produce tool events");
    for (const event of [...toolEvents, ...events.filter((event) => event.type === "message.delta")]) {
      assert.equal(event.origin?.executedBy, "external", event.type);
    }
    assert.deepEqual(gateClaims, [], "the host tool.call gate must not see the external call");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no_external_process_outlives_run", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-ext-exit-"));
  try {
    const { exited } = await externalWorkerAttribution(config(root));
    assert.equal(exited, true, "the scripted CLI must exit before the run returns");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unsupported_control_fails_create_agent", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-unsup-"));
  try {
    const message = await externalUnsupportedControl(config(root));
    assert.match(message, /driver_capability_missing/);
    assert.match(message, /subagents/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
