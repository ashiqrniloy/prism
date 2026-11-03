import { dirname, join } from "node:path";
import { type AgentEvent, createAgent } from "@arnilo/prism";
import { createProfiles } from "@arnilo/prism/driver-kit";
import { createScriptedCli, type ScriptStep } from "@arnilo/prism/testing";
import { type AgentAdapter, adapterDriver, processDriver } from "@arnilo/prism-driver-process";
import { hostStreamCli } from "../adapters/stream-cli.js";
import type { HostConfig, HostDeps } from "../host/config.js";
import { createExternalWorker } from "../host/external.js";
import { sqlitePackage } from "../host/store.js";
import { hostStreamCliDialect } from "./stream-cli.dialect.js";

export const EXTERNAL_TOOL = "read_file";

/** A message, a thinking block, and a tool call, all reported by the vendor CLI. */
export function externalScript(): readonly ScriptStep[] {
  return [
    { out: { kind: "message.delta", content: { type: "text", text: "Working." } } },
    { out: { kind: "message.delta", content: { type: "thinking", text: "Read first." } } },
    { out: { kind: "tool.started", call: { id: "ext-1", name: EXTERNAL_TOOL, args: { path: "note.md" } } } },
    { out: { kind: "tool.completed", toolCallId: "ext-1", status: "finished", result: "contents" } },
    { out: { kind: "message.delta", content: { type: "text", text: "Done." } } },
  ];
}

export interface ExternalAttribution {
  readonly events: readonly AgentEvent[];
  /** Every `tool.call` the host gate saw. The external tool call must never appear. */
  readonly gateClaims: readonly string[];
  /** The scripted CLI records its own exit; a live process here would mean one outlived the run. */
  readonly exited: boolean;
}

export async function externalWorkerAttribution(config: HostConfig): Promise<ExternalAttribution> {
  const cli = createScriptedCli({ dialect: hostStreamCliDialect, script: externalScript() });
  const gateClaims: string[] = [];
  const deps: HostDeps = {
    hooks: (hooks) => {
      hooks.on("tool.call", (payload) => {
        gateClaims.push(payload.name);
        return "allow";
      });
    },
  };
  try {
    const agent = await createExternalWorker(
      {
        ...config,
        external: { binary: cli.command[0]!, args: cli.command.slice(1), profilesRoot: join(dirname(config.storePath), "profiles") },
      },
      deps,
    );
    const events: AgentEvent[] = [];
    try {
      const session = await agent.session({ create: true });
      const pump = (async () => {
        for await (const event of session.subscribe()) events.push(event);
      })();
      await session.run("go");
      await pump;
    } finally {
      await agent.dispose();
    }
    return { events, gateClaims, exited: cli.record().some((entry) => entry.event === "exit") };
  } finally {
    cli.dispose();
  }
}

/** A descriptor missing one control the spec asks for: `createAgent` must fail and name it (§1.4). */
export async function externalUnsupportedControl(config: HostConfig): Promise<string> {
  const cli = createScriptedCli({
    dialect: hostStreamCliDialect,
    script: [{ out: { kind: "message.delta", content: { type: "text", text: "hi" } } }],
  });
  const reduced: AgentAdapter = {
    ...hostStreamCli,
    name: `${hostStreamCli.name}-no-subagents`,
    descriptor: { ...hostStreamCli.descriptor, controls: { ...hostStreamCli.descriptor.controls, subagents: false } },
  };
  const profilesRoot = join(dirname(config.storePath), "unsupported-profiles");
  await createProfiles({ root: profilesRoot, driver: adapterDriver(reduced) }).create("external", {
    mode: "key",
    principal: "prism-agent",
  });
  try {
    await createAgent({
      name: "external",
      packages: [sqlitePackage(config.storePath), processDriver(reduced)],
      packageConfig: {
        [reduced.name]: {
          name: "external",
          profile: "external",
          profilesRoot,
          principal: "prism-agent",
          binary: cli.command[0]!,
          args: cli.command.slice(1),
          requires: { subagents: true },
        },
      },
    });
    throw new Error("createAgent accepted an unsupported control");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    cli.dispose();
  }
}
