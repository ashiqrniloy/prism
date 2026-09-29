import { BoxRenderable, type CliRenderer, DiffRenderable, type SyntaxStyle, TextRenderable } from "@opentui/core";
import type { UiApprovalRequest } from "../reducer.js";
import { createDiffRenderable, updateDiffRenderable } from "./diff-view.js";

export type ApprovalDecision = "allow_once" | "allow_for_run" | "allow_always" | "deny";

export interface ApprovalPromptOptions {
  readonly defaultTimeoutMs?: number;
  readonly syntaxStyle?: SyntaxStyle;
}

export class ApprovalPromptComponent {
  readonly root: BoxRenderable;
  private readonly defaultTimeoutMs: number;
  private readonly syntaxStyle?: SyntaxStyle;
  private readonly titleText: TextRenderable;
  private readonly summaryText: TextRenderable;
  private readonly diffHost: BoxRenderable;
  private readonly optionsText: TextRenderable;
  private diffRenderable?: DiffRenderable;
  private activeResolver?: (decision: ApprovalDecision) => void;
  private activeTimer?: ReturnType<typeof setTimeout>;

  constructor(renderer: CliRenderer, options?: ApprovalPromptOptions) {
    // No auto-deny by default: an autonomous run waits for the operator (plan 137 Task 8).
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 0;
    this.syntaxStyle = options?.syntaxStyle;

    this.root = new BoxRenderable(renderer, {
      flexDirection: "column",
      border: true,
      borderColor: "#ffaa00",
      backgroundColor: "#1e1e1e",
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      marginBottom: 1,
      visible: false,
    });

    this.titleText = new TextRenderable(renderer, {
      content: "Tool Execution Approval Required",
    });

    this.summaryText = new TextRenderable(renderer, {
      content: "",
    });

    this.diffHost = new BoxRenderable(renderer, {
      flexDirection: "column",
      visible: false,
    });

    this.optionsText = new TextRenderable(renderer, {
      content: "[a] Allow once   [r] Allow for run   [w] Always allow (repo)   [d] Deny (Esc)",
    });

    this.root.add(this.titleText);
    this.root.add(this.summaryText);
    this.root.add(this.diffHost);
    this.root.add(this.optionsText);
  }

  get isPrompting(): boolean {
    return this.activeResolver !== undefined;
  }

  prompt(request: UiApprovalRequest, timeoutMs?: number): Promise<ApprovalDecision> {
    // If already prompting, deny previous
    if (this.activeResolver) {
      this.resolve("deny");
    }

    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;

    this.summaryText.content = `Tool: ${request.toolName} (${request.actionKind}:${request.operation})\nDetails: ${request.summary}`;
    this.showPatch(request.patch);
    this.root.visible = true;

    return new Promise<ApprovalDecision>((resolve) => {
      this.activeResolver = resolve;

      if (effectiveTimeout > 0) {
        this.activeTimer = setTimeout(() => {
          this.resolve("deny");
        }, effectiveTimeout);
      }
    });
  }

  /** The proposal diff for mutating tools; sanitized and size-bounded by the caller. */
  private showPatch(patch?: string): void {
    if (!patch) {
      this.diffHost.visible = false;
      return;
    }
    if (!this.diffRenderable) {
      this.diffRenderable = createDiffRenderable(this.root.ctx, patch, this.syntaxStyle);
      this.diffHost.add(this.diffRenderable);
    } else {
      updateDiffRenderable(this.diffRenderable, patch);
    }
    this.diffHost.visible = true;
  }

  handleKey(keyName: string): boolean {
    if (!this.activeResolver) return false;

    const lower = keyName.toLowerCase();
    if (lower === "a" || lower === "1") {
      this.resolve("allow_once");
      return true;
    }
    if (lower === "r" || lower === "2") {
      this.resolve("allow_for_run");
      return true;
    }
    if (lower === "w" || lower === "4") {
      this.resolve("allow_always");
      return true;
    }
    if (lower === "d" || lower === "3" || lower === "escape") {
      this.resolve("deny");
      return true;
    }
    return false;
  }

  resolve(decision: ApprovalDecision): void {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = undefined;
    }
    this.root.visible = false;
    // Free the parsed patch: diffs can be large and the next prompt rebuilds from its own request.
    if (this.diffRenderable) {
      this.diffHost.remove(this.diffRenderable);
      this.diffRenderable.destroy();
      this.diffRenderable = undefined;
    }
    this.diffHost.visible = false;
    const resolver = this.activeResolver;
    this.activeResolver = undefined;
    if (resolver) {
      resolver(decision);
    }
  }

  cancel(): void {
    if (this.activeResolver) {
      this.resolve("deny");
    }
  }
}
