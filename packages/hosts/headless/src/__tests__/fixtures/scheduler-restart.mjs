import { createAgent, definePackage } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import workflows, { defineWorkflow, functionNode, workflowCommand } from "@arnilo/prism-extensions/workflows";
import { createScheduler } from "../../index.js";

const [filename, mode] = process.argv.slice(2);
const persistence = createSqlitePersistence({ filename });
const definition = defineWorkflow({ id: "restart-scheduler", revision: "1", nodes: { n: functionNode({ execute: () => "done" }) } });
const host = definePackage({
  name: "scheduler-restart",
  version: "1.0.0",
  requires: { api: 1 },
  capabilities: ["session-state"],
  setup(prism) {
    prism.commands.register(workflowCommand(prism, "nightly", definition));
  },
});
const agent = await createAgent({
  id: "scheduler-restart",
  ownership: { tenantId: "test" },
  model: { provider: "mock", model: "test" },
  slots: { store: persistence },
  packages: [mockProvider([]), workflows, host],
});
const scheduler = createScheduler({
  checkpoints: persistence.checkpoints,
  ownership: { tenantId: "test" },
  clock: {
    now: () => Date.parse(mode === "prepare" ? "2026-10-13T00:00:00Z" : "2026-10-13T02:00:00Z"),
    sleep(_ms, signal) {
      return new Promise((resolve) => {
        signal.addEventListener("abort", resolve, { once: true });
        if (signal.aborted) resolve();
      });
    },
  },
  targets: { job: { kind: "workflow", agent, command: "nightly", input: {} } },
});
if (mode === "prepare") {
  const state = await scheduler.schedule({ id: "daily", target: "job", cron: "0 2 * * *" });
  if (!(await agent.sessions.get(state.scheduleSessionId))) throw new Error("parent was not persisted");
  console.log(JSON.stringify(state));
} else {
  scheduler.start();
  for (let i = 0; i < 200; i++) {
    if ((await scheduler.list())[0].lastFiring?.status === "succeeded") break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await scheduler.stop();
  const state = (await scheduler.list())[0];
  if (state.lastFiring?.status !== "succeeded") throw new Error("workflow did not fire");
  console.log(JSON.stringify(state));
}
await scheduler.stop();
await agent.dispose();
persistence.close();
