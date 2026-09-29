import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureHomeDir, resolvePrismHome } from "../home.js";

/** Prompt history is app data, never authoritative: every failure here is silent and non-fatal. */
export const PROMPT_HISTORY_LIMIT = 500;
/** The file is shared by every repository; rotate so it cannot grow without bound. */
const PROMPT_HISTORY_FILE_LIMIT = 2_000;

interface PromptHistoryRecord {
  readonly cwd: string;
  readonly text: string;
  readonly at: string;
}

export function promptHistoryPath(home: string = resolvePrismHome()): string {
  return join(home, "history.jsonl");
}

/** Recent prompts for one repository, oldest first, most recent last. */
export function loadPromptHistory(cwd: string, options?: { readonly home?: string; readonly limit?: number }): string[] {
  const path = promptHistoryPath(options?.home);
  if (!existsSync(path)) return [];
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch {
    return [];
  }
  const texts: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      const record = JSON.parse(line) as PromptHistoryRecord;
      if (record.cwd !== cwd || typeof record.text !== "string" || record.text.length === 0) continue;
      texts.push(record.text);
    } catch {
      // A corrupt line only loses that line.
    }
  }
  return texts.slice(-(options?.limit ?? PROMPT_HISTORY_LIMIT));
}

/** Append one submitted prompt; secret prompts never reach this (masked input is a separate component). */
export function appendPromptHistory(cwd: string, text: string, options?: { readonly home?: string }): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  const home = options?.home ?? resolvePrismHome();
  const path = promptHistoryPath(home);
  const record: PromptHistoryRecord = { cwd, text: trimmed, at: new Date().toISOString() };
  try {
    ensureHomeDir(home);
    appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(path, 0o600);
    rotateIfOversized(path);
  } catch {
    // Best effort: history must never break a prompt.
  }
}

function rotateIfOversized(path: string): void {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length <= PROMPT_HISTORY_FILE_LIMIT) return;
  writeFileSync(path, `${lines.slice(-PROMPT_HISTORY_FILE_LIMIT).join("\n")}\n`, { mode: 0o600 });
}
