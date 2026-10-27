import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, AgentEvent, HostUi } from "@arnilo/prism";
import { connectAgent, remoteHostUi, type ServedAgent, serveAgent } from "./index.js";

export type ConformanceTransport = "stdio" | "websocket" | "http";
export interface RemoteConformanceFactory {
  readonly module: string;
  readonly prompts: { readonly run: string; readonly approve: string };
}
export interface RemoteConformanceOptions {
  readonly transports?: readonly ConformanceTransport[];
  readonly timeoutMs?: number;
}
export interface RemoteConformanceLeg {
  readonly transport: ConformanceTransport;
  readonly leg: string;
  readonly passed: boolean;
  readonly error?: string;
}
export interface RemoteConformanceResult {
  readonly legs: readonly RemoteConformanceLeg[];
  readonly failures: readonly RemoteConformanceLeg[];
}
/** A factory owns its packages and persistent store; stateDirectory survives stdio reconnects. */
export type RemoteAgentFactory = (options: { hostUi: HostUi; stateDirectory: string }) => Promise<Agent>;

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
async function deadline<T>(work: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Exercise the public Agent contract through real transports, without constructing an agent. */
export async function remoteConformance(
  factory: RemoteConformanceFactory,
  options: RemoteConformanceOptions = {},
): Promise<RemoteConformanceResult> {
  // host-gate: the conformance factory module path is supplied by the caller at runtime.
  const create: RemoteAgentFactory = (await import(factory.module)).create;
  assert.equal(typeof create, "function", "factory module must export create");
  const legs: RemoteConformanceLeg[] = [];
  for (const transport of options.transports ?? ["stdio", "websocket", "http"]) {
    for (const leg of ["run", "stream", "steer", "abort", "resume", "HostUi", "commands", "suspension on disconnect"]) {
      const directory = await mkdtemp(join(tmpdir(), "prism-remote-conformance-"));
      let served: ServedAgent | undefined;
      let backend: Agent | undefined;
      let proxy: Agent | undefined;
      let stdioOpens = 0;
      let stopped = false;
      let asked = 0;
      const waitFor = async (check: () => boolean) => {
        while (!check()) {
          if (stopped) throw new Error("leg stopped");
          await pause();
        }
      };
      let mode: "answer" | "unavailable" | "hold" = "answer";
      let release: (() => void) | undefined;
      const ui: HostUi = {
        async request(request) {
          asked++;
          if (mode === "hold")
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          if (mode !== "answer") return { status: "unavailable" };
          return { status: "answered", value: request.kind === "select" ? "once" : true } as never;
        },
      };
      const open = async () => {
        if (transport === "stdio") {
          return connectAgent(
            {
              kind: "stdio",
              command: [
                process.execPath,
                fileURLToPath(new URL("./testing-fixtures/serve-stdio.ts", import.meta.url)),
                factory.module,
                directory,
              ],
              env: { PRISM_CONFORMANCE_DRAIN: leg === "suspension on disconnect" && stdioOpens++ === 0 ? "1" : "0" },
            },
            { host: { ui } },
          );
        }
        if (!served) {
          const hostUi = remoteHostUi();
          backend = await create({ hostUi, stateDirectory: directory });
          served = serveAgent(backend, { transport: { kind: transport, port: 0 }, hostUi });
          await served.ready;
        }
        assert.ok(served.url && served.token, "network listener has no endpoint or token");
        return connectAgent({ kind: transport, url: served.url, token: served.token }, { host: { ui } });
      };
      const checkEvents = (events: AgentEvent[]) => {
        assert.ok(events.length > 0, "no events received");
        for (const event of events) {
          assert.ok(event.origin?.remote, "event missing origin.remote");
          if (served?.token) assert.ok(!JSON.stringify(event).includes(served.token), "token leaked in event");
        }
      };
      const collect = async (events: AsyncIterable<AgentEvent>) => {
        const collected: AgentEvent[] = [];
        for await (const event of events) collected.push(event);
        checkEvents(collected);
        return collected;
      };
      try {
        await deadline(
          (async () => {
            proxy = await open();
            const session = await proxy.session();
            if (leg === "run") {
              const events = collect(session.subscribe());
              assert.equal((await session.run(factory.prompts.run)).status, "completed");
              await events;
            } else if (leg === "stream") {
              const local = await create({ hostUi: ui, stateDirectory: join(directory, "local") });
              try {
                const expected: string[] = [];
                for await (const event of (await local.session()).stream(factory.prompts.run)) expected.push(event.type);
                const events = await collect(session.stream(factory.prompts.run));
                assert.deepEqual(
                  events.map((event) => event.type),
                  expected,
                  "stream event order differs from local",
                );
              } finally {
                await local.dispose();
              }
            } else if (leg === "HostUi") {
              assert.equal((await session.run(factory.prompts.approve)).status, "completed");
              assert.ok(asked > 0, "approval never reached client HostUi");
            } else if (leg === "commands") {
              const local = await create({ hostUi: ui, stateDirectory: join(directory, "local") });
              try {
                assert.deepEqual(proxy.commands.list(), local.commands.list());
                const command = proxy.commands.list()[0];
                assert.ok(command, "fixture needs a command without required arguments");
                const name = command.name;
                assert.deepEqual(await proxy.commands.run(name), await local.commands.run(name));
              } finally {
                await local.dispose();
              }
            } else if (leg === "resume") {
              mode = "unavailable";
              const result = await session.run(factory.prompts.approve);
              assert.equal(result.status, "suspended");
              assert.ok(result.pending?.length, "no pending approval");
              mode = "answer";
              const events = await collect(
                session.resume(result.pending.map((item) => ({ approvalId: item.approvalId, outcome: "allow_once" }))),
              );
              assert.equal(events.at(-1)?.type, "run.completed");
            } else if (leg === "steer" || leg === "abort") {
              mode = "hold";
              const running = session.run(factory.prompts.approve);
              await waitFor(() => asked > 0);
              if (leg === "steer") session.steer(factory.prompts.run);
              else session.abort();
              mode = "answer";
              release?.();
              const result = await running;
              assert.equal(result.status, leg === "abort" ? "aborted" : "completed", JSON.stringify(result));
              if (leg === "steer") assert.ok(JSON.stringify(await session.messages()).includes(factory.prompts.run), "steering input lost");
            } else {
              mode = "hold";
              const running = session.run(factory.prompts.approve).catch(() => undefined);
              await waitFor(() => asked > 0);
              const id = session.id;
              await proxy.dispose();
              await running;
              release?.();
              // A stdio disconnect terminates the owned child. The fixture drains suspension before exit.
              if (transport === "stdio") {
                while (true) {
                  if (stopped) throw new Error("leg stopped");
                  try {
                    await access(join(directory, "stdio-drained"));
                    break;
                  } catch {
                    await pause();
                  }
                }
              }
              mode = "hold";
              const before = asked;
              proxy = await open();
              const reopened = await proxy.session({ id });
              await waitFor(() => asked > before);
              const completed = collect(reopened.subscribe());
              mode = "answer";
              release?.();
              const events = await completed;
              assert.equal(events.at(-1)?.type, "run.completed");
            }
          })(),
          options.timeoutMs ?? 2000,
          `${transport}/${leg}`,
        );
        legs.push({ transport, leg, passed: true });
      } catch (error) {
        // Avoid echoing a credential even when an assertion includes a remote payload.
        const message = error instanceof Error ? error.message : "conformance failed";
        legs.push({ transport, leg, passed: false, error: served?.token ? message.replaceAll(served.token, "[redacted]") : message });
      } finally {
        stopped = true;
        release?.();
        await proxy?.dispose();
        await served?.close();
        await backend?.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
  return { legs, failures: legs.filter((leg) => !leg.passed) };
}
