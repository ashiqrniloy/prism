/**
 * Plans/064 Task 9 live outbound-webhook probes.
 * Env-gated: skipped (never failed) unless PRISM_TEST_WEBHOOK_URL is set —
 * that URL must be an endpoint the operator owns (their own receiver).
 * PRISM_TEST_WEBHOOK_SECRET overrides the shared HMAC key (≥ 32 bytes; default
 * "prism-live-webhook-secret-0123456789abcdef"; the receiver verifies
 * x-prism-signature). Bounded: 1 request to the operator receiver + ≤ 2 requests
 * to a local loopback receiver for the retry-after-5xx leg.
 */
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { createSecretRedactor } from "@arnilo/prism";
import { createWebhookNotifier, signWebhookBody } from "../webhooks.js";

const TARGET_URL = process.env.PRISM_TEST_WEBHOOK_URL;
const SECRET = process.env.PRISM_TEST_WEBHOOK_SECRET ?? "prism-live-webhook-secret-0123456789abcdef";
const skip: string | false = !TARGET_URL
  ? "set PRISM_TEST_WEBHOOK_URL (an endpoint you own) and optionally PRISM_TEST_WEBHOOK_SECRET to run live webhook delivery probes"
  : false;

const signer = { key: new TextEncoder().encode(SECRET) };
const redactor = createSecretRedactor([SECRET]);

function waitForDelivered(notifier: ReturnType<typeof createWebhookNotifier>, minimum: number, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const diagnostics = notifier.diagnostics();
      if (diagnostics.delivered >= minimum) return resolve();
      if (diagnostics.failures.length > 0) return reject(new Error(`webhook delivery failed: ${JSON.stringify(diagnostics.failures)}`));
      if (Date.now() - started > timeoutMs)
        return reject(new Error(`webhook delivery did not settle within ${timeoutMs}ms: ${JSON.stringify(diagnostics)}`));
      setTimeout(poll, 100);
    };
    poll();
  });
}

/** Verifies the x-prism-signature HMAC over the raw body the receiver saw. */
function verifySignature(rawBody: string, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(signWebhookBody(rawBody, signer.key));
  const received = Buffer.from(header.slice("sha256=".length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

describe("@arnilo/prism-core runtime/server/webhooks live tests", () => {
  it("live_signed_delivery_reaches_operator_receiver", { skip }, async () => {
    const notifier = createWebhookNotifier({ targets: [{ url: TARGET_URL!, events: ["run.completed"] }], signer, redactor });
    notifier.notify({ event: "run.completed", runId: "live-webhook-probe", status: "completed", timestamp: new Date().toISOString() });
    await waitForDelivered(notifier, 1);
    const diagnostics = notifier.diagnostics();
    assert.equal(diagnostics.failures.length, 0);
    assert.ok(!JSON.stringify(diagnostics).includes(SECRET), "diagnostics must never carry the signing secret");
  });

  it("live_retries_after_5xx_and_verifies_signature_over_loopback", { skip: skip || false }, async () => {
    const seen: { raw: string; signature?: string }[] = [];
    let mode500 = true;
    const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
      void request;
      if (mode500) {
        mode500 = false;
        response.writeHead(500).end();
        return;
      }
      let raw = "";
      request.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      request.on("end", () => {
        const signatureHeader = request.headers["x-prism-signature"];
        seen.push({ raw, signature: Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader });
        response.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const notifier = createWebhookNotifier({
        targets: [{ url: `http://127.0.0.1:${address.port}/prism-webhook`, events: ["run.completed"] }],
        signer,
        redactor,
        allowLoopbackHttp: true,
        limits: { retries: 3, retryBaseDelayMs: 10, retryMaxDelayMs: 20, timeoutMs: 2_000 },
      });
      notifier.notify({ event: "run.completed", runId: "live-webhook-retry-probe", status: "completed" });
      await waitForDelivered(notifier, 1);
      assert.ok(seen.length >= 1, "receiver must see the successful (post-retry) delivery");
      assert.equal(
        verifySignature(seen[0]!.raw, seen[0]!.signature),
        true,
        "receiver-side signature verification must pass over the delivered envelope",
      );
      assert.ok(notifier.diagnostics().retries >= 1, "the 5xx first attempt must be recorded as a retry");
      assert.ok(!JSON.stringify(seen).includes(SECRET), "delivered envelopes must not carry the signing secret");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
