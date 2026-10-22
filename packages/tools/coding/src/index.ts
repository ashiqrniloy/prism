/**
 * `@arnilo/prism-tools-coding` — the first-party coding tools as a package.
 *
 * The default export registers the file, search, and shell tools (`read`, `write`, `edit`, `grep`,
 * `glob`, `shell` with `shell_output`, plus `delete`/`move` when the shell is unavailable, or the
 * read subset with `readOnly: true`), the
 * structured git tools, `coding_check` when checks are configured, `todo_write` with its `run.end`
 * continuation, and `ask_user_decision` over `host.ui`.
 *
 * Root escapes, read-only violations, and configured `commandRules` denies are hard-denied through
 * one `tool.call` decide handler, so they hold under any approval mode or host `allow` hook. A
 * durable-effect tool fails closed without a host principal. The `coding.targets` service reports the
 * paths and roots of each own-tool call for approval.
 *
 * ```ts
 * import toolsCoding from "@arnilo/prism-tools-coding";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({ model, packages: [toolsCoding({ root: process.cwd() })] });
 * ```
 */

import { resolve } from "node:path";
import { definePackage, type PackageInstance, type ToolDefinition } from "@arnilo/prism";
import manifest from "../package.json" with { type: "json" };
import { createAskUserDecisionTool } from "./agent/ask-user-decision.js";
import { createCodingCheckTool } from "./agent/checks.js";
import { createDiagnosticsTool, type DiagnosticsToolHandle } from "./agent/diagnostics-tool.js";
import type { ForgeCredentialResolverSource } from "./agent/forge/index.js";
import { createGitTools } from "./agent/git-tools.js";
import { createCodingTools, createReadOnlyTools, type ProcessSandboxBackend, type ToolsOptions } from "./agent/index.js";
import { getShellConfig } from "./agent/shell.js";
import { createBackgroundProcesses } from "./agent/shell-background.js";
import { createTodoContinuationDecision, createTodoWriteTool } from "./agent/todo.js";
import { createAskUserHostHook } from "./ask-user-host.js";
import { type ToolsCodingCommandRule, type ToolsCodingConfig, toolsCodingConfigSchema } from "./config.js";
import { createHardDenyHook } from "./hard-deny.js";
import { withDurablePrincipal } from "./principal-guard.js";
import { type CodingSandboxKind, selectCodingSandbox } from "./sandbox.js";
import { type CommandRule } from "./security/command-rules.js";
import { createEgressPolicy } from "./security/egress/index.js";
import { createCodingTargets } from "./targets.js";
import { createWorkspaceService, createWorktreeRouting, type WorkspaceService, WorkspaceServiceError } from "./workspace/index.js";

// The moved agent and security surfaces keep their names, now behind one entry point.
export * from "./agent/index.js";
export { type AskUserHostHookOptions, createAskUserHostHook } from "./ask-user-host.js";
export type {
  ToolsCodingCommandRule,
  ToolsCodingConfig,
  ToolsCodingEgressConfig,
  ToolsCodingEgressRule,
  ToolsCodingForgeConfig,
  ToolsCodingGitConfig,
  ToolsCodingLanguageConfig,
  ToolsCodingLanguageServerConfig,
  ToolsCodingPrincipalConfig,
  ToolsCodingRepositoryConfig,
  ToolsCodingShellConfig,
  ToolsCodingTodoConfig,
  ToolsCodingWorkspaceConfig,
} from "./config.js";
export { toolsCodingConfigSchema } from "./config.js";
export { createHardDenyHook, type HardDenyOptions } from "./hard-deny.js";
export {
  durablePrincipalError,
  ERR_PRISM_CODING_PRINCIPAL_MISMATCH,
  ERR_PRISM_CODING_PRINCIPAL_REQUIRED,
  isDurableCall,
  withDurablePrincipal,
} from "./principal-guard.js";
export { type CodingSandboxKind, type SelectedCodingSandbox, selectCodingSandbox } from "./sandbox.js";
export * from "./security/index.js";
export { CODING_TOOL_NAMES, type CodingTargets, type CodingTargetsFn, createCodingTargets } from "./targets.js";
export * from "./workspace/index.js";

function toCommandRules(rules: readonly ToolsCodingCommandRule[] | undefined): readonly CommandRule[] {
  return (rules ?? []).map((rule) => ({
    pattern: rule.match,
    action: rule.decision,
    ...(rule.reason !== undefined ? { reason: rule.reason } : {}),
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The `coding.forge` service: a ref-only credential source a forge adapter resolves per call. */
export interface CodingForgeService {
  readonly name: string;
  readonly resolver: ForgeCredentialResolverSource["resolver"];
}

const definition = definePackage<ToolsCodingConfig>({
  name: "@arnilo/prism-tools-coding",
  version: manifest.version,
  description:
    "File, search, shell, git, check, todo, and ask-user coding tools with declared effects, in-tool containment, and tool.call hard denies.",
  requires: { api: 1 },
  capabilities: ["host-ui", "credentials"],
  config: toolsCodingConfigSchema,
  setup: async (prism) => {
    const root = prism.config.root;
    if (typeof root !== "string" || root.length === 0) {
      throw new Error("prism-tools-coding: config needs root (the workspace root the file tools operate in)");
    }
    const readOnly = prism.config.readOnly === true;
    const commandRules = toCommandRules(prism.config.commandRules);
    const sandbox: CodingSandboxKind = prism.config.sandbox ?? "none";
    const principalId = prism.config.principal?.id;

    if (prism.config.egress !== undefined) {
      try {
        createEgressPolicy({
          allow: prism.config.egress.allow?.map((rule) => ({
            host: rule.host,
            port: rule.port,
            protocol: rule.protocol ?? "https",
            ...(rule.allowPrivate !== undefined ? { allowPrivate: rule.allowPrivate } : {}),
          })),
          presets: prism.config.egress.presets,
        });
      } catch (error) {
        throw new Error(`prism-tools-coding: invalid egress config: ${errorMessage(error)}`);
      }
      if (sandbox === "none") {
        prism.status.note("warn", "egress config has no effect without a sandbox backend");
      }
    }

    const options: ToolsOptions = {};
    if (prism.config.repository !== undefined) options.repository = prism.config.repository;
    if (prism.config.shell?.timeoutMs !== undefined) options.shell = { timeout: prism.config.shell.timeoutMs / 1000 };

    let toolRoot = resolve(root);
    let shellAvailable = prism.config.shell?.enabled !== false;
    let sandboxTools: readonly ToolDefinition[] | undefined;
    let processBackend: ProcessSandboxBackend | undefined;

    if (sandbox !== "none") {
      const selected = await selectCodingSandbox(sandbox, { root, repository: prism.config.repository, readOnly });
      if (selected.tools !== undefined) {
        sandboxTools = selected.tools;
        toolRoot = selected.toolRoot;
        processBackend = selected.processes;
      } else {
        for (const warning of selected.warnings) prism.status.note("warn", warning);
        shellAvailable = false;
      }
    }

    // `delete`/`move` are the no-shell substitutes (plan 189 Task 8), so the set depends on this.
    options.shellAvailable = shellAvailable;

    // Background processes (plan 189 Task 9): one lazy runtime shared by every worktree's tool set.
    // Nothing is constructed in the process library until the first background call.
    const background =
      shellAvailable && !readOnly && (sandbox === "none" || processBackend !== undefined)
        ? createBackgroundProcesses({
            maxProcesses: prism.config.shell?.background?.maxProcesses,
            shell: getShellConfig(),
            ...(processBackend !== undefined ? { sandbox: processBackend } : {}),
          })
        : undefined;
    if (background !== undefined) options.shell = { ...(options.shell ?? {}), background };

    // `diagnostics` (plan 189 Task 10): opt-in, one language workspace per cwd, servers start on the
    // first call. Handles stay in the map so a disposed tool can start its servers again.
    const languageServers = prism.config.language?.servers;
    const diagnosticsEnabled = languageServers !== undefined && Object.keys(languageServers).length > 0;
    if (diagnosticsEnabled && sandbox !== "none") {
      prism.status.note("warn", "language servers run on the host, outside the sandbox");
    }
    const diagnosticsByCwd = new Map<string, DiagnosticsToolHandle>();
    const diagnosticsTool = (cwd: string): ToolDefinition => {
      let handle = diagnosticsByCwd.get(cwd);
      if (handle === undefined) {
        handle = createDiagnosticsTool(cwd, {
          servers: languageServers ?? {},
          onServerFailure: (server, message) => prism.status.note("warn", `language server ${server}: ${message}`),
        });
        diagnosticsByCwd.set(cwd, handle);
      }
      return handle.tool;
    };

    /**
     * The cwd-taking tools for one directory: `toolRoot` at setup, and once per worktree for a
     * session bound to one (plan 165 Task 7). A sandbox backend's own set is not per-cwd.
     */
    const cwdTools = (cwd: string): readonly ToolDefinition[] => {
      if (sandboxTools !== undefined) {
        return diagnosticsEnabled ? [...sandboxTools, diagnosticsTool(cwd)] : sandboxTools;
      }
      let set = readOnly ? createReadOnlyTools(cwd, options) : createCodingTools(cwd, options);
      // Git and checks can mutate, so read-only mode keeps exactly the four read tools.
      if (!readOnly) {
        if (prism.config.git?.enabled !== false) set = [...set, ...createGitTools(cwd, options)];
        if (prism.config.checks !== undefined && Object.keys(prism.config.checks).length > 0) {
          set = [...set, createCodingCheckTool(cwd, { checks: prism.config.checks })];
        }
      }
      if (!shellAvailable) set = set.filter((tool) => tool.name !== "shell");
      return diagnosticsEnabled ? [...set, diagnosticsTool(cwd)] : set;
    };

    let tools = cwdTools(toolRoot);

    // Todo and ask_user take no cwd, so they are registered once rather than once per worktree.
    if (!readOnly) {
      const todoEnabled = prism.config.todo?.enabled !== false;
      if (todoEnabled) tools = [...tools, createTodoWriteTool()];
      if (todoEnabled && prism.config.todo?.continueOnOpen !== false) {
        prism.hooks.on(
          "run.end",
          createTodoContinuationDecision({
            onNoProgressStop: (info) =>
              prism.events.emit("todo.no-progress-stop", { open: info.openTodos.length, noProgress: info.noProgress }),
          }),
          { id: "todo" },
        );
      }
      const ui = prism.host.ui;
      tools = [...tools, createAskUserDecisionTool({ ui })];
      prism.hooks.on("tool.call", createAskUserHostHook({ ui }), { id: "ask-user" });
    }

    let workspaceService: WorkspaceService | undefined;
    if (prism.config.workspace?.enabled !== false) {
      try {
        const workspace = await createWorkspaceService({
          root: toolRoot,
          sandboxed: sandbox !== "none",
          ...(prism.config.workspace?.worktreeRoot !== undefined ? { worktreeRoot: prism.config.workspace.worktreeRoot } : {}),
          ...(prism.config.workspace?.maxWorktrees !== undefined ? { maxWorktrees: prism.config.workspace.maxWorktrees } : {}),
          ...(prism.config.workspace?.diff !== undefined ? { diff: prism.config.workspace.diff } : {}),
        });
        workspaceService = workspace;
        prism.services.provide("workspace", workspace);
      } catch (error) {
        // Outside a git repository there is no worktree to hand out; say so and serve no service.
        if (error instanceof WorkspaceServiceError && error.code === "workspace_not_git") {
          prism.status.note("info", `workspace service unavailable: ${error.message}`);
        } else {
          throw error;
        }
      }
    }

    // Approval and the hard-deny hook follow the session's worktree, when it has one.
    const targets = createCodingTargets(toolRoot, prism.config.roots ?? [], workspaceService);
    prism.services.provide("coding.targets", targets);
    prism.hooks.on("tool.call", createHardDenyHook({ targets, readOnly, commandRules }), { id: "hard-deny" });

    // One routing wrapper at registration: a bound session's tools run in its worktree.
    const routing =
      workspaceService !== undefined && sandboxTools === undefined
        ? createWorktreeRouting({ base: tools, create: cwdTools, workspace: workspaceService })
        : undefined;
    if (routing !== undefined) {
      prism.hooks.on("session.closed", (event) => routing.forget(event.sessionId), { id: "workspace-routing" });
    }

    if (prism.config.forge !== undefined) {
      const ref = prism.config.forge.token;
      const service: CodingForgeService = {
        name: "github",
        resolver: {
          resolve: async () => await prism.credentials.resolve(ref),
        },
      };
      prism.services.provide("coding.forge", service);
    }

    if (diagnosticsEnabled) {
      const open = new Set<string>();
      prism.hooks.on(
        "session.opened",
        (event) => {
          open.add(event.sessionId);
        },
        { id: "language-open" },
      );
      prism.hooks.on(
        "session.closed",
        (event) => {
          open.delete(event.sessionId);
          if (open.size > 0) return;
          for (const handle of diagnosticsByCwd.values()) void handle.dispose();
        },
        { id: "language-servers" },
      );
    }

    let shellRegistered = false;
    for (const tool of routing?.tools ?? tools) {
      if (!shellAvailable && tool.name === "shell") continue;
      if (tool.name === "shell") shellRegistered = true;
      prism.tools.register(withDurablePrincipal(tool, principalId));
    }
    if (background !== undefined && shellRegistered) {
      // `shell_output` itself is part of the shell tool set; this is only the kill switch.
      prism.hooks.on("session.closed", (event) => background.killSession(event.sessionId), { id: "shell-background" });
    }
    if (sandbox === "none" && shellRegistered) {
      prism.status.note("warn", "shell runs on the host without a sandbox; pair it with @arnilo/prism-approval or set sandbox");
    }
  },
});

/** The package definition. Pass config through `packageConfig` or use {@link toolsCoding}. */
export default definition;

/** The package with config baked in, for `packages: [toolsCoding({ root })]`. */
export function toolsCoding(config: ToolsCodingConfig): PackageInstance {
  return definition(config);
}
