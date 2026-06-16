import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMiddlewareRegistry } from "../index.js";
import type { ExtensionEvent } from "../index.js";

describe("middleware registry", () => {
  it("runs middleware in registration order", async () => {
    const middleware = createMiddlewareRegistry();

    middleware.use<{ steps: string[] }>("provider_request", async (value, next) => {
      value.steps.push("one");
      return next(value);
    });
    middleware.use<{ steps: string[] }>("provider_request", (value) => ({ steps: [...value.steps, "two"] }));

    assert.deepEqual(await middleware.run("provider_request", { steps: [] }), { steps: ["one", "two"] });
  });

  it("can transform payload without runtime side effects", async () => {
    const middleware = createMiddlewareRegistry();

    middleware.use<{ value: number }>("input_assembly", (payload) => ({ value: payload.value + 1 }));

    assert.deepEqual(await middleware.run("input_assembly", { value: 1 }), { value: 2 });
  });

  it("emits redacted extension_error and continues by default", async () => {
    const errors: ExtensionEvent[] = [];
    const middleware = createMiddlewareRegistry({ secrets: ["token-123"], onError: (event) => { errors.push(event); } });

    middleware.use<{ steps: string[] }>("tool_call", () => { throw new Error("bad token-123"); });
    middleware.use<{ steps: string[] }>("tool_call", (value) => ({ steps: [...value.steps, "after"] }));

    assert.deepEqual(await middleware.run("tool_call", { steps: [] }), { steps: ["after"] });
    assert.equal(errors[0]?.type, "extension_error");
    assert.equal(errors[0]?.extension, "middleware:tool_call");
    assert.equal(errors[0]?.error?.message, "bad [REDACTED]");
  });

  it("throws when host opts in", async () => {
    const middleware = createMiddlewareRegistry({ errorPolicy: "throw" });
    middleware.use("retry", () => { throw new Error("boom"); });

    await assert.rejects(() => middleware.run("retry", {}), /boom/);
  });
});
