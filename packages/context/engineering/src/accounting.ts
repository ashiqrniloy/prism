/**
 * Per-request context accounting and the injected-block share cap (plan 194 Task 5).
 *
 * One pass over the final provider request: classify every message by source, add the assembler's
 * tool-declaration text, and emit counts only — never text.
 * The optional `blocks.maxShare` cap drops whole injected blocks (prefix block messages and the
 * `metadata.contextBlocks` tail) by lowest priority, then latest-added. The system prompt and plain
 * instruction layers are never entries here, so they can never be counted against the share or
 * dropped by it.
 */
import type { JsonObject, Message, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { estimateMessageTokens, estimateTextTokens } from "@arnilo/prism";

export interface ContextAccountEvent {
  readonly turn: number;
  /** The model input cap the share is measured against; `0` when the model declares no window. */
  readonly inputCapTokens: number;
  readonly totalTokens: number;
  readonly bySource: {
    readonly system: number;
    readonly instructions: number;
    readonly skills: number;
    readonly history: number;
    readonly toolResults: number;
    readonly folded: number;
    readonly input: number;
    readonly blocks: Readonly<Record<string, number>>;
    readonly tail: Readonly<Record<string, number>>;
  };
  readonly dropped: readonly { readonly source: string; readonly tokens: number }[];
}

export interface AccountRequestOptions {
  /** Fraction of the input cap injected blocks may occupy. Absent: no cap, measure only. */
  readonly maxShare?: number;
  readonly inputCapTokens: number;
}

export interface AccountedRequest {
  readonly request: ProviderRequest;
  readonly event: ContextAccountEvent;
}

const TAIL_KEY = "contextBlocks";
/** Instruction layers that are never injected blocks, even though they carry `metadata.source`. */
const INSTRUCTION_SOURCES = new Set(["context-files-nested"]);

interface BlockEntry {
  readonly kind: "prefix" | "tail";
  readonly source: string;
  readonly priority: number;
  readonly tokens: number;
  /** Prefix: message index. Tail: message index of the tail message. */
  readonly messageIndex: number;
  /** Tail only. */
  readonly itemIndex?: number;
  /** Attachment order, latest-added drops first among equal priorities. */
  readonly order: number;
}

const SKILL_CATALOG_PREFIX = "Skills are task-specific instructions.";
const LOADED_SKILL_PREFIX = "Skill ";
const PREVIOUS_SKILLS_PREFIX = "Previously loaded skills";

/** Account one final provider request; optionally cap the injected context-block share. */
export function accountRequest(request: ProviderRequest, options: AccountRequestOptions): AccountedRequest {
  const cap = options.maxShare === undefined || options.inputCapTokens <= 0 ? undefined : Math.floor(options.maxShare * options.inputCapTokens);
  const dropped = cap === undefined ? [] : selectDrops(blockEntries(request), cap);
  const capped = dropped.length === 0 ? request : dropBlocks(request, dropped);
  const measured = measure(capped);
  return {
    request: capped,
    event: {
      turn: currentTurnOf(capped.messages),
      inputCapTokens: options.inputCapTokens,
      totalTokens: measured.totalTokens,
      bySource: measured.bySource,
      dropped: dropped.map((entry) => ({ source: entry.source, tokens: entry.tokens })),
    },
  };
}

/** One pass over the final request: messages plus the assembler's tool-declaration text shape. */
function measure(request: ProviderRequest): { readonly totalTokens: number; readonly bySource: ContextAccountEvent["bySource"] } {
  return accountBySource(request);
}

function toolTokens(tools: readonly ToolDefinition[] | undefined): number {
  if (!tools?.length) return 0;
  return estimateTextTokens(`Available tools:\n${tools.map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`).join("\n")}`);
}

function blockEntries(request: ProviderRequest): BlockEntry[] {
  const entries: BlockEntry[] = [];
  for (const [index, message] of request.messages.entries()) {
    const items = tailItems(message);
    if (items) {
      // Only a plain "block, separator, block" message can have one block removed. Anything else
      // is treated as instructions and is neither counted nor capped.
      if (message.content.length === items.length * 2 - 1) {
        for (const [itemIndex, item] of items.entries()) {
          entries.push({
            kind: "tail",
            source: item.source,
            priority: item.priority,
            tokens: item.tokens,
            messageIndex: index,
            itemIndex,
            order: entries.length,
          });
        }
      }
      continue;
    }
    const source = blockSource(message);
    if (source === undefined) continue;
    entries.push({
      kind: "prefix",
      source,
      priority: blockPriority(message),
      tokens: estimateMessageTokens(message),
      messageIndex: index,
      order: entries.length,
    });
  }
  return entries;
}

function selectDrops(entries: readonly BlockEntry[], cap: number): BlockEntry[] {
  let total = entries.reduce((sum, entry) => sum + entry.tokens, 0);
  if (total <= cap) return [];
  const ordered = [...entries].sort((left, right) => left.priority - right.priority || right.order - left.order);
  const dropped: BlockEntry[] = [];
  for (const entry of ordered) {
    if (total <= cap) break;
    // Never leave a block that alone exceeds the cap by dropping everything else first: each drop
    // is whole, and the loop stops as soon as the remaining blocks fit.
    dropped.push(entry);
    total -= entry.tokens;
  }
  return dropped;
}

function dropBlocks(request: ProviderRequest, dropped: readonly BlockEntry[]): ProviderRequest {
  const messageIndexes = new Set(dropped.filter((entry) => entry.kind === "prefix").map((entry) => entry.messageIndex));
  const tailDrops = new Map<number, Set<number>>();
  for (const entry of dropped) {
    if (entry.kind !== "tail" || entry.itemIndex === undefined) continue;
    const set = tailDrops.get(entry.messageIndex) ?? new Set<number>();
    set.add(entry.itemIndex);
    tailDrops.set(entry.messageIndex, set);
  }

  const messages: Message[] = [];
  for (const [index, message] of request.messages.entries()) {
    if (messageIndexes.has(index)) continue;
    const drops = tailDrops.get(index);
    const next = drops ? withoutTailItems(message, drops) : message;
    if (next !== undefined) messages.push(next);
  }

  const droppedMetadata = new Set<Readonly<Record<string, unknown>>>();
  for (const entry of dropped) {
    if (entry.kind !== "prefix") continue;
    const metadata = request.messages[entry.messageIndex]?.metadata;
    if (metadata !== undefined) droppedMetadata.add(metadata);
  }
  const context =
    request.context === undefined || droppedMetadata.size === 0
      ? request.context
      : request.context.filter((block) => block.metadata === undefined || !droppedMetadata.has(block.metadata));
  return { ...request, messages, ...(context === undefined ? {} : { context }) };
}

/** Rebuild a tail message without the dropped item indexes; `undefined` means delete the message. */
function withoutTailItems(message: Message, drops: ReadonlySet<number>): Message | undefined {
  const items = tailItems(message)!;
  const kept = items.filter((_, index) => !drops.has(index));
  if (kept.length === 0) return undefined;
  const content: Message["content"][number][] = [];
  let first = true;
  for (const [index] of items.entries()) {
    if (drops.has(index)) continue;
    if (!first) content.push(message.content[index * 2 - 1]!);
    content.push(message.content[index * 2]!);
    first = false;
  }
  return {
    ...message,
    content,
    metadata: { ...message.metadata, [TAIL_KEY]: kept.map((item) => item.raw) },
  };
}

function accountBySource(request: ProviderRequest): {
  readonly totalTokens: number;
  readonly bySource: ContextAccountEvent["bySource"];
} {
  const account = {
    system: 0,
    instructions: 0,
    skills: 0,
    history: 0,
    toolResults: 0,
    folded: 0,
    input: 0,
    blocks: {} as Record<string, number>,
    tail: {} as Record<string, number>,
  };
  let seenSystem = false;
  let totalTokens = 0;
  for (const message of request.messages) {
    const items = tailItems(message);
    if (items) {
      const tokens = estimateMessageTokens(message);
      totalTokens += tokens;
      for (const item of items) add(account.tail, item.source, item.tokens);
      continue;
    }
    const tokens = estimateMessageTokens(message);
    totalTokens += tokens;
    if (message.role === "tool") {
      if (message.metadata?.prismFolded === true) account.folded += tokens;
      else account.toolResults += tokens;
      continue;
    }
    if (message.role === "user") {
      account.input += tokens;
      continue;
    }
    if (message.role === "assistant") {
      account.history += tokens;
      continue;
    }
    const source = blockSource(message);
    if (source !== undefined) {
      add(account.blocks, source, tokens);
      continue;
    }
    if (isSkillMessage(message)) {
      account.skills += tokens;
      continue;
    }
    if (!seenSystem) {
      seenSystem = true;
      account.system += tokens;
    } else {
      account.instructions += tokens;
    }
  }
  const tools = toolTokens(request.tools);
  account.instructions += tools;
  return { totalTokens: totalTokens + tools, bySource: account };
}

function blockSource(message: Message): string | undefined {
  const source = message.metadata?.source;
  if (typeof source !== "string" || INSTRUCTION_SOURCES.has(source)) return undefined;
  if (typeof message.metadata?.loadedSkill === "string") return undefined;
  return source;
}

function blockPriority(message: Message): number {
  const value = message.metadata?.priority;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isSkillMessage(message: Message): boolean {
  if (typeof message.metadata?.loadedSkill === "string") return true;
  const text = message.content[0];
  if (text?.type !== "text") return false;
  return (
    text.text.startsWith(SKILL_CATALOG_PREFIX) || text.text.startsWith(LOADED_SKILL_PREFIX) || text.text.startsWith(PREVIOUS_SKILLS_PREFIX)
  );
}

interface TailItem {
  readonly source: string;
  readonly priority: number;
  readonly tokens: number;
  readonly raw: JsonObject;
}

function tailItems(message: Message): TailItem[] | undefined {
  if (message.role !== "system") return undefined;
  const raw = message.metadata?.[TAIL_KEY];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const items: TailItem[] = [];
  const structured = message.content.length === raw.length * 2 - 1;
  for (const [index, value] of raw.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    const source = typeof item.source === "string" ? item.source : typeof item.title === "string" ? item.title : "context";
    const priority = typeof item.priority === "number" && Number.isFinite(item.priority) ? item.priority : 0;
    const fallback = structured
      ? estimateMessageTokens({ role: "system", content: [message.content[index * 2]!] })
      : Math.ceil(estimateMessageTokens(message) / raw.length);
    const tokens = typeof item.tokens === "number" && Number.isFinite(item.tokens) ? item.tokens : fallback;
    items.push({ source, priority, tokens, raw: value as JsonObject });
  }
  return items;
}


function add(target: Record<string, number>, key: string, tokens: number): void {
  target[key] = (target[key] ?? 0) + tokens;
}

/** Provider turn the request belongs to: one per assistant reply already in the transcript. */
function currentTurnOf(messages: readonly Message[]): number {
  let assistant = 0;
  for (const message of messages) if (message.role === "assistant") assistant += 1;
  return assistant + 1;
}
