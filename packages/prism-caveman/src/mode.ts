import { createSessionEntry, type SessionEntry } from "@arnilo/prism";

import type { CavemanLevel } from "./types.js";

export const CAVEMAN_LEVEL_TYPE = "caveman-level" as const;

export const CAVEMAN_LEVELS = [
  "off",
  "lite",
  "full",
  "ultra",
  "wenyan-lite",
  "wenyan",
  "wenyan-ultra",
  "micro",
] as const satisfies readonly CavemanLevel[];

const STOP_ALIASES = new Set(["off", "stop", "quit", "disable"]);

export function isCavemanLevel(value: string): value is CavemanLevel {
  return (CAVEMAN_LEVELS as readonly string[]).includes(value);
}

export function normalizeLevelArg(arg: string): CavemanLevel | null {
  const normalized = arg.trim().toLowerCase();
  if (STOP_ALIASES.has(normalized)) return "off";
  if (normalized === "wenyan-full") return "wenyan";
  return isCavemanLevel(normalized) ? normalized : null;
}

export function resolveLevelFromEntries(entries: readonly SessionEntry[]): CavemanLevel | undefined {
  let latest: CavemanLevel | undefined;
  for (const entry of entries) {
    if (entry.kind !== "custom") continue;
    const data = entry.data;
    if (!data || typeof data !== "object") continue;
    const record = data as { type?: unknown; level?: unknown };
    if (record.type !== CAVEMAN_LEVEL_TYPE) continue;
    if (typeof record.level === "string" && isCavemanLevel(record.level)) latest = record.level;
  }
  return latest;
}

// ponytail: whole-message match only — same guard as ponytail-config isDeactivationCommand.
export function isDeactivationCommand(text: string): boolean {
  const normalized = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?\s]+$/, "");
  return normalized === "stop caveman" || normalized === "normal mode";
}

export function extractUserText(messages: readonly { readonly role?: string; readonly content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (!block || typeof block !== "object") return "";
          const text = (block as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        })
        .join("\n");
    }
  }
  return "";
}

export interface PersistLevelOptions {
  readonly sessionId: string;
  readonly level: CavemanLevel;
  readonly getEntries: () => readonly SessionEntry[] | Promise<readonly SessionEntry[]>;
  readonly appendEntry: (entry: SessionEntry, options?: { readonly expectedParentId?: string }) => Promise<void>;
}

export async function persistLevel(options: PersistLevelOptions): Promise<void> {
  const entries = await options.getEntries();
  const parentId = entries.at(-1)?.id;
  const entry = createSessionEntry({
    sessionId: options.sessionId,
    parentId,
    kind: "custom",
    data: { type: CAVEMAN_LEVEL_TYPE, level: options.level },
  });
  await options.appendEntry(entry, { expectedParentId: parentId });
}
