#!/usr/bin/env node
/**
 * Session-search scenario (plan 095 Task 1): store-native FTS query latency and index sizing.
 *
 * Builds a 100k-turn SQLite corpus through the public store API (200 workspaces sessions x
 * 500 turns), then measures `searchSessions({ workspaceRoot, query, limit })` p50/p95 over
 * mixed rare/common terms. Reports the indexed-text-to-transcript ratio (index sizing) and
 * fails when p95 exceeds the plan's 100 ms ceiling. Network-free.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import { createSqlitePersistence } from "../../packages/prism-core/dist/sessions/sqlite/index.js";

const SESSIONS = 200;
const TURNS_PER_SESSION = 500;
const WORKSPACE = "/bench/repo";
const PAGE_LIMIT = 20;
const MEASURED_QUERIES = 40;
const P95_CEILING_MS = 100;
const TOOL_OUTPUT_BYTES = 512;

// Common terms appear in most turns; the rare terms appear once per session, so hits stay bounded.
const WORDS = [
  "folding",
  "attention",
  "invoice",
  "ledger",
  "ticket",
  "deploy",
  "canary",
  "rollback",
  "oncall",
  "calendar",
  "mirror",
  "triage",
  "archive",
  "approve",
  "export",
  "import",
  "reconcile",
  "void",
  "audit",
  "queue",
];

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function turnText(session, turn) {
  const first = WORDS[turn % WORDS.length];
  const second = WORDS[(turn * 7 + session) % WORDS.length];
  const rare = `raretoken${session}t${turn}`;
  return `turn ${turn} in session ${session}: ${first} ${second} handling notes for ${WORDS[(turn * 3) % WORDS.length]} pipeline ${rare}`;
}

async function runScenario() {
  const dir = mkdtempSync(join(tmpdir(), "prism-session-search-bench-"));
  const filename = join(dir, "bench.db");
  const persistence = createSqlitePersistence({ filename });
  const now = new Date().toISOString();

  try {
    const buildStart = performance.now();
    for (let session = 0; session < SESSIONS; session += 1) {
      const sessionId = `bench-session-${session}`;
      persistence.appendSession?.({
        id: sessionId,
        tenantId: "bench",
        createdAt: now,
        updatedAt: now,
        metadata: { workspaceRoot: WORKSPACE },
      });
      for (let turn = 1; turn <= TURNS_PER_SESSION; turn += 1) {
        const text = turnText(session, turn);
        const label = turn % 50 === 0 ? `checkpoint ${WORDS[turn % WORDS.length]}` : undefined;
        const timestamp = new Date(Date.UTC(2026, 0, 1) + (session * TURNS_PER_SESSION + turn) * 1000).toISOString();
        await persistence.append({
          id: `${sessionId}-${turn}`,
          sessionId,
          timestamp,
          kind: "message",
          ...(label ? { label } : {}),
          message: { role: turn % 2 === 0 ? "assistant" : "user", content: [{ type: "text", text }] },
        });
        // Raw tool output is stored but never indexed (transcript-text-only contract); it is what
        // pushes real transcripts far above the indexed text, so the sizing ratio needs it.
        await persistence.append({
          id: `${sessionId}-${turn}-tool`,
          sessionId,
          timestamp,
          kind: "message",
          message: {
            role: "tool",
            content: [
              {
                type: "tool_result",
                toolCallId: `call-${turn}`,
                name: "read_file",
                result: { output: `${WORDS[(turn * 5) % WORDS.length]} `.repeat(Math.ceil(TOOL_OUTPUT_BYTES / 8)) },
              },
            ],
          },
        });
      }
    }
    const buildMs = performance.now() - buildStart;

    // Rare term (one entry), rotated common term (thousands of entries), and a label/annotation term.
    const queries = [];
    for (let index = 0; index < MEASURED_QUERIES; index += 1) {
      if (index % 4 === 3) queries.push({ term: `raretoken${index % SESSIONS}t${(index * 37) % TURNS_PER_SESSION}`, common: false });
      else queries.push({ term: WORDS[index % WORDS.length], common: true });
    }

    const latencies = [];
    const commonLatencies = [];
    let hits = 0;
    for (const query of queries) {
      const start = performance.now();
      const page = await persistence.searchSessions({ workspaceRoot: WORKSPACE, query: query.term, limit: PAGE_LIMIT });
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      if (query.common) commonLatencies.push(elapsed);
      hits += page.items.length;
      for (const hit of page.items) {
        if (hit.score === undefined || hit.entryId === undefined || hit.turn === undefined) {
          throw new Error("benchmark hits must carry entryId, turn, and score");
        }
      }
    }

    const p50 = percentile(latencies, 0.5);
    const p95 = percentile(latencies, 0.95);
    const commonP95 = percentile(commonLatencies, 0.95);
    const dbBytes = statSync(filename).size;
    // Real page usage, not text length: the FTS shadow tables vs the stored transcript (table +
    // its indexes). Tool payload rows count as transcript and contribute no index bytes.
    persistence.close();
    const measure = new Database(filename, { readonly: true });
    const pageBytes = (pattern) =>
      measure.prepare("SELECT COALESCE(SUM(pgsize), 0) AS bytes FROM dbstat WHERE name LIKE ?").get(pattern).bytes;
    const indexBytes = pageBytes("prism_session_search_fts%");
    const transcriptBytes = pageBytes("prism_session_entries%");
    measure.close();

    return {
      version: "0.9.0",
      generatedAt: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model ?? "unknown",
        memoryBytes: totalmem(),
        network: false,
        credentials: false,
      },
      fixture: {
        sessions: SESSIONS,
        turns: SESSIONS * TURNS_PER_SESSION,
        pageLimit: PAGE_LIMIT,
        measuredQueries: queries.length,
      },
      results: [
        { name: "build_ms", value: Number(buildMs.toFixed(1)), unit: "ms" },
        { name: "query_p50_ms", value: Number(p50.toFixed(2)), unit: "ms" },
        { name: "query_p95_ms", value: Number(p95.toFixed(2)), unit: "ms" },
        { name: "common_term_p95_ms", value: Number(commonP95.toFixed(2)), unit: "ms" },
        { name: "hits", value: hits, unit: "hits" },
        { name: "transcript_bytes", value: transcriptBytes, unit: "bytes" },
        { name: "index_bytes", value: indexBytes, unit: "bytes" },
        { name: "index_to_transcript_ratio", value: Number((indexBytes / transcriptBytes).toFixed(4)), unit: "ratio" },
        { name: "db_bytes", value: dbBytes, unit: "bytes" },
      ],
      checks: [
        { name: "query_p95_under_ceiling", pass: p95 < P95_CEILING_MS },
        { name: "common_term_p95_under_ceiling", pass: commonP95 < P95_CEILING_MS },
        { name: "hits_point_at_entries", pass: hits > 0 },
        { name: "index_is_proportional", pass: indexBytes / transcriptBytes < 1 },
      ],
    };
  } finally {
    try {
      // Closed before the sizing measurement when the run completes; ignore the double close.
      persistence.close();
    } catch {
      // ignore double close
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && new URL(import.meta.url).href.endsWith(process.argv[1].split("/").pop())) {
  const report = await runScenario();
  for (const check of report.checks) {
    if (!check.pass) console.error(`BUDGET FAIL: ${check.name}`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.checks.some((check) => !check.pass)) process.exitCode = 1;
}

export { runScenario };
