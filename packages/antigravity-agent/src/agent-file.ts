import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { type BuildCustomAgentInstructionsOptions, buildCustomAgentInstructions } from "./prompt.js";
import { AntigravityWorkspaceConfigError } from "./types.js";
import { assertValidWorkspacePath } from "./workspace-config.js";

export const DEFAULT_PRISM_AGENT_NAME = "prism";

export interface BuildCustomAgentMarkdownOptions extends BuildCustomAgentInstructionsOptions {
  readonly agentName?: string;
  readonly description?: string;
  readonly mainAgent?: boolean;
  readonly inheritMcp?: boolean;
}

export function buildCustomAgentMarkdown(options: BuildCustomAgentMarkdownOptions = {}): string {
  const agentName = options.agentName ?? DEFAULT_PRISM_AGENT_NAME;
  if (!agentName || !/^[A-Za-z0-9_-]+$/.test(agentName)) {
    throw new AntigravityWorkspaceConfigError(`Invalid agent name: '${agentName}'`);
  }

  const description = options.description ?? "Delegated Prism agent running official Antigravity CLI with authorized Prism MCP tools";
  const mainAgent = options.mainAgent !== false;
  const inheritMcp = options.inheritMcp !== false;

  const frontmatter = [
    "---",
    `name: ${agentName}`,
    `description: ${description.replace(/[\r\n]/g, " ")}`,
    `mainAgent: ${mainAgent}`,
    `inheritMcp: ${inheritMcp}`,
    "---",
  ].join("\n");

  const instructions = buildCustomAgentInstructions(options);

  return `${frontmatter}\n\n${instructions}\n`;
}

export interface EphemeralAgentFileOptions extends BuildCustomAgentMarkdownOptions {
  readonly workspace: string;
  readonly markdownContent?: string;
}

export interface EphemeralAgentFileHandle {
  readonly workspace: string;
  readonly agentName: string;
  readonly agentDir: string;
  readonly agentFile: string;
  readonly restored: boolean;
  restore(): Promise<void>;
  [Symbol.asyncDispose]?(): Promise<void>;
}

function assertContained(parent: string, child: string, label: string): void {
  const rel = relative(parent, child);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new AntigravityWorkspaceConfigError(`${label} escapes workspace boundary: ${child}`);
  }
}

export function writeEphemeralAgentFile(options: EphemeralAgentFileOptions): EphemeralAgentFileHandle {
  const realWorkspace = assertValidWorkspacePath(options.workspace);
  const agentName = options.agentName ?? DEFAULT_PRISM_AGENT_NAME;

  if (!agentName || !/^[A-Za-z0-9_-]+$/.test(agentName)) {
    throw new AntigravityWorkspaceConfigError(`Invalid agent name: '${agentName}'`);
  }

  const agentsRootDir = join(realWorkspace, ".agents");
  const agentsSubDir = join(agentsRootDir, "agents");
  const agentDir = join(agentsSubDir, agentName);
  const agentFile = join(agentDir, "agent.md");

  assertContained(realWorkspace, agentsRootDir, "Agents root directory");
  assertContained(realWorkspace, agentsSubDir, "Agents sub-directory");
  assertContained(realWorkspace, agentDir, "Agent directory");
  assertContained(realWorkspace, agentFile, "Agent file");

  let createdAgentsRootDir = false;
  let createdAgentsSubDir = false;
  let createdAgentDir = false;
  let backupContent: string | undefined;
  let restored = false;

  try {
    if (!existsSync(agentsRootDir)) {
      mkdirSync(agentsRootDir, { recursive: true });
      createdAgentsRootDir = true;
    } else {
      const real = realpathSync(agentsRootDir);
      assertContained(realWorkspace, real, "Agents root realpath");
    }

    if (!existsSync(agentsSubDir)) {
      mkdirSync(agentsSubDir, { recursive: true });
      createdAgentsSubDir = true;
    } else {
      const real = realpathSync(agentsSubDir);
      assertContained(realWorkspace, real, "Agents subdir realpath");
    }

    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true });
      createdAgentDir = true;
    } else {
      const real = realpathSync(agentDir);
      assertContained(realWorkspace, real, "Agent dir realpath");
    }

    if (existsSync(agentFile)) {
      const stat = statSync(agentFile);
      if (stat.isFile()) {
        backupContent = readFileSync(agentFile, "utf8");
      }
    }

    const content = options.markdownContent ?? buildCustomAgentMarkdown({ ...options, agentName });

    // Atomic write
    const tmpPath = `${agentFile}.tmp.${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync(tmpPath, content, "utf8");
      renameSync(tmpPath, agentFile);
    } catch (error) {
      if (existsSync(tmpPath)) {
        rmSync(tmpPath, { force: true });
      }
      throw new AntigravityWorkspaceConfigError(`Failed to write agent file: ${agentFile}`, { cause: error });
    }

    const restore = async () => {
      if (restored) return;
      restored = true;

      try {
        if (backupContent !== undefined) {
          const tmpRestore = `${agentFile}.tmp.${randomBytes(6).toString("hex")}`;
          writeFileSync(tmpRestore, backupContent, "utf8");
          renameSync(tmpRestore, agentFile);
        } else if (existsSync(agentFile)) {
          rmSync(agentFile, { force: true });
        }

        if (createdAgentDir && existsSync(agentDir)) {
          try {
            if (readdirSync(agentDir).length === 0) {
              rmdirSync(agentDir);
            }
          } catch {}
        }

        if (createdAgentsSubDir && existsSync(agentsSubDir)) {
          try {
            if (readdirSync(agentsSubDir).length === 0) {
              rmdirSync(agentsSubDir);
            }
          } catch {}
        }

        if (createdAgentsRootDir && existsSync(agentsRootDir)) {
          try {
            if (readdirSync(agentsRootDir).length === 0) {
              rmdirSync(agentsRootDir);
            }
          } catch {}
        }
      } catch {}
    };

    return {
      workspace: realWorkspace,
      agentName,
      agentDir,
      agentFile,
      get restored() {
        return restored;
      },
      restore,
      [Symbol.asyncDispose]: restore,
    };
  } catch (error) {
    if (createdAgentDir && existsSync(agentDir)) {
      rmSync(agentDir, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function withEphemeralAgentFile<T>(
  options: EphemeralAgentFileOptions,
  fn: (handle: EphemeralAgentFileHandle) => Promise<T>,
): Promise<T> {
  const handle = writeEphemeralAgentFile(options);
  try {
    return await fn(handle);
  } finally {
    await handle.restore();
  }
}
