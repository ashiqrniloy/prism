import type { SystemPromptConfig } from "./contracts.js";
export interface ComposeSystemPromptOptions {
    readonly base?: string | readonly string[];
}
export declare function composeSystemPrompt(contributions?: SystemPromptConfig, options?: ComposeSystemPromptOptions): string | undefined;
export declare function mergeSystemPromptConfig(config: SystemPromptConfig | undefined, override: SystemPromptConfig | undefined): SystemPromptConfig;
