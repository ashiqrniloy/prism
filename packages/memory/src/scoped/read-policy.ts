import type { MemoryFabric, MemoryFabricExplainEntry, MemoryFabricRecallOptions, MemoryNoteHit } from "../fabric/types.js";
import { HARD_TOP_K_CAP } from "../limits.js";
import { RECALL_OVERSAMPLE } from "../scoring.js";
import { loadScopedLedger, saveScopedLedger, touchScopedLedger, type ScopedMemoryLedger } from "./ledger.js";

type ReadPolicySettings = {
  readonly activation: { readonly topK: number; readonly minSimilarity: number };
  readonly decay: { readonly tauDays: number };
};

export interface ScopedMemoryRecallResult {
  readonly hits: readonly MemoryNoteHit[];
  readonly abstained: boolean;
  readonly explain: readonly MemoryFabricExplainEntry[];
}

const MS_PER_DAY = 86_400_000;

export function scoreScopedHit(score: number, uses: number, ageDays: number, tauDays: number): number {
  const s = Number.isFinite(score) ? score : 0;
  const u = Number.isFinite(uses) && uses > 0 ? uses : 0;
  const age = Number.isFinite(ageDays) && ageDays > 0 ? ageDays : 0;
  const tau = Number.isFinite(tauDays) && tauDays > 0 ? tauDays : 30;
  return s * Math.exp(-age / tau) * (1 + Math.log(1 + u));
}

function similarityOf(hit: MemoryNoteHit): number {
  const value = hit.similarity ?? hit.score;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function ageDays(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || now <= t) return 0;
  return (now - t) / MS_PER_DAY;
}

function applyReadPolicy(
  hits: readonly MemoryNoteHit[],
  explain: readonly MemoryFabricExplainEntry[],
  ledger: ScopedMemoryLedger,
  settings: ReadPolicySettings,
  now: number,
): ScopedMemoryRecallResult {
  const admitted = hits.filter((hit) => similarityOf(hit) >= settings.activation.minSimilarity);
  if (admitted.length === 0) return { hits: [], abstained: true, explain: [] };

  const ranked = admitted
    .map((hit) => {
      const row = ledger.notes[hit.id];
      const scoped = scoreScopedHit(hit.score, row?.uses ?? 0, ageDays(row?.lastUsedAt ?? hit.ingestedAt, now), settings.decay.tauDays);
      return { hit: { ...hit, score: scoped }, scoped, original: hit.score };
    })
    .sort((a, b) => b.scoped - a.scoped || b.original - a.original || a.hit.id.localeCompare(b.hit.id))
    .slice(0, settings.activation.topK);

  const explainById = new Map(explain.map((entry) => [entry.id, entry]));
  return {
    hits: ranked.map((row) => row.hit),
    abstained: false,
    explain: ranked.map((row) => {
      const prev = explainById.get(row.hit.id);
      return {
        id: row.hit.id,
        score: row.scoped,
        link: prev?.link ?? false,
        valid: prev?.valid ?? true,
        ...(prev?.similarity !== undefined ? { similarity: prev.similarity } : {}),
        ...(prev?.recency !== undefined ? { recency: prev.recency } : {}),
        ...(prev?.importance !== undefined ? { importance: prev.importance } : {}),
      };
    }),
  };
}

export async function recallScopedMemory(
  input: {
    readonly fabric: MemoryFabric;
    readonly ledgerFile: string;
    readonly settings: ReadPolicySettings;
    readonly now?: number;
  },
  query: string,
  options: MemoryFabricRecallOptions = {},
): Promise<ScopedMemoryRecallResult> {
  const fetchK = Math.min(HARD_TOP_K_CAP, input.settings.activation.topK * RECALL_OVERSAMPLE);
  const recalled = await input.fabric.recall(query, { ...options, topK: fetchK });
  const now = input.now ?? Date.now();
  const ledger = await loadScopedLedger(input.ledgerFile);
  const result = applyReadPolicy(recalled.hits, recalled.explain, ledger, input.settings, now);
  if (result.hits.length === 0) return result;
  await saveScopedLedger(
    input.ledgerFile,
    touchScopedLedger(
      ledger,
      result.hits.map((hit) => hit.id),
      new Date(now).toISOString(),
    ),
  );
  return result;
}
