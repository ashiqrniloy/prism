#!/usr/bin/env node
/**
 * Plan 079 Task 8: sqlite-backed channel worker for SIGTERM / SIGKILL injection.
 * PRISM_CHANNELS_WORKER_INPUT = { filename, connectionId, eventId, chat, actor }
 */
import { createAgent } from "../../dist/index.js";
import { createMessagingRuntime } from "../../packages/prism-channels/dist/index.js";
import { createSqlitePersistence } from "../../packages/prism-core/dist/sessions/sqlite/index.js";

const input = JSON.parse(process.env.PRISM_CHANNELS_WORKER_INPUT ?? "null");
if (
  !input ||
  typeof input.filename !== "string" ||
  !input.filename.endsWith(".sqlite") ||
  typeof input.connectionId !== "string" ||
  typeof input.eventId !== "string" ||
  typeof input.chat !== "string" ||
  typeof input.actor !== "string"
) {
  throw new Error("PRISM_CHANNELS_WORKER_INPUT with filename/connectionId/eventId/chat/actor is required");
}

const identity = {
  tenantId: "e2e-tenant",
  userId: "e2e-user",
  principal: { kind: "user", id: "e2e-user" },
  scopes: ["chat"],
  issuedAt: "1970-01-01T00:00:00.000Z",
  verified: true,
};

const persistence = createSqlitePersistence({ filename: input.filename });
const agent = createAgent({
  id: "channel-agent",
  model: { provider: "mock", model: "demo" },
  provider: {
    id: "mock",
    async *generate(request) {
      await new Promise((resolve) => {
        if (request.signal?.aborted) {
          resolve();
          return;
        }
        request.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("aborted while the process was dying");
    },
  },
  store: persistence,
  runLedger: persistence,
});
const runtime = createMessagingRuntime({
  authorize: () => ({ identity, agentAliases: ["primary"], grantRevision: "rev-1" }),
  resolveAgent: () => agent,
  deliver: () => ({ delivered: true }),
  checkpoints: persistence.checkpoints,
  leases: persistence.leases,
});

const admitted = await runtime.admit({
  connectionId: input.connectionId,
  externalConversationId: input.chat,
  externalActorId: input.actor,
  eventId: input.eventId,
  text: "hello",
});
if (admitted.status !== "accepted" || admitted.operationId === undefined) {
  persistence.close();
  throw new Error("worker failed to admit");
}

let unresolved;
for (let attempt = 0; attempt < 200; attempt += 1) {
  unresolved = await runtime.listUnresolved({ identity });
  if (unresolved[0]?.state === "executing") break;
  await new Promise((resolve) => setTimeout(resolve, 5));
}
if (unresolved?.[0]?.state !== "executing") {
  persistence.close();
  throw new Error("worker never claimed the operation");
}
// Install SIGTERM before STATE. The test kills on the first STATE line; a handler
// registered after that write loses the race on loaded CI (exit code null).
const stopping = new Promise((resolve) => {
  const keepAlive = setInterval(() => {}, 60_000);
  process.on("SIGTERM", () => {
    clearInterval(keepAlive);
    resolve();
  });
});
process.stdout.write(`STATE ${JSON.stringify({ operationId: unresolved[0].operationId, version: unresolved[0].version })}\n`);
await stopping;
await runtime.stop();
persistence.close();
process.stdout.write("STOPPED\n");
