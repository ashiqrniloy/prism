import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { childEnv, childTimeoutMs, type RunGraftResult, runGraftJson } from "../cli.js";
import type { ResolvedGraftCli } from "../upstream.js";

const fixtureCli = resolve(import.meta.dirname, "../../fixtures/graft-package-fixture/bin/graft.mjs");
const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/graft-package-fixture");

function explicitCli(): ResolvedGraftCli {
  return { kind: "explicit", command: process.execPath, args: [fixtureCli] };
}

describe("graft child env", () => {
  it("childEnv_is_fixed_base_with_do_not_track", () => {
    const env = childEnv({ providerEnv: { GRAFT_API_KEY: "k", CUSTOM_X: "v" } });
    assert.equal(env.DO_NOT_TRACK, "1");
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.GRAFT_API_KEY, "k");
    assert.equal(env.CUSTOM_X, undefined);
    assert.ok(
      Object.keys(env).every(
        (key) => key === "PATH" || key === "HOME" || ["DO_NOT_TRACK", "NODE_ENV", "LANG", "GRAFT_API_KEY"].includes(key),
      ),
    );
  });

  it("childEnv_allows_opted_in_telemetry", () => {
    const env = childEnv({ allowUpstreamTelemetry: true });
    assert.equal(env.DO_NOT_TRACK, undefined);
  });

  it("childTimeoutMs_subtracts_overhead_and_floors_at_4s", () => {
    assert.equal(childTimeoutMs(8000), 6000);
    assert.equal(childTimeoutMs(5000), 4000);
    assert.equal(childTimeoutMs(undefined), 6000);
    assert.equal(childTimeoutMs(0), 6000);
  });
});

describe("runGraftJson", () => {
  it("parses_json_from_successful_exit", async () => {
    const result = await runGraftJson<{ stub: boolean }>(explicitCli(), [], {});
    assert.equal(result.ok, true);
    assert.equal(result.value?.stub, true);
  });

  it("recovers_json_from_non_zero_exit", async () => {
    const result = await runGraftJson<{ partial: boolean }>(explicitCli(), ["fail-json"], {});
    assert.equal(result.ok, false);
    assert.deepEqual(result.value, { partial: true });
  });

  it("returns_null_on_timeout_within_wall_budget", async () => {
    const startedAt = Date.now();
    const result: RunGraftResult<{ slept?: string }> = await runGraftJson(explicitCli(), ["sleep", "30000"], {
      timeoutMs: 250,
    });
    assert.equal(result.value, null);
    assert.equal(result.reason, "timeout");
    assert.ok(Date.now() - startedAt < 5000);
  });

  it("kills_and_discards_on_stdout_overflow", async () => {
    const result = await runGraftJson(explicitCli(), ["big"], { maxResultBytes: 1024, timeoutMs: 8000 });
    assert.equal(result.value, null);
    assert.equal(result.reason, "overflow");
  });

  it("env_stub_confirms_no_inherited_secrets_and_graft_allowlist_only", async () => {
    process.env.SECRET_SENTINEL = "leak-me";
    try {
      const result = await runGraftJson<Record<string, string | null>>(explicitCli(), ["env"], {
        cwd: fixtureRoot,
        env: childEnv({ providerEnv: { GRAFT_API_KEY: "key-1", CUSTOM_X: "nope" } }),
      });
      assert.equal(result.ok, true);
      assert.equal(result.value?.DO_NOT_TRACK, "1");
      assert.equal(result.value?.SECRET_SENTINEL, null);
      assert.equal(result.value?.GRAFT_API_KEY, "key-1");
      assert.equal(result.value?.CUSTOM_X, null);
    } finally {
      delete process.env.SECRET_SENTINEL;
    }
  });

  it("aborts_on_external_signal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await runGraftJson(explicitCli(), ["sleep", "30000"], {
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    assert.equal(result.value, null);
    assert.equal(result.reason, "aborted");
  });

  it("spawn_error_returns_null_not_throw", async () => {
    const result = await runGraftJson({ kind: "explicit", command: "/nonexistent/graft-binary-xyz", args: [] }, [], {});
    assert.equal(result.value, null);
    assert.equal(result.reason, "spawn-error");
  });
});
