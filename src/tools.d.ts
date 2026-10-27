import type { AgentEvent, ErrorInfo, JsonObject, OwnershipScope, RunLedger, ToolCallContent, ToolCapabilityKind, ToolDefinition, ToolEffectDeclaration, ToolEffectStore, ToolExecutionContext, ToolRegistry, ToolResult } from "./contracts.js";
import { type SecretRedactor } from "./redaction.js";
import { type DuplicateRegistrationOptions } from "./registry-options.js";
import type { RunLimitTracker } from "./run-limits.js";
import { type TrustPolicy } from "./security.js";
export interface ToolFilter {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
}
export type ToolFilterInput = ToolFilter | readonly ToolFilter[];
export type ToolValidator = (tool: ToolDefinition, args: JsonObject, context: ToolExecutionContext) => undefined | string | ErrorInfo | Promise<undefined | string | ErrorInfo>;
export interface ToolArgumentValidationError {
    readonly path?: string;
    readonly message: string;
}
export interface ToolArgumentValidationResult {
    readonly ok: boolean;
    readonly errors?: readonly ToolArgumentValidationError[];
}
export interface ToolArgumentValidator {
    validate(schema: JsonObject, value: unknown): ToolArgumentValidationResult;
}
export interface ToolParameterValidatorOptions {
    /** When a tool omits `parameters`. Default `"allow"` preserves pre-validation behavior. */
    readonly missingSchema?: "allow" | "reject";
}
/** Wrap a schema adapter as the existing `ToolValidator` seam used by dispatch and the agent runtime. */
export declare function createToolParameterValidator(validator: ToolArgumentValidator, options?: ToolParameterValidatorOptions): ToolValidator;
export interface DispatchToolCallOptions {
    readonly call: ToolCallContent;
    readonly registry: ToolRegistry;
    readonly context: ToolExecutionContext;
    readonly filter?: ToolFilterInput;
    readonly validate?: ToolValidator;
    /** Adapter-specific policy check immediately before the tool side effect. */
    readonly beforeExecute?: (call: ToolCallContent, tool: ToolDefinition, context: ToolExecutionContext) => void | Promise<void>;
    readonly emit?: (event: AgentEvent) => void | Promise<void>;
    readonly secrets?: readonly (string | undefined)[];
    readonly trust?: TrustPolicy;
    readonly redactor?: SecretRedactor;
    readonly ledger?: RunLedger;
    /** Optional shared recovery store. Only declared optional/required effects use it. */
    readonly effectStore?: ToolEffectStore;
    readonly ownership?: OwnershipScope;
    /** Opaque host principal, passed through unchanged. */
    readonly principal?: import("./contracts-core/principal.js").Principal;
    /** Shared run tracker; direct hosts may supply one for their call scope. */
    readonly limitTracker?: RunLimitTracker;
}
export interface ToolRegistryOptions extends DuplicateRegistrationOptions {
}
export declare class ToolDefinitionError extends Error {
    readonly code: "ERR_PRISM_TOOL_EFFECTS";
    constructor(code: "ERR_PRISM_TOOL_EFFECTS", message: string);
}
/**
 * Capabilities reported to `tool.call` hooks. A tool with no `effects` resolves to all kinds, so a
 * missing annotation never widens what an effects-based policy allows.
 */
export declare function resolveToolEffects(tool: ToolDefinition): readonly ToolCapabilityKind[];
export declare function createToolRegistry(tools?: readonly ToolDefinition[], options?: ToolRegistryOptions): ToolRegistry;
export declare function filterTools(tools: readonly ToolDefinition[], filter?: ToolFilterInput): readonly ToolDefinition[];
/** Run allow-lists never exceed the disclosed set. */
export declare const HARD_RUN_TOOL_NAMES = 1024;
/** Restrictive clamp: keep listed order; names outside the grant are dropped (not thrown). */
export declare function clampTurnToolNames(listed: readonly ToolDefinition[], requested: readonly string[]): {
    readonly tools: readonly ToolDefinition[];
    readonly dropped: readonly string[];
};
/**
 * Per-run allow-list. Omitted grant → unchanged list. Checkpointed grant cannot widen.
 * Fresh unknown names fail closed; resume drops names the current registry no longer has.
 */
export declare function selectRunTools(listed: readonly ToolDefinition[], requested: readonly string[] | undefined, checkpoint?: readonly string[]): {
    readonly tools: readonly ToolDefinition[];
    readonly grant: readonly string[] | undefined;
};
export declare function dispatchToolCall(options: DispatchToolCallOptions): Promise<ToolResult>;
export declare function resolveToolEffectDeclaration(tool: ToolDefinition, args: JsonObject, context: ToolExecutionContext): ToolEffectDeclaration | undefined;
