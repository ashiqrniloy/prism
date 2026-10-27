import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pendingDecisionsOf, remoteHostUi, serveAgent } from "../index.js";
import type { RemoteAgentFactory } from "../testing.js";

const modulePath = process.argv[2];
const stateDirectory = process.argv[3];
assert.ok(modulePath && stateDirectory, "expected factory module and state directory");
// host-gate: the factory module path is this fixture's CLI argument.
const create: RemoteAgentFactory = (await import(modulePath)).create;
const hostUi = remoteHostUi();
const agent = await create({ hostUi, stateDirectory });
// connectAgent owns this child; let EOF persist an in-flight approval before SIGTERM exits it.
process.on("SIGTERM", () => {});
const served = serveAgent(agent, { transport: { kind: "stdio" }, hostUi });
await served.closed;
const draining = process.env.PRISM_CONFORMANCE_DRAIN === "1";
const end = Date.now() + (draining ? 1000 : 0);
while (Date.now() < end) {
  const sessions = await agent.sessions.list();
  let suspended = false;
  for (const item of sessions.items) {
    const session = await agent.session({ id: item.sessionId });
    if (pendingDecisionsOf(await session.entries()).length) suspended = true;
  }
  if (suspended) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
await agent.dispose();
if (draining) await writeFile(join(stateDirectory, "stdio-drained"), "");
process.exit(0);
