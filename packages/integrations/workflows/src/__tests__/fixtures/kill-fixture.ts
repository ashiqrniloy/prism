/** Workflows and agents shared by the kill worker and the resuming test process, so both hash the same definition. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { type Agent, askEveryTool, createAgent, type ModelProvider, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import {
  agentNode,
  type CheckpointStore,
  createWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  type LeaseStore,
  type WorkflowCheckpointAdapter,
  type WorkflowDefinition,
} from "../../index.js";

/** The SQLite store, loaded by computed URL so this package's typecheck never pulls in another package's sources. */
export async function openPersistence(dir: string): Promise<{
  readonly persistence: { close(): void };
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly leases: LeaseStore;
}> {
  const { createSqlitePersistence } = await import(new URL("../../../../../stores/sqlite/src/index.ts", import.meta.url).href);
  const persistence = createSqlitePersistence({ filename: join(dir, "workflows.sqlite") }) as {
    checkpoints: CheckpointStore;
    leases: LeaseStore;
    close(): void;
  };
  return { persistence, checkpoints: createWorkflowCheckpoints({ store: persistence.checkpoints }), leases: persistence.leases };
}

export const RUN_ID = "run-kill";

/** One line per execution; the process may die, the file does not. */
export const countsFile = (dir: string): string => join(dir, "counts.log");
const count = (dir: string, name: string): void => appendFileSync(countsFile(dir), `${name}\n`);

/** a → b → c. With `hang`, b records its start and never returns, so the parent can SIGKILL the process mid-node. */
export function dagWorkflow(options: { dir: string; hang: boolean; bIdempotent?: "rerun" | "fail" }): WorkflowDefinition {
  return defineWorkflow({
    id: "kill-dag",
    revision: "1",
    nodes: {
      a: functionNode({
        execute: () => {
          count(options.dir, "a");
          return "a-out";
        },
      }),
      b: functionNode({
        ...(options.bIdempotent ? { idempotent: options.bIdempotent } : {}),
        execute: async () => {
          count(options.dir, "b");
          if (options.hang) {
            console.log("READY");
            await new Promise(() => undefined);
          }
          return "b-out";
        },
      }),
      c: functionNode({
        execute: () => {
          count(options.dir, "c");
          return "c-out";
        },
      }),
    },
    edges: [
      ["a", "b"],
      ["b", "c"],
    ],
  });
}

/** A worker whose first tool call is gated by `askEveryTool`, so its run suspends until a reviewer decides. */
export async function gatedWorker(options: { dir: string; store: unknown; turnsSeen: number }): Promise<Agent> {
  let turn = options.turnsSeen;
  const provider: ModelProvider = {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield { type: "tool_call" as const, call: toolCallContent("c1", "write", {}) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("child-done");
      yield providerDone();
    },
  };
  return createAgent({
    id: "gated",
    model: { provider: "mock", model: "m" },
    slots: { store: options.store as never },
    hooks: askEveryTool(),
    packages: [providerPackage("gated-provider", [provider])],
    tools: {
      add: [
        {
          name: "write",
          parameters: {},
          execute: (_args: unknown, context: { toolCallId: string }) => {
            count(options.dir, "tool");
            return { toolCallId: context.toolCallId, name: "write", value: "done" };
          },
        },
      ],
    },
  });
}

export const childWorkflow = (worker: Agent): WorkflowDefinition =>
  defineWorkflow({ id: "kill-child", revision: "1", nodes: { build: agentNode({ agent: worker, input: () => "go" }) } });
