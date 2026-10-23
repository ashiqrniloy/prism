import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { checkLayaServerReachable, runSystemOneLiveScenarios } from "@arnilo/prism/testing";
import { laya, LAYA_DEFAULT_BASE_URL } from "../index.js";

const baseUrl = process.env.LAYA_BASE_URL ?? LAYA_DEFAULT_BASE_URL;

await runSystemOneLiveScenarios({
  provider: (opts) => laya({ baseUrl, apiKey: "env:LAYA_API_KEY", fetch: opts?.fetch }),
  model: process.env.PRISM_LIVE_LAYA_MODEL ?? "laya",
  baseUrl,
  reachabilityCheck: true,
  secretEnv: "LAYA_API_KEY",
  skipUnless: () =>
    process.env.PRISM_LIVE_LAYA !== "1" ? "set PRISM_LIVE_PROVIDER_TESTS=1 and PRISM_LIVE_LAYA=1 to run Laya live tests" : false,
  decideTestName: "laya_live_decide",
  title: "@arnilo/prism-provider-laya live tests",
});

describe("@arnilo/prism-provider-laya live skip probe", () => {
  it("laya_live_skips_cleanly_when_server_absent", async () => {
    const unreachableUrl = "http://127.0.0.1:59999";
    const check = await checkLayaServerReachable(unreachableUrl);
    assert.equal(check.reachable, false);
    assert.match(check.reason ?? "", /laya-serve is not running/);
  });
});
