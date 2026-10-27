/** Context-assembly + runInternal orchestrator (plan 059). */
import type { ActiveDurableRun } from "../../agent-approval.js";
import type { ResolvedRunOptions, RunResult } from "../../contracts.js";
import type { AgentInput } from "../../input.js";
import type { SessionHost } from "./types.js";
export declare function executeRun(session: SessionHost, input: AgentInput, options: ResolvedRunOptions, runId: string, resumed?: ActiveDurableRun): Promise<RunResult>;
