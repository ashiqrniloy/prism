import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

interface OutboxSummary {
  admission: string;
  drained: boolean;
  order: string[];
  outboxRows: number;
  tenantId: unknown;
  messageId: unknown;
  topic: unknown;
  payload: Record<string, unknown>;
  sent: string[];
  leakedPromptText: boolean;
}

// Plan 080 Task 8: the ERP outbox composition stays honest offline — the row is appended inside
// the host transaction (BEGIN → append → COMMIT) before the reply reaches the transport, the
// payload carries correlation ids only, and there is exactly one row per delivered reply.
test("messaging_outbox_example_appends_a_correlation_row_before_the_handoff", () => {
  const result = spawnSync(process.execPath, ["examples/messaging-outbox.ts"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, `messaging-outbox.ts exited ${result.status}\n${result.stderr}`);

  const summary = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as OutboxSummary;
  assert.equal(summary.admission, "accepted");
  assert.equal(summary.drained, true);
  assert.deepEqual(summary.order, ["BEGIN", "append", "COMMIT", "send"], "the row commits before the send");
  assert.equal(summary.outboxRows, 1);
  assert.equal(summary.tenantId, "example-tenant", "tenant comes from the identity ownership scope");
  assert.equal(summary.messageId, "42", "correlation id, not message text");
  assert.equal(summary.topic, "prism.channel.reply");
  assert.deepEqual(summary.payload, { connectionId: "erp-host", eventId: "42", kind: "final" });
  assert.deepEqual(summary.sent, ["Host example reply."]);
  assert.equal(summary.leakedPromptText, false, "no prompt or reply text reaches the outbox");
});
