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

  formatContradictionLogEntry(records: readonly ContradictionRecord[]): string {
    if (records.length === 0) return "";

    const timestamp = records[0].detectedAt.replace("T", " ").slice(0, 16);
    let entry = `\n## [${timestamp}] contradiction | Reconciled ${records.length} conflicting claim(s)\n`;

    for (const rec of records) {
      entry += `- **Entity:** [[entities/${rec.entityId}.md]] (${rec.type})\n`;
      entry += `  - Previous: ${rec.previousClaim}\n`;
      entry += `  - Updated: ${rec.newClaim}\n`;
      entry += `  - Resolution: ${rec.resolution}\n`;
    }

    return entry;
  }
}
