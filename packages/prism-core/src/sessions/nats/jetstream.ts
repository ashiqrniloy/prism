import type { NatsConnection } from "@nats-io/transport-node";

async function loadNatsJetStream() {
  try {
    const mod = (await import("@nats-io/jetstream")) as typeof import("@nats-io/jetstream");
    return mod;
  } catch (error) {
    throw new Error(
      "@arnilo/prism-core/sessions/nats: optional peer dependency '@nats-io/jetstream' is not installed. " +
        "Install it (npm i @nats-io/jetstream @nats-io/transport-node) to use NATS JetStream persistence.",
      { cause: error },
    );
  }
}

/**
 * Narrow, duck-typed JetStream surface used by the agent event source.
 *
 * The adapter depends only on this interface; tests inject an in-memory fake
 * (network-free), and `createNatsJetStream` adapts the official
 * `@nats-io/transport-node` + `@nats-io/jetstream` clients to it.
 */
export interface NatsJetStreamPublishAck {
  readonly stream: string;
  readonly seq: number;
  readonly duplicate: boolean;
}

export interface NatsJetStreamStoredMessage {
  readonly subject: string;
  readonly data: Uint8Array;
}

export interface NatsJetStreamMessage extends NatsJetStreamStoredMessage {
  readonly seq: number;
  readonly deliveryCount: number;
  ack(): void;
}

export interface NatsJetStreamConsumer {
  fetch(opts: { readonly max_messages: number; readonly expires: number }): Promise<AsyncIterable<NatsJetStreamMessage>>;
}

export interface NatsJetStreamConsumerConfig {
  /** Durable consumer name. */
  readonly name: string;
  readonly filter_subject: string;
  readonly ack_policy: "explicit" | "all";
  readonly deliver_policy: "all" | "by_start_sequence";
  readonly opt_start_seq?: number;
  /** Nanoseconds. */
  readonly ack_wait?: number;
  readonly max_deliver?: number;
}

export interface NatsJetStream {
  publish(subject: string, data: Uint8Array, opts: { readonly msgID: string }): Promise<NatsJetStreamPublishAck>;
  addConsumer(stream: string, cfg: NatsJetStreamConsumerConfig): Promise<void>;
  getConsumer(stream: string, name: string): Promise<NatsJetStreamConsumer>;
  deleteConsumer(stream: string, name: string): Promise<void>;
  getMessage(stream: string, seq: number): Promise<NatsJetStreamStoredMessage | null>;
  deleteMessage(stream: string, seq: number): Promise<void>;
}

/** Adapts an official NATS connection to the narrow JetStream surface. */
export async function createNatsJetStream(connection: NatsConnection): Promise<NatsJetStream> {
  const { JetStreamApiError, jetstream, jetstreamManager } = await loadNatsJetStream();
  const js = jetstream(connection);
  const jsm = await jetstreamManager(connection);
  return {
    async publish(subject, data, opts) {
      const ack = await js.publish(subject, data, { msgID: opts.msgID });
      return { stream: ack.stream, seq: ack.seq, duplicate: ack.duplicate };
    },
    async addConsumer(stream, cfg) {
      const config = {
        durable_name: cfg.name,
        filter_subject: cfg.filter_subject,
        ack_policy: cfg.ack_policy,
        deliver_policy: cfg.deliver_policy,
        ...(cfg.opt_start_seq === undefined ? {} : { opt_start_seq: cfg.opt_start_seq }),
        ...(cfg.ack_wait === undefined ? {} : { ack_wait: cfg.ack_wait }),
        ...(cfg.max_deliver === undefined ? {} : { max_deliver: cfg.max_deliver }),
      };
      try {
        await jsm.consumers.add(stream, config);
      } catch (error) {
        // Durable reuse (restart-stable identity): a crashed subscribe leaves its
        // consumer behind, and re-adding by the same stable name resumes at the
        // consumer's last-acked position. NATS server error 10058 = "consumer
        // already exists"; ephemeral page/cleanup names never collide.
        if (!(error instanceof JetStreamApiError) || error.code !== 10058) throw error;
      }
    },
    async getConsumer(stream, name) {
      const consumer = await js.consumers.get(stream, name);
      return {
        async fetch(opts) {
          const messages = await consumer.fetch({ max_messages: opts.max_messages, expires: opts.expires });
          return {
            async *[Symbol.asyncIterator]() {
              for await (const message of messages) {
                yield {
                  subject: message.subject,
                  seq: message.info.streamSequence,
                  deliveryCount: message.info.deliveryCount,
                  data: message.data,
                  ack: () => message.ack(),
                };
              }
            },
          };
        },
      };
    },
    async deleteConsumer(stream, name) {
      await jsm.consumers.delete(stream, name);
    },
    async getMessage(stream, seq) {
      const stored = await jsm.streams.getMessage(stream, { seq });
      if (!stored) return null;
      return { subject: stored.subject, data: stored.data };
    },
    async deleteMessage(stream, seq) {
      await jsm.streams.deleteMessage(stream, seq);
    },
  };
}
