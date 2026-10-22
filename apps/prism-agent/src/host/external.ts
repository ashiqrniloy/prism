import { dirname, join } from "node:path";
import { type Agent, createAgent } from "@arnilo/prism";
import { createProfiles } from "@arnilo/prism/driver-kit";
import { adapterDriver, processDriver } from "@arnilo/prism-driver-process";
import { hostStreamCli } from "../adapters/stream-cli.js";
import type { HostConfig, HostDeps } from "./config.js";
import { sqlitePackage } from "./store.js";

const PRINCIPAL = "prism-agent";

/**
 * The external worker: a host-owned adapter over `prism-driver-process` (roadmap §2.13.1).
 * `createProfiles` runs first — a run without a lease fails `profile_invalid` — and the agent
 * lists the store and the driver package; there is no `loop:` or `store:` field.
 */
export async function createExternalWorker(config: HostConfig, deps: HostDeps = {}): Promise<Agent> {
  const external = config.external;
  if (external === undefined) throw new Error("prism-agent config needs external.binary to create the external worker");
  const profile = external.profile ?? "external";
  const profilesRoot = external.profilesRoot ?? join(dirname(config.storePath), "profiles");
  await createProfiles({ root: profilesRoot, driver: adapterDriver(hostStreamCli) }).create(profile, {
    mode: "key",
    principal: PRINCIPAL,
  });
  return createAgent({
    name: "external",
    ...(deps.host === undefined ? {} : { host: deps.host }),
    ...(deps.hooks === undefined ? {} : { hooks: deps.hooks }),
    packages: [sqlitePackage(config.storePath), ...(deps.packages ?? []), processDriver(hostStreamCli)],
    packageConfig: {
      [hostStreamCli.name]: {
        name: "external",
        profile,
        profilesRoot,
        principal: PRINCIPAL,
        binary: external.binary,
        ...(external.args === undefined ? {} : { args: [...external.args] }),
      },
    },
  });
}
