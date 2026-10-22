/**
 * The process the kill tests SIGKILL. Input: PRISM_KILL_WORKER = JSON { dir, scenario }.
 *   dag   — runs a → b → c; b hangs after recording its start (READY on stdout).
 *   child — runs a gated agent node; the workflow suspends on the child's approval (READY <json> on stdout).
 */
import { createWorkflowTransitionChannel, runWorkflow } from "../../index.js";
import { childWorkflow, dagWorkflow, gatedWorker, openPersistence, RUN_ID } from "./kill-fixture.js";

const input = JSON.parse(process.env.PRISM_KILL_WORKER ?? "null") as { dir: string; scenario: "dag" | "child" };
const { persistence, checkpoints } = await openPersistence(input.dir);

if (input.scenario === "dag") {
  await runWorkflow(dagWorkflow({ dir: input.dir, hang: true }), null, { checkpoints, runId: RUN_ID });
} else {
  const worker = await gatedWorker({ dir: input.dir, store: persistence, turnsSeen: 0 });
  const channel = createWorkflowTransitionChannel({ workflowId: "kill-child", runId: RUN_ID });
  let pending: { approvalId: string }[] = [];
  const watching = (async () => {
    for await (const event of channel.stream()) {
      if (event.type === "run.suspended") pending = [...(event.interruption.pendingDecisions ?? [])];
    }
  })();
  const result = await runWorkflow(childWorkflow(worker), null, { checkpoints, runId: RUN_ID, transitions: channel });
  await watching;
  console.log(`READY ${JSON.stringify({ status: result.status, version: result.version, approvals: pending.map((p) => p.approvalId) })}`);
  await new Promise(() => undefined);
}
