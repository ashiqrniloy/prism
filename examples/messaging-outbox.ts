// Plan 080 Task 8: optional PostgreSQL ERP-outbox composition, network-free.
// The host appends one correlation-only outbox row in its own transaction, commits, and only then
// sends the reply through the transport it owns. No new SQL table, no `pg` peer on
// @arnilo/prism-channels and no channel-side dispatcher — this is composition, not an integration.
// A real host passes a real `pg.Pool` and a real adapter (`createTelegramAdapter`, ...); the demo
// stands in for both so it runs offline while still calling the real `outbox.append`.
import type { AgentIdentity } from "@arnilo/prism";
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import type { ChannelReply, ChannelSendResult } from "@arnilo/prism-channels";
import { createMessagingRuntime } from "@arnilo/prism-channels";
import { createPostgresErpMessaging } from "@arnilo/prism-core/enterprise/postgres";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import type { Pool, PoolClient } from "pg";

const INBOUND_TEXT = "hello from the host";
const REPLY_TEXT = "Host example reply.";
const TOPIC = "prism.channel.reply";

const identity: AgentIdentity = {
  tenantId: "example-tenant",
  userId: "example-user",
  principal: { kind: "user", id: "example-user" },
  scopes: ["chat"],
  issuedAt: new Date(0).toISOString(),
  verified: true,
};

export async function demo(): Promise<Record<string, unknown>> {
  const order: string[] = [];
  const inserts: { text: string; params: readonly unknown[] }[] = [];
  const sent: string[] = [];

  // ── Stand-in for `pg`: records call order and returns the row the real INSERT ... RETURNING would.
  const client = {
    query: (text: string, params: readonly unknown[] = []) => {
      if (/INSERT INTO/i.test(text)) {
        order.push("append");
        inserts.push({ text, params });
        const [tenantId, messageId, topic, payload] = params;
        const now = new Date().toISOString();
        return Promise.resolve({
          rows: [
            {
              tenant_id: tenantId,
              message_id: messageId,
              topic,
              payload,
              status: "pending",
              attempt: 0,
              version: 1,
              claim_token: null,
              lease_expires_at: null,
              next_attempt_at: now,
              last_error: null,
              last_action_ref: null,
              created_at: now,
              updated_at: now,
            },
          ],
          rowCount: 1,
        });
      }
      order.push(text.trim().toUpperCase());
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
    release: () => {},
  } as unknown as PoolClient;
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;

  // ── Stand-in for the transport adapter the host owns.
  const transport = {
    send: (reply: ChannelReply): Promise<ChannelSendResult> => {
      order.push("send");
      sent.push(reply.text);
      return Promise.resolve({ delivered: true, messageId: `transport-${sent.length}` });
    },
  };

  const persistence = createSqlitePersistence({ filename: ":memory:" });
  try {
    const erp = createPostgresErpMessaging({ pool });
    const agent = createAgent({
      id: "outbox-agent",
      model: { provider: "mock", model: "offline" },
      provider: createMockProvider([providerTextDelta(REPLY_TEXT), providerDone()]),
      store: persistence,
      runLedger: persistence,
    });
    const runtime = createMessagingRuntime({
      authorize: () => ({ identity, agentAliases: ["primary"], grantRevision: "rev-1" }),
      resolveAgent: () => agent,
      deliver: async (reply) => {
        // The runtime hands `deliver` correlation ids only — the prompt text is never here.
        const owned = await pool.connect();
        try {
          await owned.query("BEGIN");
          await erp.outbox.append(owned, {
            // Tenant comes from the identity's ownership scope, never from the transport event.
            tenantId: identity.tenantId,
            messageId: reply.inReplyTo ?? `${reply.connectionId}:reply`,
            topic: TOPIC,
            payload: { connectionId: reply.connectionId, eventId: reply.inReplyTo, kind: reply.kind },
          });
          await owned.query("COMMIT");
        } catch (error) {
          await owned.query("ROLLBACK");
          throw error;
        } finally {
          owned.release();
        }
        // Only after commit: an external send cannot be rolled back, so the row is the record.
        return transport.send(reply);
      },
      checkpoints: persistence.checkpoints,
      leases: persistence.leases,
    });

    const admission = await runtime.admit({
      connectionId: "erp-host",
      externalConversationId: "chat-1",
      externalActorId: "user-1",
      eventId: "42",
      text: INBOUND_TEXT,
    });
    const drained = await runtime.drain({ deadlineMs: 5_000 });
    await runtime.stop();

    const row = inserts[0];
    const [tenantId, messageId, topic, encodedPayload] = row?.params ?? [];
    const summary = {
      admission: admission.status,
      drained: drained.settled,
      order,
      outboxRows: inserts.length,
      tenantId,
      messageId,
      topic,
      payload: JSON.parse(String(encodedPayload ?? "null")),
      sent,
      leakedPromptText: String(encodedPayload ?? "").includes(INBOUND_TEXT) || String(encodedPayload ?? "").includes(REPLY_TEXT),
    };
    if (summary.leakedPromptText) throw new Error("the outbox payload must stay correlation-only");
    if (order.join(">") !== "BEGIN>append>COMMIT>send") throw new Error(`unexpected delivery order: ${order.join(">")}`);
    if (summary.outboxRows !== sent.length) throw new Error("one outbox row per delivered reply");
    return summary;
  } finally {
    persistence.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
