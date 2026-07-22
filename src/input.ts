import type {
  ContentBlock,
  ContextBlock,
  ContextProvider,
  ContextResolutionContext,
  InputAssemblyLayout,
  InputBuilder,
  InstructionInjector,
  InputBuildContext,
  JsonObject,
  JsonValue,
  Message,
  ModelConfig,
  PromptBuilder,
  PromptBuildRequest,
  ProviderRequest,
  ProviderRequestOptions,
  ResourceLoader,
  Skill,
  ToolDefinition,
  ToolResult,
} from "./contracts.js";
import type { MiddlewareRegistry } from "./middleware.js";
import type { SecretRedactor } from "./redaction.js";
import { redactMessage } from "./redaction.js";
import { assertMessagesSupportModelCapabilities } from "./content.js";
import { loadTextResource } from "./resources.js";
import { composeSystemPrompt } from "./system-prompts.js";
import { runInstructionInjectors } from "./instruction-injection.js";
import {
  applyContextBudget,
  CONTEXT_BUDGET_REPORT_METADATA_KEY,
  type ContextBudget,
  type ContextBudgetReport,
} from "./context-budget.js";

export type AgentInput = string | Message | readonly Message[];

export interface PromptInstruction {
  readonly text: string;
  readonly label?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface InputAttachment {
  readonly name?: string;
  readonly text?: string;
  readonly content?: readonly ContentBlock[];
  readonly uri?: string;
  readonly mediaType?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DefaultInputBuildContext extends InputBuildContext {
  readonly systemInstructions?: string | readonly string[];
  readonly developerInstructions?: string | readonly string[];
  readonly instructions?: string | PromptInstruction | readonly PromptInstruction[];
  readonly history?: readonly Message[];
  readonly summaries?: readonly (string | ContextBlock)[];
  readonly attachments?: readonly InputAttachment[];
  readonly resourceUris?: readonly string[];
  readonly resourceLoader?: ResourceLoader;
  readonly toolResults?: readonly ToolResult[];
  readonly middleware?: MiddlewareRegistry;
  // ponytail: exposed so a custom InputBuilder can opt to run injectors (runInstructionInjectors).
  readonly instructionInjectors?: readonly InstructionInjector[];
  readonly turn?: number;
}

export interface DefaultInputBuilder extends InputBuilder {
  build(input: AgentInput, context?: DefaultInputBuildContext): Promise<readonly Message[]>;
}

export interface ResolveContextOptions extends Omit<ContextResolutionContext, "messages"> {
  readonly messages: readonly Message[];
  readonly providers?: readonly ContextProvider[];
  readonly middleware?: MiddlewareRegistry;
  // ponytail: injector-produced blocks appended after provider blocks, before middleware.
  readonly injectedBlocks?: readonly ContextBlock[];
}

export interface DefaultPromptBuilder extends PromptBuilder {
  build(request: PromptBuildRequest): Promise<readonly Message[]>;
}

export interface PromptTemplateOptions {
  readonly missing?: "throw" | "preserve";
}

export interface AssembleProviderInputOptions extends DefaultInputBuildContext {
  readonly model: ModelConfig;
  readonly redactor?: SecretRedactor;
  readonly input: AgentInput;
  readonly inputBuilder?: InputBuilder;
  readonly contextProviders?: readonly ContextProvider[];
  readonly promptBuilder?: PromptBuilder;
  readonly skills?: readonly Skill[];
  readonly tools?: readonly ToolDefinition[];
  readonly providerOptions?: ProviderRequestOptions;
  /** Assembler-time eviction; does not delete session store history. */
  readonly contextBudget?: ContextBudget;
}

export function createDefaultInputBuilder(): DefaultInputBuilder {
  return {
    name: "default-input",
    async build(input, context = {}) {
      const groups = await buildDefaultInputMessageGroups(input, context);
      const messages = flattenInputGroups(groups, context.inputLayout ?? "legacy");
      return context.middleware ? context.middleware.run("input_assembly", messages) : messages;
    },
  };
}

export async function resolveContextProviders(options: ResolveContextOptions): Promise<readonly ContextBlock[]> {
  const blocks: ContextBlock[] = [];
  for (const provider of options.providers ?? []) {
    throwIfAborted(options.signal);
    blocks.push(...await provider.resolve({
      sessionId: options.sessionId,
      runId: options.runId,
      messages: options.messages,
      metadata: options.metadata,
      signal: options.signal,
    }));
  }
  // ponytail: injector blocks after host+skill provider blocks (split by origin if per-block ordering matters).
  if (options.injectedBlocks) blocks.push(...options.injectedBlocks);
  return options.middleware ? options.middleware.run("context", blocks) : blocks;
}

export function createDefaultPromptBuilder(): DefaultPromptBuilder {
  return {
    name: "default-prompt",
    async build(request) {
      return [
        ...contextMessages(request.context),
        ...skillMessages(request.skills),
        ...toolMessages(request.tools),
        ...request.messages,
      ];
    },
  };
}

export function renderPromptTemplate(template: string, variables: JsonObject, options: PromptTemplateOptions = {}): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      if (options.missing === "preserve") return match;
      throw new Error(`Missing prompt template variable: ${name}`);
    }
    return templateValue(variables[name]!);
  });
}

export async function assembleProviderInput(options: AssembleProviderInputOptions): Promise<ProviderRequest> {
  const baseContext = {
    sessionId: options.sessionId,
    runId: options.runId,
    metadata: options.metadata,
    signal: options.signal,
  };
  // ponytail: Phase 30 — run injectors once per turn inside the assembler so when/predicate/turn
  // filter against loop-local turn. Instructions layer via composeSystemPrompt (no parallel prompt
  // code); contextBlocks merge via resolveContextProviders (middleware still runs).
  const turn = options.turn ?? 1;
  const injectorContribs = options.instructionInjectors?.length
    ? runInstructionInjectors(options.instructionInjectors, {
        sessionId: options.sessionId ?? "",
        runId: options.runId ?? "",
        turn,
        // Runtime history is already redacted; input is redacted here before injector code sees it.
        input: inputMessages(options.input).map((message) => redactMessage(message, options.redactor)),
        history: options.history ?? [],
        metadata: options.metadata ?? {},
        signal: options.signal ?? new AbortController().signal,
      })
    : { instructions: [], contextBlocks: [] } as const;
  const systemInstructions = injectorContribs.instructions.length
    ? composeSystemPrompt(injectorContribs.instructions, { base: options.systemInstructions })
    : options.systemInstructions;
  const buildContext: DefaultInputBuildContext = { ...options, ...baseContext, systemInstructions };
  const layout = buildContext.inputLayout ?? "legacy";

  let messages: readonly Message[];
  let context: readonly ContextBlock[];
  let skills = options.skills;
  let tools = options.tools;
  let budgetReport: ContextBudgetReport | undefined;

  if (options.contextBudget) {
    // ponytail: budget path always uses default groups so eviction kinds stay deterministic;
    // custom inputBuilder still honored when contextBudget is absent.
    const groups = await buildDefaultInputMessageGroups(options.input, buildContext);
    context = await resolveContextProviders({
      providers: options.contextProviders,
      messages: flattenInputGroups(groups, layout),
      injectedBlocks: injectorContribs.contextBlocks.length ? injectorContribs.contextBlocks : undefined,
      middleware: options.middleware,
      ...baseContext,
    });
    const applied = applyContextBudget({
      groups,
      context,
      skills: skills ?? [],
      tools,
      budget: options.contextBudget,
      layout,
    });
    messages = flattenInputGroups(applied.groups, layout);
    if (buildContext.middleware) messages = await buildContext.middleware.run("input_assembly", messages);
    context = applied.context;
    skills = applied.skills;
    tools = applied.tools;
    if (options.contextBudget.reportOmissions) budgetReport = applied.report;
  } else {
    const inputBuilder = options.inputBuilder ?? createDefaultInputBuilder();
    messages = await inputBuilder.build(options.input, buildContext);
    context = await resolveContextProviders({
      providers: options.contextProviders,
      messages,
      injectedBlocks: injectorContribs.contextBlocks.length ? injectorContribs.contextBlocks : undefined,
      middleware: options.middleware,
      ...baseContext,
    });
  }

  const promptBuilder = options.promptBuilder ?? createDefaultPromptBuilder();
  const promptRequest = options.middleware
    ? await options.middleware.run("prompt_build", {
      messages,
      context,
      skills,
      tools,
      metadata: options.metadata,
      signal: options.signal,
    })
    : {
      messages,
      context,
      skills,
      tools,
      metadata: options.metadata,
      signal: options.signal,
    };
  const providerMessages = await promptBuilder.build({ ...promptRequest, tools });
  assertMessagesSupportModelCapabilities(options.model, providerMessages);

  const metadata = budgetReport
    ? { ...options.metadata, [CONTEXT_BUDGET_REPORT_METADATA_KEY]: budgetReport }
    : options.metadata;

  return {
    model: options.model,
    messages: providerMessages,
    tools,
    context,
    options: options.providerOptions,
    metadata,
    signal: options.signal,
  };
}

async function buildDefaultInputMessageGroups(
  input: AgentInput,
  context: DefaultInputBuildContext,
): Promise<DefaultInputMessageGroups> {
  return {
    instructions: [
      ...instructionMessages(context.systemInstructions, "System instruction"),
      ...instructionMessages(context.developerInstructions, "Developer instruction"),
      ...customInstructionMessages(context.instructions),
    ],
    summaries: summaryMessages(context.summaries),
    history: [...(context.history ?? [])],
    input: inputMessages(input),
    attachments: await attachmentMessages(context),
    toolResults: toolResultMessages(context.toolResults),
  };
}

interface DefaultInputMessageGroups {
  readonly instructions: readonly Message[];
  readonly summaries: readonly Message[];
  readonly history: readonly Message[];
  readonly input: readonly Message[];
  readonly attachments: readonly Message[];
  readonly toolResults: readonly Message[];
}

function flattenInputGroups(groups: DefaultInputMessageGroups, layout: InputAssemblyLayout): Message[] {
  switch (layout) {
    case "cache_aware":
      return [...groups.instructions, ...groups.attachments, ...groups.summaries, ...groups.history, ...groups.toolResults, ...groups.input];
    case "legacy":
      return [...groups.instructions, ...groups.summaries, ...groups.history, ...groups.input, ...groups.attachments, ...groups.toolResults];
  }
}

export function inputMessages(input: AgentInput): Message[] {
  if (typeof input === "string") return [textMessage("user", input)];
  if ("role" in input) return [input];
  return [...input];
}

function instructionMessages(value: string | readonly string[] | undefined, label: string): Message[] {
  const items = typeof value === "string" ? [value] : value ?? [];
  return items.map((text) => textMessage("system", `${label}:\n${text}`));
}

function customInstructionMessages(value: DefaultInputBuildContext["instructions"]): Message[] {
  if (!value) return [];
  if (typeof value === "string") return [textMessage("system", value)];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => textMessage("system", item.label ? `${item.label}:\n${item.text}` : item.text, item.metadata));
}

function summaryMessages(summaries: readonly (string | ContextBlock)[] | undefined): Message[] {
  return (summaries ?? []).map((summary) => {
    if (typeof summary === "string") return textMessage("system", `Summary:\n${summary}`);
    const content = typeof summary.content === "string" ? [{ type: "text", text: summary.content } as const] : summary.content;
    return { role: "system", content, metadata: summary.metadata };
  });
}

async function attachmentMessages(context: DefaultInputBuildContext): Promise<Message[]> {
  const messages: Message[] = [];
  for (const attachment of context.attachments ?? []) {
    if (attachment.content) {
      messages.push({ role: "user", content: attachment.content, metadata: attachmentMetadata(attachment) });
      continue;
    }
    if (attachment.text !== undefined) {
      messages.push(textMessage("user", attachment.name ? `Attachment ${attachment.name}:\n${attachment.text}` : attachment.text, attachmentMetadata(attachment)));
      continue;
    }
    if (attachment.uri) messages.push(await resourceMessage(attachment.uri, context, attachment));
  }
  for (const uri of context.resourceUris ?? []) messages.push(await resourceMessage(uri, context));
  return messages;
}

async function resourceMessage(uri: string, context: DefaultInputBuildContext, attachment?: InputAttachment): Promise<Message> {
  if (!context.resourceLoader) throw new Error(`Resource loader required for ${uri}`);
  const text = await loadTextResource(context.resourceLoader, uri, {
    signal: context.signal,
    metadata: context.metadata,
    permission: context.permission,
    trust: context.trust,
  });
  const label = attachment?.name ?? uri;
  return textMessage("user", `Resource ${label}:\n${text}`, attachmentMetadata({ ...attachment, uri }));
}

function toolResultMessages(results: readonly ToolResult[] | undefined): Message[] {
  return (results ?? []).map((result) => ({
    role: "tool" as const,
    content: [{
      type: "tool_result" as const,
      toolCallId: result.toolCallId,
      name: result.name,
      result: result.value,
      error: result.error,
    }, ...(result.content ?? [])],
    metadata: result.metadata,
  }));
}

function textMessage(role: Message["role"], text: string, metadata?: Readonly<Record<string, unknown>>): Message {
  return { role, content: [{ type: "text", text }], metadata };
}

function contextMessages(context: readonly ContextBlock[] | undefined): Message[] {
  return (context ?? []).map((block) => textMessage("system", `${block.title ? `${block.title}:\n` : "Context:\n"}${blockText(block)}`, block.metadata));
}

function skillMessages(skills: readonly Skill[] | undefined): Message[] {
  return (skills ?? [])
    .filter((skill) => skill.instructions)
    .map((skill) => textMessage("system", `Skill ${skill.name}:\n${skill.instructions}`, skill.metadata));
}

function toolMessages(tools: readonly ToolDefinition[] | undefined): Message[] {
  if (!tools?.length) return [];
  return [textMessage("system", `Available tools:\n${tools.map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`).join("\n")}`)];
}

function blockText(block: ContextBlock): string {
  if (typeof block.content === "string") return block.content;
  return block.content.map((part) => {
    if (part.type === "text" || part.type === "thinking") return part.text;
    if (part.type === "tool_result") return JSON.stringify(part.result ?? part.error ?? null);
    if (part.type === "tool_call") return `${part.name}(${JSON.stringify(part.arguments)})`;
    if (part.type === "tool_call_delta") return `${part.name ?? "tool"}(${part.argumentsText ?? ""})`;
    if (part.type === "image") return part.url ?? part.resourceUri ?? part.mimeType ?? "[image]";
    if (part.type === "audio") return part.transcript ?? part.name ?? part.url ?? part.resourceUri ?? part.mediaType ?? "[audio]";
    if (part.type === "file") return part.name ?? part.url ?? part.resourceUri ?? part.mediaType ?? "[file]";
    if (part.type === "document") return part.transcript ?? part.name ?? part.url ?? part.resourceUri ?? part.mediaType ?? "[document]";
    return "[content]";
  }).join("\n");
}

function templateValue(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  return JSON.stringify(sortJson(value));
}

function sortJson(value: JsonValue): JsonValue {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortJson);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key]!)]));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Context resolution aborted");
}

function attachmentMetadata(attachment?: InputAttachment): Readonly<Record<string, unknown>> | undefined {
  if (!attachment) return undefined;
  return {
    ...attachment.metadata,
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.uri ? { uri: attachment.uri } : {}),
    ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
  };
}
