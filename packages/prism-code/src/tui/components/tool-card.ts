import { BoxRenderable, type CliRenderer, DiffRenderable, type SyntaxStyle, TextRenderable } from "@opentui/core";
import type { UiToolCallEntry, UiToolCallStatus } from "../reducer.js";
import { sanitizeTerminalText } from "../sanitize.js";
import { createDiffRenderable, updateDiffRenderable } from "./diff-view.js";

export type ToolCardRenderer = "text" | "diff";

/**
 * Per-tool card bodies, registered by tool name. The default is the text renderer; mutating
 * tools get the diff renderer so their proposed/applied patch is visible without expanding.
 */
const toolCardRenderers = new Map<string, ToolCardRenderer>([
  ["edit", "diff"],
  ["write", "diff"],
  ["git_apply", "diff"],
  ["git_diff", "diff"],
]);

export function registerToolRenderer(toolName: string, renderer: ToolCardRenderer): void {
  toolCardRenderers.set(toolName, renderer);
}

export function resolveToolRenderer(toolName: string): ToolCardRenderer {
  return toolCardRenderers.get(toolName) ?? "text";
}

const COLLAPSED_OUTPUT_LINES = 6;
/** Expanded previews stay bounded so one pathological output cannot blow up a frame. */
export const MAX_EXPANDED_OUTPUT_LINES = 2000;

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

function statusColor(status: UiToolCallStatus): string | undefined {
  if (status === "failure") return "#ef4444";
  if (status === "denied") return "#eab308";
  return undefined;
}

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return "";
  if (durationMs < 1000) return ` · ${Math.round(durationMs)}ms`;
  return ` · ${(durationMs / 1000).toFixed(1)}s`;
}

/** Collapsed preview: first N lines, with the expand hint when the output continues. */
export function collapsedOutputText(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= COLLAPSED_OUTPUT_LINES) return lines.join("\n");
  return `${lines.slice(0, COLLAPSED_OUTPUT_LINES).join("\n")}\n… ${lines.length - COLLAPSED_OUTPUT_LINES} more lines (Ctrl+O to expand)`;
}

/** Expanded preview is capped at MAX_EXPANDED_OUTPUT_LINES with an omitted-lines marker. */
export function expandedOutputText(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_EXPANDED_OUTPUT_LINES) return lines.join("\n");
  return `${lines.slice(0, MAX_EXPANDED_OUTPUT_LINES).join("\n")}\n… ${lines.length - MAX_EXPANDED_OUTPUT_LINES} lines omitted …`;
}

export interface ToolCardOptions {
  readonly syntaxStyle?: SyntaxStyle;
  readonly expanded?: boolean;
}

/** One transcript card: header line, per-tool body (unified diff for mutating tools), output preview. */
export class ToolCardComponent {
  readonly root: BoxRenderable;
  private readonly renderer: CliRenderer;
  private readonly syntaxStyle?: SyntaxStyle;
  private readonly header: TextRenderable;
  private readonly diffHost: BoxRenderable;
  private readonly output: TextRenderable;
  private readonly rendererKind: ToolCardRenderer;
  private diffRenderable?: DiffRenderable;
  private outputText?: string;
  private expanded: boolean;

  constructor(renderer: CliRenderer, entry: UiToolCallEntry, options?: ToolCardOptions) {
    this.renderer = renderer;
    this.syntaxStyle = options?.syntaxStyle;
    this.rendererKind = resolveToolRenderer(entry.name);
    this.expanded = options?.expanded ?? false;

    this.root = new BoxRenderable(renderer, {
      flexDirection: "column",
      marginBottom: 1,
      paddingLeft: 2,
    });
    this.header = new TextRenderable(renderer, { content: "" });
    this.diffHost = new BoxRenderable(renderer, { flexDirection: "column", visible: false });
    this.output = new TextRenderable(renderer, { content: "" });
    this.root.add(this.header);
    this.root.add(this.diffHost);
    this.root.add(this.output);

    this.update(entry);
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  update(entry: UiToolCallEntry): void {
    this.header.content = sanitizeTerminalText(
      `[${toolStatusGlyph(entry.status)}] ${entry.name} ${entry.argsSummary}${entry.error ? ` (${entry.error})` : ""}${formatDuration(entry.durationMs)}`,
    );
    this.header.fg = statusColor(entry.status) ?? undefined;

    if (this.rendererKind === "diff" && entry.patch) {
      if (!this.diffRenderable) {
        this.diffRenderable = createDiffRenderable(this.renderer, entry.patch, this.syntaxStyle);
        this.diffHost.add(this.diffRenderable);
      } else {
        updateDiffRenderable(this.diffRenderable, entry.patch);
      }
      this.diffHost.visible = true;
    } else {
      this.diffHost.visible = false;
    }

    this.outputText = entry.output;
    if (entry.output) {
      this.output.content = sanitizeTerminalText(this.expanded ? expandedOutputText(entry.output) : collapsedOutputText(entry.output));
      this.output.visible = true;
    } else {
      this.output.visible = false;
    }
    this.root.requestRender();
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    if (this.outputText !== undefined) {
      const text = this.expanded ? expandedOutputText(this.outputText) : collapsedOutputText(this.outputText);
      this.output.content = sanitizeTerminalText(text);
    }
    this.root.requestRender();
  }

  toggleExpanded(): boolean {
    this.setExpanded(!this.expanded);
    return this.expanded;
  }
}
