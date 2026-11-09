/**
 * Plan 216 Task 8: the behaviour-preservation record for the memory-system moves (Tasks 3–7), generated, never typed.
 *
 * Against a base worktree of `OM-before` (`37ee1a24`: plan 210's slimmed product plus plan 216 Tasks 1–3, the Task 3
 * golden point) it gathers:
 * - the session tiers' offline replay on both trees (`session-replay.mjs`), compared with Task 4's attributed renames;
 * - the LTM answer paths (`prefix-probe.mjs --capture-answers`, each tree with its own harness), compared request by
 *   request, then again with the tool schemas and the system tool catalogue taken out, naming the tools that differ;
 * - the prefix-probe report on both trees (scenarios and context-block names);
 * - the plan 210 golden (`removal-byte-identical.json`) and its re-pin chain, the cache-stability test list, the
 *   transferred dispositions and the plan 210 C-1 dry run (`cleanup-campaign.mjs dryRunC1Manifest`).
 *
 * ```sh
 * bun scripts/memory-bench/preservation.mjs --base .cache/memory-bench/216/om-before \
 *   --equivalence docs/_evidence/memory-bench/216/equivalence.json --out docs/_evidence/memory-bench/216/preservation.json
 * ```
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { dryRunC1Manifest } from "./cleanup-campaign.mjs";
import { compareAnswerCaptures } from "./prefix-probe.mjs";
import { compareSessionCaptures } from "./session-replay.mjs";

const root = resolve(import.meta.dir, "../..");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const GOLDEN = "packages/memory/system/src/ltm/__tests__/fixtures/removal-byte-identical.json";
const BASE_GOLDEN = "packages/memory/fabric/src/__tests__/fixtures/removal-byte-identical.json";
const SLIMMED_RECORD = "docs/_evidence/memory-bench/210/slimmed/record.json";
const DISPOSITIONS = "docs/_evidence/memory-bench/210/dispositions.json";
/** The tools whose schema text plan 216 Task 7 changed (working blocks, the `working` kind). */
export const TASK7_TOOLS = ["memory.forget", "memory.insert", "memory.recall", "memory.replace", "memory.view"];
const CATALOGUE = "Available tools:\n";

function run(argv, cwd, timeout = 540_000) {
  const result = spawnSync(process.execPath, argv, { cwd, encoding: "utf8", timeout, maxBuffer: 64_000_000 });
  assert.equal(result.status, 0, `${argv.join(" ")} failed in ${cwd}: ${result.stderr?.slice(-2000)}`);
  return result.stdout;
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true }))
    if (entry.isFile()) out.push(relative(dir, join(entry.parentPath, entry.name)));
  return out.sort();
}

/** A request without its tool schemas and the system tool catalogue; and the catalogue's entries by tool name. */
export function splitCatalogue(request) {
  const entries = new Map();
  const messages = (request.messages ?? []).map((message) => {
    if (message.role !== "system" || !Array.isArray(message.content)) return message;
    const content = message.content.filter((part) => {
      if (part.type !== "text" || !part.text.startsWith(CATALOGUE)) return true;
      for (const line of part.text.slice(CATALOGUE.length).split(/\n(?=- [\w.]+: )/)) {
        const match = /^- ([\w.]+): /.exec(line);
        if (match) entries.set(match[1], line);
      }
      return false;
    });
    return { ...message, content };
  });
  const { tools, ...rest } = request;
  for (const tool of tools ?? []) entries.set(`schema:${tool.name}`, JSON.stringify(tool));
  return { rest: JSON.stringify({ ...rest, messages }), entries };
}

/** Compare two answer-path text dumps: identical without tools and catalogue, and which tools differ. */
export function attributeAnswerPaths(base, post) {
  assert.deepEqual(Object.keys(base).sort(), Object.keys(post).sort(), "the two dumps hold different requests");
  const differingTools = new Set();
  let residual = 0;
  for (const [file, text] of Object.entries(base)) {
    const a = splitCatalogue(JSON.parse(text));
    const b = splitCatalogue(JSON.parse(post[file]));
    if (a.rest !== b.rest) residual++;
    for (const name of new Set([...a.entries.keys(), ...b.entries.keys()]))
      if (a.entries.get(name) !== b.entries.get(name)) differingTools.add(name.replace(/^schema:/, ""));
  }
  return {
    requests: Object.keys(base).length,
    identicalWithoutToolText: Object.keys(base).length - residual,
    residual,
    differingTools: [...differingTools].sort(),
  };
}

async function answerDump(tree, ownHarness, dir) {
  const harness = join(ownHarness ? tree : root, "scripts/memory-bench");
  const out = join(dir, "capture.json");
  run(
    [
      "--preload",
      join(harness, "equivalence-preload.mjs"),
      join(harness, "prefix-probe.mjs"),
      "--capture-answers",
      out,
      "--dump",
      join(dir, "text"),
    ],
    tree,
  );
  const files = await listFiles(join(dir, "text"));
  const texts = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(join(dir, "text", file), "utf8")])));
  return { capture: JSON.parse(await readFile(out, "utf8")), texts };
}

function prefixShape(report) {
  return {
    scenarios: report.scenarios.map((scenario) => scenario.id),
    blocks: [
      ...new Set(report.scenarios.flatMap((scenario) => scenario.requests.flatMap((request) => Object.keys(request.blocks ?? {})))),
    ].sort(),
  };
}

/** Block hashes per scenario and request, for the blocks both trees still render. */
function comparePrefix(base, post) {
  const shared = prefixShape(post).blocks.filter((block) => prefixShape(base).blocks.includes(block));
  const rows = [];
  for (const scenario of post.scenarios) {
    const before = base.scenarios.find((row) => row.id === scenario.id);
    if (!before) continue;
    const same =
      before.requests.length === scenario.requests.length &&
      scenario.requests.every((request, index) =>
        shared.every((block) => request.blocks?.[block] === before.requests[index].blocks?.[block]),
      );
    rows.push({ id: scenario.id, requests: scenario.requests.length, sharedBlocksIdentical: same });
  }
  return { sharedBlocks: shared, scenarios: rows };
}

const testNames = (source) => [...(/CACHE_STABILITY_TESTS = \[([^\]]*)\]/.exec(source)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

export async function buildPreservationRecord({ base, equivalencePath }) {
  const tree = resolve(base);
  assert.ok(existsSync(join(tree, ".git")), "--base must be a git worktree of OM-before");
  const baseCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).stdout.trim();
  const temp = await mkdtemp(join(tmpdir(), "prism-216-preservation-"));
  try {
    // Session tiers (Task 4, Task 6): the same script on both products.
    const sessionScript = join(root, "scripts/memory-bench/session-replay.mjs");
    const sessions = {};
    for (const [name, dir] of Object.entries({ base: tree, post: root })) {
      const out = join(temp, `session-${name}.json`);
      run([sessionScript, "--tree", dir, "--out", out], root, 120_000);
      sessions[name] = JSON.parse(await readFile(out, "utf8"));
    }
    const session = compareSessionCaptures(sessions.base, sessions.post);

    // LTM answer paths (Tasks 3, 5, 7): each tree with its own harness, text kept in the temp directory only.
    const answers = {};
    for (const [name, dir] of Object.entries({ base: tree, post: root }))
      answers[name] = await answerDump(dir, name === "base", join(temp, `answers-${name}`));
    const verdict = compareAnswerCaptures(answers.base.capture, answers.post.capture);
    const attribution = attributeAnswerPaths(answers.base.texts, answers.post.texts);
    const equivalenceText = await readFile(resolve(equivalencePath), "utf8");
    const equivalence = JSON.parse(equivalenceText);

    // Prefix probe report shape (Task 7).
    const probe = Object.fromEntries(
      Object.entries({ base: tree, post: root }).map(([name, dir]) => [
        name,
        JSON.parse(run(["scripts/memory-bench/prefix-probe.mjs"], dir, 120_000)),
      ]),
    );

    const golden = await readFile(join(root, GOLDEN), "utf8");
    const baseGolden = spawnSync("git", ["show", `${baseCommit}:${BASE_GOLDEN}`], { cwd: root, encoding: "utf8" }).stdout;
    const slimmed = JSON.parse(await readFile(join(root, SLIMMED_RECORD), "utf8"));
    const dispositions = JSON.parse(await readFile(join(root, DISPOSITIONS), "utf8"));
    const baseTests = testNames(await readFile(join(tree, "scripts/memory-bench/audit/readiness.mjs"), "utf8"));
    const postTests = testNames(await readFile(join(root, "scripts/memory-bench/audit/readiness.mjs"), "utf8"));
    const dryRun = await dryRunC1Manifest({ root });

    const baseShape = prefixShape(probe.base);
    const postShape = prefixShape(probe.post);
    const prefix = comparePrefix(probe.base, probe.post);
    const unattributedTools = attribution.differingTools.filter((name) => !TASK7_TOOLS.includes(name));
    const record = {
      kind: "216-behaviour-preservation",
      version: 1,
      plan: 216,
      task: 8,
      base: { commit: baseCommit, label: "OM-before (plan 210 slimmed product + plan 216 Tasks 1-3; the Task 3 golden point)" },
      moves: [
        {
          task: 3,
          move: "ontology out of the fabric into @arnilo/prism-wiki",
          fixtures: [`${GOLDEN} (conversational and coding presets, 12 requests each)`],
          result: "re-pinned (attributed); measured in-tree before the base commit",
          attributedDifferences: slimmed.byteIdenticalTest.repinned
            .filter((row) => row.by.startsWith("plan 216 Task 3"))
            .map((row) => ({
              what: "memory.recall tool schema (concept kind and description)",
              previousSha256: row.previousSha256,
              reason: row.reason,
            })),
          alsoRetired: dryRun.rows.some((row) => row.status === "retired" && row.removedBy === "plan 216 Task 3")
            ? ["C-1 arm concept-prior-loo (fabric.ontology.conceptPrior=0): the concept kind prior in recall went with the ontology"]
            : [],
        },
        {
          task: 4,
          move: "session tiers into @arnilo/prism-memory-system",
          fixtures: ["session-replay.mjs: three turns with an observer pass each, session.compact(), one more turn"],
          result: session.status,
          requests: session.requests,
          identical: session.identical,
          attributed: session.attributed,
          differing: session.differing,
          attributedDifferences: session.renamesApplied,
        },
        {
          task: 5,
          move: "fabric into the package as ltm",
          fixtures: [
            `${GOLDEN} through memorySystem({ ltm })`,
            "prefix-probe.mjs --capture-answers (preset-r1, passive-only; 14 questions each)",
          ],
          result: "no attributed difference: every answer-path request is identical outside the Task 7 tool text",
          attributedDifferences: [],
        },
        {
          task: 6,
          move: "components, partial-use profiles, fail-closed composition",
          fixtures: ["session-replay.mjs (rehearsal pool vs target)"],
          result: sessions.post.rehearsal.crossed
            ? "rehearsal target crossed: the dropper difference applies"
            : "rehearsal target not crossed: the dropper difference does not apply",
          rehearsal: { base: sessions.base.rehearsal, post: sessions.post.rehearsal },
          attributedDifferences: sessions.post.rehearsal.crossed
            ? ["an omitted rehearsal resolves on only with wm and ltm, so a session-only replay runs no dropper"]
            : [],
        },
        {
          task: 7,
          move: "retire LTM working memory, the episode view and episode merge",
          fixtures: [`${GOLDEN}`, "prefix-probe.mjs --capture-answers", "prefix-probe.mjs (offline report)"],
          result: unattributedTools.length || attribution.residual ? "different (unattributed)" : "different (attributed)",
          attributedDifferences: [
            ...slimmed.byteIdenticalTest.repinned
              .filter((row) => row.by.startsWith("plan 216 Task 7"))
              .map((row) => ({
                what: "tool-schema re-pin of the plan 210 golden",
                previousSha256: row.previousSha256,
                sha256: sha256(golden),
              })),
            { what: "tool schemas and the system tool catalogue on the answer paths", tools: attribution.differingTools },
            {
              what: "prefix-probe report shape",
              removedScenarios: baseShape.scenarios.filter((id) => !postShape.scenarios.includes(id)),
              removedBlocks: baseShape.blocks.filter((id) => !postShape.blocks.includes(id)),
            },
            {
              what: "readiness CACHE_STABILITY_TESTS",
              removed: baseTests.filter((name) => !postTests.includes(name)),
              added: postTests.filter((name) => !baseTests.includes(name)),
            },
            {
              what: "plan 210 mechanisms coverage",
              excludedThrough: DISPOSITIONS,
              rows: dispositions.rows.filter((row) => /plan 216 Task 7/.test(row.disposition)).map((row) => row.feature),
            },
          ],
        },
      ],
      answerPaths: {
        status: verdict.status,
        requestsCompared: verdict.requestsCompared,
        differingSegments: Object.fromEntries(verdict.differing.map((row) => [row.arm, row.differingSegments])),
        matchesEquivalenceFile:
          verdict.status === equivalence.status && JSON.stringify(verdict.differingArms) === JSON.stringify(equivalence.differingArms),
        equivalence: { file: relative(root, resolve(equivalencePath)), sha256: sha256(equivalenceText), reportSha256: equivalence.sha256 },
        withoutToolText: attribution,
        unattributedTools,
      },
      prefixProbe: { base: baseShape, post: postShape, ...prefix },
      golden: {
        file: GOLDEN,
        sha256: sha256(golden),
        baseFile: BASE_GOLDEN,
        baseSha256: sha256(baseGolden),
        repinned: slimmed.byteIdenticalTest.repinned.map((row) => row.by),
      },
      cleanupCampaignDryRun: {
        manifestHash: dryRun.manifestHash,
        productHash: dryRun.productHash,
        jobs: dryRun.jobs,
        builds: dryRun.builds,
        retired: dryRun.retired,
        errors: dryRun.errors,
        retiredArms: dryRun.retiredArms,
        errorRows: dryRun.rows.filter((row) => row.status === "error"),
      },
      verdict:
        session.status !== "different" &&
        !attribution.residual &&
        !unattributedTools.length &&
        dryRun.errors === 0 &&
        prefix.scenarios.every((row) => row.sharedBlocksIdentical)
          ? "preserved: every difference is attributed"
          : "unattributed difference",
    };
    return { ...record, sha256: sha256(JSON.stringify(record)) };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  assert.ok(
    flag("--base") && flag("--equivalence"),
    "usage: preservation.mjs --base <OM-before worktree> --equivalence <file> [--out file]",
  );
  const record = await buildPreservationRecord({ base: flag("--base"), equivalencePath: flag("--equivalence") });
  const json = `${JSON.stringify(record, null, 2)}\n`;
  if (flag("--out")) {
    await mkdir(dirname(resolve(flag("--out"))), { recursive: true });
    await writeFile(flag("--out"), json);
  } else process.stdout.write(json);
  process.stderr.write(`${JSON.stringify({ verdict: record.verdict, sha256: record.sha256 })}\n`);
  if (record.verdict !== "preserved: every difference is attributed") process.exitCode = 1;
}
