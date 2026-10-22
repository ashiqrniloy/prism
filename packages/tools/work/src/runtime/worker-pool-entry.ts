import { parentPort } from "node:worker_threads";
import { DocumentReaderError } from "../document-reader/errors.js";
import type { DocumentParser } from "../document-reader/index.js";

/**
 * Module worker entry for `worker-pool.ts` (plan 127 Task 2). The parent sends typed
 * `{ kind, payload }` objects; handlers are a static map — never a path or source from a message.
 *
 * Product handlers (plan 127 Task 3) run the measured CPU-bound cores off the agent's event loop.
 * Only `document.extract` survived the Task 3 revert: the sheets/documents model parses cloned a
 * result larger than the input and regressed their own wall clock (see evidence §9), while the
 * document reader's extract returns literal text and gained loop freedom at ~no cost. The handler
 * calls the same parser the inline path calls; inside a worker `shouldOffloadToPool()` is false,
 * so it cannot recursively spawn another pool. `probe.*` handlers are the pool's own self-check
 * surface.
 */

export type WorkerPoolReply = { ok: true; value: unknown } | { ok: false; error: { name: string; message: string } };

type Handler = (payload: unknown) => unknown | Promise<unknown>;

let workerDocumentParsers: Promise<Map<string, DocumentParser>> | undefined;

/** Same default wiring as `createDocumentReader`, built once per worker and memoized. */
async function documentParsers(): Promise<Map<string, DocumentParser>> {
  workerDocumentParsers ??= (async () => {
    const { createDocxParser, createOoxmlParser, createPdfParser } = await import("../document-reader/parsers.js");
    const parsers = [
      await createPdfParser(),
      await createDocxParser(),
      createOoxmlParser("xlsx", "sheet", "xl/workbook.xml"),
      createOoxmlParser("pptx", "deck", "ppt/presentation.xml"),
    ];
    return new Map(parsers.map((parser) => [parser.format, parser]));
  })();
  return workerDocumentParsers;
}

const HANDLERS: Record<string, Handler> = {
  // --- product surface (plan 127 Task 3): the document reader's large-buffer extract ---
  "document.extract": async (payload) => {
    const { format, bytes, maxPages, maxTextBytes } = payload as {
      format: string;
      bytes: Uint8Array;
      maxPages: number;
      maxTextBytes: number;
    };
    const parser = (await documentParsers()).get(format);
    if (!parser) throw new DocumentReaderError(`document-reader: no worker parser for format "${format}"`);
    // The payload arrives as a plain Uint8Array (structured clone); the reader's byte gates accept it
    // directly, so no Buffer wrap is needed (plan 127 further action #2).
    return parser.extract(bytes, { maxPages, maxTextBytes });
  },
  // --- pool self-checks ---
  "probe.echo": (payload) => payload,
  "probe.spin": (payload) => {
    const ms = typeof (payload as { ms?: unknown } | undefined)?.ms === "number" ? (payload as { ms: number }).ms : 0;
    const end = Date.now() + Math.min(Math.max(ms, 0), 60_000);
    while (Date.now() < end) {
      // deliberately synchronous: the pool's bounded-concurrency test needs a blocking task
    }
    return { spunMs: ms };
  },
  // The kill-mid-task check: an uncaught throw inside the worker (never the parent process).
  "probe.crash": () => {
    setTimeout(() => {
      throw new Error("planned worker crash (pool self-check)");
    }, 10);
    return new Promise<never>(() => {});
  },
  // Credential-free check: proves the pool's env allowlist reached this worker.
  "probe.env": () => ({ envKeys: Object.keys(process.env).length, secret: process.env.PRISM_POOL_PROBE_SECRET ?? null }),
};

async function handle(message: unknown): Promise<void> {
  if (message === null || typeof message !== "object") return;
  const task = message as { kind?: unknown; payload?: unknown };
  const handler = typeof task.kind === "string" ? HANDLERS[task.kind] : undefined;
  if (!handler) {
    post({ ok: false, error: { name: "WorkerPoolError", message: `unknown worker task kind: ${String(task.kind)}` } });
    return;
  }
  try {
    post({ ok: true, value: await handler(task.payload) });
  } catch (error) {
    post({
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function post(reply: WorkerPoolReply): void {
  parentPort?.postMessage(reply);
}

parentPort?.on("message", (message: unknown) => {
  void handle(message);
});
