import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AgentIdentity, createSecretRedactor, MediaContentError, pinnedFetch } from "@arnilo/prism";
import { createMemoryPolicyDecisionStore, createOpaPolicyEvaluator, evaluateAndAppend, PolicyError } from "../index.js";
import type { OpaDecisionDocument } from "../opa.js";

const ISSUER_URL = "https://opa.example.internal:8181/v1/data/prism/allow";

function identity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    principal: { kind: "agent", id: "agent-1" },
    sponsor: { kind: "user", id: "sponsor-1" },
    scopes: ["mail.read"],
    issuedAt: "2026-07-23T00:00:00.000Z",
    verified: true,
    ...overrides,
  };
}

interface ScriptedStep {
  readonly status?: number;
  readonly body?: unknown;
  readonly raw?: string;
}

interface OpaFetch {
  impl: typeof fetch;
  readonly calls: number;
  readonly requests: Array<{ url: string; body?: string; contentType?: string }>;
}

/** Scripted fake OPA endpoint; undefined step hangs until abort (timeout fixture). */
function makeOpaFetch(script: (call: number) => ScriptedStep | undefined | Promise<ScriptedStep | undefined>): OpaFetch {
  let calls = 0;
  const requests: OpaFetch["requests"] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const url = typeof input === "string" ? input : input.toString();
    requests.push({
      url,
      body: typeof init?.body === "string" ? init.body : undefined,
      contentType: init?.headers ? String((init.headers as Record<string, string>)["content-type"] ?? "") : undefined,
    });
    const step = await script(calls);
    if (step === undefined) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), {
          once: true,
        });
      });
    }
    const body = step.raw ?? JSON.stringify(step.body ?? {});
    return new Response(body, { status: step.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return {
    impl: impl as typeof fetch,
    get calls() {
      return calls;
    },
    requests,
  };
}

function makeVerifier(options: {
  url?: string;
  script: (call: number) => ScriptedStep | undefined | Promise<ScriptedStep | undefined>;
  overrides?: Partial<Parameters<typeof createOpaPolicyEvaluator>[0]>;
}) {
  const fetchApi = makeOpaFetch(options.script);
  const verifier = createOpaPolicyEvaluator({
    url: options.url ?? ISSUER_URL,
    policyId: "opa-prism",
    policyVersion: "2026-08-01",
    fetch: fetchApi.impl,
    ...options.overrides,
  });
  return { verifier, fetchApi };
}

function request(overrides: Partial<Parameters<typeof evaluateAndAppend>[0]> = {}): Parameters<typeof evaluateAndAppend>[0] {
  return { identity: identity(), action: "mail.read", resource: { kind: "mailbox", id: "inbox" }, ...overrides };
}

describe("@arnilo/prism-core/governance/policy/opa", () => {
  it("maps boolean, {allow}, and {outcome} decisions to allow/deny/modify/approval", async () => {
    const { verifier } = makeVerifier({
      script: (call) => {
        if (call === 1) return { body: { result: true } };
        if (call === 2) return { body: { result: false } };
        if (call === 3) return { body: { result: { allow: true } } };
        if (call === 4) return { body: { result: { allow: false } } };
        return {
          body: {
            result: { outcome: "approval", reason: "needs human", evidenceRefs: ["rule:send"], expiresAt: "2026-08-08T00:00:00.000Z" },
          },
        };
      },
    });
    assert.equal((await verifier.evaluate(request())).outcome, "allow");
    assert.equal((await verifier.evaluate(request())).outcome, "deny");
    assert.equal((await verifier.evaluate(request())).outcome, "allow");
    assert.equal((await verifier.evaluate(request())).outcome, "deny");
    const approval = await verifier.evaluate(request());
    assert.equal(approval.outcome, "approval");
    assert.equal(approval.reason, "needs human");
    assert.deepEqual(approval.evidenceRefs, ["rule:send"]);
    assert.equal(approval.expiresAt, "2026-08-08T00:00:00.000Z");
  });

  it("posts POST /v1/data/<path> with redacted actor refs only (no prompts/JWTs/credentials/context)", async () => {
    const { verifier, fetchApi } = makeVerifier({ script: () => ({ body: { result: true } }) });
    await verifier.evaluate(request({ action: "mail.send", resource: { kind: "mailbox", id: "outbox" } }));
    assert.equal(fetchApi.calls, 1);
    assert.equal(fetchApi.requests[0].url, ISSUER_URL);
    assert.equal(fetchApi.requests[0].contentType, "application/json");
    const sent = JSON.parse(fetchApi.requests[0].body ?? "{}") as { input: OpaDecisionDocument };
    assert.deepEqual(sent.input.resource, { kind: "mailbox", id: "outbox" });
    assert.equal(sent.input.action, "mail.send");
    assert.deepEqual(sent.input.identity, {
      tenantId: "tenant-1",
      userId: "user-1",
      principal: { kind: "agent", id: "agent-1" },
      sponsorId: "sponsor-1",
      scopes: ["mail.read"],
    });
    for (const forbidden of ["prompt", "payload", "messages", "toolArguments", "token", "jwt", "credential", "context"]) {
      assert.ok(!(forbidden in sent.input), `input must not contain ${forbidden}`);
    }
  });

  it("rejects custom inputs carrying unrestricted payload keys (fail closed)", async () => {
    const { verifier, fetchApi } = makeVerifier({
      script: () => ({ body: { result: true } }),
      overrides: { mapInput: () => ({ action: "mail.send", payload: { raw: "prompt" } }) },
    });
    await assert.rejects(
      async () => verifier.evaluate(request()),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_POLICY_PAYLOAD",
    );
    assert.equal(fetchApi.calls, 0);
  });

  it("fails closed on input oversize (default onFailure deny)", async () => {
    const { verifier, fetchApi } = makeVerifier({
      script: () => ({ body: { result: true } }),
      overrides: { maxInputBytes: 64 },
    });
    const result = await verifier.evaluate(request());
    assert.equal(result.outcome, "deny");
    assert.equal(fetchApi.calls, 0);
  });

  it("fails closed on malformed JSON and missing result", async () => {
    const { verifier } = makeVerifier({ script: () => ({ raw: "{not json" }) });
    const malformed = await verifier.evaluate(request());
    assert.equal(malformed.outcome, "deny");
    assert.ok(malformed.reason);
    const { verifier: noResult } = makeVerifier({ script: () => ({ body: { other: 1 } }) });
    const missing = await noResult.evaluate(request());
    assert.equal(missing.outcome, "deny");
  });

  it("fails closed on oversized response bodies (capped read, no unbounded buffering)", async () => {
    const { verifier } = makeVerifier({
      script: () => ({ raw: JSON.stringify({ result: { allow: true, reason: "x".repeat(4096) } }) }),
      overrides: { maxResponseBytes: 1024 },
    });
    const result = await verifier.evaluate(request());
    assert.equal(result.outcome, "deny");
  });

  it("fails closed on timeout (bounded, no retry by default) and escalates on demand", async () => {
    const { verifier, fetchApi } = makeVerifier({ script: () => undefined, overrides: { timeoutMs: 50 } });
    const result = await verifier.evaluate(request());
    assert.equal(result.outcome, "deny");
    assert.ok(result.reason?.includes("timed out"));
    assert.equal(fetchApi.calls, 1);
    const { verifier: escalating } = makeVerifier({ script: () => undefined, overrides: { timeoutMs: 50, onFailure: "escalate" } });
    await assert.rejects(
      async () => escalating.evaluate(request()),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_OPA_TIMEOUT",
    );
  });

  it("fails closed on transport errors and escalates with the frozen code", async () => {
    const { verifier } = makeVerifier({
      script: () => {
        throw new TypeError("ECONNREFUSED");
      },
    });
    const result = await verifier.evaluate(request());
    assert.equal(result.outcome, "deny");
    const { verifier: escalating } = makeVerifier({
      script: () => {
        throw new TypeError("ECONNREFUSED");
      },
      overrides: { onFailure: "escalate" },
    });
    await assert.rejects(
      async () => escalating.evaluate(request()),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_OPA_TRANSPORT",
    );
  });

  it("retries only timeout/transport/5xx up to the bounded maxRetries", async () => {
    const { verifier, fetchApi } = makeVerifier({
      script: (call) => {
        if (call <= 2) return { status: 500 };
        return { body: { result: { allow: true } } };
      },
      overrides: { maxRetries: 2 },
    });
    const result = await verifier.evaluate(request());
    assert.equal(result.outcome, "allow");
    assert.equal(fetchApi.calls, 3);
    const { verifier: noRetry, fetchApi: four } = makeVerifier({ script: () => ({ status: 404 }) });
    assert.equal((await noRetry.evaluate(request())).outcome, "deny");
    assert.equal(four.calls, 1);
  });

  it("sends provenance=true only when requirePolicyVersion is set; stale/missing revision fails closed", async () => {
    const { verifier: plainVerifier, fetchApi: plain } = makeVerifier({ script: () => ({ body: { result: true } }) });
    assert.equal((await plainVerifier.evaluate(request())).outcome, "allow");
    assert.ok(!plain.requests[0].url.includes("provenance"));
    const withProvenance = (revision?: string) => {
      const { verifier, fetchApi } = makeVerifier({
        script: () => ({
          body: revision === undefined ? { result: true } : { result: true, provenance: { bundles: { prism: { revision } } } },
        }),
        overrides: { requirePolicyVersion: "2026-08-01" },
      });
      return { verifier, fetchApi };
    };
    const match = withProvenance("2026-08-01");
    assert.equal((await match.verifier.evaluate(request())).outcome, "allow");
    assert.ok(match.fetchApi.requests[0].url.includes("provenance=true"));
    const stale = withProvenance("2026-07-01");
    assert.equal((await stale.verifier.evaluate(request())).outcome, "deny");
    const absent = withProvenance();
    assert.equal((await absent.verifier.evaluate(request())).outcome, "deny");
  });

  it("fails closed on unmappable decisions", async () => {
    const { verifier } = makeVerifier({ script: () => ({ body: { result: 42 } }) });
    const result = await verifier.evaluate(request());
    assert.equal(result.outcome, "deny");
    const { verifier: escalating } = makeVerifier({
      script: () => ({ body: { result: { outcome: "explode" } } }),
      overrides: { onFailure: "escalate" },
    });
    await assert.rejects(
      async () => escalating.evaluate(request()),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_OPA_DECISION_MAPPING",
    );
  });

  it("redacts OPA-provided reason and evidence refs before they leave the adapter", async () => {
    const { verifier } = makeVerifier({
      script: () => ({ body: { result: { outcome: "allow", reason: "ok super-secret", evidenceRefs: ["super-secret", "rule:1"] } } }),
      overrides: { redactor: createSecretRedactor(["super-secret"]) },
    });
    const result = await verifier.evaluate(request());
    assert.equal(result.outcome, "allow");
    assert.ok(!result.reason?.includes("super-secret"));
    assert.deepEqual(result.evidenceRefs, ["[REDACTED]", "rule:1"]);
  });

  it("records decisions through evaluateAndAppend into the durable ledger (ownership-scoped)", async () => {
    const { verifier } = makeVerifier({ script: () => ({ body: { result: { allow: true } } }) });
    const store = createMemoryPolicyDecisionStore();
    const record = await evaluateAndAppend(request({ action: "mail.send" }), {
      store,
      evaluator: verifier,
      id: "decision-1",
    });
    assert.equal(record.outcome, "allow");
    assert.equal(record.policyId, "opa-prism");
    assert.equal(record.policyVersion, "2026-08-01");
    assert.equal(record.actor.principalId, "agent-1");
    assert.equal(record.actor.tenantId, "tenant-1");
    assert.deepEqual(record.target, { kind: "mailbox", id: "inbox" });
    const page = await store.query({ tenantId: "tenant-1", userId: "user-1" });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, "decision-1");
  });

  it("records fail-closed denials too (audit trail) and keeps requirePolicyVersion semantics", async () => {
    const { verifier } = makeVerifier({ script: () => ({ status: 500 }) });
    const store = createMemoryPolicyDecisionStore();
    const record = await evaluateAndAppend(request(), { store, evaluator: verifier, id: "denied-1" });
    assert.equal(record.outcome, "deny");
    assert.ok(record.reason);
    const pinned = createMemoryPolicyDecisionStore({ requirePolicyVersion: "2026-08-01" });
    const { verifier: other } = makeVerifier({ script: () => ({ body: { result: true } }), overrides: { policyVersion: "2026-07-01" } });
    await assert.rejects(
      async () => evaluateAndAppend(request(), { store: pinned, evaluator: other, id: "denied-2" }),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_POLICY_VERSION",
    );
  });

  it("propagates caller aborts instead of converting them to a policy outcome", async () => {
    const { verifier } = makeVerifier({ script: () => undefined, overrides: { timeoutMs: 10_000 } });
    const controller = new AbortController();
    const pending: Promise<unknown> = Promise.resolve(verifier.evaluate(request({ signal: controller.signal })));
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
  });

  it("applies SSRF policy to the endpoint (denial surfaces MediaContentError, zero calls, any onFailure)", async () => {
    for (const onFailure of ["deny", "escalate"] as const) {
      const { verifier, fetchApi } = makeVerifier({
        url: "http://127.0.0.1:8181/v1/data/prism/allow",
        script: () => ({ body: { result: true } }),
        overrides: { onFailure },
      });
      await assert.rejects(
        async () => verifier.evaluate(request()),
        (error: unknown) => error instanceof MediaContentError && error.code === "ssrf_denied",
      );
      assert.equal(fetchApi.calls, 0);
    }
  });

  it("default OPA path pins DNS through the core pinnedFetch primitive", async () => {
    // The default (no fetch option) OPA decision fetch routes through pinnedFetch:
    // an endpoint resolving to a private address fails closed as ssrf_denied
    // before any connect (rebinding defense).
    await assert.rejects(
      () =>
        pinnedFetch(
          new URL(ISSUER_URL),
          { method: "POST", body: "{}" },
          {
            resolver: async () => [{ address: "10.0.0.1", family: 4 }],
          },
        ),
      (error: unknown) => error instanceof MediaContentError && error.code === "ssrf_denied",
    );
  });

  it("validates action/resource before any network call", async () => {
    const { verifier, fetchApi } = makeVerifier({ script: () => ({ body: { result: true } }) });
    await assert.rejects(
      async () => verifier.evaluate(request({ action: "" })),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_POLICY_VALIDATION",
    );
    await assert.rejects(
      async () => verifier.evaluate(request({ resource: { kind: "", id: "x" } })),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_POLICY_VALIDATION",
    );
    assert.equal(fetchApi.calls, 0);
  });

  it("rejects out-of-bounds caps at construction", () => {
    assert.throws(
      () => createOpaPolicyEvaluator({ url: ISSUER_URL, policyId: "p", policyVersion: "v", maxRetries: 5 }),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_POLICY_LIMITS",
    );
    assert.throws(
      () => createOpaPolicyEvaluator({ url: "not a url", policyId: "p", policyVersion: "v" }),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_POLICY_VALIDATION",
    );
  });
});
