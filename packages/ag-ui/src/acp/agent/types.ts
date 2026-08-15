/** types (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */
import type { AcpCapabilitiesOptions, AcpMcpSeams, AcpSessionStoreSeams } from "../capabilities.js";
import type { AcpClientFilesystem } from "../fs-client.js";
import type { AcpClientTerminals } from "../terminal-client.js";
import type { AcpConfigOptionsSeam, AcpModesSeam } from "../modes.js";
import type { AcpSessionStore } from "../session-store.js";
import type { AgUiAuthorization } from "../../types.js";
import type { AgUiLimitOptions } from "../../limits.js";
import type { AgUiProjection } from "../../projection.js";
import type { AgentContext, McpServer } from "@agentclientprotocol/sdk";
import type { AgentRunLifecycle, AgentSession, OwnershipScope, PendingDecision, SecretRedactor } from "@arnilo/prism";
import type { CodingLifecycleEmitter } from "@arnilo/prism-coding-agent";

export interface AcpAuthorization extends AgUiAuthorization {}

export interface AcpSessionBinding {
  readonly session: AgentSession;
  /** Optional host assertion passed to the durable lifecycle. */
  readonly agentId?: string;
}

/** Client-method adapters the host can wire into its coding tools (built per advertised capability). */
export interface AcpCodingContext {
  readonly filesystem?: AcpClientFilesystem;
  readonly processes?: AcpClientTerminals;
}

/** Host-supplied factory seams; the agent calls them only when the client advertised the matching capability. */
export interface AcpCodingSeams {
  /** Editor-buffer filesystem. Called only when the client advertised fs.readTextFile or fs.writeTextFile; `sessionId` is the ACP session id. */
  readonly filesystem?: (client: AgentContext, sessionId: string) => AcpClientFilesystem | Promise<AcpClientFilesystem>;
  /** Client terminals. Called only when the client advertised terminal; `sessionId` is the ACP session id. */
  readonly processes?: (client: AgentContext, sessionId: string) => AcpClientTerminals | Promise<AcpClientTerminals>;
  /**
   * Host lifecycle emitter. While a session streams, mapped lifecycle events
   * (freeze `lifecycleEventMapping`) are forwarded to that session's client;
   * `configuration_changed` broadcasts `config_option_update` per session.
   */
  readonly lifecycle?: CodingLifecycleEmitter;
}

export interface CreatePrismAcpAgentOptions<Authorization extends AcpAuthorization = AcpAuthorization> {
  readonly name?: string;
  /** Host binds transport identity to Prism ownership. False rejects new sessions. */
  readonly authorize: (input: {
    readonly sessionId?: string;
    readonly signal: AbortSignal;
  }) => Authorization | false | Promise<Authorization | false>;
  /** Host owns session construction; only policy-checked cwd, additionalDirectories, and approved MCP configs are forwarded. */
  readonly sessionFactory: (input: {
    readonly authorization: Authorization;
    readonly signal: AbortSignal;
    /** Pre-generated ACP session id; present only when `coding.processes` is wired and the client advertised terminal. */
    readonly sessionId?: string;
    /** Editor-backed adapters, built from `coding` seams only for client-advertised capabilities. */
    readonly coding?: AcpCodingContext;
    /** Client-supplied working directory (schema-required absolute path); host policy-checks it. */
    readonly cwd: string;
    /** Policy-checked subset of the client's additionalDirectories (empty when none allowed). */
    readonly additionalDirectories: readonly string[];
    /** Cap-validated, host-approved MCP server configs (empty when client sent none). */
    readonly mcpServers: readonly McpServer[];
  }) => AcpSessionBinding | Promise<AcpSessionBinding>;
  readonly lifecycle: AgentRunLifecycle;
  readonly redactor?: SecretRedactor;
  readonly projection?: AgUiProjection;
  readonly limits?: AgUiLimitOptions;
  /** Host-owned session store; presence advertises the matching session capabilities. */
  readonly sessions?: AcpSessionStoreSeams;
  /** Host-owned durable registry store (plan 018 Task 2); absent seam => in-memory 0.1.5 behavior. */
  readonly sessionStore?: AcpSessionStore;
  /** MCP seams; presence of `select` plus `transports` advertises mcpCapabilities per transport. */
  readonly mcp?: AcpMcpSeams;
  /** Capability policy seams (prompt media/embedded gates). */
  readonly capabilities?: AcpCapabilitiesOptions;
  /** Host mode table; presence returns `modes` on new/load/resume and enables `session/set_mode`. */
  readonly modes?: AcpModesSeam;
  /** Host config-option table; returned only when the client advertised session.configOptions.boolean. */
  readonly configOptions?: AcpConfigOptionsSeam;
  /** Client-method adapter seams (filesystem/terminals), gated on client advertisements. */
  readonly coding?: AcpCodingSeams;
}

export interface ActiveSession extends AcpSessionBinding {
  controller?: AbortController;
  /** Current mode id when `modes` is wired; set at registration and on set_mode. */
  modeId?: string;
  /** Current config-option values (initialized from defaults when `configOptions` is wired). */
  readonly configValues: Map<string, boolean | string>;
  /** Client of the active prompt stream; set only while forward() runs. */
  client?: AgentContext;
  /** Shared per-run notification budget; lifecycle updates count against it. */
  budget?: AcpStreamBudget;
  /** Host-bound ownership at registration (phase 18 Task 2 persistence). */
  ownership?: OwnershipScope;
  /** Working directory at registration (phase 18 Task 2 persistence). */
  cwd?: string;
  /** Policy-checked additional roots at registration (phase 18 Task 2 persistence). */
  additionalDirectories?: readonly string[];
}

export type ElicitationPendingDecision = PendingDecision & { readonly kind: "elicitation" };

export interface AcpStreamBudget {
  events: number;
  bytes: number;
}

/** Builds a stable ACP v1 agent using Prism sessions and durable-resume streams. */
