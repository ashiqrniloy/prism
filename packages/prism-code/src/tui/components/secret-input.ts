import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core";

const MASK_GLYPH = "•";

/**
 * Masked single-line secret prompt.
 *
 * OpenTUI 0.5.12 has no masking hook on `InputRenderable`/`TextareaRenderable`, so this component owns the
 * buffer itself: the secret never enters an edit buffer, history, or renderable content — only `•` glyphs are
 * drawn. Keys, paste, Enter, and Escape are routed here by the TUI while the prompt is visible.
 */
export class SecretInputComponent {
  readonly root: BoxRenderable;
  private readonly labelText: TextRenderable;
  private readonly valueText: TextRenderable;
  private buffer = "";
  private resolver?: (value: string | undefined) => void;

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      flexDirection: "column",
      border: true,
      borderColor: "#00aaff",
      paddingLeft: 1,
      paddingRight: 1,
      marginBottom: 1,
      visible: false,
    });

    this.labelText = new TextRenderable(renderer, { content: "" });
    this.valueText = new TextRenderable(renderer, { content: "" });
    this.root.add(this.labelText);
    this.root.add(this.valueText);
  }

  get isVisible(): boolean {
    return this.root.visible;
  }

  /** Current buffer length only — never the value. */
  get length(): number {
    return this.buffer.length;
  }

  show(label: string): Promise<string | undefined> {
    this.buffer = "";
    this.labelText.content = label;
    this.renderValue();
    this.root.visible = true;
    return new Promise<string | undefined>((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Handles one keypress while visible. Returns true when the key was consumed (always, while visible). */
  handleKey(key: { name: string; sequence?: string; ctrl?: boolean; meta?: boolean }): boolean {
    if (!this.root.visible) return false;

    if (key.name === "escape") {
      this.resolve(undefined);
      return true;
    }
    if (key.name === "return" || key.name === "enter") {
      this.resolve(this.buffer);
      return true;
    }
    if (key.name === "backspace") {
      this.buffer = this.buffer.slice(0, -1);
      this.renderValue();
      return true;
    }
    if (key.ctrl && key.name === "u") {
      this.buffer = "";
      this.renderValue();
      return true;
    }
    if (key.ctrl || key.meta) {
      // Swallow control/meta combos: they must never insert text into a secret.
      return true;
    }

    const char = key.sequence ?? (key.name.length === 1 ? key.name : undefined);
    if (char && char.length === 1 && char >= " ") {
      this.buffer += char;
      this.renderValue();
    }
    return true;
  }

  /** Appends pasted text with newlines and control characters stripped; never echoes the paste. */
  handlePaste(bytes: Uint8Array): boolean {
    if (!this.root.visible) return false;
    const text = new TextDecoder()
      .decode(bytes)
      .replace(/[\r\n]+/g, "")
      .replace(/[\u0000-\u001f\u007f]/g, "");
    if (text.length > 0) {
      this.buffer += text;
      this.renderValue();
    }
    return true;
  }

  /** Cancels a pending prompt (same as Escape); used on teardown. */
  cancel(): void {
    if (this.root.visible) {
      this.resolve(undefined);
    }
  }

  private resolve(value: string | undefined): void {
    const resolver = this.resolver;
    this.resolver = undefined;
    this.buffer = "";
    this.renderValue();
    this.root.visible = false;
    resolver?.(value);
  }

  private renderValue(): void {
    this.valueText.content = MASK_GLYPH.repeat(this.buffer.length);
  }
}
