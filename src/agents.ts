import type {
  Agent,
  AgentConfig,
  AgentEvent,
  AgentSession,
  AgentSessionConfig,
  AIProvider,
  CompactionMiddlewarePayload,
  CompactionOptions,
  CompactionResult,
  ContentBlock,
  ErrorInfo,
  LoopContext,
  Message,
  ProviderEvent,
  ProviderRequest,
  ProviderRequestPolicy,
  ProviderResolver,
  ProviderTurnResult,
  RetryMiddlewarePayload,
  RetryOptions,
  RunOptions,
  SessionEntry,
  SessionStore,
  Skill,
  ToolCallContent,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
  Usage,
} from "./contracts.js";
import { resolveLoop } from "./agent-loops.js";
import { createDefaultCompactionStrategy, isCompactionEntryData } from "./compaction.js";
import { assembleProviderInput, type AgentInput } from "./input.js";
import { createProviderRequestPolicyChain, mergeProviderRequestOptions, normalizeProviderRequestPolicyResult } from "./provider-request-policy.js";
import { errorToErrorInfo, redactAgentEvent, redactProviderRequest, redactSecrets, redactSessionEntry, type SecretRedactor } from "./redaction.js";
import { composeSystemPrompt, mergeSystemPromptConfig } from "./system-prompts.js";
import { createDefaultRetryPolicy, waitForRetry } from "./retry.js";
import { createMemorySessionStore, createSessionEntry, getSessionBranchEntries, rebuildSessionContext } from "./session-stores.js";
import { createToolRegistry, dispatchToolCall } from "./tools.js";
import { resolveActiveSkills } from "./skills.js";

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
  private activeRedactor?: SecretRedactor;
  private activeProvider?: AIProvider;

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

    const controller = new AbortController();
    const cleanupSignal = bridgeAbort(options.signal, controller);
    this.activeRun = controller;
    this.activeRedactor = options.redactor ?? this.agent.config.redactor;

    try {
      this.resolveRunProvider(options);
      throwIfAborted(controller.signal);
      this.emit({ type: "agent_started", sessionId: this.id, runId });

      await this.rebuildHistory();
      if (options.model && JSON.stringify(options.model) !== JSON.stringify(this.agent.config.model)) {
        await this.appendEntry(createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "model_change", previousModel: this.agent.config.model, model: options.model }));
      }
      const inputMessages = inputToMessages(input).map((message) => this.redact(message));
      for (const message of inputMessages) await this.appendMessage(message, runId);
      await this.autoCompact(runId, options, controller.signal, inputMessages);

      const metadata = { ...this.agent.config.metadata, ...this.metadata, ...options.metadata };
      const { registry, tools } = activeTools(this.agent.config.tools);
      const activeSkills = this.resolveRunSkills(options, tools);
      const maxToolRounds = options.maxToolRounds ?? 1;
      const systemInstructions = composeSystemPrompt(mergeSystemPromptConfig(this.agent.config.systemPrompt, options.systemPrompt), { base: this.agent.config.instructions });
      const contextProviders = [
        ...(this.agent.config.context ?? []),
        // ponytail: skill context after host context; no per-skill token budget yet.
        ...activeSkills.flatMap((skill) => skill.context ?? []),
      ];
      const providerOptions = mergeProviderRequestOptions(this.agent.config.providerOptions, options.providerOptions);
      const validate = options.validate ?? this.agent.config.validator;
      // ponytail: RunOptions.instructionInjectors overrides AgentConfig.instructionInjectors (mirrors validate/loop).
      const instructionInjectors = options.instructionInjectors ?? this.agent.config.instructionInjectors ?? [];
      const loop = resolveLoop(options, this.agent.config);

      // ponytail: LoopContext binds existing private helpers; loop orchestrates only.
      const ctx: LoopContext = {
        sessionId: this.id,
        runId,
        metadata,
        signal: controller.signal,
        history: this.history,
        input,
        inputMessages,
        maxToolRounds,
        assemble: async (nextInput, toolResults, turn) => assembleProviderInput({
          model: options.model ?? this.agent.config.model,
          input: nextInput,
          history: this.history,
          summaries: (await this.snapshot()).summaries,
          toolResults: toolResults ?? [],
          turn,
          instructionInjectors,
          systemInstructions,
          inputBuilder: this.agent.config.inputBuilder,
          promptBuilder: this.agent.config.promptBuilder,
          contextProviders,
          skills: activeSkills,
          tools,
          resourceLoader: this.agent.config.resourceLoader,
          providerOptions,
          middleware: this.agent.config.middleware,
          sessionId: this.id,
          runId,
          metadata,
          signal: controller.signal,
        }),
        generate: async (request) => {
          const policyResult = await this.applyProviderRequestPolicies(request, runId, options, metadata, controller.signal);
          const middlewareRequest = await this.agent.config.middleware?.run("provider_request", policyResult.request) ?? policyResult.request;
          return this.generateWithRetry(this.redactProviderRequest(middlewareRequest), runId, options, controller.signal, policyResult.secrets);
        },
        dispatchToolCall: (call) => dispatchToolCall({
          call,
          registry,
          context: { sessionId: this.id, runId, toolCallId: call.id, signal: controller.signal, metadata },
          middleware: this.agent.config.middleware,
          emit: (event) => this.emit(event),
          permission: this.agent.config.permission,
          redactor: this.activeRedactor,
          // ponytail: RunOptions wins; array-compose deferred (roadmap: compose-later).
          validate,
        }),
        appendMessage: (message) => this.appendMessage(message, runId),
        emit: (event) => this.emit(event),
      };

      const usage = await loop.run(ctx);
      this.emit({ type: "agent_finished", sessionId: this.id, runId, usage });
    } catch (error) {
      const info = errorToErrorInfo(error);
      this.emit({ type: "error", sessionId: this.id, runId, error: info });
      throw error;
    } finally {
      if (this.activeRun === controller) this.activeRun = undefined;
      this.activeRedactor = undefined;
      this.activeProvider = undefined;
      cleanupSignal();
      this.closeSubscribers();
    }
  }

  prompt(input: string, options?: RunOptions): Promise<void> {
    return this.run(input, options);
  }

  async compact(options: CompactionOptions = {}): Promise<CompactionResult> {
    if (this.activeRun) throw new Error("Agent session already has an active run");
    return this.compactBranch(options, undefined, options.signal, "manual");
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

  private resolveRunProvider(options: RunOptions): void {
    const model = options.model ?? this.agent.config.model;
    const provider =
      options.providerSource?.(model) ??
      this.agent.config.providerSource?.(model) ??
      this.agent.config.provider;
    if (!provider) throw new Error(`Unknown provider: ${model.provider}`);
    this.activeProvider = provider;
  }

  private resolveRunSkills(options: RunOptions, tools: readonly ToolDefinition[]): readonly Skill[] {
    const configured = this.agent.config.skills;
    if (configured && typeof configured === "object" && "list" in configured) {
      if (options.activeSkills) return resolveActiveSkills({ registry: configured, names: options.activeSkills, tools });
      return configured.list();
    }
    const arr = options.skills ?? (Array.isArray(configured) ? configured : []);
    return arr;
  }

  private emit(event: AgentEvent): void {
    const redacted = redactAgentEvent(event, this.activeRedactor);
    for (const subscriber of this.subscribers) subscriber.push(redacted);
  }

  private closeSubscribers(): void {
    for (const subscriber of this.subscribers) subscriber.close();
    this.subscribers.clear();
  }

  private async generateWithRetry(request: ProviderRequest, runId: string, options: RunOptions, signal: AbortSignal, requestSecrets: readonly (string | undefined)[] = []): Promise<ProviderTurnResult> {
    const retry = mergeRetry(this.agent.config.retry, options.retry);
    const secrets = [...requestSecrets, ...(retry?.secrets ?? [])];
    const policy = retry?.policy ?? (retry ? createDefaultRetryPolicy(retry) : undefined);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.generateProviderTurn(request, runId, signal, secrets);
      } catch (error) {
        const failure = error instanceof ProviderTurnFailure ? error : undefined;
        const info = failure ? redactSecrets(failure.info, secrets) : errorToErrorInfo(error, secrets);
        if (!policy || failure?.observable) throw errorFromInfo(info);
        const context = { sessionId: this.id, runId, attempt, error: info, metadata: retry?.metadata, signal };
        let decision = await policy.decide(context);
        const payload: RetryMiddlewarePayload = await this.agent.config.middleware?.run("retry", { context, decision }) ?? { context, decision };
        decision = payload.decision;
        if (!decision.retry) throw errorFromInfo(info);
        const delayMs = decision.delayMs ?? 0;
        this.emit({ type: "retry_scheduled", sessionId: this.id, runId, attempt, delayMs, error: info });
        await waitForRetry(decision, signal);
      }
    }
  }

  private async generateProviderTurn(request: ProviderRequest, runId: string, signal: AbortSignal, secrets: readonly (string | undefined)[] = []): Promise<ProviderTurnResult> {
    const content: ContentBlock[] = [];
    const calls: ToolCallContent[] = [];
    let messageId: string | undefined;
    let started = false;
    let usage: Usage | undefined;
    try {
      for await (const event of this.activeProvider!.generate(request)) {
        throwIfAborted(signal);
        if (event.type === "error") throw new ProviderTurnFailure(event.error, started);
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
      return { content, calls, messageId, started, usage };
    } catch (error) {
      if (error instanceof ProviderTurnFailure) throw error;
      throw new ProviderTurnFailure(errorToErrorInfo(error, secrets), started);
    }
  }

  private async applyProviderRequestPolicies(request: ProviderRequest, runId: string, options: RunOptions, metadata: Readonly<Record<string, unknown>>, signal: AbortSignal) {
    const policies = [...policyList(this.agent.config.providerRequestPolicies), ...policyList(options.providerRequestPolicies)];
    if (policies.length === 0) return { request, secrets: [] as readonly (string | undefined)[] };
    const result = await createProviderRequestPolicyChain(policies).apply({ request, sessionId: this.id, runId, metadata, signal });
    return normalizeProviderRequestPolicyResult(result);
  }

  private async appendMessage(message: Message, runId: string): Promise<void> {
    await this.appendEntry(createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "message", message }));
  }

  private async autoCompact(runId: string, options: RunOptions, signal: AbortSignal, inputMessages: readonly Message[]): Promise<void> {
    const compaction = mergeCompaction(this.agent.config.compaction, options.compaction);
    if (!compaction || compaction.thresholdEntries === undefined) return;
    const snapshot = await this.snapshot();
    if (snapshot.entries.length <= compaction.thresholdEntries || snapshot.entries.at(-1)?.kind === "compaction") return;
    await this.compactBranch(compaction, runId, signal, "auto");
    const compacted = await this.snapshot();
    this.history = withoutTrailingInput(compacted.messages, inputMessages);
  }

  private async compactBranch(options: CompactionOptions, runId: string | undefined, signal: AbortSignal | undefined, trigger: "manual" | "auto"): Promise<CompactionResult> {
    throwIfAbortedSignal(signal);
    const entries = await this.entries();
    const secrets = options.secrets ?? [];
    const strategy = options.strategy ?? createDefaultCompactionStrategy({ keepRecentEntries: options.keepRecentEntries, maxSummaryChars: options.maxSummaryChars, secrets });
    const context = { sessionId: this.id, entries, keepRecentEntries: options.keepRecentEntries, trigger, secrets, metadata: options.metadata, signal };
    this.emit({ type: "compaction_started", sessionId: this.id, runId });
    let result = await strategy.compact(context);
    result = { ...result, summary: redactSecrets(result.summary, secrets) };
    const payload: CompactionMiddlewarePayload = await this.agent.config.middleware?.run("compaction", { context, result }) ?? { context, result };
    result = { ...payload.result, summary: redactSecrets(payload.result.summary, secrets) };
    const source = result.entries?.find((entry) => entry.kind === "compaction");
    const data = isCompactionEntryData(source?.data) ? source.data : undefined;
    const entry = createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "compaction", summary: result.summary, data });
    await this.appendEntry(entry);
    const finalResult = { ...result, entries: [entry] };
    this.emit({ type: "compaction_finished", sessionId: this.id, runId, summary: finalResult.summary });
    await this.rebuildHistory();
    return finalResult;
  }

  private async appendEntry(entry: SessionEntry): Promise<void> {
    const redacted = redactSessionEntry(entry, this.activeRedactor);
    await this.store.append(redacted);
    this.currentLeafId = redacted.id;
  }

  private redact<T>(value: T): T {
    return this.activeRedactor?.redact(value) ?? value;
  }

  private redactProviderRequest(request: ProviderRequest): ProviderRequest {
    return redactProviderRequest(request, this.activeRedactor);
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

function activeTools(tools: AgentConfig["tools"]): { registry: ToolRegistry; tools: readonly ToolDefinition[] } {
  if (!tools) return { registry: createToolRegistry(), tools: [] };
  if ("list" in tools) return { registry: tools, tools: tools.list() };
  const registry = createToolRegistry(tools);
  return { registry, tools };
}

function policyList(policies: ProviderRequestPolicy | readonly ProviderRequestPolicy[] | undefined): readonly ProviderRequestPolicy[] {
  if (!policies) return [];
  return "apply" in policies ? [policies] : policies;
}

function errorFromInfo(error: ErrorInfo): Error {
  return Object.assign(new Error(error.message), { name: error.name ?? "Error", cause: error.cause });
}

class ProviderTurnFailure extends Error {
  constructor(readonly info: ErrorInfo, readonly observable: boolean) {
    super(info.message);
  }
}

function mergeRetry(agent: false | RetryOptions | undefined, run: false | RetryOptions | undefined): RetryOptions | undefined {
  if (run === false) return undefined;
  if (run) return { ...(agent || {}), ...run };
  return agent || undefined;
}

function mergeCompaction(agent: false | CompactionOptions | undefined, run: false | CompactionOptions | undefined): CompactionOptions | undefined {
  if (run === false) return undefined;
  if (run) return { ...(agent || {}), ...run };
  return agent || undefined;
}

function withoutTrailingInput(messages: readonly Message[], input: readonly Message[]): Message[] {
  const next = [...messages];
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const last = next.at(-1);
    if (last && JSON.stringify(last) === JSON.stringify(input[i])) next.pop();
  }
  return next;
}

function bridgeAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function throwIfAborted(signal: AbortSignal): void {
  throwIfAbortedSignal(signal);
}

function throwIfAbortedSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Agent run aborted");
}

function randomId(prefix: string): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}
