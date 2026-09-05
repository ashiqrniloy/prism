/**
 * Packed-install CLI live journey (plans/064 Task 5).
 *
 * Packs the root umbrella + @arnilo/prism-providers into a fresh consumer, then
 * drives the real `prism` bin from that install: `init --provider <id>`
 * scaffold (generated offline test passes), `providers add` scaffold, and
 * print/json/rpc modes over the chosen provider's real wire. The provider is
 * the first init-catalog entry whose credential env var is present (override
 * with PRISM_LIVE_CLI_PROVIDER); requires PRISM_LIVE_PROVIDER_TESTS=1 and at
 * least one provider key — otherwise the run skips.
 *
 * Every spawn transcript is captured; the final test asserts the key never
 * appears in any of them.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createPackedConsumer, repoRoot } from "./fixtures/packed-consumer.mjs";

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const catalog = JSON.parse(readFileSync(join(repoRoot, "templates", "init", "providers.json"), "utf8"));
const requested = process.env.PRISM_LIVE_CLI_PROVIDER;
const providerId =
  requested ??
  Object.values(catalog)
    .filter((e) => e.factoryModule && process.env[e.envKey])
    .map((e) => e.id)[0];
const spec = catalog[providerId];
const API_KEY = spec ? process.env[spec.envKey] : undefined;

if (!LIVE || !spec || !API_KEY) {
  const why = !LIVE
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 plus a provider credential"
    : !spec
      ? `PRISM_LIVE_CLI_PROVIDER=${requested} is not in the init catalog`
      : `no catalog provider credential found (set one of: ${Object.values(catalog)
          .filter((e) => e.envKey)
          .map((e) => e.envKey)
          .join(", ")})`;
  console.log(`[e2e-cli-live] SKIP: ${why}`);
  process.exit(0); // skip-not-fail: matrix treats empty run as skip
}

const CEILING_MS = 120_000;
const PROMPT = "Reply with exactly the word: pong";
/** Placeholder/expired keys happen: provider-side 401/403 means the credential
 *  is unavailable (skip-not-fail invariant), not that the CLI is broken — the
 *  hermetic CLI/adapter tests own the auth-header wiring. */
function isCredentialRejected(text) {
  return (
    /\b(401|403)\b/.test(text) && /invalid[_ ]api[_ ]key|missing authentication|unauthorized|incorrect api key|invalid api key/i.test(text)
  );
}

const packages = [
  { dir: ".", name: "@arnilo/prism" },
  { dir: "packages/prism-providers", name: "@arnilo/prism-providers" },
];
const packed = createPackedConsumer(packages);
after(() => packed.cleanup());
if (packed.installStatus !== 0) {
  console.log(`[e2e-cli-live] SKIP: packed install failed\n${packed.installOut.slice(0, 2000)}`);
  process.exit(0);
}

const consumer = packed.consumer;
const cli = join(consumer, "node_modules", "@arnilo/prism", "dist", "cli.js");
const env = { ...process.env, [spec.envKey]: API_KEY };
/** Every spawn transcript, for the leak scan. */
const transcripts = [];

function record(tag, result) {
  transcripts.push({ tag, out: result.stdout ?? "", err: result.stderr ?? "" });
  return result;
}

function runCli(args, cwd = consumer, timeoutMs = 60_000) {
  return record(args.join(" "), spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8", timeout: timeoutMs }));
}

describe(`packed-install CLI live journey (${providerId} over the real wire)`, { timeout: CEILING_MS }, () => {
  it(`prism init --provider ${providerId} scaffolds a project whose generated offline test passes`, () => {
    const init = runCli(["init", "app", "--provider", providerId]);
    assert.equal(init.status, 0, init.stdout + init.stderr);
    const app = join(consumer, "app");
    for (const rel of ["package.json", "src/agent.ts", "src/__tests__/agent.test.ts"]) {
      assert.ok(existsSync(join(app, rel)), `scaffold missing ${rel}`);
    }
    const agentSrc = readFileSync(join(app, "src", "agent.ts"), "utf8");
    assert.match(agentSrc, new RegExp(spec.factoryExport));
    assert.match(agentSrc, new RegExp(`process\\.env\\.${spec.envKey}`), "scaffold must read the key from env, never inline it");
    // Generated offline test runs against the packed install (mock provider, no network).
    const test = record(
      "generated test",
      spawnSync(process.execPath, ["--test", join("app", "src", "__tests__", "agent.test.ts")], {
        cwd: consumer,
        encoding: "utf8",
        timeout: 60_000,
      }),
    );
    assert.equal(test.status, 0, test.stdout + test.stderr);
  });

  it("prism providers add scaffolds an adapter package", () => {
    const add = runCli(["providers", "add", "acme", "--base-url", "https://api.acme.example/v1", "--env-key", "ACME_API_KEY"]);
    assert.equal(add.status, 0, add.stdout + add.stderr);
    const pkg = join(consumer, "acme");
    assert.ok(existsSync(join(pkg, "package.json")), "providers add must write a package manifest");
    assert.ok(existsSync(join(pkg, "src", "provider.ts")), "providers add must write the provider module");
  });

  it("print mode completes a real one-shot prompt", (t) => {
    const run = runCli(["--provider", providerId, "--mode", "print", "-p", PROMPT]);
    if (isCredentialRejected(run.stdout + run.stderr))
      return t.skip(`provider rejected ${spec.envKey} (401/403) — refresh the credential and rerun`);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.trim().length > 0, "print mode produced no text");
  });

  it("json mode emits well-formed event envelopes", (t) => {
    const run = runCli(["--provider", providerId, "--mode", "json", "-p", PROMPT]);
    if (isCredentialRejected(run.stdout + run.stderr))
      return t.skip(`provider rejected ${spec.envKey} (401/403) — refresh the credential and rerun`);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const lines = run.stdout.split("\n").filter((l) => l.trim());
    assert.ok(lines.length > 0, "json mode produced no output");
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.equal(parsed.type, "event");
      assert.ok(parsed.event, "envelope missing event payload");
    }
  });

  it("rpc mode drives prompt → state → abort over the real stdio wire", async (t) => {
    const child = spawn(process.execPath, [cli, "--provider", providerId, "--mode", "rpc"], {
      cwd: consumer,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const transcript = { tag: "rpc", out: "", err: "" };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (transcript.out += d));
    child.stderr.on("data", (d) => (transcript.err += d));
    transcripts.push(transcript);

    const _pending = new Map();
    const lines = [];
    let notify;
    child.stdout.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        lines.push(line);
        notify?.();
      }
    });
    const wait = () => new Promise((r) => (notify = r));
    /** Next response (ok/error envelope) for `id` — event lines are ignored here. */
    async function waitFor(id, timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = lines.find((l) => {
          try {
            const parsed = JSON.parse(l);
            return parsed.id === id && (parsed.ok === true || parsed.ok === false) && parsed.type !== "event";
          } catch {
            return false;
          }
        });
        if (hit) return JSON.parse(hit);
        if (Date.now() > deadline) throw new Error(`timeout waiting for rpc response ${id}`);
        await wait();
      }
    }
    const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);

    // 1. prompt over the real wire: events stream, run completes.
    send({ id: 1, command: "prompt", params: { input: PROMPT } });
    const done1 = await waitFor(1);
    if (done1.ok === false && isCredentialRejected(JSON.stringify(done1))) {
      child.kill();
      return t.skip(`provider rejected ${spec.envKey} (401/403) — refresh the credential and rerun`);
    }
    assert.equal(done1.ok, true, JSON.stringify(done1));
    const events1 = lines.map((l) => JSON.parse(l)).filter((p) => p.type === "event" && p.id === 1);
    assert.ok(events1.length > 0, "prompt produced no streamed events");
    assert.ok(
      events1.some((p) => p.event.type === "message_delta" && p.event.content?.type === "text"),
      "no text delta streamed",
    );

    // 2. state after the run.
    send({ id: 2, command: "state" });
    const state2 = await waitFor(2);
    assert.equal(state2.ok, true, JSON.stringify(state2));

    // 3. abort mid-run: start a longer prompt, abort it, server stays responsive.
    send({ id: 3, command: "prompt", params: { input: "Count from one to twenty, one number per line." } });
    await new Promise((r) => setTimeout(r, 500));
    send({ id: 4, command: "abort", params: { reason: "journey abort leg" } });
    const aborted = await waitFor(4);
    assert.equal(aborted.ok, true, JSON.stringify(aborted));
    await waitFor(3); // the aborted run still settles its response
    send({ id: 5, command: "state" });
    assert.equal((await waitFor(5)).ok, true, "server unresponsive after abort");

    child.kill();
    await new Promise((r) => child.on("exit", r));
  });

  it("the provider credential never appears in any spawn transcript", () => {
    for (const t of transcripts) {
      assert.ok(!t.out.includes(API_KEY), `key leaked in stdout of: ${t.tag}`);
      assert.ok(!t.err.includes(API_KEY), `key leaked in stderr of: ${t.tag}`);
    }
  });
});
