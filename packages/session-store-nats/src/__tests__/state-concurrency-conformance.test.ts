// plan 022 Task 4: NATS leg of the state-concurrency harness — replay-cursor
// resume across a real re-open (restart) against the network-free
// fake-jetstream seam. Real-NATS restart-durable probes stay protected
// evidence.

import { describe, it } from "node:test";
import { assertStateConcurrencyConforms } from "@arnilo/prism/testing/state-concurrency-conformance";
import { createNatsAgentEventSource } from "../event-source.js";
import { FakeJetStream } from "./fake-jetstream.js";

describe("state concurrency conformance (nats)", () => {
  it("passes the replay-cursor resume probe across a re-open against the fake jetstream seam", async () => {
    const jetstream = new FakeJetStream();
    const probes = await assertStateConcurrencyConforms({
      events: {
        reopenable: true,
        create: () =>
          createNatsAgentEventSource({ connection: jetstream, stream: "prism_agent_events", cursorSecret: "concurrency-cursor-secret" }),
      },
    });
    if (!probes.includes("cursor-resume")) throw new Error("nats run did not execute probe cursor-resume");
  });
});
