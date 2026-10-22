import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { runRelay } from "../../cli-relay.js";
import { relayCommand } from "../relay-command.js";
import { RELAY_DESCRIPTOR_FILE } from "../relay-protocol.js";

const FAIL = { exitCode: 2, stdout: '{"fail":true}' };
const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runDirWith(descriptor: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  if (descriptor !== undefined) writeFileSync(join(dir, RELAY_DESCRIPTOR_FILE), JSON.stringify(descriptor));
  return dir;
}

async function relay(args: string[], input: string) {
  let stdout = "";
  let stderr = "";
  const code = await runRelay(args, {
    stdin: Readable.from([input]),
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
  });
  return { code, stdout, stderr };
}

/** A socket that accepts and never answers, so the relay's own timeout is the only way out. */
async function silentSocket(path: string) {
  const server = createServer((socket) => socket.on("data", () => undefined));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return server;
}

describe("prism relay", () => {
  it("relay_forwards_and_prints_broker_answer", async () => {
    const answer = { exitCode: 3, stdout: "from-broker" };
    const dir = runDirWith(undefined);
    const socket = join(dir, "relay.sock");
    const server = createServer((connection) => {
      connection.setEncoding("utf8");
      connection.on("data", () => undefined);
      connection.on("end", () => connection.end(`${JSON.stringify(answer)}\n`));
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    writeFileSync(join(dir, RELAY_DESCRIPTOR_FILE), JSON.stringify({ version: 1, socket, timeoutMs: 2_000, failClosed: FAIL }));
    try {
      const out = await relay(["hook", "--run", dir], '{"kind":"stop"}');
      assert.equal(out.code, 3);
      assert.equal(out.stdout, "from-broker");
    } finally {
      server.close();
    }
  });

  it("relay_fails_closed_on_timeout_and_missing_descriptor", async () => {
    const dir = runDirWith(undefined);
    const missing = await relay(["hook", "--run", dir], "{}");
    assert.equal(missing.code, 2);
    assert.equal(missing.stdout, "", "no descriptor means no fail-closed stdout");

    const socket = join(dir, "silent.sock");
    const server = await silentSocket(socket);
    try {
      writeFileSync(join(dir, RELAY_DESCRIPTOR_FILE), JSON.stringify({ version: 1, socket, timeoutMs: 100, failClosed: FAIL }));
      const started = Date.now();
      const slow = await relay(["hook", "--run", dir], '{"kind":"stop"}');
      assert.equal(slow.code, FAIL.exitCode);
      assert.equal(slow.stdout, FAIL.stdout);
      assert.ok(Date.now() - started < 2_000, "the relay honours its own timeout");
    } finally {
      server.close();
    }
  });

  it("relay_fails_closed_when_broker_stopped", async () => {
    const dir = runDirWith({ version: 1, socket: join(dir0(), "gone.sock"), timeoutMs: 500, failClosed: FAIL });
    const out = await relay(["hook", "--run", dir], '{"kind":"pre-tool"}');
    assert.equal(out.code, FAIL.exitCode);
    assert.equal(out.stdout, FAIL.stdout);
  });

  it("relay_rejects_usage_and_mcp_without_broker", async () => {
    const usage = await relay(["nope"], "");
    assert.equal(usage.code, 2);
    assert.match(usage.stderr, /usage: prism relay/);
    const dir = runDirWith({ version: 1, socket: join(dir0(), "gone.sock"), timeoutMs: 500, failClosed: FAIL });
    const mcp = await relay(["mcp", "--run", dir], '{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    assert.equal(mcp.code, 2);
    assert.match(mcp.stderr, /unreachable/);
  });

  it("relay_imports_only_relay_module", () => {
    const allowed = new Set(["cli-relay.ts", "relay-protocol.ts"]);
    const seen = new Set<string>();
    const queue = [join(srcDir, "cli-relay.ts")];
    const external: string[] = [];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (seen.has(file)) continue;
      seen.add(file);
      for (const match of readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
        const specifier = match[1] ?? "";
        if (specifier.startsWith("node:")) continue;
        if (!specifier.startsWith(".")) {
          external.push(`${file}: ${specifier}`);
          continue;
        }
        const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
        queue.push(target);
      }
    }
    assert.deepEqual(external, []);
    const names = [...seen].map((file) => file.split("/").pop() ?? file);
    assert.deepEqual(
      names.filter((name) => !allowed.has(name)),
      [],
      "the relay graph holds only the relay and its protocol",
    );
    assert.ok(existsSync(join(srcDir, "cli-relay.ts")));
  });

  it("relay_dispatches_from_the_cli_entry", () => {
    const dir = runDirWith({ version: 1, socket: join(dir0(), "gone.sock"), timeoutMs: 500, failClosed: FAIL });
    const result = spawnSync(process.execPath, [join(srcDir, "cli.ts"), "relay", "hook", "--run", dir], {
      input: '{"kind":"stop"}',
      encoding: "utf8",
    });
    assert.equal(result.status, FAIL.exitCode);
    assert.equal(result.stdout, FAIL.stdout);
  });

  it("relay_command_is_absolute_kernel_path", () => {
    const [exec, cli] = relayCommand();
    assert.equal(exec, process.execPath);
    assert.ok(cli !== undefined && resolve(cli) === cli, "absolute");
    assert.ok(existsSync(cli));
    assert.equal(cli, join(srcDir, existsSync(join(srcDir, "cli.js")) ? "cli.js" : "cli.ts"));
  });

  it("relay_command_spawns_the_relay", () => {
    const dir = runDirWith({ version: 1, socket: join(dir0(), "gone.sock"), timeoutMs: 500, failClosed: FAIL });
    const [command, ...args] = relayCommand();
    const out = spawnSync(command as string, [...args, "relay", "hook", "--run", dir], { input: '{"kind":"pre-tool"}', encoding: "utf8" });
    assert.equal(out.status, FAIL.exitCode);
    assert.equal(out.stdout, FAIL.stdout);
  });
});

function dir0(): string {
  return mkdtempSync(join(tmpdir(), "sock-"));
}
