import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type LoopStrategy, type RunController } from "../index.js";

const driver = (run: (run: RunController) => Promise<void>, extra: Partial<LoopStrategy> = {}): LoopStrategy => ({
  name: "ext",
  revision: "1",
  usesModel: false,
  run,
  ...extra,
});

describe("model-less agents and run.model (K1)", () => {
  it("model_required_without_model_less_loop", async () => {
    await assert.rejects(createAgent({}), (error: { code?: string }) => error.code === "model_required");
    await assert.rejects(
      createAgent({ slots: { loop: { name: "custom", run: async () => undefined } } }),
      (error: { code?: string }) => error.code === "model_required",
    );
  });

  it("model_less_loop_creates_agent", async () => {
    let seen: unknown = "unset";
    const agent = await createAgent({
      slots: {
        loop: driver(async (run) => {
          seen = run.model;
        }),
      },
    });
    assert.equal(agent.config.model, undefined);
    assert.deepEqual(await agent.models.list(), []);
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.equal(seen, undefined);
  });

  it("turn_without_model_fails_no_model", async () => {
    const agent = await createAgent({ slots: { loop: driver(async (run) => void (await run.turn())) } });
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "no_model");
  });

  it("run_model_passthrough", async () => {
    let seen: unknown;
    const agent = await createAgent({
      slots: {
        loop: driver(async (run) => {
          seen = run.model;
        }, { runModel: "passthrough" }),
      },
    });
    const result = await (await agent.session()).run("go", { model: { provider: "p", model: "m" } });
    assert.equal(result.status, "completed");
    assert.deepEqual(seen, { provider: "p", model: "m" });
  });

  it("run_model_none_fails_closed", async () => {
    let ran = false;
    const agent = await createAgent({
      slots: {
        loop: driver(async () => {
          ran = true;
        }, { runModel: "none" }),
      },
    });
    const result = await (await agent.session()).run("go", { model: { provider: "p", model: "m" } });
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "run_model_unsupported");
    assert.equal(ran, false);
  });

  it("unknown_run_model_mode_fails_creation", async () => {
    await assert.rejects(
      createAgent({ slots: { loop: driver(async () => undefined, { runModel: "other" as never }) } }),
      (error: { code?: string }) => error.code === "invalid_run_model_mode",
    );
  });
});
