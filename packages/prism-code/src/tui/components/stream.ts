import { BoxRenderable, type CliRenderer, type Renderable, ScrollBoxRenderable, type SyntaxStyle, TextRenderable } from "@opentui/core";
import type { UiStreamEntry, UiToolCallStatus } from "../reducer.js";
import { sanitizeTerminalText } from "../sanitize.js";
import { createPrismSyntaxStyle, MarkdownMessageComponent } from "./markdown-message.js";
import { ToolCardComponent } from "./tool-card.js";

function toolStatusGlyph(status: UiToolCallStatus): string {
  switch (status) {
    case "running":
      return "●";
    case "success":
      return "✔";
    case "failure":
      return "✖";
    case "denied":
      return "⊘";
  }
}

/** Collapsed one-line rendering for thinking blocks (full text stays in the session store). */
const THINKING_PREVIEW_LENGTH = 120;

function thinkingPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > THINKING_PREVIEW_LENGTH ? `${collapsed.slice(0, THINKING_PREVIEW_LENGTH - 1)}…` : collapsed;
}

export function collapsedThinkingText(text: string): string {
  return `▸ Thinking… (Ctrl+T to expand) ${thinkingPreview(sanitizeTerminalText(text))}`;
}

export function expandedThinkingText(text: string): string {
  return `▾ Thinking\n${sanitizeTerminalText(text)}`;
}

function thinkingText(entry: UiStreamEntry, expanded: boolean): string {
  if (entry.type !== "thinking") return "";
  return expanded ? expandedThinkingText(entry.text) : collapsedThinkingText(entry.text);
}

function plainEntryText(entry: UiStreamEntry): string {
  if (entry.type === "message") {
    return entry.role === "assistant"
      ? `Assistant: ${sanitizeTerminalText(entry.text)}`
      : `${entry.role === "user" ? "You: " : "Note: "}${sanitizeTerminalText(entry.text)}`;
  }
  if (entry.type === "tool_call") {
    const details = entry.error ? ` (${entry.error})` : entry.resultSummary ? ` -> ${entry.resultSummary}` : "";
    return sanitizeTerminalText(`[${toolStatusGlyph(entry.status)}] ${entry.name} ${entry.argsSummary}${details}`);
  }
  return entry.type === "thinking" ? collapsedThinkingText(entry.text) : `Error: ${sanitizeTerminalText(entry.message)}`;
}

interface StreamItem {
  entry: UiStreamEntry;
  renderable: Renderable;
  textRenderable?: TextRenderable;
  markdown?: MarkdownMessageComponent;
  card?: ToolCardComponent;
}

export class MessageStreamComponent {
  readonly root: ScrollBoxRenderable;
  private readonly renderer: CliRenderer;
  private readonly maxEntries: number;
  private readonly syntaxStyle?: SyntaxStyle;
  private readonly entryMap = new Map<string, StreamItem>();
  private readonly entryOrder: string[] = [];
  private thinkingExpanded = false;
  private lastToolEntryId?: string;

  constructor(renderer: CliRenderer, options?: { maxEntries?: number; syntaxStyle?: SyntaxStyle }) {
    this.renderer = renderer;
    this.maxEntries = options?.maxEntries ?? 500;
    this.syntaxStyle = options?.syntaxStyle;

    this.root = new ScrollBoxRenderable(renderer, {
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
    });
  }

  appendOrUpdate(entry: UiStreamEntry): void {
    const existing = this.entryMap.get(entry.id);
    if (existing) {
      if (entry.version !== undefined && existing.entry.version === entry.version) return;
      existing.entry = entry;
      if (entry.type === "tool_call") {
        this.lastToolEntryId = entry.id;
        if (existing.card) {
          existing.card.update(entry);
          return;
        }
      }
      if (existing.markdown && entry.type === "message") {
        existing.markdown.setText(entry.text, entry.finished);
        return;
      }
      if (existing.textRenderable) {
        existing.textRenderable.content = entry.type === "thinking" ? thinkingText(entry, this.thinkingExpanded) : plainEntryText(entry);
      }
      return;
    }

    const item = this.createItem(entry);
    this.root.add(item.renderable);
    this.entryMap.set(entry.id, item);
    this.entryOrder.push(entry.id);
    if (entry.type === "tool_call") this.lastToolEntryId = entry.id;

    // Evict oldest if exceeding maxEntries
    while (this.entryOrder.length > this.maxEntries) {
      const oldestId = this.entryOrder.shift();
      if (oldestId) {
        const oldest = this.entryMap.get(oldestId);
        if (oldest) {
          this.root.content.remove(oldest.renderable);
          oldest.renderable.destroy();
          this.entryMap.delete(oldestId);
        }
      }
    }
  }

  private createItem(entry: UiStreamEntry): StreamItem {
    if (entry.type === "message" && entry.role === "assistant") {
      const box = new BoxRenderable(this.renderer, {
        flexDirection: "column",
        marginBottom: 1,
        paddingLeft: 1,
      });
      // Assistant messages are the one place markdown is interpreted; user/system stay plain.
      const markdown = new MarkdownMessageComponent(this.renderer, this.syntaxStyle ?? defaultSyntaxStyle());
      markdown.setText(entry.text, entry.finished);
      box.add(markdown.root);
      return { entry, renderable: box, markdown };
    }

    if (entry.type === "tool_call") {
      const card = new ToolCardComponent(this.renderer, entry, {
        ...(this.syntaxStyle ? { syntaxStyle: this.syntaxStyle } : {}),
      });
      return { entry, renderable: card.root, card };
    }

    const box = new BoxRenderable(this.renderer, {
      flexDirection: "column",
      marginBottom: 1,
      paddingLeft: entry.type === "thinking" ? 2 : 1,
    });
    const textRenderable = new TextRenderable(this.renderer, {
      content: entry.type === "thinking" ? thinkingText(entry, this.thinkingExpanded) : plainEntryText(entry),
      ...(entry.type === "thinking" ? { fg: "#6b7280" } : {}),
      ...(entry.type === "message" && entry.role === "system" ? { fg: "#9ca3af" } : {}),
      ...(entry.type === "error" ? { fg: "#ef4444" } : {}),
    });
    box.add(textRenderable);
    return { entry, renderable: box, textRenderable };
  }

  /** Ctrl+T: expand or collapse every thinking block in the transcript. */
  toggleThinking(): boolean {
    this.thinkingExpanded = !this.thinkingExpanded;
    for (const item of this.entryMap.values()) {
      if (item.entry.type === "thinking" && item.textRenderable) {
        item.textRenderable.content = thinkingText(item.entry, this.thinkingExpanded);
      }
    }
    this.root.requestRender();
    return this.thinkingExpanded;
  }

  get isThinkingExpanded(): boolean {
    return this.thinkingExpanded;
  }

  /** Ctrl+O: expand or collapse the most recent tool card. */
  toggleLastToolCard(): boolean {
    const last = this.lastToolEntryId === undefined ? undefined : this.entryMap.get(this.lastToolEntryId);
    if (!last?.card) return false;
    return last.card.toggleExpanded();
  }

  clear(): void {
    for (const id of this.entryOrder) {
      const item = this.entryMap.get(id);
      if (item) {
        this.root.content.remove(item.renderable);
        item.renderable.destroy();
      }
    }
    this.entryMap.clear();
    this.entryOrder.length = 0;
    this.lastToolEntryId = undefined;
  }

  getItemCount(): number {
    return this.entryOrder.length;
  }
}

let sharedSyntaxStyle: SyntaxStyle | undefined;

function defaultSyntaxStyle(): SyntaxStyle {
  sharedSyntaxStyle ??= createPrismSyntaxStyle();
  return sharedSyntaxStyle;
}
