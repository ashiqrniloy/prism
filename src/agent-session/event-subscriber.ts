/** event-subscriber (0.2.5 plan 025 Task 1 split; plan 228 Task 3 coalescing queue). */
import type { AgentEvent, SubscribeOptions } from "../contracts.js";
import { mergeDeltaEvents } from "./coalesce.js";

/** Plan 228 Task 3: the default queue bound. A whole four-turn coding run is ~120 events. */
export const DEFAULT_MAX_QUEUED_EVENTS = 4096;

/**
 * Raised through the iterator when a subscriber's queue overflows under the `coalesce` (default) or
 * `close` policy: the `for await` fails loudly instead of seeing a synthetic event mid-run.
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

/**
 * Queue of pending events. `head` indexes the next event so dequeue is O(1); the array is compacted once
 * the consumed prefix dominates. A `tool.progress` replaced by a newer one for the same call leaves a
 * hole (`undefined`), so the newer one keeps its own position and order across event types holds.
 */
export class EventSubscriber implements AsyncIterable<AgentEvent>, AsyncIterator<AgentEvent> {
  /** Plan 104 T5: run-scoped unless the host opted into `acrossRuns`. */
  readonly acrossRuns: boolean;
  private slots: (AgentEvent | undefined)[] = [];
  private head = 0;
  /** Live (non-hole) queued events. */
  private size = 0;
  /** `toolCallId` → absolute slot index of its queued `tool.progress` (coalesce only). */
  private readonly progressSlots = new Map<string, number>();
  /** Absolute index of `slots[0]`, so `progressSlots` survives compaction. */
  private base = 0;
  private readonly waiters: Waiter[] = [];
  private waiterHead = 0;
  private readonly maxQueuedEvents: number;
  private readonly overflow: NonNullable<SubscribeOptions["overflow"]>;
  private closed = false;
  private overflowError: SubscriberOverflowError | undefined;

  constructor(
    private readonly sessionId: string,
    options: SubscribeOptions,
    private readonly onClose: () => void,
  ) {
    const maxQueuedEvents = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS;
    this.maxQueuedEvents = Number.isFinite(maxQueuedEvents) ? Math.max(1, Math.floor(maxQueuedEvents)) : DEFAULT_MAX_QUEUED_EVENTS;
    this.overflow = options.overflow ?? "coalesce";
    this.acrossRuns = options.acrossRuns === true;
  }

  /** True once this subscriber failed with {@link SubscriberOverflowError}. */
  get overflowed(): boolean {
    return this.overflowError !== undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this;
  }

  next(): Promise<IteratorResult<AgentEvent>> {
    if (this.overflowError) return Promise.reject(this.overflowError);
    const event = this.dequeue();
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
    const waiter = this.takeWaiter();
    if (waiter) {
      waiter.resolve({ value: event, done: false });
      return;
    }
    if (this.closed) return;
    if (this.overflow === "coalesce" && this.coalesce(event)) return;
    if (this.size < this.maxQueuedEvents) {
      this.enqueue(event);
      return;
    }
    if (this.overflow === "drop_oldest") {
      this.dequeue();
      this.enqueue(event);
      return;
    }
    if (this.overflow === "drop_newest") return;
    // `coalesce` and `close`: the iterator fails loudly. A synthetic event would be
    // indistinguishable from a real one, and a host reading it mid-run would mis-account.
    this.overflowError = new SubscriberOverflowError(this.sessionId, this.size + 1, this.maxQueuedEvents);
    this.slots = [];
    this.head = 0;
    this.size = 0;
    this.progressSlots.clear();
    for (const pending of this.drainWaiters()) pending.reject(this.overflowError);
    this.close();
    this.onClose();
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.drainWaiters()) waiter.resolve({ value: undefined, done: true });
  }

  /** Merge `event` into the queue without growing it; true when it was absorbed. */
  private coalesce(event: AgentEvent): boolean {
    if (event.type === "message.delta") {
      if (this.size === 0) return false;
      const lastIndex = this.slots.length - 1;
      const last = this.slots[lastIndex];
      const merged = last && mergeDeltaEvents(last, event);
      if (!merged) return false;
      this.slots[lastIndex] = merged;
      return true;
    }
    if (event.type === "tool.progress") {
      const absolute = this.progressSlots.get(event.toolCallId);
      if (absolute === undefined) return false;
      const index = absolute - this.base;
      // Leave a hole at the old position and append the newer progress, so order across types holds.
      this.slots[index] = undefined;
      this.size -= 1;
      this.progressSlots.delete(event.toolCallId);
      return false;
    }
    return false;
  }

  private enqueue(event: AgentEvent): void {
    if (this.overflow === "coalesce" && event.type === "tool.progress") {
      this.progressSlots.set(event.toolCallId, this.base + this.slots.length);
    }
    this.slots.push(event);
    this.size += 1;
  }

  private dequeue(): AgentEvent | undefined {
    while (this.head < this.slots.length) {
      const index = this.head;
      const event = this.slots[index];
      this.slots[index] = undefined;
      this.head += 1;
      if (!event) continue;
      this.size -= 1;
      if (event.type === "tool.progress" && this.progressSlots.get(event.toolCallId) === this.base + index) {
        this.progressSlots.delete(event.toolCallId);
      }
      this.compact();
      return event;
    }
    this.compact();
    return undefined;
  }

  private compact(): void {
    if (this.head === this.slots.length) {
      this.base += this.slots.length;
      this.slots = [];
      this.head = 0;
    } else if (this.head >= 1024 && this.head * 2 >= this.slots.length) {
      this.slots = this.slots.slice(this.head);
      this.base += this.head;
      this.head = 0;
    }
  }

  private takeWaiter(): Waiter | undefined {
    if (this.waiterHead >= this.waiters.length) return undefined;
    const waiter = this.waiters[this.waiterHead];
    this.waiterHead += 1;
    if (this.waiterHead === this.waiters.length) {
      this.waiters.length = 0;
      this.waiterHead = 0;
    }
    return waiter;
  }

  private drainWaiters(): Waiter[] {
    const pending = this.waiters.slice(this.waiterHead);
    this.waiters.length = 0;
    this.waiterHead = 0;
    return pending;
  }
}
