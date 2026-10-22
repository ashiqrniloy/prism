import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentConfig, createAgent, createMemorySessionStore, definePackage, type PackageInput } from "@arnilo/prism";
import { createProfiles } from "@arnilo/prism/driver-kit";
import { createScriptedCli, type ScriptStep } from "@arnilo/prism/testing";
import { type AgentAdapter, adapterDriver, type ProcessDriverConfig, processDriver } from "../../index.js";
import { testAdapter } from "./test-adapter.js";

export async function harness(
  options: {
    script?: readonly ScriptStep[];
    source?: string;
    adapter?: (base: AgentAdapter) => AgentAdapter;
    config?: Partial<ProcessDriverConfig> & Record<string, unknown>;
    packages?: readonly PackageInput[];
    agent?: Partial<AgentConfig>;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "pd-"));
  const cli = createScriptedCli({ dialect: "jsonl-stream", script: options.script ?? [{ out: { type: "turn.done" } }] });
  const wrapper = join(root, "binary.mjs");
  writeFileSync(
    wrapper,
    `if (process.argv.includes('--version')) { console.log('1.2.3'); process.exit(0); }\n${options.source ?? `await import(${JSON.stringify(cli.command[1])});`}`,
  );
  const base = testAdapter([process.execPath, wrapper]);
  const adapter = options.adapter?.(base) ?? base;
  const profiles = createProfiles({ root, driver: adapterDriver(adapter) });
  await profiles.create("me");
  let inspection: { inspect(): unknown } | undefined;
  const inspector = definePackage({
    name: "test-inspector",
    version: "1.0.0",
    requires: { api: 1 },
    setup(api) {
      inspection = api.services.consume(`driver-process:${adapter.name}`);
    },
  });
  const events: unknown[] = [];
  const store = createMemorySessionStore();
  let agent: Awaited<ReturnType<typeof createAgent>>;
  try {
    agent = await createAgent({
      ...options.agent,
      slots: { ...options.agent?.slots, store },
      hooks(hooks) {
        options.agent?.hooks?.(hooks);
        for (const name of ["package.event", "message.delta", "tool.started", "tool.completed"] as const)
          hooks.on(name, (event: unknown) => {
            events.push(event);
          });
      },
      packages: [
        ...(options.packages ?? []),
        processDriver(adapter)({ name: "worker", profile: "me", profilesRoot: root, graceMs: 100, ...options.config }),
        inspector,
      ],
    });
  } catch (error) {
    cli.dispose();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const session = await agent.session({ id: "test", create: true });
  return {
    root,
    adapter,
    cli,
    agent,
    session,
    events,
    store,
    inspection: () => inspection?.inspect(),
    async close() {
      await session.close();
      await agent.dispose();
      cli.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
