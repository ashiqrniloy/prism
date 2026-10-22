/**
 * Worker entry for the `grep` tool's regex mode (plan 189 Task 4).
 *
 * Compiles the pattern once and matches one file's text per message, so a pattern with
 * catastrophic backtracking runs off the main thread and stays killable with `terminate()`.
 * Only file text is ever posted in — the main thread resolves and contains paths.
 */
import { matchLines } from "./repository/search.js";

interface CompileMessage {
  readonly type: "compile";
  readonly pattern: string;
  readonly flags: string;
  readonly maxLineBytes: number;
}

interface MatchMessage {
  readonly type: "match";
  readonly id: number;
  readonly text: string;
  readonly context: number;
}

type Request = CompileMessage | MatchMessage;

interface WorkerScope {
  onmessage: ((event: { data: Request }) => void) | null;
  postMessage: (value: unknown) => void;
}

const scope = globalThis as unknown as WorkerScope;

let compiled: RegExp | null = null;
let maxLineBytes = 0;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

scope.onmessage = (event) => {
  const message = event.data;

  if (message.type === "compile") {
    try {
      // No "g"/"y": the matcher probes each line from the start, so state between lines would lie.
      compiled = new RegExp(message.pattern, message.flags);
      maxLineBytes = message.maxLineBytes;
      scope.postMessage({ type: "ready" });
    } catch (error) {
      scope.postMessage({ type: "invalid", message: reason(error) });
    }
    return;
  }

  const regex = compiled;
  if (regex === null) {
    scope.postMessage({ type: "error", id: message.id, message: "pattern was not compiled" });
    return;
  }
  try {
    const matches = matchLines(
      message.text,
      (line) => {
        const hit = regex.exec(line);
        return hit ? { column: hit.index + 1 } : null;
      },
      message.context,
      maxLineBytes,
    );
    scope.postMessage({ type: "matches", id: message.id, matches });
  } catch (error) {
    scope.postMessage({ type: "error", id: message.id, message: reason(error) });
  }
};
