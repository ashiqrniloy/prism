#!/usr/bin/env node
/**
 * `prism-devtools`: serves the developer inspector over a manifest-built agent, on loopback.
 *
 * `--model provider/model` picks the provider the manifest packages registered. `--root` defaults to the
 * current directory, and the project scope loads only with `--trust-project` (roadmap §2.7). The bin is
 * loopback-only: a remote bind belongs to a programmatic `serveDevtools(agent, { hostname, token })` call.
 */
import type { Agent } from "@arnilo/prism";
import { createAgent } from "@arnilo/prism";
import { loadManifest, ManifestError } from "@arnilo/prism/manifest";
import { type DevtoolsArgs, DevtoolsArgsError, parseDevtoolsArgs, serveDevtools } from "../src/index.js";

/** Assemble the served agent from the manifest. The only `createAgent` call in this package. */
export async function buildAgent(args: DevtoolsArgs): Promise<Agent> {
  const packages = await loadManifest({
    ...(args.root === undefined ? {} : { root: args.root }),
    scopes: ["user", "project"],
    ...(args.trustProject ? { trustProject: () => true } : {}),
  });
  return createAgent({ id: "prism-devtools", model: args.model, packages });
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: DevtoolsArgs;
  try {
    args = parseDevtoolsArgs(argv);
  } catch (error) {
    if (!(error instanceof DevtoolsArgsError)) throw error;
    console.error(`prism-devtools: ${error.message}`);
    return 1;
  }

  let agent: Agent;
  try {
    agent = await buildAgent(args);
  } catch (error) {
    const detail =
      error instanceof ManifestError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
    console.error(`prism-devtools: ${detail}`);
    return 1;
  }

  let devtools: ReturnType<typeof serveDevtools>;
  try {
    devtools = serveDevtools(agent, { port: args.port });
  } catch (error) {
    await agent.dispose();
    console.error(`prism-devtools: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  console.log(`prism-devtools → ${devtools.url} (press Ctrl+C to stop)`);

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await devtools.close();
  await agent.dispose();
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
