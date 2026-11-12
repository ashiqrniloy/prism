/**
 * Plan 216 Task 8: the session tiers' offline replay on any tree, so a package move can be compared like with like.
 *
 * One scripted session (three turns, each followed by an observer pass, `session.compact()`, one more turn) runs on a
 * mock main provider and a mock observer against the tree's own kernel and session package: `@arnilo/prism-memory-system`
 * when the tree has it, else the pre-move `@arnilo/prism-memory-observational`. Every provider request (main and
 * worker) is captured, then normalized: per-run ids (UUIDs, observation ids) and timestamps become ordinals, because they differ on every
 * run of the same tree. Hashes only, unless `--dump` names a private directory for the text.
 *
 * ```sh
 * bun scripts/memory-bench/session-replay.mjs --tree <dir> --out capture.json [--dump dir]
 * bun scripts/memory-bench/session-replay.mjs --compare base.json post.json   # verdict with attributed renames
 * ```
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * The renames plan 216 Task 4 attributed (the session tiers' new names). Applied to the base text only, as whole
 * strings; any other difference is unattributed.
 */
export const SESSION_RENAMES = [
  { from: "# Observational Memory", to: "# Session Memory", why: "summary heading renamed with the package (plan 216 Task 4)" },
  { from: '"om:s"', to: '"memory.session:s"', why: "worker sessionId/cacheKey prefix renamed with the package (plan 216 Task 4)" },
];

/** Per-run values: UUIDs and ISO timestamps become first-seen ordinals. */
export function normalizeRequestText(text) {
  const seen = { id: new Map(), obs: new Map(), ts: new Map() };
  const ordinal = (prefix) => (value) => {
    const map = seen[prefix];
    if (!map.has(value)) map.set(value, `<${prefix}${map.size + 1}>`);
    return map.get(value);
  };
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ordinal("id"))
    .replace(/(?<![0-9a-f])[0-9a-f]{12}(?![0-9a-f])/g, ordinal("obs"))
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, ordinal("ts"))
    .replace(/"(createdAt|updatedAt|timestamp|at|time)":\d{10,}/g, '"$1":<ms>');
}

const MODEL = { provider: "main", model: "main-model", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

/** Run the scripted session against `tree`'s product; returns the normalized request texts in order. */
export async function captureSession(tree) {
  const dir = resolve(tree);
  const kernel = await import(join(dir, "src/index.ts"));
  const { providerPackage } = await import(join(dir, "src/provider-kit/index.ts"));
  const system = join(dir, "packages/memory/system/src/index.ts");
  const observational = join(dir, "packages/memory/observational/src/index.ts");
  const product = existsSync(system) ? "memory-system" : "memory-observational";
  assert.ok(product === "memory-system" || existsSync(observational), `no session package in ${dir}`);
  const { default: factory } = await import(product === "memory-system" ? system : observational);
  // The same settings under each package's names: the observer on every non-empty tail, nothing else changed.
  const config =
    product === "memory-system"
      ? { stm: { model: "observer/om-model", triggerTokens: 1 } }
      : { observer: { model: "observer/om-model", messageTokens: 1 } };
  const toggle = product === "memory-system" ? "memory:session" : "om";
  const status = product === "memory-system" ? "memory:session:status" : "om:status";
  const requests = [];
  const capture = (role) => (request) => requests.push({ role, text: JSON.stringify(request) });
  const main = {
    id: "main",
    async *generate(request) {
      capture("main")(request);
      yield kernel.providerTextDelta("ok");
      yield kernel.providerDone();
    },
  };
  const observer = {
    id: "observer",
    async *generate(request) {
      capture("worker")(request);
      const called = request.messages.some((message) => message.role === "tool");
      const prompt = request.messages.find((message) => message.role === "user")?.content[0];
      const sourceId = /\[[^\]]+\] \[([^\]]+)\] (?:message|user|assistant|tool|system):/.exec(
        prompt?.type === "text" ? prompt.text : "",
      )?.[1];
      if (!called && sourceId)
        yield kernel.providerToolCall(
          kernel.toolCallContent("c1", "record_observation", {
            content: `Observed ${sourceId}`,
            relevance: "high",
            sourceEntryIds: [sourceId],
          }),
        );
      yield kernel.providerDone();
    },
  };
  const agent = await kernel.createAgent({
    model: MODEL,
    packages: [providerPackage("main-provider", [main]), providerPackage("observer-provider", [observer]), factory(config)],
    slots: { store: kernel.createMemorySessionStore() },
  });
  const session = await agent.session({ id: "s", create: true });
  const settle = async () => {
    const deadline = Date.now() + 30_000;
    await new Promise((done) => setTimeout(done, 0));
    while ((await agent.commands.run(status, {}, { session })).inFlight) {
      assert.ok(Date.now() < deadline, "session worker did not settle");
      await new Promise((done) => setTimeout(done, 10));
    }
  };
  await agent.commands.run(toggle, {}, { session });
  for (const prompt of ["one", "two", "three"]) {
    await session.run(prompt);
    await settle();
  }
  await session.compact();
  await session.run("four");
  await settle();
  const final = await agent.commands.run(status, {}, { session });
  await session.close();
  await agent.dispose();
  return {
    product,
    requests: requests.map((request) => ({ role: request.role, text: normalizeRequestText(request.text) })),
    // The rehearsal (dropper) runs only past its target; a replay whose pool stays under it cannot show the Task 6
    // change (an omitted `rehearsal` is off without `wm` and `ltm`), so that difference does not apply to it.
    rehearsal: {
      activeObservationPool: final.tokens.activeObservationPool,
      targetTokens: final.thresholds.targetTokens,
      crossed: final.tokens.activeObservationPool > final.thresholds.targetTokens,
      dropped: final.observations.dropped,
    },
    // Plan 218 Task 2 renamed the status count to `wmItems`; a pinned older revision still answers `reflections`.
    finalStatus: { contextMode: final.contextMode ?? null, observations: final.observations, wmItems: final.wmItems ?? final.reflections },
  };
}

/** Compare two captures: identical, identical after the attributed renames, or different. */
export function compareSessionCaptures(base, post, renames = SESSION_RENAMES) {
  const rename = (text) => renames.reduce((out, { from, to }) => out.split(from).join(to), text);
  const rows = [];
  const count = Math.max(base.requests.length, post.requests.length);
  for (let index = 0; index < count; index++) {
    const a = base.requests[index];
    const b = post.requests[index];
    const raw = a?.text === b?.text;
    const attributed = !raw && a && b && rename(a.text) === b.text;
    const applied = attributed ? renames.filter(({ from }) => a.text.includes(from)).map(({ from, to }) => `${from} -> ${to}`) : [];
    rows.push({
      index: index + 1,
      role: b?.role ?? a?.role,
      result: raw ? "identical" : attributed ? "attributed" : "different",
      renames: applied,
    });
  }
  const differing = rows.filter((row) => row.result === "different");
  return {
    status: differing.length ? "different" : rows.some((row) => row.result === "attributed") ? "identical-after-attribution" : "identical",
    requests: count,
    baseRequests: base.requests.length,
    postRequests: post.requests.length,
    identical: rows.filter((row) => row.result === "identical").length,
    attributed: rows.filter((row) => row.result === "attributed").length,
    differing: differing.map((row) => row.index),
    renamesApplied: [...new Set(rows.flatMap((row) => row.renames))],
    rows,
  };
}

/** The capture file: hashes only. */
export function captureRecord(capture) {
  return {
    kind: "216-session-replay-capture",
    product: capture.product,
    rehearsal: capture.rehearsal,
    finalStatus: capture.finalStatus,
    requests: capture.requests.map((request) => ({
      role: request.role,
      sha256: sha256(request.text),
      bytes: Buffer.byteLength(request.text),
    })),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (args.includes("--compare")) {
    const [basePath, postPath] = args.slice(args.indexOf("--compare") + 1);
    const load = async (path) => JSON.parse(await readFile(path, "utf8"));
    process.stdout.write(`${JSON.stringify(compareSessionCaptures(await load(basePath), await load(postPath)), null, 2)}\n`);
  } else {
    assert.ok(flag("--tree") && flag("--out"), "usage: session-replay.mjs --tree <dir> --out <file> [--dump dir] | --compare base post");
    const capture = await captureSession(flag("--tree"));
    const out = resolve(flag("--out"));
    await mkdir(dirname(out), { recursive: true });
    // The comparable form keeps the normalized text; it stays in the private output path, never in evidence.
    await writeFile(out, `${JSON.stringify(capture, null, 2)}\n`);
    if (flag("--dump"))
      for (const [index, request] of capture.requests.entries()) {
        const file = join(flag("--dump"), `${index + 1}-${request.role}.json`);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, request.text);
      }
    process.stderr.write(
      `${JSON.stringify({ product: capture.product, requests: capture.requests.length, rehearsal: capture.rehearsal })}\n`,
    );
  }
}
