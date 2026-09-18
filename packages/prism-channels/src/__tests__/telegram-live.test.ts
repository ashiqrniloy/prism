// Plan 079 Task 8: opt-in Telegram live probe. Skips without credentials; never creates contacts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCheckpointStore, createMemoryLeaseStore } from "@arnilo/prism";
import { createTelegramAdapter } from "../telegram.js";

const LIVE = process.env.PRISM_LIVE_TELEGRAM === "1";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const skip: string | false = !LIVE || !TOKEN ? "set PRISM_LIVE_TELEGRAM=1 and TELEGRAM_BOT_TOKEN to run the live Telegram probe" : false;
const CHAT = process.env.PRISM_LIVE_TELEGRAM_CHAT_ID;

describe("plan 079 telegram live", () => {
  it("starts polling against getMe and stops without creating contacts", { skip, timeout: 30_000 }, async () => {
    const adapter = createTelegramAdapter({
      connectionId: "live-telegram",
      botToken: () => process.env.TELEGRAM_BOT_TOKEN,
      checkpoints: createMemoryCheckpointStore(),
      leases: createMemoryLeaseStore(),
      cursorOwnership: { tenantId: "live-telegram" },
      pollTimeoutSeconds: 1,
      pollLimit: 1,
    });
    await adapter.start(() => ({ status: "denied", reason: "rejected" }));
    if (CHAT !== undefined && CHAT.length > 0) {
      const sent = await adapter.send({
        connectionId: "live-telegram",
        externalConversationId: CHAT,
        kind: "notice",
        text: "prism live probe",
      });
      assert.equal(sent.delivered, true);
    }
    await adapter.stop();
  });
});
