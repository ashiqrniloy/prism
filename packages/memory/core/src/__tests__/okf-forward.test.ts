/**
 * Plan 188.11 Task 4: a note file written by a newer version is kept as written, and a readable note keeps the
 * frontmatter keys this version does not know.
 */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createMarkdownMemoryStores } from "../fabric/index.js";
import { noteRelPath } from "../fabric/layout.js";
import { OKF_METADATA_KEY, parseNoteFile, renderNoteFile, unreadableReason } from "../fabric/okf.js";
import type { MemoryVectorRecord } from "../types.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-forward-"));
  dirs.push(dir);
  return dir;
}

const base = {
  tenantId: "t",
  resourceId: "r",
  threadId: "s",
  embedding: [] as number[],
  sequence: 1,
  createdAt: "2026-10-27T00:00:00.000Z",
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function note(id: string, fabric: Record<string, unknown>, extra?: Record<string, unknown>, text = `Body of ${id}`): MemoryVectorRecord {
  return {
    ...base,
    id,
    text,
    metadata: { fabric, ...(extra === undefined ? {} : { [OKF_METADATA_KEY]: { extra } }) } as MemoryVectorRecord["metadata"],
  };
}

/** A file as a newer version would have written it: unknown fabric key, unknown top-level frontmatter key. */
function futureFile(id = "aaaaaaaa1111"): string {
  return renderNoteFile(note(id, { v: 2, kind: "fact", future: "kept" }, { future_key: { nested: [1, 2] } }));
}

function plant(root: string, content: string, id = "aaaaaaaa1111", name?: string): string {
  const generated = noteRelPath({ tenantId: "t", resourceId: "r", kind: "fact", text: `Body of ${id}`, archived: false, id });
  const rel = name === undefined ? generated : `${dirname(generated)}/${name}`;
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
  return rel;
}

test("future_version_file_parses_as_unreadable_and_renders_its_own_bytes", () => {
  const content = futureFile();
  const parsed = parseNoteFile(content, "facts/a.md");
  expect(unreadableReason(parsed)).toBe("version>1");
  expect(renderNoteFile(parsed)).toBe(content);
});

test("unknown_top_level_frontmatter_key_survives_parse_and_render", () => {
  const content = renderNoteFile(note("bbbbbbbb2222", { v: 1, kind: "fact", extra: 1 }, { extra_top: "x" }));
  const parsed = parseNoteFile(content, "facts/b.md");
  expect(unreadableReason(parsed)).toBeUndefined();
  expect((parsed.metadata?.[OKF_METADATA_KEY] as { extra: unknown } | undefined)?.extra).toEqual({ extra_top: "x" });
  expect(renderNoteFile(parsed)).toBe(content);
  // The owned key is never written under `prism.metadata`.
  expect(content.match(/extra_top/g)?.length).toBe(1);
});

test("classifier_reason_marks_a_note_unreadable", () => {
  const content = renderNoteFile(note("cccccccc3333", { v: 1, kind: "bogus" }));
  expect(unreadableReason(parseNoteFile(content, "facts/c.md"))).toBeUndefined();
  const parsed = parseNoteFile(content, "facts/c.md", (record) => (record.metadata?.fabric ? "invalid-fabric" : undefined));
  expect(unreadableReason(parsed)).toBe("invalid-fabric");
  expect(renderNoteFile(parsed)).toBe(content);
});

test("future_version_note_survives_reconcile_rebuild_upsert_and_keeps_its_path", async () => {
  const root = tempDir();
  const content = futureFile();
  const rel = plant(root, content, "aaaaaaaa1111", "planted-by-a-newer-version.md");
  const stores = await createMarkdownMemoryStores({ root });
  try {
    for (const report of [await stores.reconcile(), await stores.rebuild()]) {
      expect(report.malformed).toBe(0);
      expect(report.unreadable).toBe(1);
      expect(report.unreadableReasons).toEqual({ "version>1": 1 });
    }
    expect(stores.unreadable()).toEqual({ unreadable: 1, unreadableReasons: { "version>1": 1 } });
    const [record] = await stores.vectorStore.getByIds(base, ["aaaaaaaa1111"]);
    expect(unreadableReason(record!)).toBe("version>1");
    // A writer that re-upserts the record (import, export, a patch) writes the same bytes to the same path.
    await stores.vectorStore.upsert([record!]);
    expect(hash(readFileSync(join(root, rel), "utf8"))).toBe(hash(content));
    expect(readdirSync(dirname(join(root, rel)))).toEqual([rel.split("/").at(-1)!]);
    // A tombstone does not move it either.
    await stores.vectorStore.invalidate(base, [{ id: "aaaaaaaa1111", reason: "corrected", at: base.createdAt } as never]);
    expect(readFileSync(join(root, rel), "utf8")).toBe(content);
  } finally {
    await stores.close();
  }
});

test("classify_note_option_counts_a_reason_core_cannot_know", async () => {
  const root = tempDir();
  plant(root, renderNoteFile(note("dddddddd4444", { v: 1, kind: "bogus" })), "dddddddd4444");
  const stores = await createMarkdownMemoryStores({
    root,
    classifyNote: (record) => ((record.metadata?.fabric as { kind?: string } | undefined)?.kind === "bogus" ? "unknown-kind" : undefined),
  });
  try {
    expect(stores.unreadable()).toEqual({ unreadable: 1, unreadableReasons: { "unknown-kind": 1 } });
  } finally {
    await stores.close();
  }
});

test("explicit_delete_removes_an_unreadable_note", async () => {
  const root = tempDir();
  const rel = plant(root, futureFile());
  const stores = await createMarkdownMemoryStores({ root });
  try {
    expect(await stores.vectorStore.delete({ ...base, ids: ["aaaaaaaa1111"] })).toBe(1);
    expect(() => readFileSync(join(root, rel))).toThrow();
    expect(stores.unreadable().unreadable).toBe(0);
  } finally {
    await stores.close();
  }
});
