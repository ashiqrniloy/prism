/** Provider-round phase of runInternal (plan 059). */
import type { ModelConfig, ProviderRequest, ProviderTurnResult, ResolvedRunOptions, ToolResult, Usage } from "../../contracts.js";
import type { RoundContext, SessionHost } from "./types.js";
/** Resolve the per-request input cap for turn-budget metadata (plan 087 T1). A model without a
 *  derivable cap omits the field instead of failing an emitting turn. */
export declare function resolveTurnInputCap(model: ModelConfig): number | undefined;
export declare function recordProviderUsage(ctx: RoundContext, turnUsage: Usage | undefined, turn: number, attempt: number, request?: ProviderRequest): Promise<Usage | undefined>;
export declare function generateWithRetry(session: SessionHost, request: ProviderRequest, runId: string, options: ResolvedRunOptions, signal: AbortSignal, requestSecrets?: readonly (string | undefined)[], turn?: number, recordUsage?: (usage: Usage | undefined, turn: number, attempt: number) => Promise<Usage | undefined>, toolResults?: readonly ToolResult[]): Promise<ProviderTurnResult>;
export declare function generateProviderTurn(session: SessionHost, request: ProviderRequest, runId: string, signal: AbortSignal, secrets?: readonly (string | undefined)[], turn?: number, attempt?: number, recordUsage?: (usage: Usage | undefined, turn: number, attempt: number) => Promise<Usage | undefined>, toolResults?: readonly ToolResult[]): Promise<ProviderTurnResult>;
