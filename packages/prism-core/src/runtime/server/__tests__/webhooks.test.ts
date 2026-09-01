import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { createSecretRedactor } from "@arnilo/prism";
import { buildWebhookEnvelope, createWebhookNotifier, retryWebhookDelivery, signWebhookBody } from "../webhooks.js";

const key = Buffer.alloc(32, 7);
const redactor = createSecretRedactor(["top-secret"]);

function options() {
  return {
    targets: [{ url: "https://hooks.example.test/prism", events: ["run.failed" as const] }],
    signer: { key },
    redactor,
  };
}

describe("createWebhookNotifier", () => {
  it("redacts before signing and rejects a tampered body", () => {
    const envelope = buildWebhookEnvelope(
      { event: "run.failed", runId: "run-1", status: "failed", payload: { token: "top-secret" }, timestamp: "2026-01-01T00:00:00.000Z" },
      redactor,
      "event-1",
    );
    const body = JSON.stringify(envelope);
    const signature = signWebhookBody(body, key);

    assert.doesNotMatch(body, /top-secret/);
    assert.equal(signature, createHmac("sha256", key).update(body).digest("hex"));
    assert.notEqual(signature, createHmac("sha256", key).update(`${body}!`).digest("hex"));
  });

  it("retries transient 500, 429, and network failures only to cap", async () => {
    let serverCalls = 0;
    const server = await retryWebhookDelivery(
      async () => ({ status: ++serverCalls === 1 ? 500 : 200 }),
      { timeoutMs: 1, retries: 1, retryBaseDelayMs: 1, retryMaxDelayMs: 1, retryJitter: 0 },
      redactor,
    );
    let rateLimitCalls = 0;
    const rateLimited = await retryWebhookDelivery(
      async () => ({ status: ++rateLimitCalls === 1 ? 429 : 204 }),
      { timeoutMs: 1, retries: 1, retryBaseDelayMs: 1, retryMaxDelayMs: 1, retryJitter: 0 },
      redactor,
    );
    let networkCalls = 0;
    const network = await retryWebhookDelivery(
      async () => {
        networkCalls += 1;
        throw new Error("temporary network failure");
      },
      { timeoutMs: 1, retries: 2, retryBaseDelayMs: 1, retryMaxDelayMs: 1, retryJitter: 0 },
      redactor,
    );

    assert.deepEqual(server, { state: "delivered", attempts: 2, retries: 1, status: 200 });
    assert.deepEqual(rateLimited, { state: "delivered", attempts: 2, retries: 1, status: 204 });
    assert.equal(network.state, "failed");
    assert.equal(network.attempts, 3);
    assert.equal(network.retries, 2);
    assert.equal(networkCalls, 3);
  });

  it("does not retry permanent failures and redacts terminal errors", async () => {
    const permanent = await retryWebhookDelivery(
      async () => ({ status: 400 }),
      { timeoutMs: 1, retries: 3, retryBaseDelayMs: 1, retryMaxDelayMs: 1, retryJitter: 0 },
      redactor,
    );
    const redacted = await retryWebhookDelivery(
      async () => {
        throw new Error("top-secret transport failure");
      },
      { timeoutMs: 1, retries: 0, retryBaseDelayMs: 1, retryMaxDelayMs: 1, retryJitter: 0 },
      redactor,
    );

    assert.deepEqual(permanent, {
      state: "failed",
      attempts: 1,
      retries: 0,
      status: 400,
      error: "Webhook returned HTTP 400",
    });
    assert.equal(redacted.state, "failed");
    assert.equal(redacted.retries, 0);
    assert.doesNotMatch(redacted.error ?? "", /top-secret/);
  });

  it("cancels a retry backoff when its run signal aborts", async () => {
    const controller = new AbortController();
    const pending = retryWebhookDelivery(
      async () => {
        throw new Error("temporary failure");
      },
      { timeoutMs: 1, retries: 3, retryBaseDelayMs: 1_000, retryMaxDelayMs: 1_000, retryJitter: 0 },
      redactor,
      controller.signal,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    assert.deepEqual(await pending, { state: "cancelled", attempts: 1, retries: 0 });
  });

  it("rejects non-public endpoints and allows HTTP only with explicit loopback opt-in", () => {
    for (const url of [
      "http://hooks.example.test/prism",
      "http://localhost:3000/prism",
      "https://127.0.0.1/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://metadata.google.internal/hook",
    ]) {
      assert.throws(() => createWebhookNotifier({ ...options(), targets: [{ url, events: ["run.failed"] }] }));
    }
    assert.throws(() => createWebhookNotifier({ ...options(), signer: { key: Buffer.alloc(31) } }));
    assert.doesNotThrow(() =>
      createWebhookNotifier({
        ...options(),
        allowLoopbackHttp: true,
        targets: [{ url: "http://localhost:3000/prism", events: ["run.failed"] }],
      }),
    );
  });

  it("drops newest deliveries when bounded queue is full", () => {
    const notifier = createWebhookNotifier({
      ...options(),
      targets: [{ url: "https://example.invalid/hook", events: ["run.failed"] }],
      limits: { maxQueuedEvents: 1, timeoutMs: 1 },
    });
    const event = { event: "run.failed" as const, runId: "run-1", status: "failed" as const };
    notifier.notify(event);
    notifier.notify(event);
    notifier.notify(event);

    assert.equal(notifier.diagnostics().queued, 1);
    assert.equal(notifier.diagnostics().dropped, 1);
  });
});
