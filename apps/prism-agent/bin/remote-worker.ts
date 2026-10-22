import { createAgent, type PackageInstance } from "@arnilo/prism";
import { approvalPackage } from "@arnilo/prism-approval";
import { remoteHostUi, serveAgent } from "@arnilo/prism-remote";
import { loadHostConfig } from "../src/host/config.js";
import { REMOTE_ENDPOINT } from "../src/host/remote.js";

/** stdout is the `prism.remote/1` protocol; every diagnostic goes to stderr. */
const configPath = process.env.PRISM_AGENT_CONFIG;
if (configPath === undefined || configPath.length === 0) {
  process.stderr.write("remote-worker: PRISM_AGENT_CONFIG must name a prism-agent.json\n");
  process.exit(2);
}

// Fresh-process scenarios cannot share an in-memory mock provider. `PRISM_AGENT_MOCK` names a script.
const kind = process.env.PRISM_AGENT_MOCK;
const mock: readonly PackageInstance[] =
  kind === undefined || kind.length === 0 ? [] : (await import("../src/scenarios/mock-seam.js")).mockPackages(kind);

const config = loadHostConfig(configPath);
const ui = remoteHostUi();
const agent = await createAgent({
  id: "remote-worker",
  name: "remote-worker",
  model: config.models.research,
  host: { ui },
  packages: [approvalPackage({ mode: "ask" }), ...mock],
  tools: {
    add: [
      {
        name: "save",
        description: "Save the report",
        parameters: { type: "object", properties: {} },
        effects: ["write"],
        execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "save", value: "approved" }),
      },
    ],
  },
});

const served = serveAgent(agent, { transport: { kind: "stdio" }, hostUi: ui, endpointId: REMOTE_ENDPOINT });
try {
  await served.closed;
} finally {
  await agent.dispose();
}
