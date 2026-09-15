import { connectE2BSandbox, createE2BSandbox, type E2BClient, type E2BSandboxInstance } from "@arnilo/prism-coding-tools/security";

const instance = (): E2BSandboxInstance => ({
  sandboxId: "sbx_demo",
  commands: {
    async run(_cmd, opts) {
      if (opts?.background) return { pid: 3, wait: async () => ({ exitCode: 0 }) };
      return { exitCode: 0, stdout: "ok\n", stderr: "" };
    },
    async kill() {
      return true;
    },
  },
  async pause() {
    return true;
  },
  async kill() {
    return true;
  },
});

const client: E2BClient = {
  Sandbox: {
    create: async () => instance(),
    connect: async () => instance(),
    getInfo: async () => ({ sandboxId: "sbx_demo", state: "paused", metadata: { "app.owner": "demo" } }),
    kill: async () => true,
  },
};

const sandbox = await createE2BSandbox({ client, labels: { "app.owner": "demo" } });
await sandbox.execFile({ file: "/bin/echo", args: ["hello"], cwd: "/workspace" });
const paused = await sandbox.pause!({ keepMemory: false });
const reconnected = await connectE2BSandbox({
  client,
  sandboxId: sandbox.id,
  expectedLabels: { "app.owner": "demo" },
});
await reconnected.kill();

console.log(
  JSON.stringify({
    id: sandbox.id,
    pauseKind: paused.kind,
    reconnectState: (await reconnected.status()).state,
    autoResume: false,
  }),
);
