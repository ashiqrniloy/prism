import { type CliRenderer, MarkdownRenderable, type StyleDefinitionInput, SyntaxStyle } from "@opentui/core";
import { sanitizeTerminalText } from "../sanitize.js";

/**
 * One dark-theme palette for fences, diffs, and markdown. Capture names the shipped grammars
 * emit are registered directly; anything else falls back to `default` (unhighlighted).
 */
const PRISM_SYNTAX_STYLES: Record<string, StyleDefinitionInput> = {
  default: { fg: "#d4d4d4" },
  comment: { fg: "#6a9955", italic: true },
  keyword: { fg: "#c586c0" },
  "keyword.function": { fg: "#c586c0" },
  "keyword.return": { fg: "#c586c0" },
  "keyword.operator": { fg: "#d4d4d4" },
  "keyword.import": { fg: "#c586c0" },
  "keyword.type": { fg: "#569cd6" },
  string: { fg: "#ce9178" },
  number: { fg: "#b5cea8" },
  boolean: { fg: "#569cd6" },
  constant: { fg: "#4fc1ff" },
  constructor: { fg: "#4ec9b0" },
  type: { fg: "#4ec9b0" },
  function: { fg: "#dcdcaa" },
  "function.call": { fg: "#dcdcaa" },
  "function.method": { fg: "#dcdcaa" },
  "function.method.call": { fg: "#dcdcaa" },
  variable: { fg: "#9cdcfe" },
  "variable.parameter": { fg: "#9cdcfe" },
  property: { fg: "#9cdcfe" },
  operator: { fg: "#d4d4d4" },
  punctuation: { fg: "#d4d4d4" },
  label: { fg: "#c586c0" },
  escape: { fg: "#d7ba7d" },
  tag: { fg: "#569cd6" },
  attribute: { fg: "#9cdcfe" },
  "markup.heading": { fg: "#569cd6", bold: true },
  "markup.italic": { italic: true },
  "markup.bold": { bold: true },
  "markup.link": { fg: "#4fc1ff", underline: true },
};

/** Caller owns the style; destroy it when the TUI tears down. */
export function createPrismSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles(PRISM_SYNTAX_STYLES);
}

/** Assistant text is markdown by contract; every other transcript entry stays plain text. */
export class MarkdownMessageComponent {
  readonly root: MarkdownRenderable;

  constructor(renderer: CliRenderer, syntaxStyle: SyntaxStyle) {
    // Fenced code blocks become internal CodeRenderables; the default tree-sitter client
    // highlights them off the render path, so nothing here awaits highlighting.
    this.root = new MarkdownRenderable(renderer, {
      content: "",
      syntaxStyle,
      streaming: true,
      width: "100%",
    });
  }

  setText(text: string, finished: boolean | undefined): void {
    this.root.content = sanitizeTerminalText(text);
    this.root.streaming = finished !== true;
  }
}
