import { createSessionEntry, type SessionEntry } from "@arnilo/prism";

import type { PonytailMode } from "./types.js";

export const PONYTAIL_MODE_TYPE = "ponytail-mode" as const;

export const PONYTAIL_MODES = ["off", "lite", "full", "ultra"] as const satisfies readonly PonytailMode[];

export function isPonytailMode(value: string): value is PonytailMode {
  return (PONYTAIL_MODES as readonly string[]).includes(value);
}

export function resolveModeFromEntries(entries: readonly SessionEntry[]): PonytailMode | undefined {
  let latest: PonytailMode | undefined;
  for (const entry of entries) {
    if (entry.kind !== "custom") continue;
    const data = entry.data;
    if (!data || typeof data !== "object") continue;
    const record = data as { type?: unknown; mode?: unknown };
    if (record.type !== PONYTAIL_MODE_TYPE) continue;
    if (typeof record.mode === "string" && isPonytailMode(record.mode)) latest = record.mode;
  }
  return latest;
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

export interface PersistModeOptions {
  readonly sessionId: string;
  readonly mode: PonytailMode;
  readonly getEntries: () => readonly SessionEntry[] | Promise<readonly SessionEntry[]>;
  readonly appendEntry: (entry: SessionEntry, options?: { readonly expectedParentId?: string }) => Promise<void>;
}

export async function persistMode(options: PersistModeOptions): Promise<void> {
  const entries = await options.getEntries();
  const parentId = entries.at(-1)?.id;
  const entry = createSessionEntry({
    sessionId: options.sessionId,
    parentId,
    kind: "custom",
    data: { type: PONYTAIL_MODE_TYPE, mode: options.mode },
  });
  await options.appendEntry(entry, { expectedParentId: parentId });
}
