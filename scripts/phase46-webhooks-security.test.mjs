/**
 * Outbound-webhook threat-suite leg (plan 046 Task 3).
 * Runs only built public entrypoints. The package test and core pinned-fetch
 * fixtures are also registered in security:threat-suites for signature/redaction
 * and the full SSRF matrix.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { pinnedFetch } from "@arnilo/prism";
import { createWebhookNotifier } from "@arnilo/prism-core/runtime/server";

const BLOCKER_IDS = ["webhook-registration", "webhook-rebinding", "webhook-redirect"];
const blockerIds = new Set();
const notifierOptions = (url, extra = {}) => ({
  targets: [{ url, events: ["run.failed"] }],
  signer: { key: Buffer.alloc(32, 7) },
  redactor: { redact: (value) => value },
  ...extra,
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, server });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

describe("outbound webhook security conformance (plan 046 Task 3, built public entrypoints)", () => {
  it("rejects public HTTP, private, and metadata registrations; loopback HTTP requires opt-in", () => {
    for (const url of [
      "http://hooks.example.test/prism",
      "http://localhost:3000/prism",
      "https://127.0.0.1/prism",
      "https://169.254.169.254/latest/meta-data",
      "https://metadata.google.internal/prism",
    ]) {
      assert.throws(() => createWebhookNotifier(notifierOptions(url)));
    }
    assert.doesNotThrow(() => createWebhookNotifier(notifierOptions("http://localhost:3000/prism", { allowLoopbackHttp: true })));
    blockerIds.add("webhook-registration");
  });

  it("pins every DNS resolution and rejects a rebinding private answer before connect", async () => {
    const { origin, server } = await listen((_request, response) => response.end("ok"));
    try {
      const url = new URL(origin.replace("127.0.0.1", "localhost"));
      let resolves = 0;
      const fetchPinned = () =>
        pinnedFetch(url, undefined, {
          allowLoopback: true,
          resolver: async () => {
            resolves += 1;
            return resolves === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.1", family: 4 }];
          },
        });

      assert.equal(await (await fetchPinned()).text(), "ok");
      await assert.rejects(fetchPinned, (error) => error?.code === "ssrf_denied");
      assert.equal(resolves, 2);
      blockerIds.add("webhook-rebinding");
    } finally {
      await close(server);
    }
  });

  it("rejects a redirect before following it", async () => {
    const { origin, server } = await listen((_request, response) => {
      response.writeHead(302, { location: "https://example.test/private" });
      response.end();
    });
    try {
      await assert.rejects(
        () => pinnedFetch(new URL(origin), undefined, { allowLoopback: true }),
        (error) => error?.code === "redirect",
      );
      blockerIds.add("webhook-redirect");
    } finally {
      await close(server);
    }
  });

  it("gate accounting: all webhook SSRF blockers executed", () => {
    assert.deepEqual(
      [...blockerIds].sort(),
      [...BLOCKER_IDS].sort(),
      `blocker coverage incomplete; ran: ${[...blockerIds].sort().join(", ")}`,
    );
  });
});
