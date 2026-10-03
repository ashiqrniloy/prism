// Plan 147 Task 2: the `@arnilo/prism/testing` package conformance suite's own checks. The loop
// half is exercised by `hook-catalog-coverage.test.ts` and `hook-invariants.test.ts`, which import
// the promoted harness from the subpath module.
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { definePackage } from "../index.js";
import { type PackageConformanceResult, loopConformance, packageConformance } from "../testing/index.js";

const check = (result: PackageConformanceResult, name: string) => result.checks.find((entry) => entry.name === name);

describe("packageConformance", () => {
  it("conformance_passes_for_a_well_behaved_package", async () => {
    const started = Date.now();
    const result = await packageConformance(
      definePackage<{ apiKey: string; level: "info" | "warn" }>({
        name: "@acme/well-behaved",
        version: "1.0.0",
        requires: { prism: "^0.12.1 || ^0.13.0-0" },
        capabilities: ["credentials", "session-state"],
        config: {
          type: "object",
          properties: {
            apiKey: { type: "string", "x-prism-secret": true, default: "env:PRISM_CONF_WELL_BEHAVED" },
            level: { type: "string", enum: ["info", "warn"], default: "info" },
          },
          required: ["apiKey"],
        },
        setup(prism) {
          const counter = prism.state.agent("runs", 0);
          prism.commands.register({
            name: "ping",
            description: "ping",
            run: () => counter.get(),
          });
          prism.hooks.on("run.input", (messages) => messages);
          void prism.credentials.resolve(prism.config.apiKey).then((credential) => {
            if (credential === undefined) prism.status.note("warn", "credential did not resolve");
          });
          prism.status.note("info", "loaded");
        },
      }),
      { config: { apiKey: "env:PRISM_CONF_WELL_BEHAVED" } },
    );
    const elapsed = Date.now() - started;
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
    assert.ok(elapsed < 1000, `conformance run took ${elapsed}ms (budget: 1000ms)`);
  });

  it("conformance_catches_leak", async () => {
    const result = await packageConformance(
      definePackage({
        name: "@acme/leaky",
        version: "1.0.0",
        setup(prism) {
          const hooks = prism.hooks;
          // Keeps the registrar and registers a hook after teardown has run.
          prism.onDispose(() => {
            setTimeout(() => hooks.on("run.input", (messages) => messages), 0);
          });
        },
      }),
    );
    const leak = check(result, "no_leaks_after_dispose");
    assert.equal(leak?.ok, false, JSON.stringify(result.checks, null, 2));
    assert.match(leak?.message ?? "", /hook run\.input/);
  });

  it("conformance_catches_undeclared_capability", async () => {
    const result = await packageConformance(
      definePackage({
        name: "@acme/undeclared-slot",
        version: "1.0.0",
        setup(prism) {
          prism.slots.loop.provide(prism.slots.loop.default);
        },
      }),
    );
    const capability = check(result, "capabilities_cover_usage");
    assert.equal(capability?.ok, false, JSON.stringify(result.checks, null, 2));
    assert.match(capability?.message ?? "", /slot:loop/);
  });

  it("conformance_catches_secret_in_inspect", async () => {
    const result = await packageConformance(
      definePackage<{ apiKey: string }>({
        name: "@acme/secret-leaker",
        version: "1.0.0",
        capabilities: ["credentials"],
        config: {
          type: "object",
          properties: { apiKey: { type: "string", "x-prism-secret": true } },
          required: ["apiKey"],
        },
        // The broken pattern: bypasses the ref and copies the raw env value into inspect output.
        setup(prism) {
          prism.status.note("warn", `resolved ${process.env.PRISM_CONF_LEAK}`);
        },
      }),
      { config: { apiKey: "env:PRISM_CONF_LEAK" } },
    );
    const secret = check(result, "no_secret_in_inspect");
    assert.equal(secret?.ok, false, JSON.stringify(result.checks, null, 2));
    delete process.env.PRISM_CONF_LEAK;
  });
});

describe("loopConformance (promoted harness)", () => {
  it("loop_conformance_reports_catalog_hooks", async () => {
    const { result, fired } = await loopConformance({});
    assert.equal(result?.status, "completed");
    assert.ok(fired.has("turn.before"));
    assert.ok(fired.has("tool.call"));
    assert.ok(fired.has("run.end"));
  });

  it("accepts a bare LoopStrategy", async () => {
    const defaultLoop = (await import("../index.js")).defaultLoop;
    const { fired } = await loopConformance(defaultLoop);
    assert.ok(fired.has("turn.before"));
  });
});
