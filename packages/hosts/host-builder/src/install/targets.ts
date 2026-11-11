/**
 * The installer's targets. One row per coding agent; adding a target is adding a row.
 *
 * Conventions (plan 215 Task 13 (d), checked against the agents' docs on 2026-11-07):
 * - Claude Code reads `.claude/skills` and the project `.mcp.json` (`mcpServers`).
 * - Codex CLI reads `.agents/skills` and `.codex/config.toml` (`[mcp_servers.<name>]`, TOML).
 * - Cursor reads `.agents/skills` (and `.claude/skills`) and `.cursor/mcp.json` (`mcpServers`).
 * - Prism's `contextFiles` discovers `.agents/skills` first, then `.claude/skills`.
 */

export type InstallTargetName = "claude" | "codex" | "cursor" | "agents" | "prism";

/** Where a target keeps its project MCP configuration. */
export interface ConfigTarget {
  /** Project-relative file. */
  readonly file: string;
  /** `json`: merged in place. `toml`: only printed (the package takes no TOML dependency). */
  readonly format: "json" | "toml";
  /** The JSON key (or TOML table prefix) that holds the servers. */
  readonly key: string;
}

export interface InstallTarget {
  /** Project-relative directory the skill is copied into, as `<skillDir>/prism-host-builder`. */
  readonly skillDir: string;
  readonly config?: ConfigTarget;
}

export const INSTALL_TARGETS: Readonly<Record<InstallTargetName, InstallTarget>> = {
  claude: { skillDir: ".claude/skills", config: { file: ".mcp.json", format: "json", key: "mcpServers" } },
  codex: { skillDir: ".agents/skills", config: { file: ".codex/config.toml", format: "toml", key: "mcp_servers" } },
  cursor: { skillDir: ".agents/skills", config: { file: ".cursor/mcp.json", format: "json", key: "mcpServers" } },
  agents: { skillDir: ".agents/skills" },
  prism: { skillDir: ".agents/skills" },
};

export const INSTALL_TARGET_NAMES = Object.keys(INSTALL_TARGETS) as readonly InstallTargetName[];

/** The skill directory name under a target's `skillDir`. */
export const SKILL_NAME = "prism-host-builder";

/** The server name the installer writes. Another entry under this name that differs is a conflict. */
export const SERVER_NAME = "prism";

/** The entry written under the server key. `command` and `args` only: no env, no token. */
export const SERVER_ENTRY = { command: "bunx", args: ["--package", "@arnilo/prism-hosts", "prism-host-builder", "mcp"] } as const;

export function isInstallTargetName(value: string): value is InstallTargetName {
  return Object.hasOwn(INSTALL_TARGETS, value);
}
