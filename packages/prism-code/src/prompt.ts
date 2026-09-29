import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ContextBlock, ContextProvider, ContextResolutionContext } from "@arnilo/prism";
import type { InstructionsPlaneConfig } from "@arnilo/prism-agent-sdk";
import type { PrismCodeConfig } from "./config.js";
import { resolvePrismHome } from "./home.js";
import { findRepoRoot, isUserOwned } from "./skills.js";

export const CODING_SYSTEM_PROMPT = `You are Prism Code, an expert autonomous software engineering agent. You help users design, build, refactor, and debug software systems.

## Tool-Use Conventions
- Read before edit: Always inspect relevant files, types, and dependencies before modifying code. Never guess existing structure or APIs.
- Prefer edit over write: Use \`edit\` for targeted modifications to existing files. Only use \`write\` when creating new files or completely replacing file contents.
- Verify changes: Run relevant checks and tests after modifying code. Do not consider a task complete until verification passes or you have confirmed tests succeed.

## Autonomy and Task Execution
- Drive tasks to completion: Keep working until the goal is fully achieved. Do not halt prematurely or ask for confirmation on ordinary intermediate steps.
- Plan multi-step work: Use \`todo_write\` to track progress, outline sub-tasks, and mark completed steps during complex workflows.
- Ask only when blocked: Use \`ask_user_decision\` only when genuinely blocked by missing requirements, critical architectural choices, or irreversible actions. Otherwise make sound engineering decisions and proceed.

## Safety Rules
- Respect repository boundaries and files.
- Avoid destructive commands, unprompted hard resets, or removing uncommitted user work.
- Never output, log, or leak credentials, tokens, API keys, or private secrets.

## Output Style
- Be concise, technical, and direct.
- Explain what you changed and why, referencing exact file paths and test results.
- Avoid conversational filler, disclaimers, or excessive verbosity.`;

export interface EnvironmentContextProviderOptions {
  readonly repoRoot: string;
  readonly cwd?: string;
  readonly model?: string | { readonly provider?: string; readonly model?: string };
  readonly getGitBranch?: () => string | undefined;
  readonly getGitDirty?: () => boolean | undefined;
  readonly getDate?: () => string;
  readonly getModelId?: () => string | undefined;
}

export function detectGitBranch(repoRoot: string): string | undefined {
  try {
    const gitHead = join(repoRoot, ".git", "HEAD");
    if (existsSync(gitHead)) {
      const content = readFileSync(gitHead, "utf-8").trim();
      if (content.startsWith("ref: refs/heads/")) {
        return content.slice("ref: refs/heads/".length);
      }
      return content.slice(0, 7) || "detached";
    }
  } catch {
    // fallback
  }

  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      encoding: "utf-8",
    }).trim();
    if (branch && branch !== "HEAD") return branch;
  } catch {
    // ignore
  }
  return undefined;
}

export function detectGitDirty(repoRoot: string): boolean {
  try {
    const status = execSync("git status --porcelain", {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
      encoding: "utf-8",
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

export function createEnvironmentContextProvider(options: EnvironmentContextProviderOptions): ContextProvider {
  return {
    name: "environment",
    resolve(context: ContextResolutionContext): readonly ContextBlock[] {
      const cwd = options.cwd ?? options.repoRoot;
      const repoRoot = options.repoRoot;
      const os = `${process.platform} (${process.arch})`;
      const shell = process.env.SHELL ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
      const date = options.getDate ? options.getDate() : new Date().toISOString().slice(0, 10);
      const branch = options.getGitBranch ? options.getGitBranch() : detectGitBranch(repoRoot);
      const dirty = options.getGitDirty ? options.getGitDirty() : detectGitDirty(repoRoot);
      const modelId = options.getModelId
        ? options.getModelId()
        : ((context.metadata?.model as any)?.model ??
          (context.metadata?.model as any) ??
          (typeof options.model === "object" ? options.model?.model : options.model) ??
          "default");

      return [
        {
          title: "Environment",
          content: [
            `Working directory: ${cwd}`,
            `Repository root: ${repoRoot}`,
            `OS: ${os}`,
            `Shell: ${shell}`,
            `Date: ${date}`,
            `Git branch: ${branch ?? "none"}`,
            `Git dirty: ${dirty ? "true" : "false"}`,
            `Model: ${modelId}`,
          ].join("\n"),
        },
      ];
    },
  };
}

export interface ResolvePrismCodeInstructionsOptions {
  readonly config: PrismCodeConfig;
  readonly repoRoot?: string;
  readonly home?: string;
  readonly agentsHome?: string;
}

export function resolvePrismCodeInstructions(options: ResolvePrismCodeInstructionsOptions): InstructionsPlaneConfig {
  const { config } = options;
  const repoRoot = options.repoRoot ?? findRepoRoot(config.cwd);
  const home = options.home ?? resolvePrismHome();
  const agentsHome = options.agentsHome ?? process.env.PRISM_AGENTS_HOME ?? homedir();

  const text = config.instructions?.text ?? CODING_SYSTEM_PROMPT;

  // SYSTEM.md
  let systemMd: InstructionsPlaneConfig["systemMd"] = false;
  if (config.instructions?.systemMd !== false) {
    if (typeof config.instructions?.systemMd === "object" && (config.instructions.systemMd as any).path) {
      systemMd = {
        path: (config.instructions.systemMd as any).path,
        mode: (config.instructions.systemMd as any).mode ?? "replace",
      };
    } else if (typeof config.instructions?.systemMd === "string") {
      systemMd = {
        path: config.instructions.systemMd,
        mode: "replace",
      };
    } else {
      let systemPath: string | undefined;
      if (typeof config.instructions?.systemMd === "object" && (config.instructions.systemMd as any).globalRoot) {
        const root = (config.instructions.systemMd as any).globalRoot;
        const candidate = join(root, ".prism", "agent", "SYSTEM.md");
        if (existsSync(candidate)) systemPath = candidate;
        else {
          const direct = join(root, "SYSTEM.md");
          if (existsSync(direct)) systemPath = direct;
          else {
            const agentPath = join(root, "agent", "SYSTEM.md");
            if (existsSync(agentPath)) systemPath = agentPath;
          }
        }
      } else {
        // Default: ~/.prism/agent/SYSTEM.md
        systemPath = join(home, "agent", "SYSTEM.md");
      }

      if (systemPath && existsSync(systemPath)) {
        systemMd = {
          path: systemPath,
          mode: "replace",
        };
      }
    }
  }

  // AGENTS.md
  let agentsMd: InstructionsPlaneConfig["agentsMd"] = false;
  if (config.instructions?.agentsMd !== false) {
    if (typeof config.instructions?.agentsMd === "string") {
      agentsMd = { path: config.instructions.agentsMd };
    } else if (typeof config.instructions?.agentsMd === "object" && Array.isArray((config.instructions.agentsMd as any).paths)) {
      agentsMd = { paths: (config.instructions.agentsMd as any).paths };
    } else if (typeof config.instructions?.agentsMd === "object" && typeof (config.instructions.agentsMd as any).path === "string") {
      agentsMd = { path: (config.instructions.agentsMd as any).path };
    } else {
      const paths: string[] = [];
      // 1. ~/.agents/agent/AGENTS.md
      const agentsGlobal = join(agentsHome, ".agents", "agent", "AGENTS.md");
      if (existsSync(agentsGlobal) && isUserOwned(dirname(agentsGlobal))) {
        paths.push(agentsGlobal);
      }
      // 2. ~/.prism/agent/AGENTS.md
      const prismGlobal = join(home, "agent", "AGENTS.md");
      if (existsSync(prismGlobal) && isUserOwned(dirname(prismGlobal))) {
        paths.push(prismGlobal);
      }
      // 3. <repo>/AGENTS.md (at repoRoot)
      const repoAgents = join(repoRoot, "AGENTS.md");
      if (existsSync(repoAgents)) {
        paths.push(repoAgents);
      }
      agentsMd = { paths };
    }
  }

  return {
    text,
    agentsMd,
    systemMd,
    ...(config.instructions && "layers" in config.instructions ? { layers: (config.instructions as any).layers } : {}),
  };
}
