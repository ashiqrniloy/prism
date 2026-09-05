import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { assertAgentEventSourceConforms } from "@arnilo/prism";
import { assertStateConcurrencyConforms } from "@arnilo/prism/testing/state-concurrency-conformance";
import { jetstreamManager } from "@nats-io/jetstream";
import { connect } from "@nats-io/transport-node";
import { createNatsAgentEventSource } from "../event-source.js";
import { createNatsJetStream } from "../jetstream.js";

const natsUrl = process.env.PRISM_TEST_NATS_URL;
const describeIntegration = natsUrl ? describe : describe.skip;

describeIntegration("NATS JetStream live (events, cursor, restart)", () => {
  it("conforms on a real server and resumes cursors across reopen", async () => {
    const nc = await connect({ servers: natsUrl });
    const jsm = await jetstreamManager(nc);
    const stream = `prism_t_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await jsm.streams.add({ name: stream, subjects: ["prism.agent-events.>"] });
    try {
      const connection = await createNatsJetStream(nc);
      const open = () => createNatsAgentEventSource({ connection, stream, cursorSecret: "nats-ci-cursor" });
      await assertAgentEventSourceConforms(open);
      const probes = await assertStateConcurrencyConforms({ events: { reopenable: true, create: open } });
      assert.ok(probes.includes("cursor-resume"), "nats live run did not execute probe cursor-resume");
    } finally {
      await jsm.streams.delete(stream).catch(() => undefined);
      await nc.close();
    }
  });
});
