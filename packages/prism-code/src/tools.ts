import type { ExecutionPolicy, ToolDefinition } from "@arnilo/prism";
import {
  type AskUserDecisionHandler,
  createAskUserDecisionTool,
  createCodingCheckTool,
  createCodingTools,
  createGitTools,
  createReadOnlyTools,
  createTodoWriteTool,
  type NamedCheckDefinition,
  type ToolsOptions,
} from "@arnilo/prism-coding-tools/agent";
import type { PrismCodeChecksConfig, PrismCodeConfig } from "./config.js";
import { resolveContinueOnOpenTodos } from "./limits.js";

/** Model-facing result when no interactive user exists (headless/print): guidance, never a fake choice. */
export const NO_INTERACTIVE_ASK_USER_MESSAGE = "no interactive user available; proceed with your best judgment and state the assumption";

/** JSON `checks` config → the coding-tools named-check map (`command` is the executable). */
export function resolvePrismCodeChecks(checks?: PrismCodeChecksConfig): Record<string, NamedCheckDefinition> {
  const resolved: Record<string, NamedCheckDefinition> = {};
  for (const [name, check] of Object.entries(checks ?? {})) {
    resolved[name] = {
      file: check.command,
      args: check.args ? [...check.args] : [],
      ...(check.cwd ? { cwd: check.cwd } : {}),
      ...(check.env ? { env: { ...check.env } } : {}),
      ...(check.timeoutMs !== undefined ? { timeoutMs: check.timeoutMs } : {}),
    };
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Bundled Tool Inventory Types
// ---------------------------------------------------------------------------

export type ToolCategory = "core" | "git" | "decision" | "check" | "plan";

export interface BundledToolDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defaultOn: boolean;
  readonly category: ToolCategory;
}

/**
 * Shipped tool inventory from @arnilo/prism-coding-tools/agent.
 * The core 9 tools and `todo_write` are defaultOn: true; `ask_user_decision` is default-on with a
 * host handler; `coding_check` requires config-declared checks; git tools are opt-in.
 */
export const BUNDLED_CODING_TOOLS: readonly BundledToolDescriptor[] = [
  // Core 9
  { id: "shell", name: "shell", description: "Execute shell commands in the workspace", defaultOn: true, category: "core" },
  { id: "read", name: "read", description: "Read file contents and inspect text files", defaultOn: true, category: "core" },
  { id: "write", name: "write", description: "Create or overwrite files in the workspace", defaultOn: true, category: "core" },
  { id: "edit", name: "edit", description: "Perform structured edits on files", defaultOn: true, category: "core" },
  { id: "repo_list", name: "repo_list", description: "List files and directories in repository", defaultOn: true, category: "core" },
  {
    id: "repo_search",
    name: "repo_search",
    description: "Search for strings or patterns in repository",
    defaultOn: true,
    category: "core",
  },
  { id: "glob", name: "glob", description: "Match files using glob patterns", defaultOn: true, category: "core" },
  { id: "delete", name: "delete", description: "Delete files safely within workspace", defaultOn: true, category: "core" },
  { id: "move", name: "move", description: "Move or rename files safely within workspace", defaultOn: true, category: "core" },
  // Opt-in Git tools (7 tools)
  { id: "git_status", name: "git_status", description: "Inspect working tree git status", defaultOn: false, category: "git" },
  { id: "git_diff", name: "git_diff", description: "View git diff for working tree or commits", defaultOn: false, category: "git" },
  { id: "git_commit", name: "git_commit", description: "Record changes to the repository", defaultOn: false, category: "git" },
  { id: "git_apply", name: "git_apply", description: "Apply unified diff patches to repository", defaultOn: false, category: "git" },
  { id: "git_branch", name: "git_branch", description: "List, create, or switch git branches", defaultOn: false, category: "git" },
  { id: "git_worktree", name: "git_worktree", description: "Manage multiple working trees", defaultOn: false, category: "git" },
  { id: "git_pr_handoff", name: "git_pr_handoff", description: "Prepare PR handoff summaries", defaultOn: false, category: "git" },
  // Default-on user decision tool (read-only result; host picker or headless guidance)
  {
    id: "ask_user_decision",
    name: "ask_user_decision",
    description: "Prompt user for interactive decisions",
    defaultOn: true,
    category: "decision",
  },
  // Requires config-declared named commands; otherwise not registered
  { id: "coding_check", name: "coding_check", description: "Run automated coding checks and linters", defaultOn: false, category: "check" },
  // Default-on planning tool (plan 137 Task 7)
  { id: "todo_write", name: "todo_write", description: "Track task progress with a todo list", defaultOn: true, category: "plan" },
];

export const CORE_CODING_TOOL_NAMES = new Set(["shell", "read", "write", "edit", "repo_list", "repo_search", "glob", "delete", "move"]);

export const GIT_TOOL_NAMES = new Set([
  "git_status",
  "git_diff",
  "git_commit",
  "git_apply",
  "git_branch",
  "git_worktree",
  "git_pr_handoff",
]);

// ---------------------------------------------------------------------------
// Tool Assembly & Opt-in Resolution
// ---------------------------------------------------------------------------

export interface ResolveCodingToolsOptions {
  readonly cwd: string;
  readonly config?: PrismCodeConfig;
  readonly permissions?: ExecutionPolicy;
  readonly replaceTools?: Readonly<Record<string, ToolDefinition>>;
  readonly addTools?: readonly ToolDefinition[];
  readonly toolOptions?: ToolsOptions;
  readonly isReadOnly?: boolean;
  readonly askUserHandler?: AskUserDecisionHandler;
  readonly checks?: Readonly<Record<string, NamedCheckDefinition>>;
}

/**
 * Resolves the active tool set for Prism Code:
 * 1. Base tools: 9 core tools if coding plane is enabled (or 4 read-only tools if isReadOnly: true).
 * 2. Default-on: `todo_write` and `ask_user_decision` (ask uses the host handler, or the headless
 *    guidance message when none is supplied).
 * 3. Conditional: `coding_check` only when host-declared checks exist; git tools only when opted in.
 * 4. Exclude: drops any tools named in config.tools.exclude.
 * 5. Replace: replaces tools with custom replacements from config.tools.replace.
 * 6. Add: appends additional custom tools from config.tools.add.
 */
export function resolveCodingToolSet(options: ResolveCodingToolsOptions): ToolDefinition[] {
  const { cwd, config, permissions, isReadOnly = false } = options;
  const toolOptions: ToolsOptions = {
    ...options.toolOptions,
    executionPolicy: permissions ?? options.toolOptions?.executionPolicy,
  };

  const planes = config?.tools?.planes;
  const optIns = new Set(config?.tools?.optIn ?? []);
  const codingPlaneEnabled = planes?.coding !== false;

  let tools: ToolDefinition[] = [];

  if (isReadOnly) {
    tools.push(...createReadOnlyTools(cwd, toolOptions));
  } else if (codingPlaneEnabled) {
    tools.push(...createCodingTools(cwd, toolOptions));
    // Task-completion continuation planning tool (plan 137 Task 7), default on.
    if (resolveContinueOnOpenTodos(config?.loop)) {
      tools.push(createTodoWriteTool());
    }
  }

  // Opt-in Git tools
  const gitOptedIn = planes?.git === true || optIns.has("git");
  if (gitOptedIn && !isReadOnly) {
    tools.push(...createGitTools(cwd, toolOptions));
  }

  // Default-on Ask User Decision tool; a missing handler is the headless guidance path.
  const askUserEnabled = planes?.askUser !== false;
  if (askUserEnabled && !isReadOnly) {
    const askHandler =
      options.askUserHandler ??
      (async (): Promise<never> => {
        throw new Error(NO_INTERACTIVE_ASK_USER_MESSAGE);
      });
    tools.push(createAskUserDecisionTool({ ask: askHandler }));
  }

  // Coding Check tool: registered only for config-declared named commands.
  const checks = options.checks ?? resolvePrismCodeChecks(config?.checks);
  if (planes?.checks !== false && !isReadOnly && Object.keys(checks).length > 0) {
    tools.push(createCodingCheckTool(cwd, { checks }));
  }

  // Apply replacements if provided
  if (options.replaceTools && Object.keys(options.replaceTools).length > 0) {
    tools = tools.map((tool) => options.replaceTools?.[tool.name] ?? tool);
  }

  // Apply exclusions
  const excludeSet = new Set(config?.tools?.exclude ?? []);
  if (excludeSet.size > 0) {
    tools = tools.filter((tool) => !excludeSet.has(tool.name));
  }

  // Append addTools
  if (options.addTools && options.addTools.length > 0) {
    tools.push(...options.addTools);
  }

  return tools;
}
