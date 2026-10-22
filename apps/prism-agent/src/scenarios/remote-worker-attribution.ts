import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Agent, type AgentEvent, createAgent, createSessionIndex, definePackage, type HostUi } from "@arnilo/prism";
import { createScriptedHostUi } from "@arnilo/prism/testing";
import { createSqlitePersistence } from "@arnilo/prism-store-sqlite";
import type { HostConfig } from "../host/config.js";
import { connectRemoteWorker, REMOTE_ENDPOINT } from "../host/remote.js";
import { sqlitePackage } from "../host/store.js";

export { REMOTE_ENDPOINT };

/** The remote process reads its own `prism-agent.json`; the scenario writes the host's to a file. */
export function writeRemoteWorkerConfig(config: HostConfig): string {
  mkdirSync(config.workspace, { recursive: true });
  const path = join(dirname(config.storePath), "remote-worker.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
}

export interface RemoteAttribution {
  readonly events: readonly AgentEvent[];
  /** Every `tool.call` the host's own gate saw. The remote tool must never appear. */
  readonly gateClaims: readonly string[];
  readonly mirrored: boolean;
}

/**
 * Host + remote worker: the remote runs a gated tool, the host answers its approval, and the
 * forwarded events keep their catalog types. A host-side `tool.call` hook proves the remote call
 * never reached the local gate; the host store proves the session was mirrored.
 */
export async function remoteWorkerAttribution(config: HostConfig): Promise<RemoteAttribution> {
  const configPath = writeRemoteWorkerConfig(config);
  const scripted = createScriptedHostUi({ confirm: true, select: "once" });
  const mirror = createSqlitePersistence({ filename: config.storePath });
  const gateClaims: string[] = [];
  const host = await createAgent({
    model: config.models.orchestrator,
    packages: [
      sqlitePackage(config.storePath),
      definePackage({
        name: "@prism-agent/remote-gate-probe",
        version: "1.0.0",
        requires: { api: 1 },
        setup(prism) {
          prism.hooks.on("tool.call", (payload) => {
            gateClaims.push(payload.name);
          });
        },
      }),
    ],
  });
  let agent: Agent | undefined;
  const events: AgentEvent[] = [];
  try {
    agent = await connectRemoteWorker({
      configPath,
      ui: scripted.ui,
      mirror,
      endpointId: REMOTE_ENDPOINT,
      env: { PRISM_AGENT_MOCK: "remote-approve" },
    });
    const session = await agent.session({ create: true });
    const pump = (async () => {
      for await (const event of session.subscribe()) events.push(event);
    })();
    await session.run("save the report");
    await pump;
    const listed = await createSessionIndex(mirror).list();
    return { events, gateClaims, mirrored: listed.items.length > 0 };
  } finally {
    await agent?.dispose();
    await host.dispose();
    mirror.close();
  }
}

/** The host UI never answers, so the remote run stays in flight until the process is killed. */
export async function remoteProcessKill(config: HostConfig): Promise<string | undefined> {
  const configPath = writeRemoteWorkerConfig(config);
  const blocked: HostUi = { request: () => new Promise(() => {}) };
  const agent = await connectRemoteWorker({
    configPath,
    ui: blocked,
    endpointId: REMOTE_ENDPOINT,
    env: { PRISM_AGENT_MOCK: "remote-approve" },
  });
  try {
    const session = await agent.session({ create: true });
    const code = session.run("save the report").then(
      () => undefined,
      (error: unknown) => (error as { code?: string }).code,
    );
    await agent.dispose();
    return await code;
  } finally {
    await agent.dispose();
  }
}
