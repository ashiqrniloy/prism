import type {
  NatsJetStream,
  NatsJetStreamConsumer,
  NatsJetStreamConsumerConfig,
  NatsJetStreamPublishAck,
  NatsJetStreamStoredMessage,
} from "../jetstream.js";

interface StoredMessage {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly msgID: string;
}

interface ConsumerState {
  readonly cfg: NatsJetStreamConsumerConfig;
  readonly acked: Set<number>;
  readonly deliveries: Map<number, number>;
}

/** In-memory JetStream fake implementing the narrow seam (network-free tests). */
export class FakeJetStream implements NatsJetStream {
  readonly messages = new Map<number, StoredMessage>();
  readonly consumers = new Map<string, ConsumerState>();
  private nextSeq = 1;
  private readonly msgIds = new Map<string, number>();

  async publish(subject: string, data: Uint8Array, opts: { readonly msgID: string }): Promise<NatsJetStreamPublishAck> {
    const existing = this.msgIds.get(opts.msgID);
    if (existing !== undefined) return { stream: "test", seq: existing, duplicate: true };
    const seq = this.nextSeq++;
    this.messages.set(seq, { subject, data, msgID: opts.msgID });
    this.msgIds.set(opts.msgID, seq);
    return { stream: "test", seq, duplicate: false };
  }

  async addConsumer(_stream: string, cfg: NatsJetStreamConsumerConfig): Promise<void> {
    // Upsert by name: a restarting durable subscribe reuses the existing consumer's
    // ack position (cursor resume from the last ack, not the stream head). Ephemeral
    // page/cleanup consumers use random names, so they always start fresh.
    const existing = this.consumers.get(cfg.name);
    this.consumers.set(cfg.name, {
      cfg,
      acked: existing?.acked ?? new Set(),
      deliveries: existing?.deliveries ?? new Map(),
    });
  }

  async getConsumer(_stream: string, name: string): Promise<NatsJetStreamConsumer> {
    const state = this.consumers.get(name);
    if (!state) throw new Error(`consumer not found: ${name}`);
    return {
      fetch: async ({ max_messages, expires }) => {
        const filter = state.cfg.filter_subject;
        const start = state.cfg.opt_start_seq ?? 1;
        const candidates: Array<{ seq: number; subject: string; data: Uint8Array }> = [];
        for (const [seq, message] of this.messages) {
          if (seq < start) continue;
          if (!subjectMatches(filter, message.subject)) continue;
          if (state.acked.has(seq)) continue;
          candidates.push({ seq, subject: message.subject, data: message.data });
        }
        candidates.sort((left, right) => left.seq - right.seq);
        const batch = candidates.slice(0, max_messages);
        if (batch.length === 0) await sleep(expires);
        return {
          async *[Symbol.asyncIterator]() {
            for (const item of batch) {
              const deliveryCount = (state.deliveries.get(item.seq) ?? 0) + 1;
              state.deliveries.set(item.seq, deliveryCount);
              // ack_policy "all" auto-acks on delivery (position advances); "explicit" waits for ack().
              if (state.cfg.ack_policy === "all") state.acked.add(item.seq);
              yield {
                subject: item.subject,
                seq: item.seq,
                deliveryCount,
                data: item.data,
                ack: () => state.acked.add(item.seq),
              };
            }
          },
        };
      },
    };
  }

  async deleteConsumer(_stream: string, name: string): Promise<void> {
    this.consumers.delete(name);
  }

  async getMessage(_stream: string, seq: number): Promise<NatsJetStreamStoredMessage | null> {
    const message = this.messages.get(seq);
    return message ? { subject: message.subject, data: message.data } : null;
  }

  async deleteMessage(_stream: string, seq: number): Promise<void> {
    this.messages.delete(seq);
  }
}

function subjectMatches(filter: string, subject: string): boolean {
  const left = filter.split(".");
  const right = subject.split(".");
  if (left.length !== right.length) return false;
  return left.every((token, index) => token === "*" || token === right[index]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
