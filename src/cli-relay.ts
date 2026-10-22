import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import {
  isRelayAnswer,
  isRelayDescriptor,
  isRelayMcpFrame,
  RELAY_DESCRIPTOR_FILE,
  RELAY_MAX_BODY_BYTES,
  type RelayAnswer,
  type RelayDescriptor,
  relayHeader,
} from "./driver-kit/relay-protocol.js";

/** The streams the relay uses. `prism` passes its own process streams. */
export interface RelayRuntime {
  readonly stdin: AsyncIterable<Uint8Array | string>;
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

const USAGE = "usage: prism relay hook --run <run-dir> | prism relay mcp --run <run-dir>\n";

/**
 * `prism relay`: moves bytes between a vendor's hook or MCP stdio and the run's broker. It knows no dialect.
 * It prints the broker's answer verbatim, or the descriptor's fail-closed answer whenever it gets none.
 */
export async function runRelay(argv: readonly string[], runtime: RelayRuntime): Promise<number> {
  const [mode, flag, runDir, ...extra] = argv;
  if ((mode !== "hook" && mode !== "mcp") || flag !== "--run" || runDir === undefined || extra.length > 0) {
    runtime.stderr.write(USAGE);
    return 2;
  }
  const descriptor = await readDescriptor(runDir);
  if (descriptor === undefined) {
    // No readable descriptor: there is no fail-closed answer to print, so the hook exits 2 with empty stdout.
    runtime.stderr.write("relay: no readable relay descriptor in the run directory\n");
    return 2;
  }
  return mode === "hook" ? relayHook(descriptor, runtime) : relayMcp(descriptor, runtime);
}

async function readDescriptor(runDir: string): Promise<RelayDescriptor | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(runDir, RELAY_DESCRIPTOR_FILE), "utf8"));
    return isRelayDescriptor(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function relayHook(descriptor: RelayDescriptor, runtime: RelayRuntime): Promise<number> {
  const payload = await readAll(runtime.stdin);
  const answer = payload === undefined ? undefined : await exchangeHook(descriptor, payload);
  const chosen: RelayAnswer = answer ?? descriptor.failClosed;
  runtime.stdout.write(chosen.stdout);
  return chosen.exitCode;
}

/** One request, one answer line, bounded by the descriptor's timeout. Any failure resolves `undefined`. */
function exchangeHook(descriptor: RelayDescriptor, payload: string): Promise<RelayAnswer | undefined> {
  return new Promise((resolve) => {
    const socket = connect(descriptor.socket);
    let data = "";
    let settled = false;
    const settle = (value: RelayAnswer | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => settle(undefined), descriptor.timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.end(`${relayHeader("hook")}${payload}`));
    socket.on("data", (chunk: string) => {
      data += chunk;
      if (data.length > RELAY_MAX_BODY_BYTES) return settle(undefined);
      const newline = data.indexOf("\n");
      if (newline !== -1) settle(parseAnswer(data.slice(0, newline)));
    });
    socket.on("error", () => settle(undefined));
    socket.on("close", () => settle(undefined));
  });
}

function parseAnswer(line: string): RelayAnswer | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isRelayAnswer(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Bridges stdio JSON-RPC to the broker's MCP route. Each stdin line goes to the socket as it arrives, and each
 * response frame is written to stdout as the broker produces it. The run ends when the client closes stdin and
 * the broker has answered every request.
 */
function relayMcp(descriptor: RelayDescriptor, runtime: RelayRuntime): Promise<number> {
  return new Promise((resolve) => {
    const socket = connect(descriptor.socket);
    let buffered = "";
    let ended = false;
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(relayHeader("mcp"));
      void pipeStdin(runtime.stdin, socket);
    });
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      if (buffered.length > RELAY_MAX_BODY_BYTES) {
        socket.destroy();
        return;
      }
      for (let newline = buffered.indexOf("\n"); newline !== -1; newline = buffered.indexOf("\n")) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        const frame = parseFrame(line);
        if (frame !== undefined && frame.body !== "") runtime.stdout.write(`${frame.body}\n`);
      }
    });
    socket.on("end", () => {
      ended = true;
    });
    socket.on("error", () => {
      runtime.stderr.write("relay: the broker is unreachable\n");
    });
    socket.on("close", () => resolve(ended ? 0 : 2));
  });
}

async function pipeStdin(stdin: AsyncIterable<Uint8Array | string>, socket: import("node:net").Socket): Promise<void> {
  for await (const chunk of stdin) socket.write(chunk);
  socket.end();
}

function parseFrame(line: string): { status: number; body: string } | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isRelayMcpFrame(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function readAll(stdin: AsyncIterable<Uint8Array | string>): Promise<string | undefined> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stdin) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    if (text.length > RELAY_MAX_BODY_BYTES) return undefined;
  }
  return text + decoder.decode();
}
