#!/usr/bin/env node
/**
 * Spawnable ACP agent entrypoint (0.2.8 Task 10 / adoption F3).
 *
 * Reads a config file (default `prism-acp-agent.json`, override with
 * `--config <path>`), builds the ACP agent seams, and serves the protocol
 * over stdio via the SDK's ndjson stream adapter. The process lives until
 * the client closes stdin; EPIPE on stdout is a normal client disconnect.
 */
import { Readable, Writable } from "node:stream";
import { parseArgs } from "node:util";
import { type AgentApp, ndJsonStream } from "@agentclientprotocol/sdk";
import { createSpawnableAgent, loadConfig } from "../src/index.js";

const { values } = parseArgs({
  options: { config: { type: "string", short: "c" } },
  allowPositionals: false,
});

let agent: AgentApp;
try {
  agent = createSpawnableAgent({ config: loadConfig(values.config ?? "prism-acp-agent.json") });
} catch (error) {
  console.error(`prism-acp-agent: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);
try {
  const connection = await agent.connect(stream);
  await connection?.closed;
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code !== "EPIPE") console.error(`prism-acp-agent: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(code === "EPIPE" ? 0 : 1);
}
