import type {
  Agent,
  AgentConfig,
  AgentEvent,
  AgentSession,
  AgentSessionConfig,
  ContentBlock,
  ErrorInfo,
  Message,
  ProviderEvent,
  RunOptions,
  SessionEntry,
  SessionStore,
  ToolCallContent,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
  Usage,
} from "./contracts.js";
import { assembleProviderInput, type AgentInput } from "./input.js";
import { errorToErrorInfo } from "./redaction.js";
import { createMemorySessionStore, createSessionEntry, getSessionBranchEntries, rebuildSessionContext } from "./session-stores.js";
import { createToolRegistry, dispatchToolCall } from "./tools.js";

export function createAgent(config: AgentConfig): Agent {
  return {
    config,
    createSession(sessionConfig = {}) {
      return createAgentSession({ ...sessionConfig, agent: this });
    },
  };
}

export function createAgentSession(config: AgentSessionConfig & { readonly agent: Agent }): AgentSession {
  return new RuntimeAgentSession(config);
}

class RuntimeAgentSession implements AgentSession {
  readonly id: string;
  private readonly agent: Agent;
  private readonly metadata?: Readonly<Record<string, unknown>>;
  private readonly store: SessionStore;
  private readonly subscribers = new Set<EventSubscriber>();
  private currentLeafId?: string;
  private history: Message[] = [];
  private activeRun?: AbortController;

  constructor(config: AgentSessionConfig & { readonly agent: Agent }) {
    this.id = config.id ?? randomId("session");
    this.agent = config.agent;
    this.metadata = config.metadata;
    this.store = config.store ?? config.agent.config.store ?? createMemorySessionStore();
    this.currentLeafId = config.leafId;
  }

  subscribe(): AsyncIterable<AgentEvent> {
    const subscriber = new EventSubscriber(() => this.subscribers.delete(subscriber));
    this.subscribers.add(subscriber);
    return subscriber;
  }

  async run(input: AgentInput, options: RunOptions = {}): Promise<void> {
    const runId = randomId("run");
    if (this.activeRun) {
      const error = new Error("Agent session already has an active run");
      this.emit({ type: "error", sessionId: this.id, runId, error: errorToErrorInfo(error) });
      throw error;
    }

    let usage: Usage | undefined;
    const controller = new AbortController();
    const cleanupSignal = bridgeAbort(options.signal, controller);
    this.activeRun = controller;

    try {
      this.requireProvider();
      throwIfAborted(controller.signal);
      this.emit({ type: "agent_started", sessionId: this.id, runId });

      await this.rebuildHistory();
      if (options.model && JSON.stringify(options.model) !== JSON.stringify(this.agent.config.model)) {
        await this.appendEntry(createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "model_change", previousModel: this.agent.config.model, model: options.model }));
      }
      const inputMessages = inputToMessages(input);
      for (const message of inputMessages) await this.appendMessage(message, runId);

      const metadata = { ...this.agent.config.metadata, ...this.metadata, ...options.metadata };
      const { registry, tools } = activeTools(this.agent.config.tools);
      const maxToolRounds = options.maxToolRounds ?? 1;
      const toolResults: ToolResult[] = [];
      let toolRounds = 0;
      let nextInput: AgentInput = input;

      for (let turn = 1; ; turn += 1) {
        throwIfAborted(controller.signal);
        this.emit({ type: "turn_started", sessionId: this.id, runId, turn });
        const request = await assembleProviderInput({
          model: options.model ?? this.agent.config.model,
          input: nextInput,
          history: this.history,
          summaries: (await this.snapshot()).summaries,
          toolResults,
          systemInstructions: this.agent.config.instructions,
          inputBuilder: this.agent.config.inputBuilder,
          promptBuilder: this.agent.config.promptBuilder,
          contextProviders: this.agent.config.context,
          skills: this.agent.config.skills ? ("list" in this.agent.config.skills ? this.agent.config.skills.list() : this.agent.config.skills) : undefined,
          tools,
          resourceLoader: this.agent.config.resourceLoader,
          middleware: this.agent.config.middleware,
          sessionId: this.id,
          runId,
          metadata,
          signal: controller.signal,
        });

        throwIfAborted(controller.signal);
        const content: ContentBlock[] = [];
        const calls: ToolCallContent[] = [];
        let messageId: string | undefined;
        let started = false;
        for await (const event of this.agent.config.provider!.generate(request)) {
          throwIfAborted(controller.signal);
          if (event.type === "error") throw errorFromInfo(event.error);
          if (event.type === "usage") usage = event.usage;
          if (event.type === "done") {
            usage = event.usage ?? usage;
            break;
          }
          if (event.type === "message_start") {
            started = true;
            messageId = event.messageId;
            this.emit({ type: "message_started", sessionId: this.id, runId, message: { id: messageId, role: "assistant", content: [] } });
            continue;
          }
          if (event.type === "content_delta" || event.type === "tool_call") {
            if (!started) {
              started = true;
              this.emit({ type: "message_started", sessionId: this.id, runId, message: { role: "assistant", content: [] } });
            }
            const block = providerContent(event);
            content.push(block);
            if (block.type === "tool_call") calls.push(block);
            this.emit({ type: "message_delta", sessionId: this.id, runId, content: block });
          }
        }

        if (turn === 1) this.history.push(...inputMessages);
        if (started) {
          const message: Message = { id: messageId, role: "assistant", content };
          this.history.push(message);
          await this.appendMessage(message, runId);
          this.emit({ type: "message_finished", sessionId: this.id, runId, message });
        }
        this.emit({ type: "turn_finished", sessionId: this.id, runId, turn });

        if (calls.length === 0 || toolRounds >= maxToolRounds) break;
        toolRounds += 1;
        for (const call of calls) {
          const result = await dispatchToolCall({
            call,
            registry,
            context: { sessionId: this.id, runId, toolCallId: call.id, signal: controller.signal, metadata },
            middleware: this.agent.config.middleware,
            emit: (event) => this.emit(event),
          });
          toolResults.push(result);
          await this.appendMessage(toolResultMessage(result), runId);
          throwIfAborted(controller.signal);
        }
        nextInput = [];
      }

      this.emit({ type: "agent_finished", sessionId: this.id, runId, usage });
    } catch (error) {
      const info = errorToErrorInfo(error);
      this.emit({ type: "error", sessionId: this.id, runId, error: info });
      throw error;
    } finally {
      if (this.activeRun === controller) this.activeRun = undefined;
      cleanupSignal();
      this.closeSubscribers();
    }
  }

  prompt(input: string, options?: RunOptions): Promise<void> {
    return this.run(input, options);
  }

  abort(reason?: unknown): void {
    this.activeRun?.abort(reason);
  }

  async entries(): Promise<readonly SessionEntry[]> {
    return getSessionBranchEntries(await this.store.list(this.id), { leafId: this.currentLeafId });
  }

  async checkout(leafId?: string): Promise<void> {
    this.currentLeafId = leafId;
    await this.rebuildHistory();
  }

  fork(options: { readonly leafId?: string } = {}): AgentSession {
    return createAgentSession({ agent: this.agent, id: this.id, store: this.store, leafId: options.leafId ?? this.currentLeafId, metadata: this.metadata });
  }

  async clone(options: { readonly id?: string; readonly leafId?: string } = {}): Promise<AgentSession> {
    const id = options.id ?? randomId("session");
    const branch = getSessionBranchEntries(await this.store.list(this.id), { leafId: options.leafId ?? this.currentLeafId });
    const remap = new Map<string, string>();
    for (const entry of branch) {
      const nextId = randomId("entry");
      remap.set(entry.id, nextId);
      const { id: _oldId, parentId: _oldParentId, sessionId: _oldSessionId, ...rest } = entry;
      await this.store.append({ ...rest, id: nextId, parentId: entry.parentId ? remap.get(entry.parentId) : undefined, sessionId: id });
    }
    return createAgentSession({ agent: this.agent, id, store: this.store, leafId: branch.length ? remap.get(branch[branch.length - 1]!.id) : undefined, metadata: this.metadata });
  }

  private requireProvider(): void {
    if (!this.agent.config.provider) throw new Error(`Unknown provider: ${this.agent.config.model.provider}`);
  }

  private emit(event: AgentEvent): void {
    for (const subscriber of this.subscribers) subscriber.push(event);
  }

  private closeSubscribers(): void {
    for (const subscriber of this.subscribers) subscriber.close();
    this.subscribers.clear();
  }

  private async appendMessage(message: Message, runId: string): Promise<void> {
    await this.appendEntry(createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "message", message }));
  }

  private async appendEntry(entry: SessionEntry): Promise<void> {
    await this.store.append(entry);
    this.currentLeafId = entry.id;
  }

  private async rebuildHistory(): Promise<void> {
    this.history = (await this.snapshot()).messages.slice();
  }

  private async snapshot() {
    return rebuildSessionContext(await this.store.list(this.id), { leafId: this.currentLeafId });
  }
}

class EventSubscriber implements AsyncIterable<AgentEvent>, AsyncIterator<AgentEvent> {
  private readonly queue: AgentEvent[] = [];
  private readonly waiters: ((result: IteratorResult<AgentEvent>) => void)[] = [];
  private closed = false;

  constructor(private readonly onClose: () => void) {}

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
    if (waiter) waiter({ value: event, done: false });
    else if (!this.closed) this.queue.push(event);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }
}

function providerContent(event: Extract<ProviderEvent, { type: "content_delta" | "tool_call" }>): ContentBlock {
  return event.type === "content_delta" ? event.content : event.call;
}

function inputToMessages(input: AgentInput): Message[] {
  if (typeof input === "string") return [{ role: "user", content: [{ type: "text", text: input }] }];
  if ("role" in input) return [input];
  return [...input];
}

function toolResultMessage(result: ToolResult): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: result.toolCallId, name: result.name, result: result.value, error: result.error }, ...(result.content ?? [])],
    metadata: result.metadata,
  };
}

function activeTools(tools: AgentConfig["tools"]): { registry: ToolRegistry; tools: readonly ToolDefinition[] } {
  if (!tools) return { registry: createToolRegistry(), tools: [] };
  if ("list" in tools) return { registry: tools, tools: tools.list() };
  const registry = createToolRegistry(tools);
  return { registry, tools };
}

function errorFromInfo(error: ErrorInfo): Error {
  return Object.assign(new Error(error.message), { name: error.name ?? "Error", cause: error.cause });
}

function bridgeAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Agent run aborted");
}

function randomId(prefix: string): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}
