import { BoxRenderable, type CliRenderer, TextareaRenderable } from "@opentui/core";

/** Pastes larger than either bound collapse to a token and expand again on submit. */
const PASTE_COLLAPSE_LINES = 10;
const PASTE_COLLAPSE_BYTES = 2 * 1024;

export interface InputEditorOptions {
  readonly height?: number;
  readonly placeholder?: string;
  readonly onSubmit?: (text: string) => void;
  /** Prior prompts, oldest first, for Up/Down navigation. */
  readonly history?: readonly string[];
  readonly onHistoryAdd?: (text: string) => void;
}

export class InputEditorComponent {
  readonly root: BoxRenderable;
  readonly textarea: TextareaRenderable;
  private history: string[] = [];
  private historyIndex = 0;
  private draft = "";
  private onSubmitCallback?: (text: string) => void;
  private onHistoryAddCallback?: (text: string) => void;
  private readonly pastedBlocks: Array<{ readonly token: string; readonly content: string }> = [];

  constructor(renderer: CliRenderer, options?: InputEditorOptions) {
    this.onSubmitCallback = options?.onSubmit;
    this.onHistoryAddCallback = options?.onHistoryAdd;
    this.history = [...(options?.history ?? [])];
    this.historyIndex = this.history.length;

    this.root = new BoxRenderable(renderer, {
      flexDirection: "column",
      height: options?.height ?? 3,
      paddingLeft: 1,
      paddingRight: 1,
      border: true,
      borderColor: "#555555",
      focusedBorderColor: "#00aaff",
    });

    this.textarea = new TextareaRenderable(renderer, {
      flexGrow: 1,
      placeholder: options?.placeholder ?? "Type a prompt or /command...",
      keyBindings: [
        { name: "return", action: "submit" },
        // Terminals without the kitty keyboard protocol report Shift+Enter as plain Enter, so the
        // newline fallbacks (Alt+Enter, Ctrl+J/linefeed) are the ones that always work.
        { name: "return", shift: true, action: "newline" },
        { name: "return", meta: true, action: "newline" },
        { name: "j", ctrl: true, action: "newline" },
        { name: "linefeed", action: "newline" },
      ],
      onSubmit: () => {
        this.submit();
      },
    });

    this.root.add(this.textarea);
  }

  submit(): void {
    const raw = this.textarea.plainText;
    const text = this.expandPastes(raw).trim();
    if (text.length === 0) return;

    // Record in history
    if (this.history.at(-1) !== text) {
      this.history.push(text);
      this.onHistoryAddCallback?.(text);
    }
    this.historyIndex = this.history.length;
    this.draft = "";
    this.pastedBlocks.length = 0;

    // Clear input
    this.clear();

    if (this.onSubmitCallback) {
      this.onSubmitCallback(text);
    }
  }

  /**
   * Collapses an oversized paste into `[pasted N lines]`, returning true when the caller must
   * preventDefault so the raw text does not also land in the buffer. Small pastes are left to
   * the textarea's own paste handling (multi-line pastes still never submit).
   */
  handlePaste(bytes: Uint8Array): boolean {
    const text = new TextDecoder().decode(bytes).replace(/\r\n/g, "\n");
    if (text.length === 0) return false;
    const newlines = (text.match(/\n/g) ?? []).length;
    const lines = text.endsWith("\n") ? newlines : newlines + 1;
    if (lines <= PASTE_COLLAPSE_LINES && bytes.byteLength <= PASTE_COLLAPSE_BYTES) return false;

    const token = `[pasted ${lines} lines]`;
    this.pastedBlocks.push({ token, content: text });
    this.textarea.insertText(token);
    return true;
  }

  historyPrevious(): void {
    if (this.history.length === 0) return;

    if (this.historyIndex === this.history.length) {
      this.draft = this.textarea.plainText;
    }

    if (this.historyIndex > 0) {
      this.historyIndex--;
      const entry = this.history[this.historyIndex];
      if (entry !== undefined) {
        this.textarea.editBuffer.setText(entry);
      }
    }
  }

  historyNext(): void {
    if (this.history.length === 0 || this.historyIndex >= this.history.length) return;

    this.historyIndex++;
    if (this.historyIndex === this.history.length) {
      this.textarea.editBuffer.setText(this.draft);
    } else {
      const entry = this.history[this.historyIndex];
      if (entry !== undefined) {
        this.textarea.editBuffer.setText(entry);
      }
    }
  }

  get isCursorOnFirstLine(): boolean {
    return this.textarea.logicalCursor.row === 0;
  }

  get isCursorOnLastLine(): boolean {
    return this.textarea.logicalCursor.row >= Math.max(0, this.textarea.lineCount - 1);
  }

  /** Trailing `\` + Enter: consume the backslash and continue on the next line instead of submitting. */
  continueLine(): boolean {
    const text = this.textarea.plainText;
    if (!text.endsWith("\\")) return false;
    this.textarea.editBuffer.setText(`${text.slice(0, -1)}\n`);
    return true;
  }

  getText(): string {
    return this.textarea.plainText;
  }

  setText(text: string): void {
    this.textarea.editBuffer.setText(text);
  }

  clear(): void {
    this.textarea.editBuffer.setText("");
  }

  focus(): void {
    this.textarea.focus();
  }

  setOnSubmit(callback: (text: string) => void): void {
    this.onSubmitCallback = callback;
  }

  private expandPastes(raw: string): string {
    let expanded = "";
    let cursor = 0;
    for (const block of this.pastedBlocks) {
      const index = raw.indexOf(block.token, cursor);
      if (index < 0) continue;
      expanded += raw.slice(cursor, index) + block.content;
      cursor = index + block.token.length;
    }
    return expanded + raw.slice(cursor);
  }
}
