import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderRequest } from "@arnilo/prism";
import { assertAbortIsObserved, assertNoSecretLeak, collectProviderEvents } from "@arnilo/prism/testing/provider-conformance";
import { createTypeSafeProvider, typeSafeModels } from "../index.js";

// Env-gated live smoke tests for @arnilo/prism-providers/typesafe.
//
// Network-free by default: these tests skip unless BOTH
// `PRISM_LIVE_PROVIDER_TESTS=1` AND `TYPESAFE_API_KEY` are set. The default
// `npm test` and CI release verification never set these. To run locally:
//
//   PRISM_LIVE_PROVIDER_TESTS=1 TYPESAFE_API_KEY=... \
//     npm run test --workspace=@arnilo/prism-providers/typesafe
//
// Security: the API key is read from the env and used only as a bearer token;
// it is never logged. `assertNoSecretLeak` verifies the key value does not
// appear in any streamed event. The state is a non-sensitive command string.

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const API_KEY = process.env.TYPESAFE_API_KEY;
const skip: string | false =
  !LIVE || !API_KEY ? "set PRISM_LIVE_PROVIDER_TESTS=1 and TYPESAFE_API_KEY to run live TypeSafe Jev smoke tests" : false;

const model = typeSafeModels[0]!;
const apiKey = () => process.env.TYPESAFE_API_KEY;

const request: ProviderRequest = {
  model,
  messages: [{ role: "user", content: [{ type: "text", text: "rm -rf ./build" }] }],
  options: {
    structuredOutput: {
      name: "decision",
      schema: {
        type: "object",
        properties: { risky: { type: "boolean", description: "Would running this destroy data or leak secrets?" } },
      },
    },
  },
};

describe("@arnilo/prism-providers/typesafe live tests", () => {
  it("live_decision_renders_schema_valid_json_and_leaks_no_secret", { skip }, async () => {
    const events = await collectProviderEvents(createTypeSafeProvider({ apiKey }), request);
    const terminal = events.at(-1);
    assert.ok(terminal && terminal.type === "done", "live request completed");
    const text = events
      .map((event) => (event.type === "content_delta" && event.content.type === "text" ? event.content.text : ""))
      .join("");
    const parsed = JSON.parse(text);
    assert.equal(typeof parsed.risky, "boolean", "rendered decision is schema-valid");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_abort_signal_is_observed_before_first_request", { skip }, async () => {
    await assertAbortIsObserved({ provider: createTypeSafeProvider({ apiKey }), request });
  });
});
