/** event-subscriber (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */
import type { AgentEvent, SubscribeOptions } from "../contracts.js";

/**
 * Raised through the iterator when a subscriber's queue overflows under the default `close`
 * policy: the `for await` fails loudly instead of seeing a synthetic event mid-run.
 */
export class SubscriberOverflowError extends Error {
  readonly code = "ERR_PRISM_SUBSCRIBER_OVERFLOW";

  constructor(
    readonly sessionId: string,
    readonly droppedEvents: number,
    readonly maxQueuedEvents: number,
  ) {
    super(`Event subscriber for session ${sessionId} overflowed (${droppedEvents} dropped, max ${maxQueuedEvents} queued)`);
    this.name = "SubscriberOverflowError";
  }
}

interface Waiter {
  readonly resolve: (result: IteratorResult<AgentEvent>) => void;
  readonly reject: (error: unknown) => void;
}

export class EventSubscriber implements AsyncIterable<AgentEvent>, AsyncIterator<AgentEvent> {
  /** Plan 104 T5: run-scoped unless the host opted into `acrossRuns`. */
  readonly acrossRuns: boolean;
  private readonly queue: AgentEvent[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly maxQueuedEvents: number;
  private readonly overflow: NonNullable<SubscribeOptions["overflow"]>;
  private closed = false;
  private overflowError: SubscriberOverflowError | undefined;

  constructor(
    private readonly sessionId: string,
    options: SubscribeOptions,
    private readonly onClose: () => void,
  ) {
    const maxQueuedEvents = options.maxQueuedEvents ?? 1024;
    this.maxQueuedEvents = Number.isFinite(maxQueuedEvents) ? Math.max(1, Math.floor(maxQueuedEvents)) : 1024;
    this.overflow = options.overflow ?? "close";
    this.acrossRuns = options.acrossRuns === true;
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this;
  }

  next(): Promise<IteratorResult<AgentEvent>> {
    if (this.overflowError) return Promise.reject(this.overflowError);
    const event = this.queue.shift();
    if (event) return Promise.resolve({ value: event, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  return(): Promise<IteratorResult<AgentEvent>> {
    this.close();
    this.onClose();
    return Promise.resolve({ value: undefined, done: true });
  }

  push(event: AgentEvent): void {
    if (this.overflowError) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: event, done: false });
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
    // Default `close` policy: the iterator fails loudly. A synthetic event would be
    // indistinguishable from a real one, and a host reading it mid-run would mis-account.
    this.overflowError = new SubscriberOverflowError(this.sessionId, this.queue.length + 1, this.maxQueuedEvents);
    this.queue.length = 0;
    for (const pending of this.waiters.splice(0)) pending.reject(this.overflowError);
    this.close();
    this.onClose();
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }
}
