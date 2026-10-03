/** System-prompt layers. Owned here so the extension surface can go without them. */

export type SystemPromptMode = "append" | "prepend" | "replace" | "disable";
export type SystemPromptSource = "package" | "app" | "user" | "run" | string;

export interface SystemPromptContribution {
  readonly id: string;
  readonly source?: SystemPromptSource;
  readonly mode?: SystemPromptMode;
  readonly text: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type SystemPromptConfig = false | SystemPromptContribution | readonly SystemPromptContribution[];
