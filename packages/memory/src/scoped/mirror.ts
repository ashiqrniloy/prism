import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryValidationError } from "../errors.js";
import { readFabricBlock } from "../fabric/blocks.js";
import { parseMemoryNoteMetadata } from "../fabric/types.js";
import type { Memory, MemoryVectorRecord } from "../types.js";
import { loadScopedLedger } from "./ledger.js";
import { scanScopedMemoryContent } from "./trust.js";

/** ponytail: stop if a store lies about nextCursor; 10k pages ≈ 1M rows at default page size */
const MAX_EXPORT_PAGES = 10_000;
const GITIGNORE = "state.json\n";

function statusOf(status: string | undefined): "candidate" | "verified" | "archived" {
  return status === "verified" || status === "archived" ? status : "candidate";
}

function yaml(fields: readonly (readonly [string, unknown])[]): string {
  const lines = ["---"];
  for (const [key, value] of fields) {
    if (value === undefined) continue;
    lines.push(`${key}: ${typeof value === "number" ? String(value) : JSON.stringify(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

async function exportAll(memory: Memory): Promise<readonly MemoryVectorRecord[]> {
  if (typeof memory.exportMemory !== "function") throw new MemoryValidationError("renderMirror requires memory.exportMemory");
  const threadId = memory.scope.threadId;
  if (!threadId) throw new MemoryValidationError("threadId");
  const identity = { tenantId: memory.scope.tenantId, resourceId: memory.scope.resourceId, threadId };
  const entries: MemoryVectorRecord[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < MAX_EXPORT_PAGES; n++) {
    const page = await memory.exportMemory({ identity, ...(cursor ? { cursor } : {}) });
    entries.push(...page.entries);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return entries;
}

function renderNote(record: MemoryVectorRecord, status: "candidate" | "verified", uses: number, lastUsedAt: string | undefined): string | undefined {
  const meta = parseMemoryNoteMetadata(record.metadata);
  if (!meta) return undefined;
  if (!scanScopedMemoryContent(record.text).ok) return undefined;
  const sourceEntryIds = meta.sourceEntryIds ? [...meta.sourceEntryIds].sort() : [];
  const links = meta.links
    ? [...meta.links]
        .map((link) => ({
          id: link.id,
          ...(link.relation === undefined ? {} : { relation: link.relation }),
          ...(link.weight === undefined ? {} : { weight: link.weight }),
        }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    : [];
  const head = yaml([
    ["id", record.id],
    ["kind", meta.kind],
    ["status", status],
    ["tenantId", record.tenantId],
    ["resourceId", record.resourceId],
    ["threadId", record.threadId],
    ["validFrom", meta.validFrom],
    ["validTo", meta.validTo],
    ["sourceEntryIds", sourceEntryIds.length > 0 ? sourceEntryIds : undefined],
    ["uses", uses],
    ["lastUsedAt", lastUsedAt],
    ["links", links.length > 0 ? links : undefined],
  ]);
  return `${head}\n\n${record.text.endsWith("\n") ? record.text : `${record.text}\n`}`;
}

function renderFacts(content: string): string {
  const kept = content.split("\n").filter((line) => line.length === 0 || scanScopedMemoryContent(line).ok);
  if (kept.length === 0) return "";
  const body = kept.join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}

export async function renderScopedMirror(input: {
  readonly memory: Memory;
  readonly scopeRoot: string;
  readonly ledgerFile: string;
  readonly factsBlock: string;
}): Promise<void> {
  const dir = join(input.scopeRoot, ".memory");
  const notesDir = join(dir, "notes");
  await mkdir(notesDir, { recursive: true });
  const ledger = await loadScopedLedger(input.ledgerFile);
  const keep = new Set<string>();
  const entries = [...(await exportAll(input.memory))].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const record of entries) {
    const row = ledger.notes[record.id];
    if (statusOf(row?.status) === "archived") continue;
    const file = renderNote(record, statusOf(row?.status) === "verified" ? "verified" : "candidate", row?.uses ?? 0, row?.lastUsedAt);
    if (!file) continue;
    keep.add(record.id);
    await writeFile(join(notesDir, `${record.id}.md`), file);
  }
  for (const name of await readdir(notesDir)) {
    if (!name.endsWith(".md") || keep.has(name.slice(0, -3))) continue;
    await unlink(join(notesDir, name));
  }
  const facts = readFabricBlock(await input.memory.getWorking(), input.factsBlock);
  await writeFile(join(dir, "facts.md"), renderFacts(facts?.content ?? ""));
  await writeFile(join(dir, ".gitignore"), GITIGNORE);
}
