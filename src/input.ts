import { deferSkillCatalog } from "./skills-catalog.js";
import { assertMessagesSupportModelCapabilities } from "./content.js";
import type {
  ContentBlock,
  ContextBlock,
  InputAssemblyLayout,
  InputBuildContext,
  JsonObject,
  JsonValue,
  Message,
  ModelConfig,
  ProviderRequest,
  ProviderRequestOptions,
  ResourceLoader,
  Skill,
  ToolDefinition,
  ToolResult,
} from "./contracts.js";
import { applyDefaultProviderRequestOptions } from "./provider-kit/provider-request-policy.js";
import type { SecretRedactor } from "./redaction.js";
import { loadTextResource } from "./resources.js";
import {
  capSkillCatalog,
  selectSkillsForPrompt,
  skillHasRenderableBody,
  skillMessages as buildSkillMessages,
  type LoadedSkillSet,
  type SkillsDisclosure,
} from "./skill-disclosure.js";
export type AgentInput = string | Message | readonly Message[];

/**
 * Wire payload for a tool result that carries no `value`, no `type:text` content, and no error.
 * Every provider route serializes a tool result from this block, so the empty case must be a
 * constant non-empty string instead of an absent payload (strict providers reject empty results).
 */
export const EMPTY_TOOL_RESULT_TEXT = "(tool completed with no output)";

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
  readonly turn?: number;
}

export interface DefaultInputBuilder {
  readonly name: string;
  build(input: AgentInput, context?: DefaultInputBuildContext): Promise<readonly Message[]>;
}

export interface PromptTemplateOptions {
  readonly missing?: "throw" | "preserve";
}

export interface AssembleProviderInputOptions extends DefaultInputBuildContext {
  readonly model: ModelConfig;
  readonly redactor?: SecretRedactor;
  readonly input: AgentInput;
  readonly skills?: readonly Skill[];
  readonly skillsDisclosure?: SkillsDisclosure;
  readonly loadedSkills?: LoadedSkillSet;
  /** @internal Session runs render the catalog through `kernel:context.build`. */
  readonly deferSkillsCatalog?: boolean;
  /** Run-owned append-only segments. Omit outside a session to retain existing assembly exactly. */
  readonly tailSegments?: Map<string, Message>;
  readonly tools?: readonly ToolDefinition[];
  readonly providerOptions?: ProviderRequestOptions;
}

async function buildDefaultInputMessageGroups(input: AgentInput, context: DefaultInputBuildContext): Promise<DefaultInputMessageGroups> {
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
      return [
        ...groups.instructions,
        ...groups.attachments,
        ...groups.summaries,
        ...groups.history,
        ...groups.toolResults,
        ...groups.input,
      ];
    case "legacy":
      return [
        ...groups.instructions,
        ...groups.summaries,
        ...groups.history,
        ...groups.input,
        ...groups.attachments,
        ...groups.toolResults,
      ];
  }
}

export function createDefaultInputBuilder(): DefaultInputBuilder {
  return {
    name: "default-input",
    async build(input, context = {}) {
      const groups = await buildDefaultInputMessageGroups(input, context);
      // The default builder is not a security seam: `assembleProviderInput` owns what
      // happens after it returns, so a host cannot slip unassembled messages past it.
      return flattenInputGroups(groups, context.inputLayout ?? "cache_aware");
    },
  };
}

/**
 * The kernel's own `context.build`-point contribution (roadmap §2.4 "Replaces: skills catalog"):
 * skills, tool declarations, and context blocks are folded into the provider view here, once per
 * turn, ahead of the dynamic transcript. Module-private since `PromptBuilder` is retired (plan 145
 * Task 4) — a host that wants a different composition registers a `context.build` handler, which
 * runs after this and so composes on top of it rather than replacing the skills catalog.
 */
function buildProviderMessages(request: PromptComposition): readonly Message[] {
  // Tool-capable models receive schemas via request.tools; the text list only serves
  // text-only (or unknown-capability) models — duplicating it doubles tool tokens per turn.
  const tools = request.model?.capabilities?.tools === true ? undefined : request.tools;
  const context = contextMessages(request.context);
  const skills = request.deferSkillsCatalog
    ? []
    : buildSkillMessages(
        request.skills,
        request.tailSkillBodies
          ? { disclosure: "progressive" }
          : { disclosure: request.skillsDisclosure, loaded: request.loadedSkills },
      );
  const declarations = toolMessages(tools);
  if ((request.inputLayout ?? "cache_aware") === "legacy") {
    return [...context, ...skills, ...declarations, ...request.messages];
  }

  // Default input assembly keeps stable instruction messages at the front. Keep that
  // boundary ahead of dynamic context/skills; legacy retains the old whole-prompt order.
  const firstNonSystem = request.messages.findIndex((message) => message.role !== "system");
  const stable = firstNonSystem < 0 ? request.messages : request.messages.slice(0, firstNonSystem);
  const dynamic = firstNonSystem < 0 ? [] : request.messages.slice(firstNonSystem);
  return [...stable, ...context, ...skills, ...declarations, ...dynamic];
}

interface PromptComposition {
  readonly deferSkillsCatalog?: boolean;
  readonly messages: readonly Message[];
  readonly inputLayout?: InputAssemblyLayout;
  readonly context?: readonly ContextBlock[];
  readonly skills?: readonly Skill[];
  readonly skillsDisclosure?: SkillsDisclosure;
  readonly loadedSkills?: LoadedSkillSet;
  readonly tailSkillBodies?: boolean;
  readonly tools?: readonly ToolDefinition[];
  readonly model?: ModelConfig;
}

export function renderPromptTemplate(template: string, variables: JsonObject, options: PromptTemplateOptions = {}): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => {
    if (!Object.hasOwn(variables, name)) {
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
  const buildContext: DefaultInputBuildContext = { ...options, ...baseContext };
  const layout = buildContext.inputLayout ?? "cache_aware";
  const skills = options.skills;
  const tools = options.tools;
  let messages: readonly Message[] = await createDefaultInputBuilder().build(options.input, buildContext);

  const tailSegments = options.tailSegments;
  const tailSkillBodies = tailSegments !== undefined;
  if (tailSegments) {
    const activeTailSegments = new Set<string>();
    messages = moveResourceMessagesToTail(messages, options, tailSegments, activeTailSegments);
    appendSkillTailSegments(tailSegments, activeTailSegments, skills, options.skillsDisclosure, options.loadedSkills);
    messages = [...messages, ...tailMessages(tailSegments, activeTailSegments)];
  }

  const providerMessages = buildProviderMessages({
    messages,
    inputLayout: layout,
    deferSkillsCatalog: options.deferSkillsCatalog,
    skills,
    skillsDisclosure: options.skillsDisclosure,
    loadedSkills: options.loadedSkills,
    tailSkillBodies,
    tools,
    model: options.model,
  });
  assertMessagesSupportModelCapabilities(options.model, providerMessages);

  const request = applyDefaultProviderRequestOptions(
    {
      model: options.model,
      messages: providerMessages,
      tools,
      options: options.providerOptions,
      metadata: options.metadata,
      signal: options.signal,
    },
    { sessionId: options.sessionId },
  );
  if (options.deferSkillsCatalog) {
    deferSkillCatalog(request, skills ?? [], {
      disclosure: tailSkillBodies ? "progressive" : options.skillsDisclosure,
      loaded: tailSkillBodies ? undefined : options.loadedSkills,
    });
  }
  return request;
}

export function inputMessages(input: AgentInput): Message[] {
  if (typeof input === "string") return [textMessage("user", input)];
  if ("role" in input) return [input];
  return [...input];
}

function instructionMessages(value: string | readonly string[] | undefined, label: string): Message[] {
  const items = typeof value === "string" ? [value] : (value ?? []);
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
      messages.push(
        textMessage(
          "user",
          attachment.name ? `Attachment ${attachment.name}:\n${attachment.text}` : attachment.text,
          attachmentMetadata(attachment),
        ),
      );
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

export function toToolResultMessage(result: ToolResult): Message {
  return {
    role: "tool",
    content: [
      {
        type: "tool_result",
        toolCallId: result.toolCallId,
        name: result.name,
        result: toolResultPayload(result),
        error: result.error,
      },
      ...(result.content ?? []).filter((block) => block.type !== "text"),
    ],
    metadata: result.metadata,
  };
}

function toolResultPayload(result: ToolResult): unknown {
  if (result.value !== undefined) return result.value;
  const text = (result.content ?? [])
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n");
  if (text.length > 0) return text;
  // An error already carries the outcome; without one, send the constant sentinel so no route
  // (JSON string content, a content string, a function response, or a typed output part) emits
  // an empty or absent payload.
  return result.error === undefined || result.error === null ? EMPTY_TOOL_RESULT_TEXT : undefined;
}

function toolResultMessages(results: readonly ToolResult[] | undefined): Message[] {
  return (results ?? []).map(toToolResultMessage);
}

function textMessage(role: Message["role"], text: string, metadata?: Readonly<Record<string, unknown>>): Message {
  return { role, content: [{ type: "text", text }], metadata };
}

export function contextMessages(context: readonly ContextBlock[] | undefined): Message[] {
  return (context ?? []).map((block) =>
    textMessage("system", `${block.title ? `${block.title}:\n` : "Context:\n"}${blockText(block)}`, block.metadata),
  );
}

function moveResourceMessagesToTail(
  messages: readonly Message[],
  options: AssembleProviderInputOptions,
  tailSegments: Map<string, Message>,
  activeTailSegments: Set<string>,
): readonly Message[] {
  const resourceUris = new Set([
    ...(options.resourceUris ?? []),
    ...(options.attachments ?? []).flatMap((attachment) =>
      attachment.uri !== undefined && attachment.text === undefined && attachment.content === undefined ? [attachment.uri] : [],
    ),
  ]);
  if (resourceUris.size === 0) return messages;
  return messages.filter((message) => {
    const uri = message.metadata?.uri;
    if (message.role !== "user" || typeof uri !== "string" || !resourceUris.has(uri)) return true;
    appendTailSegment(tailSegments, activeTailSegments, `resource:${uri}`, message);
    return false;
  });
}

function appendSkillTailSegments(
  tailSegments: Map<string, Message>,
  activeTailSegments: Set<string>,
  skills: readonly Skill[] | undefined,
  disclosure: SkillsDisclosure | undefined,
  loaded: LoadedSkillSet | undefined,
): void {
  const renderContext = { disclosure, loaded };
  const selected = capSkillCatalog(selectSkillsForPrompt(skills ?? [], renderContext));
  const byName = new Map(selected.map((skill) => [skill.name, skill]));
  const ordered =
    disclosure === "eager"
      ? selected
      : (loaded?.list() ?? []).flatMap((name) => {
          const skill = byName.get(name);
          return skill === undefined ? [] : [skill];
        });

  for (const skill of ordered) {
    if (!skillHasRenderableBody(skill, renderContext)) continue;
    const message = buildSkillMessages([skill], renderContext)[0];
    if (message) appendTailSegment(tailSegments, activeTailSegments, `skill:${skill.name}`, message);
  }
}

/** Map#set retains first-insertion order, so re-derivation replaces only this segment's bytes. */
function appendTailSegment(tailSegments: Map<string, Message>, activeTailSegments: Set<string>, id: string, message: Message): void {
  tailSegments.set(id, message);
  activeTailSegments.add(id);
}

function tailMessages(tailSegments: Map<string, Message>, activeTailSegments: ReadonlySet<string>): Message[] {
  return [...tailSegments].flatMap(([id, message]) => (activeTailSegments.has(id) ? [message] : []));
}

function toolMessages(tools: readonly ToolDefinition[] | undefined): Message[] {
  if (!tools?.length) return [];
  return [
    textMessage(
      "system",
      `Available tools:\n${tools.map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`).join("\n")}`,
    ),
  ];
}

function blockText(block: ContextBlock): string {
  if (typeof block.content === "string") return block.content;
  return block.content
    .map((part) => {
      if (part.type === "text" || part.type === "thinking") return part.text;
      if (part.type === "tool_result") return JSON.stringify(part.result ?? part.error ?? null);
      if (part.type === "tool_call") return `${part.name}(${JSON.stringify(part.arguments)})`;
      if (part.type === "tool_call_delta") return `${part.name ?? "tool"}(${part.argumentsText ?? ""})`;
      if (part.type === "image") return part.url ?? part.resourceUri ?? part.mimeType ?? "[image]";
      if (part.type === "audio") return part.transcript ?? part.name ?? part.url ?? part.resourceUri ?? part.mediaType ?? "[audio]";
      if (part.type === "file") return part.name ?? part.url ?? part.resourceUri ?? part.mediaType ?? "[file]";
      if (part.type === "document") return part.transcript ?? part.name ?? part.url ?? part.resourceUri ?? part.mediaType ?? "[document]";
      return "[content]";
    })
    .join("\n");
}

function templateValue(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  return JSON.stringify(sortJson(value));
}

function sortJson(value: JsonValue): JsonValue {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortJson);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key]!)]),
  );
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
