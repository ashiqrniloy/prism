import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { scanSecrets } from "../../scan-secrets.mjs";

export const CACHE = ".cache/memory-bench/lifecycle";
export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export function args(options) {
  return parseArgs({ options: Object.fromEntries(Object.entries(options).map(([key, type]) => [key, { type }])), strict: true }).values;
}
export function validateLedger({ manifest: m, entries }) {
  if (
    m?.type !== "manifest" ||
    m.version !== 1 ||
    !["synthetic", "recorded"].includes(m.source) ||
    (m.source === "recorded" && m.consent !== true) ||
    !Number.isFinite(Date.parse(m.order)) ||
    [m.persona, m.project, m.session].some((id) => typeof id !== "string" || !id)
  )
    throw new Error("LifecycleManifest");
  if (
    !Array.isArray(entries) ||
    entries.some((entry) => !entry || typeof entry.id !== "string" || !entry.id || entry.sessionId === undefined)
  )
    throw new Error("LifecycleEntries");
  if (!Array.isArray(m.labels) || !Array.isArray(m.probes)) throw new Error("LifecycleLabelsAndProbes");
  for (const label of m.labels)
    if (
      !label ||
      typeof label.id !== "string" ||
      typeof label.key !== "string" ||
      typeof label.shouldPromote !== "boolean" ||
      !Array.isArray(label.entryIds) ||
      label.entryIds.some((id) => typeof id !== "string")
    )
      throw new Error("LifecycleLabel");
}
export async function writeLedger(ledger, out = `${CACHE}/ledgers`) {
  validateLedger(ledger);
  await mkdir(out, { recursive: true, mode: 0o700 });
  const stage = await mkdtemp(join(out, ".export-"));
  try {
    const text = `${[ledger.manifest, ...ledger.entries.map((entry) => ({ type: "entry", entry }))].map((row) => JSON.stringify(row)).join("\n")}\n`;
    const path = join(stage, "ledger.jsonl");
    await writeFile(path, text, { mode: 0o600 });
    await scanSecrets([path]);
    const target = join(out, `${hash(text)}.jsonl`);
    await rename(path, target);
    return target;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
export async function loadLedgers(dir) {
  const files = (await readdir(dir)).filter((name) => /^[a-f0-9]{64}\.jsonl$/.test(name)).sort();
  if (!files.length || files.length > 10000) throw new Error("LifecycleLedgerCount");
  const ledgers = [];
  for (const name of files) {
    const text = await readFile(join(dir, name), "utf8");
    if (Buffer.byteLength(text) > 16 * 1024 * 1024 || hash(text) !== name.slice(0, -6)) throw new Error("LifecycleLedgerIntegrity");
    const [manifest, ...rows] = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (rows.some((row) => row.type !== "entry")) throw new Error("LifecycleEntries");
    validateLedger({ manifest, entries: rows.map((row) => row.entry) });
    ledgers.push({ manifest, entries: rows.map((row) => row.entry) });
  }
  return ledgers;
}
