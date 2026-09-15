import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  argvCommand,
  connectE2BSandbox,
  createE2BProcessRecoveryBackend,
  createE2BSandbox,
  decodeE2BProcessRef,
  type E2BClient,
  type E2BCommandHandle,
  E2BSandboxError,
  type E2BSandboxInfo,
  type E2BSandboxInstance,
  encodeE2BProcessRef,
  posixQuote,
  resolveE2BCapabilities,
} from "../e2b-sandbox.js";

class BusyError extends Error {
  readonly statusCode = 503;
  constructor() {
    super("503: node is busy snapshotting");
    this.name = "ServiceBusyError";
  }
}

function handle(pid: number, wait: () => Promise<{ exitCode: number | null }> = async () => ({ exitCode: 0 })): E2BCommandHandle {
  return { pid, wait };
}

function fakeClient(script: {
  sandboxId?: string;
  state?: string;
  metadata?: Record<string, string>;
  create?: (opts: unknown) => Promise<E2BSandboxInstance> | E2BSandboxInstance;
  connect?: (id: string) => Promise<E2BSandboxInstance>;
  getInfo?: (id: string) => Promise<E2BSandboxInfo>;
  pause?: (opts?: { keepMemory?: boolean }) => Promise<boolean | undefined>;
  kill?: () => Promise<boolean | undefined>;
  run?: E2BSandboxInstance["commands"]["run"];
  connectPid?: (pid: number) => Promise<E2BCommandHandle>;
  list?: E2BSandboxInstance["commands"]["list"];
  sendStdin?: E2BSandboxInstance["commands"]["sendStdin"];
  killPid?: E2BSandboxInstance["commands"]["kill"];
}): { client: E2BClient; calls: string[] } {
  const calls: string[] = [];
  const sandboxId = script.sandboxId ?? "sbx_test";
  const instance = (): E2BSandboxInstance => ({
    sandboxId,
    commands: {
      run:
        script.run ??
        (async (cmd, opts) => {
          calls.push(`run:${cmd}:${opts?.background ? "bg" : "fg"}`);
          if (opts?.background) return handle(7);
          opts?.onStdout?.("ok\n");
          return { exitCode: 0, stdout: "ok\n", stderr: "" };
        }),
      connect: script.connectPid,
      list: script.list,
      sendStdin: script.sendStdin,
      kill: script.killPid ?? (async () => true),
    },
    pause: async (opts) => {
      calls.push(`pause:${opts?.keepMemory !== false}`);
      return script.pause ? await script.pause(opts) : true;
    },
    kill: async () => {
      calls.push("kill");
      return script.kill ? await script.kill() : true;
    },
    getInfo: async () => ({ sandboxId, state: script.state ?? "running", metadata: script.metadata ?? { "app.owner": "alice" } }),
  });
  const client: E2BClient = {
    Sandbox: {
      create: async (templateOrOpts, opts) => {
        calls.push(`create:${typeof templateOrOpts === "string" ? templateOrOpts : "base"}`);
        const lifecycle = (opts ?? (typeof templateOrOpts === "object" ? templateOrOpts : undefined)) as
          | { lifecycle?: { autoResume?: boolean } }
          | undefined;
        assert.equal(lifecycle?.lifecycle?.autoResume, false);
        return script.create ? await script.create(templateOrOpts) : instance();
      },
      connect: async (id) => {
        calls.push(`connect:${id}`);
        return script.connect ? await script.connect(id) : instance();
      },
      getInfo: async (id) => {
        calls.push(`getInfo:${id}`);
        if (script.getInfo) return script.getInfo(id);
        return {
          sandboxId: id,
          state: script.state ?? "running",
          metadata: script.metadata ?? { "app.owner": "alice" },
          templateId: "base",
        };
      },
      pause: async (id, opts) => {
        calls.push(`api.pause:${id}:${opts?.keepMemory !== false}`);
        return true;
      },
      kill: async (id) => {
        calls.push(`api.kill:${id}`);
        return true;
      },
    },
  };
  return { client, calls };
}

describe("e2b sandbox hermetic", () => {
  it("quotes argv without interpolation", () => {
    assert.equal(posixQuote("it's"), `'it'\\''s'`);
    assert.equal(argvCommand("/bin/echo", ["a b", "x"]), `'/bin/echo' 'a b' 'x'`);
  });

  it("round-trips process refs and rejects tampering", () => {
    const ref = encodeE2BProcessRef({ version: 1, sandboxId: "sbx_a", pid: 9, commandFingerprint: "abc", workspace: "/workspace" });
    assert.equal(decodeE2BProcessRef(ref)?.pid, 9);
    assert.equal(decodeE2BProcessRef("prism-docker-proc:nope"), null);
    const decoded = decodeE2BProcessRef(ref)!;
    const tampered = encodeE2BProcessRef({ ...decoded, sandboxId: "sbx_other" });
    assert.notEqual(tampered, ref);
  });

  it("does not claim Docker isolation/egress parity", () => {
    const caps = resolveE2BCapabilities();
    assert.equal(caps.workspaceCoherent, true);
    assert.equal(caps.filesystemIsolated, true);
    assert.equal(caps.networkIsolated, false);
    assert.equal(caps.egressRestricted, false);
    assert.equal(caps.privilegeIsolated, false);
    assert.equal(resolveE2BCapabilities({ networkIsolated: true }).networkIsolated, true);
    assert.equal(resolveE2BCapabilities({ networkIsolated: true }).workspaceCoherent, false);
  });

  it("requires apiKey or client and never enables autoResume", async () => {
    await assert.rejects(() => createE2BSandbox({}), /apiKey or client/);
    const { client, calls } = fakeClient({});
    const sandbox = await createE2BSandbox({ client, labels: { "app.owner": "alice" } });
    assert.ok(calls.some((c) => c.startsWith("create:")));
    assert.equal(sandbox.id, "sbx_test");
    assert.equal(typeof sandbox.startProcess, "function");
    assert.equal(typeof sandbox.pause, "function");
    const result = await sandbox.execFile({ file: "/bin/echo", args: ["hi"], cwd: "/workspace" });
    assert.equal(result.exitCode, 0);
    await sandbox.close();
  });

  it("starts, attaches, and recovers a process; wrong owner/ref fail closed", async () => {
    const { client } = fakeClient({
      metadata: { "app.owner": "alice" },
      connectPid: async (pid) => handle(pid),
      list: async () => [{ pid: 7, cmd: "/bin/sleep", args: ["30"] }],
    });
    const sandbox = await createE2BSandbox({ client, labels: { "app.owner": "alice" } });
    const proc = await sandbox.startProcess!({ file: "/bin/sleep", args: ["30"] });
    assert.ok(proc.ref?.startsWith("prism-e2b-proc:"));
    const attached = await sandbox.attachProcess!(proc.ref!);
    assert.equal(attached?.pid, 7);
    const other = encodeE2BProcessRef({
      version: 1,
      sandboxId: "sbx_other",
      pid: 7,
      commandFingerprint: decodeE2BProcessRef(proc.ref!)!.commandFingerprint,
      workspace: "/workspace",
    });
    assert.equal(await sandbox.attachProcess!(other), null);
    const backend = createE2BProcessRecoveryBackend(sandbox, { expectedSandboxId: sandbox.id, expectedLabels: { "app.owner": "alice" } });
    assert.ok(await backend.attach(proc.ref!));
    const foreign = createE2BProcessRecoveryBackend(sandbox, { expectedSandboxId: "nope" });
    assert.equal(await foreign.attach(proc.ref!), null);
    await sandbox.close();
  });

  it("filesystem-only pause reports process loss; memory pause keeps the kind", async () => {
    const { client } = fakeClient({});
    const sandbox = await createE2BSandbox({ client });
    const proc = await sandbox.startProcess!({ file: "/bin/sleep", args: ["9"] });
    const paused = await sandbox.pause!({ keepMemory: false });
    assert.equal(paused.kind, "filesystem");
    assert.equal(paused.state, "paused");
    const status = await sandbox.status();
    assert.equal(status.state, "stopped");
    assert.equal(status.snapshot?.kind, "filesystem");
    assert.equal(await sandbox.attachProcess!(proc.ref!), null);
    await assert.rejects(() => sandbox.execFile({ file: "/bin/true", args: [] }), /paused; call resume/);
    await sandbox.resume!();
    assert.equal((await sandbox.status()).state, "running");
    assert.equal(await sandbox.attachProcess!(proc.ref!), null);
    await sandbox.close();
  });

  it("refused pause stays running", async () => {
    const { client } = fakeClient({
      pause: async () => {
        throw new BusyError();
      },
    });
    const sandbox = await createE2BSandbox({ client });
    await assert.rejects(
      () => sandbox.pause!(),
      (error: unknown) => {
        assert.ok(error instanceof E2BSandboxError);
        assert.equal(error.statusCode, 503);
        assert.match(error.message, /still running/);
        return true;
      },
    );
    assert.equal((await sandbox.status()).state, "running");
    await sandbox.execFile({ file: "/bin/true", args: [] });
    await sandbox.close();
  });

  it("reconnects by sandbox id without auto-resume, then resumes explicitly", async () => {
    const { client, calls } = fakeClient({ state: "paused", metadata: { "app.owner": "alice" } });
    const paused = await connectE2BSandbox({ client, sandboxId: "sbx_test", expectedLabels: { "app.owner": "alice" } });
    assert.equal((await paused.status()).state, "stopped");
    assert.equal(calls.includes("connect:sbx_test"), false);
    await paused.resume!();
    assert.ok(calls.includes("connect:sbx_test"));
    await paused.close();
  });

  it("rejects wrong-owner reconnect and missing sandboxes", async () => {
    const { client } = fakeClient({ state: "running", metadata: { "app.owner": "alice" } });
    await assert.rejects(
      () => connectE2BSandbox({ client, sandboxId: "sbx_test", expectedLabels: { "app.owner": "mallory" } }),
      /label mismatch/,
    );
    const missing = fakeClient({
      getInfo: async () => {
        const error = new Error("404: not found") as Error & { statusCode: number };
        error.statusCode = 404;
        throw error;
      },
    });
    await assert.rejects(() => connectE2BSandbox({ client: missing.client, sandboxId: "sbx_gone" }), /not found/);
  });

  it("close({ export }) is unsupported; kill is explicit deletion", async () => {
    const { client, calls } = fakeClient({});
    const sandbox = await createE2BSandbox({ client });
    await assert.rejects(() => sandbox.close({ export: async () => undefined }), /pause\(\) is the snapshot/);
    await sandbox.kill();
    assert.ok(calls.includes("kill"));
    assert.equal((await sandbox.status()).state, "removed");
  });

  it("redacts apiKey from surfaced errors", async () => {
    const secret = "e2b_live_secret_value";
    const { client } = fakeClient({
      run: async (cmd) => {
        if (cmd.includes("/bin/true")) throw new Error(`upstream leaked ${secret}`);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    const sandbox = await createE2BSandbox({ client, apiKey: secret });
    await assert.rejects(
      () => sandbox.execFile({ file: "/bin/true", args: [] }),
      (error: unknown) => {
        assert.ok(error instanceof E2BSandboxError);
        assert.equal(error.message.includes(secret), false);
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      },
    );
    await sandbox.close();
  });
});
