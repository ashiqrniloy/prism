import type { JsonObject, ToolDefinition } from "@arnilo/prism";
import type { AntigravityCliAgent } from "./create.js";

export interface AntigravityDelegationToolOptions {
  readonly agent: AntigravityCliAgent;
  readonly toolName?: string;
  readonly description?: string;
  readonly cwd?: string;
  readonly continueConversation?: boolean;
}

export function createAntigravityDelegationTool(options: AntigravityDelegationToolOptions): ToolDefinition {
  const toolName = options.toolName ?? "delegate_to_antigravity";
  const description =
    options.description ??
    "Delegates complex coding, multi-step planning, or workspace investigation tasks to the official Antigravity CLI agent with authorized Prism MCP tools.";

  return {
    name: toolName,
    description,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed task instructions or coding prompt for the delegated Antigravity agent.",
        },
        taskInstructions: {
          type: "string",
          description: "Optional specific constraints or directives for the delegated task.",
        },
      },
      required: ["prompt"],
    } as unknown as JsonObject,
    async execute(args, context) {
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      if (!prompt.trim()) {
        return {
          toolCallId: context.toolCallId,
          name: toolName,
          content: [{ type: "text", text: "Error: prompt must be a non-empty string" }],
        };
      }

      const cwd = options.cwd ?? process.cwd();

      try {
        const result = await options.agent.run({
          prompt,
          taskInstructions: typeof args.taskInstructions === "string" ? args.taskInstructions : undefined,
          cwd,
          sessionId: context.sessionId,
          runId: context.runId,
          identity: (context as { identity?: unknown }).identity as never,
          ownership: (context as { ownership?: unknown }).ownership as never,
          signal: (context as { signal?: AbortSignal }).signal,
          continueConversation: options.continueConversation !== false,
        });

        return {
          toolCallId: context.toolCallId,
          name: toolName,
          content: [{ type: "text", text: result.response }],
        };
      } catch (error) {
        return {
          toolCallId: context.toolCallId,
          name: toolName,
          content: [
            {
              type: "text",
              text: `Error during Antigravity delegation: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  };
}
