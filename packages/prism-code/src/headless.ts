import {
  type AgentIdentity,
  AgentRunError,
  type AgentRunResult,
  type AgentSession,
  type AgentSessionConfig,
  type AIProvider,
  createLoadSkillTool,
  createSkillRegistry,
  type ExecutionPolicy,
  type OwnershipScope,
  type ToolDefinition,
  type TrustPolicy,
} from "@arnilo/prism";
import {
  type AgentSdkConfig,
  type AgentSdkDefinition,
  assembleSkillsPlane,
  barePreset,
  codingPreset,
  defineAgent,
  mergeAgentConfig,
} from "@arnilo/prism-agent-sdk";
import {
  type AskUserDecisionHandler,
  createAskUserDecisionTool,
  createCodingCheckTool,
  createTodoContinuationStopHook,
  createTodoWriteTool,
  type TodoContinuationStopHook,
} from "@arnilo/prism-coding-tools/agent";
import { createPrismCodeApprovalPolicy, resolvePrismCodeApprovalMode } from "./approval.js";
import { resolvePrismCodeCompaction, resolvePrismCodeContextBudget, resolvePrismCodeToolResultFold } from "./compaction.js";
import type { PrismCodeConfig } from "./config.js";
import { PrismCodeCredentialManager } from "./credentials.js";
import { resolvePrismHome } from "./home.js";
import { createCostTurnPolicy, resolveContinueOnOpenTodos, resolvePrismCodeLimits, resolvePrismCodeLoop } from "./limits.js";
import { type McpTrustContext, resolveMcpServers } from "./mcp.js";
import { ObservationalMemoryCoordinator } from "./observational-memory.js";
import { createEnvironmentContextProvider, resolvePrismCodeInstructions } from "./prompt.js";
import { createProviderCache, enrichModelConfig, type ProviderCache } from "./providers.js";
import {
  deriveSessionTitle,
  ensureDurableSessionRecord,
  getCanonicalWorkspaceRoot,
  resolveContinueSessionId,
  resolveSessionStore,
  sessionRecordExists,
  setSessionTitle,
} from "./sessions.js";
import { createSkillCommands, findRepoRoot, resolveSkillRoots } from "./skills.js";
import { loadReplacementToolModules, loadToolModules } from "./tool-modules.js";
import { NO_INTERACTIVE_ASK_USER_MESSAGE, resolvePrismCodeChecks } from "./tools.js";
import { resolveWebTools, type WebToolResolution } from "./web.js";
import { resolveWikiContributions, type WikiContributions } from "./wiki.js";

export interface WritableSink {
  write(chunk: string): boolean | undefined;
}

export interface HeadlessOptions {
  readonly config: PrismCodeConfig;
  readonly prompt: string;
  readonly mode?: "print" | "json";
  readonly sessionId?: string;
  /** `--continue`: resume the most recent session for the configured repository root. */
  readonly continueRecent?: boolean;
  readonly stdout?: WritableSink;
  readonly stderr?: WritableSink;
  readonly provider?: AIProvider;
  readonly credentialManager?: PrismCodeCredentialManager;
  /** `deny` (default) refuses approval-required calls; `edits` allows in-repo edits; `all` allows everything but hard denies. */
  readonly approve?: "deny" | "edits" | "all";
  /** Prism home for the persisted permissions file; defaults to `PRISM_HOME`/`~/.prism`. */
  readonly home?: string;
  /** Project MCP server trust (`--trust-project-mcp` or the default skip); notes go to stderr. */
  readonly mcpTrust?: Omit<McpTrustContext, "notify">;
}

/** Host UI bindings the assembled agent needs at run time (picker for `ask_user_decision`). */
export interface AppHostBindings {
  readonly askUser?: AskUserDecisionHandler;
  /** MCP trust resolution context (TUI prompt, headless skip/allow); omitted means all servers are trusted. */
  readonly mcpTrust?: McpTrustContext;
}

export async function assembleAppAgent(
  config: PrismCodeConfig,
  overrideProvider?: AIProvider,
  executionPolicy?: ExecutionPolicy,
  omCoordinator?: ObservationalMemoryCoordinator,
  credentialManager?: PrismCodeCredentialManager,
  providerCache?: ProviderCache,
  trust?: TrustPolicy,
  hostBindings?: AppHostBindings,
): Promise<AgentSdkDefinition> {
  const credentials = credentialManager ?? new PrismCodeCredentialManager();
  const sessionModel = config.model ?? { provider: "mock", model: "default" };

  // One provider per provider id for the whole process; the agent gets a resolver, not a fixed
  // instance, so RunOptions.model/providerSource can switch provider between runs.
  const cache =
    providerCache ??
    createProviderCache({
      credentialRef: config.credentialRef,
      resolver: credentials.createResolver(),
      credentialManager: credentials,
    });

  if (overrideProvider) {
    // Host-supplied instance wins for the configured model and for its own id.
    cache.seed(sessionModel.provider, overrideProvider);
    cache.seed(overrideProvider.id, overrideProvider);
  } else {
    // Fail closed at assembly: an unusable provider surfaces before any session exists.
    await cache.prime(sessionModel);
  }

  // 1. Session Store Resolution
  const store = resolveSessionStore(config);

  const coordinator =
    omCoordinator ??
    new ObservationalMemoryCoordinator({
      config,
      store,
      credentialManager: credentials,
      providerResolver: (model) => cache.prime(model),
    });

  // 2. MCP servers: trust-gate project declarations, resolve header references, build OAuth options
  // and report skips through the host surface. Untrusted/failed declarations stay in the list as
  // `disabled`/`failed` stubs so status stays a single source of truth.
  const mcpResolution = await resolveMcpServers({
    servers: config.mcp?.servers,
    origins: hostBindings?.mcpTrust?.origins,
    mode: hostBindings?.mcpTrust?.mode,
    home: hostBindings?.mcpTrust?.home,
    workspaceRoot: getCanonicalWorkspaceRoot(config.cwd),
    promptTrust: hostBindings?.mcpTrust?.promptTrust,
    credentialManager: credentials,
  });
  for (const note of mcpResolution.notes) hostBindings?.mcpTrust?.notify?.(note);

  // 3. Optional web plane + wiki extension (both inert when unconfigured/disabled)
  const web = await resolveWebTools(config, credentials);
  const wiki = await resolveWikiContributions(config, { webTools: web.tools });

  // 4. Custom User Tools
  const addTools = await loadToolModules(config.tools?.add ?? [], config.cwd, {
    allowList: config.tools?.allowedModules,
    workspaceRoot: config.cwd,
  });

  const replaceTools = await loadReplacementToolModules(config.tools?.replace ?? {}, config.cwd, {
    allowList: config.tools?.allowedModules,
    workspaceRoot: config.cwd,
  });

  // 5. Base Preset & Opt-in tools
  const optIns = new Set(config.tools?.optIn ?? []);
  const gitEnabled = config.tools?.planes?.git === true || optIns.has("git");
  const codingPlaneEnabled = config.tools?.planes?.coding !== false;
  const basePreset = codingPlaneEnabled
    ? codingPreset({
        cwd: config.cwd,
        planes: {
          coding: true,
          git: gitEnabled,
        },
        permissions: executionPolicy,
      })
    : barePreset();

  const optInTools: ToolDefinition[] = [];
  if (config.tools?.planes?.askUser !== false) {
    optInTools.push(
      createAskUserDecisionTool({
        ask:
          hostBindings?.askUser ??
          (async (): Promise<never> => {
            throw new Error(NO_INTERACTIVE_ASK_USER_MESSAGE);
          }),
      }),
    );
  }
  const declaredChecks = resolvePrismCodeChecks(config.checks);
  if (config.tools?.planes?.checks !== false && Object.keys(declaredChecks).length > 0) {
    optInTools.push(createCodingCheckTool(config.cwd, { checks: declaredChecks, executionPolicy }));
  }

  // Task-completion continuation (plan 137 Task 7): default on; `loop.continueOnOpenTodos: false`
  // disables both the planning tool and the stop hook.
  const continueOnOpenTodos = resolveContinueOnOpenTodos(config.loop);
  const todoWriteTool = continueOnOpenTodos ? createTodoWriteTool() : undefined;
  const todoStopHook: TodoContinuationStopHook | undefined = continueOnOpenTodos ? createTodoContinuationStopHook() : undefined;

  // 6. Skills Plane Resolution
  const repoRoot = findRepoRoot(config.cwd);
  const skillRoots = resolveSkillRoots(config, undefined, repoRoot);
  const disclosure = config.skills?.disclosure ?? "progressive";
  const assembledSkills = await assembleSkillsPlane({
    roots: skillRoots,
    exclude: config.skills?.exclude,
    add: wiki.skills,
    disclosure,
    activateAll: true,
  });

  const loadSkillTool =
    disclosure !== "eager" ? createLoadSkillTool({ registry: assembledSkills.skills ?? createSkillRegistry([]) }) : undefined;

  const skillCommands = createSkillCommands(config);

  const envContextProvider = createEnvironmentContextProvider({
    repoRoot,
    cwd: config.cwd,
    model: sessionModel,
  });
  const instructionsPlaneConfig = resolvePrismCodeInstructions({ config, repoRoot });
  const resolvedLimits = resolvePrismCodeLimits(config.limits);
  const resolvedLoop = resolvePrismCodeLoop(config.loop);
  const resolvedCompaction = resolvePrismCodeCompaction(config.compaction, sessionModel, cache);
  const resolvedToolResultFold = resolvePrismCodeToolResultFold();
  const resolvedContextBudget = resolvePrismCodeContextBudget(sessionModel);

  // Local single-user host identity. Durable tool effects (`edit`, `write`, `delete`, `move`) fail
  // closed without a verified identity, so the TUI/headless assembly asserts one for the local
  // operator exactly like the ACP surface does; a host embedding Prism can override it by setting
  // their own identity on the agent config.
  const localUserId = config.userId ?? "local";
  const ownership: OwnershipScope = { userId: localUserId };
  const identity: AgentIdentity = {
    tenantId: "local",
    userId: localUserId,
    principal: { kind: "user", id: localUserId },
    scopes: ["coding"],
    issuedAt: new Date().toISOString(),
    verified: true,
  };

  // 7. Merge Configuration
  const agentSdkConfig = mergeAgentConfig(basePreset, {
    providerSource: (model) => cache.get(model),
    model: sessionModel,
    workspaceRoot: repoRoot,
    trust,
    store,
    ownership,
    identity,
    limits: resolvedLimits,
    ...(resolvedLoop ? { loop: resolvedLoop } : {}),
    compaction: resolvedCompaction,
    toolResultFold: resolvedToolResultFold,
    contextBudget: resolvedContextBudget,
    context: [coordinator.createDelegatingContextProvider(), envContextProvider],
    tools: {
      exclude: config.tools?.exclude ?? [],
      add: [
        ...addTools,
        ...optInTools,
        ...web.tools,
        ...wiki.tools,
        ...(loadSkillTool ? [loadSkillTool] : []),
        ...(todoWriteTool ? [todoWriteTool] : []),
        coordinator.createRecallTool(store),
      ],
      replace: replaceTools,
    },
    skills: {
      registry: assembledSkills.skills,
      disclosure,
      activateAll: true,
    },
    instructions: instructionsPlaneConfig,
    hooks: config.hooks?.file ? { file: config.hooks.file } : undefined,
    mcp: config.mcp
      ? {
          servers: mcpResolution.servers,
          ...(executionPolicy ? { executionPolicy } : {}),
        }
      : undefined,
    commands: [...skillCommands, ...wiki.commands],
  });

  const definition = await defineAgent(agentSdkConfig as AgentSdkConfig);
  (definition as any).omCoordinator = coordinator;
  (definition as any).providerCache = cache;
  (definition as any).webResolution = web;
  (definition as any).wikiContributions = wiki;
  (definition as any).skillRoots = skillRoots;
  (definition as any).repoRoot = repoRoot;
  (definition as any).limits = resolvedLimits;
  (definition as any).loop = resolvedLoop;
  (definition as any).compaction = resolvedCompaction;
  (definition as any).toolResultFold = resolvedToolResultFold;
  (definition as any).contextBudget = resolvedContextBudget;
  // TUI surfaces the no-progress stop as a system note through this hook instance.
  (definition as any).todoStopHook = todoStopHook;

  const originalCreateSession = definition.createSession.bind(definition);
  definition.createSession = (sessionConfig?: AgentSessionConfig): AgentSession => {
    const session = originalCreateSession(sessionConfig);
    const originalRun = session.run.bind(session);
    session.run = async (prompt, runOptions) => {
      let finalRunOpts = runOptions;
      // Every run model carries limits: Prism Code's own compaction trigger resolves the model's
      // input cap, and a per-run model switch can hand core a bare `{ provider, model }`. The static
      // catalog (or the conservative assumed limits) is the same source the footer and TUI use.
      if (finalRunOpts?.model) {
        finalRunOpts = { ...finalRunOpts, model: (await enrichModelConfig(finalRunOpts.model)).model };
      }
      if (resolvedLimits.maxCost) {
        const costPolicy = createCostTurnPolicy(resolvedLimits.maxCost);
        if (costPolicy) {
          finalRunOpts = {
            ...runOptions,
            turnPolicy: runOptions?.turnPolicy
              ? {
                  ...runOptions.turnPolicy,
                  stop: (ctx) => {
                    const decision = costPolicy.stop ? costPolicy.stop(ctx) : { action: "continue" as const };
                    if (decision.action === "stop") return decision;
                    return runOptions.turnPolicy?.stop ? runOptions.turnPolicy.stop(ctx) : { action: "continue" };
                  },
                }
              : costPolicy,
          };
        }
      }
      if (todoStopHook) {
        finalRunOpts = {
          ...finalRunOpts,
          stopHooks: [...(finalRunOpts?.stopHooks ?? []), todoStopHook],
        };
      }
      try {
        return await originalRun(prompt, finalRunOpts);
      } catch (err) {
        if (err instanceof AgentRunError && err.result.limit?.limit === "maxCost") {
          return {
            ...err.result,
            status: "succeeded",
            stopReason: "host_policy",
            stopDetail: "max_cost",
            finishReason: "host_policy",
          };
        }
        throw err;
      }
    };
    return session;
  };

  return definition;
}

export async function runHeadless(options: HeadlessOptions): Promise<number> {
  const mode = options.mode ?? "print";
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const config = options.config;

  // Session resume check: in-memory store cannot resume sessions
  if ((options.sessionId || options.continueRecent) && config.store?.type === "memory") {
    const message = 'store "memory" does not support session resumption via --session';
    if (mode === "json") {
      stdout.write(`${JSON.stringify({ type: "error", error: { message } })}\n`);
    } else {
      stderr.write(`prism-code: ${message}\n`);
    }
    return 1;
  }

  const writeHeadlessError = (message: string): 1 => {
    if (mode === "json") {
      stdout.write(`${JSON.stringify({ type: "error", error: { message } })}\n`);
    } else {
      stderr.write(`prism-code: ${message}\n`);
    }
    return 1;
  };

  // Approval: `deny`/`edits` map onto ask/accept-edits with a refusing prompt; `all` is auto.
  // The footer/mode is host-only; headless never prompts, so a refusal is definite.
  const approvalMode =
    options.approve === "all" ? "auto" : options.approve === "edits" ? "accept-edits" : resolvePrismCodeApprovalMode(config.approval);
  let refused = false;
  const approval = createPrismCodeApprovalPolicy({
    roots: [config.cwd],
    cwd: config.cwd,
    home: options.home ?? resolvePrismHome(),
    mode: approvalMode === "auto" ? "auto" : approvalMode === "accept-edits" ? "accept-edits" : "ask",
    ...(config.approval?.timeoutMs !== undefined ? { timeoutMs: config.approval.timeoutMs } : {}),
    prompt: async () => {
      refused = true;
      return "deny";
    },
    onDenied: () => {
      refused = true;
    },
  });

  let assembled: AgentSdkDefinition | undefined;
  try {
    assembled = await assembleAppAgent(
      config,
      options.provider,
      approval.policy,
      undefined,
      options.credentialManager,
      undefined,
      undefined,
      options.mcpTrust
        ? {
            mcpTrust: {
              ...options.mcpTrust,
              notify: (text: string) => stderr.write(`prism-code: ${text}\n`),
            },
          }
        : undefined,
    );

    // Explicit web config with an unavailable backend is surfaced, never silently broken.
    if (config.web !== undefined) {
      const webResolution = (assembled as any).webResolution as WebToolResolution | undefined;
      for (const note of webResolution?.notes ?? []) {
        stderr.write(`prism-code: ${note}\n`);
      }
    }

    const store = assembled.agent.config.store ?? resolveSessionStore(config, options.home);
    let sessionId = options.sessionId;
    if (options.continueRecent) {
      try {
        sessionId = await resolveContinueSessionId(store, config.cwd);
      } catch (error) {
        return writeHeadlessError(error instanceof Error ? error.message : String(error));
      }
      if (!sessionId) return writeHeadlessError("no prior sessions for this repository.");
    }
    if (sessionId !== undefined && !(await sessionRecordExists(store, sessionId))) {
      return writeHeadlessError(`session not found: ${sessionId}`);
    }

    const session = assembled.createSession({
      id: sessionId,
      metadata: {
        workspaceRoot: config.cwd,
        userId: config.userId ?? "local",
      },
    });

    await ensureDurableSessionRecord(store, session.id, config.cwd, {
      userId: config.userId,
    });

    // First prompt names the session (display-only; never blocks the run).
    const redactor = assembled.agent.config.redactor;
    const title = deriveSessionTitle(redactor ? redactor.redact(options.prompt) : options.prompt);
    if (title) {
      await setSessionTitle(store, session.id, title, { onlyIfUnset: true }).catch(() => {});
    }

    const coordinator: ObservationalMemoryCoordinator | undefined = (assembled as any).omCoordinator;
    const sessionModel = config.model ?? { provider: "mock", model: "default" };
    const sessionToRun = coordinator ? await coordinator.getActiveSession(session, sessionModel, store) : session;

    let textWritten = false;
    let hasRunFailure = false;

    // Subscribe to event stream
    const eventPromise = (async () => {
      for await (const event of session.subscribe()) {
        if (mode === "json") {
          const payload = JSON.stringify({
            type: "event",
            sessionId: event.sessionId,
            runId: "runId" in event ? event.runId : undefined,
            event,
          });
          stdout.write(`${payload}\n`);
        } else if (event.type === "message_delta" && event.content.type === "text") {
          stdout.write(event.content.text);
          textWritten = true;
        } else if (event.type === "agent_denied" || event.type === "run_limit_exceeded" || event.type === "budget_exhausted") {
          hasRunFailure = true;
        }
      }
    })();

    let result: AgentRunResult;
    const wikiContributions = (assembled as any).wikiContributions as WikiContributions | undefined;
    const runOptions =
      wikiContributions && wikiContributions.instructionInjectors.length > 0
        ? { instructionInjectors: wikiContributions.instructionInjectors }
        : undefined;
    let signalExitCode: number | undefined;
    const onSigint = () => {
      signalExitCode = 130;
      session.abort(new Error("SIGINT"));
      if (sessionToRun !== session && typeof (sessionToRun as any).abort === "function") {
        (sessionToRun as any).abort(new Error("SIGINT"));
      }
    };
    const onSigterm = () => {
      signalExitCode = 143;
      session.abort(new Error("SIGTERM"));
      if (sessionToRun !== session && typeof (sessionToRun as any).abort === "function") {
        (sessionToRun as any).abort(new Error("SIGTERM"));
      }
    };
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    try {
      result = await sessionToRun.run(options.prompt, runOptions);
    } catch (runErr) {
      await eventPromise.catch(() => {});
      if (signalExitCode !== undefined) {
        await ensureDurableSessionRecord(store, session.id, config.cwd, {
          userId: config.userId,
        }).catch(() => {});
        return signalExitCode;
      }
      throw runErr;
    } finally {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
    await eventPromise;

    if (signalExitCode !== undefined) {
      await ensureDurableSessionRecord(store, session.id, config.cwd, {
        userId: config.userId,
      }).catch(() => {});
      return signalExitCode;
    }

    if (mode === "print") {
      if (!textWritten && result.text) {
        stdout.write(result.text);
        textWritten = true;
      }
      if (textWritten) {
        stdout.write("\n");
      }
    }

    if (hasRunFailure || result.status !== "succeeded") {
      return 1;
    }
    // A refused approval is an operator-visible policy outcome even when the model recovers.
    if (refused) return 1;

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mode === "json") {
      stdout.write(`${JSON.stringify({ type: "error", error: { message } })}\n`);
    } else {
      stderr.write(`prism-code: ${message}\n`);
    }
    return 1;
  } finally {
    if (assembled) {
      await assembled.dispose();
    }
  }
}
