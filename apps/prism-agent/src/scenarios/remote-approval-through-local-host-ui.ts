import { type Agent } from "@arnilo/prism";
import { createScriptedHostUi } from "@arnilo/prism/testing";
import type { HostConfig } from "../host/config.js";
import { connectRemoteWorker, REMOTE_ENDPOINT } from "../host/remote.js";
import { writeRemoteWorkerConfig } from "./remote-worker-attribution.js";

export interface RemoteApproval {
  /** The request kinds the remote's approval gate sent to the host's `HostUi`. */
  readonly asked: readonly string[];
  readonly status: string;
}

/** The remote worker's approval request reaches the host's `HostUi`; the host's answer resumes the run. */
export async function remoteApprovalThroughLocalHostUi(config: HostConfig): Promise<RemoteApproval> {
  const configPath = writeRemoteWorkerConfig(config);
  const scripted = createScriptedHostUi({ confirm: true, select: "once" });
  let agent: Agent | undefined;
  try {
    agent = await connectRemoteWorker({
      configPath,
      ui: scripted.ui,
      endpointId: REMOTE_ENDPOINT,
      env: { PRISM_AGENT_MOCK: "remote-approve" },
    });
    const session = await agent.session({ create: true });
    const result = await session.run("save the report");
    return { asked: scripted.requestsOf("confirm").map((request) => request.kind), status: result.status };
  } finally {
    await agent?.dispose();
  }
}
