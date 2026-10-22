import type { WikiProfileType } from "../types.js";
import { CodebaseProfile, type ExtractedEntityDraft, type ExtractedSymbol, type ScannedFile } from "./codebase.js";
import { PkmProfile } from "./pkm.js";

export class HybridProfile {
  readonly name: WikiProfileType = "hybrid";
  private readonly codebaseProfile = new CodebaseProfile();
  private readonly pkmProfile = new PkmProfile();

  matches(_files: readonly string[]): boolean {
    return true; // Catch-all
  }

  extractSymbols(file: ScannedFile): ExtractedSymbol[] {
    if (file.relativePath.endsWith(".md") || file.relativePath.endsWith(".txt")) {
      return this.pkmProfile.extractSymbols(file);
    }
    return this.codebaseProfile.extractSymbols(file);
  }

  deriveEntities(files: readonly ScannedFile[]): ExtractedEntityDraft[] {
    const codeFiles = files.filter((f) => !f.relativePath.endsWith(".md") && !f.relativePath.endsWith(".txt"));
    const docFiles = files.filter((f) => f.relativePath.endsWith(".md") || f.relativePath.endsWith(".txt"));

    const codeEntities = this.codebaseProfile.deriveEntities(codeFiles);
    const docEntities = this.pkmProfile.deriveEntities(docFiles);

    return [...codeEntities, ...docEntities];
  }

  generateSchemaRules(): string {
    return `# Hybrid Codebase & Knowledge Wiki Schema Rules
- For source code modules, compile to \`entities/module-<name>.md\` with exact clickable line anchors: \`symbol (file:///path#L10-L40)\`.
- For conceptual documentation and literature notes, compile to \`entities/concept-<name>.md\` with \`[[wikilink]]\` cross-references.
- Architectural decision records live in \`decisions/ADR-<num>-<name>.md\`.
- All operations update \`index.md\` and append to \`log.md\`.
`;
  }
}

export function resolveProfile(profileType: WikiProfileType, sampleFiles: readonly string[]): CodebaseProfile | PkmProfile | HybridProfile {
  if (profileType === "codebase") return new CodebaseProfile();
  if (profileType === "pkm") return new PkmProfile();
  if (profileType === "hybrid") return new HybridProfile();

  // "auto" detection
  const pkm = new PkmProfile();
  if (pkm.matches(sampleFiles)) return pkm;

  const codebase = new CodebaseProfile();
  if (codebase.matches(sampleFiles)) return codebase;

  return new HybridProfile();
}
