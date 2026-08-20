import type { ResolvedAntigravityToolPolicy } from "./tool-policy.js";
import { AntigravityWorkspaceConfigError } from "./types.js";

export const MAX_AGENT_INSTRUCTIONS_BYTES = 256 * 1024; // 256 KiB

export interface AgentSkillInput {
  readonly name: string;
  readonly description?: string;
  readonly instructions: string;
}

export interface AgentContextBlockInput {
  readonly title?: string;
  readonly content: string;
}

export interface BuildCustomAgentInstructionsOptions {
  readonly systemPrompt?: string;
  readonly taskInstructions?: string;
  readonly skills?: readonly AgentSkillInput[];
  readonly context?: readonly (string | AgentContextBlockInput)[];
  readonly toolPolicy?: ResolvedAntigravityToolPolicy;
  readonly serverName?: string;
  readonly exposedMcpTools?: readonly string[];
}

export function buildCustomAgentInstructions(options: BuildCustomAgentInstructionsOptions = {}): string {
  const sections: string[] = [];
  const serverName = options.serverName ?? "prism";

  // 1. Tool policy & routing instructions
  const policy = options.toolPolicy;
  if (policy?.preferPrismMutators) {
    const lines: string[] = [
      "## Prism Capabilities & Tool Policy",
      `You are operating under the supervision of the Prism harness with authorized tools exposed via the MCP server '${serverName}'.`,
    ];

    if (options.exposedMcpTools && options.exposedMcpTools.length > 0) {
      lines.push(`Available authorized Prism tools: ${options.exposedMcpTools.map((t) => `\`${serverName}:${t}\``).join(", ")}.`);
    }

    lines.push(
      "- State-changing operations (file edits, file writes, deletions, command execution, and browser actions) MUST be routed through the corresponding Prism MCP tools.",
      "- All Prism tool calls are subject to run-bound authorization, guardrails, tenant isolation, and secret redaction.",
      "- Do not attempt to bypass Prism policies or use overlapping unconfigured built-in tools.",
    );

    if (policy.deniedBuiltins.length > 0) {
      lines.push(`- Denied built-in tools: ${policy.deniedBuiltins.map((t) => `\`${t}\``).join(", ")}.`);
    }

    sections.push(lines.join("\n"));
  }

  // 2. System prompt
  if (options.systemPrompt?.trim()) {
    sections.push(`## System Instructions\n${options.systemPrompt.trim()}`);
  }

  // 3. Task instructions
  if (options.taskInstructions?.trim()) {
    sections.push(`## Task Directives\n${options.taskInstructions.trim()}`);
  }

  // 4. Skills
  if (options.skills && options.skills.length > 0) {
    const skillBlocks: string[] = ["## Active Skills"];
    for (const skill of options.skills) {
      if (!skill.name) continue;
      const desc = skill.description ? ` - ${skill.description}` : "";
      skillBlocks.push(`### Skill: ${skill.name}${desc}\n${skill.instructions}`);
    }
    sections.push(skillBlocks.join("\n\n"));
  }

  // 5. Context
  if (options.context && options.context.length > 0) {
    const contextBlocks: string[] = ["## Context"];
    for (const item of options.context) {
      if (typeof item === "string" && item.trim()) {
        contextBlocks.push(item.trim());
      } else if (item && typeof item === "object" && "content" in item && item.content.trim()) {
        const title = item.title ? `### ${item.title}\n` : "";
        contextBlocks.push(`${title}${item.content.trim()}`);
      }
    }
    if (contextBlocks.length > 1) {
      sections.push(contextBlocks.join("\n\n"));
    }
  }

  const result = sections.join("\n\n").trim();
  if (Buffer.byteLength(result, "utf8") > MAX_AGENT_INSTRUCTIONS_BYTES) {
    throw new AntigravityWorkspaceConfigError(
      `Generated agent instructions exceed maximum length of ${MAX_AGENT_INSTRUCTIONS_BYTES} bytes`,
    );
  }

  return result;
}
