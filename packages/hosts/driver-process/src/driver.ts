import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createSecretRedactor, definePackage, type PackageDefinition } from "@arnilo/prism";
import {
  ALL_TOOL_EFFECTS,
  assertIsolation,
  buildChildEnv,
  createCallbackBroker,
  createRunDirectory,
  type DriverBinary,
  type DriverConfig,
  type DriverDefinition,
  DriverError,
  type DriverRunContext,
  defineDriver,
  driverPackage,
  type HookCodec,
  materializeSkills,
  probeBinary,
  redactedStderr,
  relayCommand,
} from "@arnilo/prism/driver-kit";
import { processShutdown } from "./abort.js";
import { type AgentAdapter, assertAdapter, type ProcessDriverConfig, quoteCommand } from "./adapter.js";
import { ProcessDriverError } from "./errors.js";
import { inspectDriver } from "./inspect.js";
import { processSession } from "./session.js";
import { jsonRpc } from "./transports/json-rpc.js";
import { jsonlStream } from "./transports/jsonl-stream.js";
import { createTurn } from "./turn.js";

export function adapterDriver(adapter: AgentAdapter): DriverDefinition<ProcessDriverConfig> {
  assertAdapter(adapter);
  return defineDriver<ProcessDriverConfig>({
    name: adapter.name,
    revision: adapter.revision,
    vendor: adapter.descriptor.vendor,
    descriptor: adapter.descriptor,
    parseStatus: adapter.profile.parseStatus,
    config: {
      type: "object",
      properties: {
        ...(adapter.vendor ? { vendor: adapter.vendor } : {}),
        binary: { type: "string", minLength: 1 },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string", minLength: 1 },
        capture: { type: "string", enum: ["mapped", "all"], default: "mapped" },
        graceMs: { type: "integer", minimum: 1, default: 5000 },
      },
    },
    start: {
      async probe(config) {
        const command = config.binary ?? adapter.binary.command[0] ?? "";
        const output = await probeBinary(command, [...adapter.binary.command.slice(1), ...(adapter.binary.versionArgs ?? ["--version"])], {
          env: { modes: adapter.descriptor.auth.modes },
        });
        const version = output === undefined ? undefined : adapter.binary.version(output);
        return version ? { path: command, version } : undefined;
      },
      run: (ctx) => runAdapter(adapter, ctx),
    },
  });
}

export function processDriver(adapter: AgentAdapter): PackageDefinition<DriverConfig<ProcessDriverConfig>> {
  const definition = adapterDriver(adapter);
  const pkg = driverPackage(definition);
  // The kit owns the loop and guard; the package adds its inspection service at setup.
  return definePackage({
    ...pkg,
    capabilities: [...(pkg.capabilities ?? []), ...(adapter.requests ? ["host-ui" as const] : [])],
    async setup(prism) {
      let binary: DriverBinary | undefined;
      await driverPackage({
        ...definition,
        start: {
          ...definition.start,
          async probe(config) {
            binary = await definition.start.probe(config);
            return binary;
          },
        },
      }).setup(prism);
      const inspection = inspectDriver(adapter, prism.config, binary);
      prism.services.provide(`driver-process:${adapter.name}`, { inspect: () => structuredClone(inspection) });
      prism.status.note("info", JSON.stringify(inspection));
    },
  });
}

const noHooks: HookCodec = {
  decode() {
    throw new Error("adapter has no hook channel");
  },
  encode() {
    return { exitCode: 2, stdout: "" };
  },
};

async function runAdapter(adapter: AgentAdapter, ctx: DriverRunContext<ProcessDriverConfig>): Promise<void> {
  const { run, spec, config, lease } = ctx;
  if (!lease) throw new DriverError("profile_invalid", "process driver needs a profile lease");
  const bound = ctx.services
    .consume<{ worktree: { bound(id: string): { path: string } | undefined } }>("workspace")
    ?.worktree.bound(run.session.id);
  assertIsolation(adapter.descriptor, { isolation: spec.isolation, ...(bound ? { worktree: bound.path } : {}) });
  const cwd = resolve(bound?.path ?? config.cwd ?? process.cwd());
  let redact = <T>(value: T): T => value;
  const hooks = adapter.hooks;
  const dir = await createRunDirectory(lease.home, randomUUID().slice(0, 8));
  try {
    const session = await processSession(adapter, ctx, { runDir: dir, home: lease.home, cwd }, (value) => redact(value));
    const turn = createTurn(adapter, ctx, (value) => redact(value), session.archive);
    if (session.resume.sessionId) turn.encoding.sessionId = session.resume.sessionId;
    const broker = await createCallbackBroker(
      {
        ...run,
        end: () => turn.enqueue(turn.end),
        ask: (request, support) => turn.enqueue(() => run.ask(request, support)),
        observe: (activity) => turn.enqueue(() => run.observe(redact(activity))),
      },
      {
        runDir: dir.path,
        hookCodec: hooks
          ? {
              decode: (stdin) => {
                const event = hooks.codec.decode(stdin);
                return event.kind === "pre-tool" && event.request.effects.length === 0
                  ? { ...event, request: { ...event.request, effects: ALL_TOOL_EFFECTS } }
                  : event;
              },
              encode: (answer) => hooks.codec.encode(answer),
            }
          : noHooks,
        failClosed: adapter.hooks?.failClosed ?? { exitCode: 2, stdout: "" },
        timeoutMs: adapter.hooks?.timeoutMs ?? 5000,
        askSupport: { rewrite: adapter.descriptor.controls.rewrite },
      },
    );
    try {
      let served: Awaited<ReturnType<typeof import("@arnilo/prism-hosts/mcp-server").serveTools>> | undefined;
      try {
        if (spec.prismTools?.length || adapter.permissionTool) {
          const { serveTools } = await import("@arnilo/prism-hosts/mcp-server");
          served = await serveTools(run, {
            broker,
            tools: ctx.tools,
            allow: spec.prismTools ?? [],
            transport: "loopback-http",
            origin: { kind: "external", agent: spec.name, agentId: spec.name, vendor: adapter.descriptor.vendor, depth: 0 },
            ...(adapter.permissionTool
              ? { permissionTool: { name: adapter.permissionTool, rewrite: adapter.descriptor.controls.rewrite } }
              : {}),
          });
        }
        const skills = spec.skills === undefined ? undefined : await materializeSkills(dir, ctx.skills, spec.skills);
        const argv = [...relayCommand(), "relay", "hook", "--run", dir.path];
        const plan = await adapter.configure(spec, {
          runDir: dir,
          resume: session.resume,
          ...(session.resume.sessionId ? { sessionId: session.resume.sessionId } : {}),
          home: lease.home,
          cwd,
          hook: { argv, command: quoteCommand(argv) },
          ...(served ? { endpoint: served.endpoint } : {}),
          ...(skills ? { skills } : {}),
        });
        for (const file of plan.files ?? []) await dir.writeFile(file.path, file.content);
        if (plan.overlays?.length) await dir.overlay(cwd, plan.overlays);
        const redactor = createSecretRedactor([
          broker.token,
          ...Object.values(plan.env ?? {}),
          ...adapter.descriptor.auth.modes.flatMap((mode) => mode.protected.env.map((name) => process.env[name])),
        ]);
        redact = (value) => redactor.redact(value);
        const env = buildChildEnv({
          modes: adapter.descriptor.auth.modes,
          paths: { ...plan.env, ...(lease.mode.homeEnv ? { [lease.mode.homeEnv]: lease.home } : {}), ...served?.env },
        });
        try {
          const completed = await converse(
            adapter,
            ctx,
            [...adapter.binary.command.slice(1), ...(config.args ?? []), ...(session.resume.args ?? []), ...(plan.args ?? [])],
            cwd,
            env,
            redactor,
            turn,
            session.resume,
          );
          if (completed && !run.signal.aborted) await session.archive(turn.encoding);
        } catch (error) {
          if (error instanceof Error) {
            error.message = redactor.redact(error.message);
            error.stack = redactor.redact(error.stack);
          }
          throw error;
        }
      } finally {
        await served?.close();
      }
    } finally {
      await broker.close();
    }
  } finally {
    await dir.dispose();
  }
}

async function converse(
  adapter: AgentAdapter,
  ctx: DriverRunContext<ProcessDriverConfig>,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  redactor: ReturnType<typeof createSecretRedactor>,
  turn: ReturnType<typeof createTurn>,
  resume: import("./adapter.js").ResumeContext,
): Promise<boolean> {
  const { run, binary, config, tools, spec } = ctx;
  if (run.signal.aborted) return false;
  const child: ChildProcessWithoutNullStreams = spawn(binary.path, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => undefined);
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  const exited = new Promise<void>((resolveExit) => child.once("close", () => resolveExit()));
  const stderr = redactedStderr(child.stderr, redactor, { maxBytes: 8192 });
  const { encoding } = turn;
  const transport =
    adapter.transport === "json-rpc"
      ? jsonRpc(child, adapter, ctx, encoding, (value) => redactor.redact(value))
      : jsonlStream(child, (text) => redactor.redact(text));
  const steers = run.steers()[Symbol.asyncIterator]();
  let steeringError: unknown;
  let finished = false;
  const shutdown = processShutdown(child, exited, adapter, transport, encoding, config.graceMs ?? 5000);
  let aborted = false;
  const abort = () => {
    aborted = true;
    void shutdown.abort();
  };
  run.signal.addEventListener("abort", abort, { once: true });
  try {
    for (const frame of adapter.open?.({
      ...encoding,
      resume,
      tools: tools.filter((tool) => spec.prismTools?.includes(tool.name)),
    }) ?? [])
      if (transport.open) {
        for (const result of (await transport.open(frame)) ?? []) {
          if (await turn.frame(result, transport.send)) return true;
        }
      } else await transport.send(frame);
    await transport.send(adapter.encode.prompt(run.input, encoding));
    const consumeSteers = async () => {
      while (!finished) {
        const next = await steers.next();
        if (next.done || finished) break;
        await turn.steer(next.value, transport.send);
      }
    };
    void consumeSteers().catch((error) => {
      steeringError = error;
      void shutdown.failure();
    });
    let ended = false;
    for await (const item of transport.frames) {
      if (run.signal.aborted) break;
      if (await turn.frame(item, transport.send)) {
        ended = true;
        break;
      }
    }
    if (steeringError) throw steeringError;
    if (!ended && !run.signal.aborted) {
      await shutdown.failure();
      await stderr.done;
      throw new ProcessDriverError(
        "vendor_process_exited",
        `${spawnError ? "could not start process" : "process exited before turnEnd"}${stderr.text() ? `: ${stderr.text()}` : ""}`,
      );
    }
    return ended && !run.signal.aborted;
  } catch (error) {
    if (run.signal.aborted) return false;
    if (error instanceof ProcessDriverError && error.code === "vendor_limit") await shutdown.abort();
    throw error;
  } finally {
    finished = true;
    await steers.return?.();
    // A turn may finish while the process keeps listening; reap it before removing its files.
    if (aborted) await shutdown.abort();
    else await shutdown.graceful();
    await exited;
    run.signal.removeEventListener("abort", abort);
    await stderr.done;
    await transport.close();
    await turn.finish();
  }
}
