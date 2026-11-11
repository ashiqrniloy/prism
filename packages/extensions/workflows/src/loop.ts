import manifest from "../../package.json" with { type: "json" };
import { definePackage, type JsonValue, type LoopStrategy, type Message, type PackageDefinition, type RunController } from "@arnilo/prism";
import { defineWorkflow } from "./define.js";
import { WorkflowDefinitionError, WorkflowRuntimeError } from "./errors.js";
import { runWorkflow } from "./run.js";
import type { FunctionNodeDefinition, WorkflowDefinition, WorkflowNodeContext, WorkflowNodeDefinition } from "./types.js";

export interface LoopAgentStepConfig {
  /** `"any"` lets a gate's back edge re-enter the step. Default `"all"`. */
  readonly activation?: "all" | "any";
  /** Builds a user message appended before the turn (feedback for a revise step). Default: none. */
  readonly input?: (ctx: WorkflowNodeContext) => string | Promise<string>;
  /** Narrow or disable tools for this step's turns (`RunTurnOptions.tools`). */
  readonly tools?: false | readonly string[];
  readonly system?: string;
  /** Most tool rounds in one step. Default 16. */
  readonly maxToolRounds?: number;
  /** Maps the step's final assistant text to the node output. Default: the text. */
  readonly output?: (text: string, ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
}

const steps = new WeakMap<object, LoopAgentStepConfig>();

/**
 * An agent step for {@link workflowLoop}: it runs provider turns and tool rounds on the loop's own run,
 * through `RunController.turn` and `executeTools`, so every tool call passes `tool.call`. It is a
 * `function` node (it names no other agent) and fails if run outside a `workflowLoop`.
 */
export function loopAgentNode(config: LoopAgentStepConfig = {}): FunctionNodeDefinition {
  const node: FunctionNodeDefinition = {
    kind: "function",
    ...(config.activation ? { activation: config.activation } : {}),
    execute: () => {
      throw new WorkflowRuntimeError("loopAgentNode runs only inside workflowLoop", "loop_step_outside_loop");
    },
  };
  steps.set(node, config);
  return node;
}

function assertNoForeignAgents(workflow: WorkflowDefinition, path: string): void {
  for (const [id, node] of Object.entries(workflow.nodes)) {
    if (node.kind === "agent") {
      throw new WorkflowDefinitionError(
        `workflowLoop node "${path}${id}" is an agentNode: a loop is one agent, one session. Use loopAgentNode, or run the agent with workflowCommand`,
      );
    }
    if (node.kind === "workflow") assertNoForeignAgents(node.workflow, `${path}${id}/`);
  }
}

function lastAssistantText(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  }
  return "";
}

async function agentStep(run: RunController, config: LoopAgentStepConfig, ctx: WorkflowNodeContext): Promise<string> {
  if (config.input) {
    const text = await config.input(ctx);
    await run.append({ role: "user", content: [{ type: "text", text }] });
  }
  const maxRounds = config.maxToolRounds ?? 16;
  for (let round = 0; ; round++) {
    const turn = await run.turn({
      ...(config.tools !== undefined ? { tools: config.tools } : {}),
      ...(config.system !== undefined ? { system: config.system } : {}),
    });
    if (turn.stopped) throw new WorkflowRuntimeError("The run stopped during a workflow loop step", "loop_stopped");
    if (turn.toolCalls.length === 0) {
      if (turn.steered) continue;
      break;
    }
    if (round >= maxRounds) throw new WorkflowRuntimeError(`Loop step exceeded ${maxRounds} tool rounds`, "loop_tool_rounds");
    await run.executeTools(turn.toolCalls);
  }
  return lastAssistantText(await run.session.messages());
}

export interface WorkflowLoopOptions {
  /** Package name. Default `@arnilo/prism-workflow-loop`. */
  readonly name?: string;
}

/**
 * A package that claims `slot:loop` and runs `definition` inside one agent's run (roadmap §2.12.13).
 * `loopAgentNode` steps share the run's session and tools; gates, functions, routes, and conditionals
 * run as usual. An `agentNode` anywhere in the definition fails here with `WorkflowDefinitionError`.
 * The loop is not resumable, so an `ask` with no `host.ui` denies instead of suspending.
 */
export function workflowLoop(definition: WorkflowDefinition, options: WorkflowLoopOptions = {}): PackageDefinition {
  const strategy = workflowLoopStrategy(definition);
  return definePackage({
    name: options.name ?? "@arnilo/prism-workflow-loop",
    version: manifest.version,
    description: `Runs the "${definition.id}" workflow inside one agent's run.`,
    capabilities: ["slot:loop"],
    requires: { api: 1 },
    setup: (prism) => prism.slots.loop.provide(strategy),
  });
}

/** The loop strategy `workflowLoop` provides; also what `loopConformance` from `/testing` takes. */
export function workflowLoopStrategy(definition: WorkflowDefinition): LoopStrategy {
  assertNoForeignAgents(definition, "");
  return {
    name: `workflow:${definition.id}`,
    revision: definition.revision,
    async run(run) {
      // Steps of parallel branches take turns: one run, one transcript.
      let queue: Promise<unknown> = Promise.resolve();
      const nodes: Record<string, WorkflowNodeDefinition> = {};
      for (const [id, node] of Object.entries(definition.nodes)) {
        const config = steps.get(node);
        nodes[id] = config
          ? {
              ...(node as FunctionNodeDefinition),
              execute: (ctx: WorkflowNodeContext) => {
                const next = queue.then(async () => {
                  const text = await agentStep(run, config, ctx);
                  return config.output ? config.output(text, ctx) : text;
                });
                queue = next.catch(() => undefined);
                return next;
              },
            }
          : node;
      }
      const bound = defineWorkflow({
        id: definition.id,
        revision: definition.revision,
        nodes,
        edges: definition.edges,
        ...(definition.limits ? { limits: definition.limits } : {}),
        ...(definition.state ? { state: definition.state } : {}),
        ...(definition.metadata ? { metadata: definition.metadata } : {}),
      });
      const result = await runWorkflow(bound, run.input as unknown as JsonValue, { signal: run.signal });
      if (result.status !== "succeeded") {
        throw new WorkflowRuntimeError(`Workflow loop "${definition.id}" ended ${result.status}`, "loop_workflow_failed");
      }
    },
  };
}
