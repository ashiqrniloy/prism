// Plan 079 Task 8: opt-in Signal live probe. Skips without an operator socket; never registers accounts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCheckpointStore, createMemoryLeaseStore } from "@arnilo/prism";
import { createSignalAdapter, SIGNAL_CLI_VERSION } from "../signal.js";

const LIVE = process.env.PRISM_LIVE_SIGNAL === "1";
const SOCKET = process.env.PRISM_LIVE_SIGNAL_SOCKET;
const ACCOUNT = process.env.PRISM_LIVE_SIGNAL_ACCOUNT;
const TERMS = process.env.PRISM_LIVE_SIGNAL_TERMS_VERSION;
const skip: string | false =
  !LIVE || !SOCKET || !ACCOUNT || !TERMS
    ? "set PRISM_LIVE_SIGNAL=1, PRISM_LIVE_SIGNAL_SOCKET, PRISM_LIVE_SIGNAL_ACCOUNT and PRISM_LIVE_SIGNAL_TERMS_VERSION"
    : false;
const RECIPIENT = process.env.PRISM_LIVE_SIGNAL_RECIPIENT_UUID;

describe("plan 079 signal live", () => {
  it("subscribes to an operator-owned socket and reports payload-free health", { skip, timeout: 30_000 }, async () => {
    const adapter = createSignalAdapter({
      connectionId: "live-signal",
      socketPath: SOCKET ?? "",
      account: ACCOUNT ?? "",
      signalCliVersion: SIGNAL_CLI_VERSION,
      policy: {
        acceptableUse: "operator_approved",
        gplDistribution: "operator_approved",
        termsVersion: TERMS ?? "",
      },
      checkpoints: createMemoryCheckpointStore(),
      leases: createMemoryLeaseStore(),
      cursorOwnership: { tenantId: "live-signal" },
    });
    await adapter.start(() => ({ status: "denied", reason: "rejected" }));
    const health = adapter.health();
    assert.equal(health.bridge, "connected");
    assert.equal(health.subscription, "active");
    if (RECIPIENT !== undefined && RECIPIENT.length > 0) {
      const sent = await adapter.send({
        connectionId: "live-signal",
        externalConversationId: RECIPIENT,
        kind: "notice",
        text: "prism live probe",
      });
      assert.equal(sent.delivered, true);
    }
    await adapter.stop();
  });
});
