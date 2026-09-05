/**
 * Live OpenAPI wire probe (plans/064 Task 7): compiles the real public Warnely
 * OpenAPI 3.1 spec (petstore serves 3.0 — the compiler requires 3.1) and drives
 * real GET operations against www.warnely.com/api/v1.
 *
 * Gated on PRISM_LIVE_OPENAPI_TOOLS=1 — skip-not-fail. No credentials; the
 * pinned server origin is the only host the compiled tools can reach (compile
 * rejects server drift). Request budget: 1 spec fetch + 2 tool calls = 3, under
 * the plan's ≤5 ceiling. Validation errors must fail closed locally (no
 * request); HTTP 4xx must map to a status-carrying untrusted result, never an
 * unclassified throw.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ToolEffectDeclaration } from "@arnilo/prism";
import { createOpenApiTools, OpenApiToolError } from "../index.js";

const FLAG = process.env.PRISM_LIVE_OPENAPI_TOOLS === "1";
const SPEC_URL = "https://warnely.com/openapi.json";
const SERVER = "https://www.warnely.com/api/v1";
/** Security criterion: the live target is a fixed public, non-sensitive origin. */
assert.ok(new URL(SPEC_URL).host === "warnely.com", "live target must stay on the allow-listed public spec host");

function context(toolCallId: string) {
  return { sessionId: "live-openapi", runId: "live-openapi", toolCallId };
}

describe("openapi live (real public spec + API)", {
  skip: !FLAG && "set PRISM_LIVE_OPENAPI_TOOLS=1 to run the live OpenAPI wire probe",
}, () => {
  it("compiles the real public spec into bounded read-only tools", async () => {
    const response = await fetch(SPEC_URL);
    assert.equal(response.status, 200, `spec fetch failed: ${response.status}`);
    const document = await response.json();
    const tools = createOpenApiTools({ document, operations: ["listCountries", "getCountryByIso"], server: SERVER });
    assert.equal(tools.length, 2, `expected both operations to compile, got: ${tools.map((t) => t.name).join(", ")}`);
    for (const tool of tools) {
      const effect = tool.effect as ToolEffectDeclaration | undefined;
      assert.ok(effect && effect.kind === "none", `GET operation must compile read-only, got ${JSON.stringify(effect)}`);
    }
  });

  it("one real tool call returns 200 as untrusted external content", async () => {
    const response = await fetch(SPEC_URL);
    const document = await response.json();
    const [listCountries] = createOpenApiTools({ document, operations: ["listCountries"], server: SERVER });
    const result = await listCountries!.execute({}, context("call-live-1"));
    const value = result.value as { status: number; body: unknown };
    assert.equal(value.status, 200);
    assert.ok(value.body !== undefined && value.body !== "", "real API must return content");
    assert.equal(result.metadata?.trust, "untrusted_external", "real API content must be marked untrusted");
    const first = result.content?.[0];
    assert.ok(
      first?.type === "text" && /UNTRUSTED EXTERNAL API CONTENT/.test(first.text),
      "untrusted-content marker must precede API output",
    );
  });

  it("missing required argument fails closed locally with no request", async () => {
    const response = await fetch(SPEC_URL);
    const document = await response.json();
    let wireCalls = 0;
    const countingFetch: typeof fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      wireCalls += 1;
      return fetch(input, init);
    }) as typeof fetch;
    const [getCountryByIso] = createOpenApiTools({
      document,
      operations: ["getCountryByIso"],
      server: SERVER,
      fetch: countingFetch,
    });
    await assert.rejects(
      async () => {
        await getCountryByIso!.execute({}, context("call-live-2"));
      },
      (error: unknown) => {
        assert.ok(error instanceof OpenApiToolError);
        assert.equal(error.code, "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");
        return true;
      },
    );
    assert.equal(wireCalls, 0, "validation errors must fail closed before any wire traffic");
  });

  it("HTTP 404 maps to a status-carrying untrusted result", async () => {
    const response = await fetch(SPEC_URL);
    const document = await response.json();
    const [getCountryByIso] = createOpenApiTools({ document, operations: ["getCountryByIso"], server: SERVER });
    const result = await getCountryByIso!.execute({ iso: "zz" }, context("call-live-3"));
    const value = result.value as { status: number };
    assert.equal(value.status, 404, `expected the real API's 404, got ${JSON.stringify(value).slice(0, 120)}`);
    assert.equal(result.metadata?.trust, "untrusted_external");
  });
});
