/** event-subscriber (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */
import type { AgentEvent, SubscribeOptions } from "../contracts.js";
/**
 * Raised through the iterator when a subscriber's queue overflows under the default `close`
 * policy: the `for await` fails loudly instead of seeing a synthetic event mid-run.
 */
export declare class SubscriberOverflowError extends Error {
    readonly sessionId: string;
    readonly droppedEvents: number;
    readonly maxQueuedEvents: number;
    readonly code = "ERR_PRISM_SUBSCRIBER_OVERFLOW";
    constructor(sessionId: string, droppedEvents: number, maxQueuedEvents: number);
}
export declare class EventSubscriber implements AsyncIterable<AgentEvent>, AsyncIterator<AgentEvent> {
    private readonly sessionId;
    private readonly onClose;
    /** Plan 104 T5: run-scoped unless the host opted into `acrossRuns`. */
    readonly acrossRuns: boolean;
    private readonly queue;
    private readonly waiters;
    private readonly maxQueuedEvents;
    private readonly overflow;
    private closed;
    private overflowError;
    constructor(sessionId: string, options: SubscribeOptions, onClose: () => void);
    [Symbol.asyncIterator](): AsyncIterator<AgentEvent>;
    next(): Promise<IteratorResult<AgentEvent>>;
    return(): Promise<IteratorResult<AgentEvent>>;
    push(event: AgentEvent): void;
    close(): void;
}
