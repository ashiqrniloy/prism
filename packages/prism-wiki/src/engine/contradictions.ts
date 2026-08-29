import type { ExtractedEntityDraft } from "../profiles/codebase.js";
import type { WikiEntityMetadata } from "../types.js";

export interface ContradictionRecord {
  readonly entityId: string;
  readonly type: "symbol_removed" | "source_removed" | "category_changed" | "summary_divergence";
  readonly previousClaim: string;
  readonly newClaim: string;
  readonly resolution: string;
  readonly detectedAt: string;
}

export class ContradictionEngine {
  detectContradictions(existingEntity: WikiEntityMetadata, newDraft: ExtractedEntityDraft): ContradictionRecord[] {
    const records: ContradictionRecord[] = [];
    const nowIso = new Date().toISOString();

    // 1. Check for removed symbols / exports
    const newSymbolNames = new Set(newDraft.symbols.map((s) => s.name));
    for (const anchor of existingEntity.anchors) {
      if (anchor.symbol && !newSymbolNames.has(anchor.symbol)) {
        records.push({
          entityId: existingEntity.id,
          type: "symbol_removed",
          previousClaim: `Exported symbol '${anchor.symbol}' in ${anchor.filePath}`,
          newClaim: `Symbol '${anchor.symbol}' no longer present in source`,
          resolution: `Removed dead symbol anchor for '${anchor.symbol}' and updated entity definition.`,
          detectedAt: nowIso,
        });
      }
    }

    // 2. Check for removed raw sources
    const newSourceSet = new Set(newDraft.rawSources);
    for (const src of existingEntity.rawSources) {
      if (!newSourceSet.has(src)) {
        records.push({
          entityId: existingEntity.id,
          type: "source_removed",
          previousClaim: `Raw source dependency on '${src}'`,
          newClaim: `Source file '${src}' no longer contributes to this entity`,
          resolution: `Decoupled '${src}' from entity '${existingEntity.id}'.`,
          detectedAt: nowIso,
        });
      }
    }

    // 3. Check for category divergence
    if (existingEntity.category !== newDraft.category) {
      records.push({
        entityId: existingEntity.id,
        type: "category_changed",
        previousClaim: `Classified under category '${existingEntity.category}'`,
        newClaim: `Reclassified as '${newDraft.category}'`,
        resolution: `Updated category metadata to '${newDraft.category}'.`,
        detectedAt: nowIso,
      });
    }

    return records;
  }

  formatContradictionLogItems(records: readonly ContradictionRecord[]): readonly { readonly verb: string; readonly text: string }[] {
    return records.map((rec) => ({
      verb: "Reconciled",
      text: `contradiction ${rec.type} on ${rec.entityId}: ${rec.previousClaim}. ${rec.resolution}`,
    }));
  }

  formatContradictionLogEntry(records: readonly ContradictionRecord[]): string {
    return this.formatContradictionLogItems(records)
      .map((item) => `* **${item.verb}**: ${item.text}`)
      .join("\n");
  }
}
