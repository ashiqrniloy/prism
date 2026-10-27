import type { ContentBlock, ContextBlock, InputBuildContext, JsonObject, Message, ModelConfig, ProviderRequest, ProviderRequestOptions, ResourceLoader, Skill, ToolDefinition, ToolResult } from "./contracts.js";
import type { SecretRedactor } from "./redaction.js";
import { type LoadedSkillSet, type SkillsDisclosure } from "./skill-disclosure.js";
export type AgentInput = string | Message | readonly Message[];
/**
 * Wire payload for a tool result that carries no `value`, no `type:text` content, and no error.
 * Every provider route serializes a tool result from this block, so the empty case must be a
 * constant non-empty string instead of an absent payload (strict providers reject empty results).
 */
export declare const EMPTY_TOOL_RESULT_TEXT = "(tool completed with no output)";
/**
 * `metadata.trust` marker for a result whose body came from outside the trust boundary (web pages,
 * browser pages, third-party APIs, ingested documents). The kernel wraps those results in an
 * envelope instead of trusting each package to repeat the same warning and escaping rule.
 */
export declare const UNTRUSTED_EXTERNAL_TRUST = "untrusted_external";
/**
 * The single wire form of an untrusted tool result: a preamble, then one tag-delimited block whose
 * body cannot close it early. The model sees the same string in the transcript, in folded text, and
 * through every codec.
 */
export declare function formatUntrustedToolText(result: Pick<ToolResult, "name" | "content" | "value" | "metadata">): string;
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
export declare function createDefaultInputBuilder(): DefaultInputBuilder;
export declare function renderPromptTemplate(template: string, variables: JsonObject, options?: PromptTemplateOptions): string;
export declare function assembleProviderInput(options: AssembleProviderInputOptions): Promise<ProviderRequest>;
export declare function inputMessages(input: AgentInput): Message[];
export declare function toToolResultMessage(result: ToolResult): Message;
export declare function contextMessages(context: readonly ContextBlock[] | undefined): Message[];
