import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  assertDecisionRequest,
  assertDecisionsSupported,
  createAgent,
  createSecretRedactor,
  DecisionsError,
  definePackage,
  type DecisionRequest,
  type DecisionsProvider,
  type LoopStrategy,
  type RunController,
  modelSupportsDecisions,
} from "../index.js";
import { mockProvider } from "../testing/index.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMAGE = `data:image/png;base64,${PNG}`;
const MODEL = { provider: "mock", model: "m", capabilities: { decisions: true, input: ["image", "text"] } };

function fakeAdapter(seen: DecisionRequest[] = []): DecisionsProvider {
  return {
    id: "fake",
    async decide(request) {
      seen.push(request);
      return {
        model: "fake-checkpoint",
        answers: {
          urgent: { type: "noul", noul: 0.91 },
          team: { type: "choice", choice: "billing", probabilities: { billing: 0.8, shipping: 0.2 }, confidence: 0.8 },
        },
        timingMs: 1,
      };
    },
  };
}

function pkg(name: string, setup: (api: any) => void, extra: Record<string, unknown> = {}) {
  return definePackage<any>({ name, version: "1.0.0", requires: { api: 1 }, setup, ...extra });
}

const modelLessLoop = (run: (run: RunController) => Promise<void>): LoopStrategy => ({
  name: "none",
  revision: "1",
  usesModel: false,
  run,
});

describe("decisions contract", () => {
  it("modelSupportsDecisions_requires_explicit_capability_flag", () => {
    assert.equal(modelSupportsDecisions(undefined), false);
    assert.equal(modelSupportsDecisions({}), false);
    assert.equal(modelSupportsDecisions({ decisions: false }), false);
    assert.equal(modelSupportsDecisions({ decisions: true }), true);
  });

  it("assertDecisionsSupported_throws_typed_unsupported_model_error", () => {
    assert.throws(
      () => assertDecisionsSupported({ provider: "p", model: "m", capabilities: {} }),
      (error: unknown) => error instanceof DecisionsError && error.code === "unsupported_model" && /p\/m/.test(error.message),
    );
  });

  it("validation_rejects_bad_questions", () => {
    const bad = (questions: unknown) =>
      assert.throws(
        () => assertDecisionRequest({ model: "m", questions } as DecisionRequest, { ...MODEL, capabilities: { input: ["text"] } }),
        (error: unknown) => error instanceof DecisionsError && error.code === "invalid_request",
      );
    bad({});
    bad(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`q${index}`, { type: "noul", instructions: "x" }])));
    bad({ q: { type: "choice", instructions: "x", criteria: { only: null } } });
    bad({ q: { type: "score", instructions: "x", criteria: Array.from({ length: 11 }, (_, index) => `l${index}`) } });
    bad({ q: { type: "other", instructions: "x" } });
    bad({ q: { type: "noul", instructions: "" } });
    assert.doesNotThrow(() =>
      assertDecisionRequest(
        { model: "m", questions: { q: { type: "noul", instructions: "x" } } },
        { ...MODEL, capabilities: { input: ["text"] } },
      ),
    );
  });

  it("validation_rejects_bad_images", () => {
    const withImages = (images: unknown) =>
      assertDecisionRequest({ model: "m", images, questions: { q: { type: "noul", instructions: "x" } } } as DecisionRequest, MODEL);
    assert.throws(() => withImages(["https://example.com/a.png"]), /data:image/);
    assert.throws(() => withImages([`data:text/plain;base64,${PNG}`]), /data:image/);
    const oversized = `data:image/png;base64,${"A".repeat(Math.ceil((9 * 1024 * 1024) / 3) * 4)}`;
    assert.throws(
      () => withImages([oversized]),
      (error: unknown) => error instanceof DecisionsError && error.code === "state_too_large",
    );
    assert.throws(
      () =>
        assertDecisionRequest(
          { model: "m", images: [IMAGE], questions: { q: { type: "noul", instructions: "x" } } },
          { ...MODEL, capabilities: { input: ["text"], decisions: true } },
        ),
      /does not declare image input/,
    );
    assert.doesNotThrow(() => withImages([IMAGE]));
  });

  it("validation_rejects_oversize_state_with_state_too_large", () => {
    assert.throws(
      () => assertDecisionRequest({ model: "m", state: "a".repeat(262_145), questions: { q: { type: "noul", instructions: "x" } } }, MODEL),
      (error: unknown) => error instanceof DecisionsError && error.code === "state_too_large",
    );
  });
});

describe("decisions package access", () => {
  it("models_decisions_throws_unsupported_model_without_flag_or_adapter", async () => {
    const adapter = fakeAdapter();
    let api: any;
    const user = pkg("@acme/d1", (a) => void (api = a), { capabilities: ["models"] });
    await createAgent({
      model: { ...MODEL, capabilities: {} },
      packages: [mockProvider([], { decisions: adapter }), user],
    });
    assert.throws(
      () => api.models.decisions(),
      (error: unknown) => error instanceof DecisionsError && error.code === "unsupported_model",
    );

    let api2: any;
    const user2 = pkg("@acme/d2", (a) => void (api2 = a), { capabilities: ["models"] });
    await createAgent({ model: MODEL, packages: [mockProvider([]), user2] });
    assert.throws(
      () => api2.models.decisions(),
      (error: unknown) => error instanceof DecisionsError && error.code === "unsupported_model",
    );
  });

  it("models_decisions_needs_models_capability", async () => {
    const user = pkg("@acme/d3", ({ models }: any) => void models.decisions());
    await assert.rejects(
      createAgent({ model: MODEL, packages: [mockProvider([], { decisions: fakeAdapter() }), user] }),
      (error: { code?: string }) => {
        return error.code === "capability_missing";
      },
    );
  });

  it("models_decisions_binds_the_resolved_model_id", async () => {
    const seen: DecisionRequest[] = [];
    let api: any;
    const user = pkg("@acme/d4", (a) => void (api = a), { capabilities: ["models"] });
    await createAgent({ model: MODEL, packages: [mockProvider([], { decisions: fakeAdapter(seen) }), user] });
    const result = await api.models.decisions().decide({ questions: { q: { type: "noul", instructions: "x" } } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.model, "m");
    assert.equal(result.answers.urgent.noul, 0.91);
  });

  it("models_decisions_without_ref_or_configured_model_throws_type_error", async () => {
    let api: any;
    const user = pkg("@acme/d5", (a) => void (api = a), { capabilities: ["models"] });
    await createAgent({ slots: { loop: modelLessLoop(async () => {}) }, packages: [mockProvider([], { decisions: fakeAdapter() }), user] });
    assert.throws(() => api.models.decisions(), /models\.decisions needs a model reference/);
  });

  it("mock_provider_decisions_returns_scripted_answers_with_probabilities", async () => {
    const seen: DecisionRequest[] = [];
    let api: any;
    const user = pkg("@acme/d6", (a) => void (api = a), { capabilities: ["models"] });
    await createAgent({ model: MODEL, packages: [mockProvider([], { decisions: fakeAdapter(seen) }), user] });
    const { answers } = await api.models.decisions("mock/m").decide({
      questions: {
        urgent: { type: "noul", instructions: "blocked?" },
        team: { type: "choice", instructions: "owner?", criteria: { billing: null, shipping: null } },
      },
    });
    assert.deepEqual(answers.team, { type: "choice", choice: "billing", probabilities: { billing: 0.8, shipping: 0.2 }, confidence: 0.8 });
  });

  it("decision_error_never_contains_resolved_key", async () => {
    const CANARY = "sk-live-canary-decisions";
    const logged: string[] = [];
    const adapter: DecisionsProvider = {
      id: "fake",
      async decide() {
        throw new Error(`upstream rejected ${CANARY}`);
      },
    };
    const user = pkg(
      "@acme/d7",
      async ({ models, log, status }: any) => {
        try {
          await models.decisions().decide({ questions: { q: { type: "noul", instructions: "x" } } });
        } catch (error) {
          log.error((error as Error).message);
          status.note("warn", (error as Error).message);
        }
      },
      { capabilities: ["models"] },
    );
    const agent = await createAgent({
      model: MODEL,
      packages: [mockProvider([], { decisions: adapter }), user],
      redactor: createSecretRedactor([CANARY]),
      host: { log: { debug() {}, error: (message) => void logged.push(message), warn() {}, info() {} } },
    });
    const inspection = JSON.stringify(agent.inspect());
    assert.equal(logged.join(" ").includes(CANARY), false);
    assert.equal(inspection.includes(CANARY), false);
    assert.ok(inspection.includes("[REDACTED]"));
  });
});
