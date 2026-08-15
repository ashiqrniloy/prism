/** event-subscriber (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */
import type { AgentEvent, SubscribeOptions } from "../contracts.js";

export class EventSubscriber implements AsyncIterable<AgentEvent>, AsyncIterator<AgentEvent> {
  private readonly queue: AgentEvent[] = [];
  private readonly waiters: ((result: IteratorResult<AgentEvent>) => void)[] = [];
  private readonly maxQueuedEvents: number;
  private readonly overflow: NonNullable<SubscribeOptions["overflow"]>;
  private closed = false;

  constructor(
    private readonly sessionId: string,
    options: SubscribeOptions,
    private readonly onClose: () => void,
  ) {
    const maxQueuedEvents = options.maxQueuedEvents ?? 1024;
    this.maxQueuedEvents = Number.isFinite(maxQueuedEvents) ? Math.max(1, Math.floor(maxQueuedEvents)) : 1024;
    this.overflow = options.overflow ?? "close";
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this;
  }

  next(): Promise<IteratorResult<AgentEvent>> {
    const event = this.queue.shift();
    if (event) return Promise.resolve({ value: event, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  return(): Promise<IteratorResult<AgentEvent>> {
    this.close();
    this.onClose();
    return Promise.resolve({ value: undefined, done: true });
  }

  push(event: AgentEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return;
    }
    if (this.closed) return;
    if (this.queue.length < this.maxQueuedEvents) {
      this.queue.push(event);
      return;
    }
    if (this.overflow === "drop_oldest") {
      this.queue.shift();
      this.queue.push(event);
      return;
    }
    if (this.overflow === "drop_newest") return;
    const droppedEvents = this.queue.length + 1;
    this.queue.splice(0, this.queue.length, {
      type: "event_subscriber_overflow",
      sessionId: this.sessionId,
      droppedEvents,
      maxQueuedEvents: this.maxQueuedEvents,
      overflow: this.overflow,
    });
    this.close();
    this.onClose();
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }
}
