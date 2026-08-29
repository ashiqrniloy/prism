import type { WikiProfileType } from "../types.js";
import { parseMarkdownHeading } from "../heading.js";
import type { ExtractedEntityDraft, ExtractedSymbol, ScannedFile } from "./codebase.js";

export class PkmProfile {
  readonly name: WikiProfileType = "pkm";

  matches(files: readonly string[]): boolean {
    const mdCount = files.filter((f) => f.endsWith(".md") || f.endsWith(".txt")).length;
    return mdCount > files.length * 0.7;
  }

  extractSymbols(file: ScannedFile): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    const lines = file.content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Extract markdown headings (# Title, ## Section) — linear heading parse (CodeQL js/polynomial-redos, alert 63)
      const headingMatch = parseMarkdownHeading(line);
      if (headingMatch) {
        symbols.push({
          name: headingMatch.text,
          kind: "heading",
          startLine: lineNum,
          endLine: lineNum,
          signature: line.trim(),
        });
        continue;
      }

      // Extract hashtags (#tag)
      const tagMatches = line.matchAll(/#([a-zA-Z0-9_-]+)/g);
      for (const match of tagMatches) {
        symbols.push({
          name: match[1],
          kind: "tag",
          startLine: lineNum,
          endLine: lineNum,
          signature: match[0],
        });
      }
    }

    return symbols;
  }

  deriveEntities(files: readonly ScannedFile[]): ExtractedEntityDraft[] {
    const entities: ExtractedEntityDraft[] = [];

    for (const file of files) {
      const symbols = this.extractSymbols(file);
      const headings = symbols.filter((s) => s.kind === "heading");
      const tags = symbols.filter((s) => s.kind === "tag").map((t) => t.name);

      const title = headings.length > 0 ? headings[0].name : file.relativePath.replace(/\.[^/.]+$/, "");
      const id = `concept-${file.relativePath.toLowerCase().replace(/[^a-z0-9-_]/g, "-")}`;

      entities.push({
        id,
        title,
        category: "concept",
        tags: Array.from(new Set([...tags, "pkm"])),
        rawSources: [file.relativePath],
        symbols,
        summary: `Compiled knowledge note for "${title}". Extracted from ${file.relativePath}.`,
      });
    }

    return entities;
  }

  generateSchemaRules(): string {
    return `# Personal Knowledge Management (PKM) Schema Rules
- Organize topics into conceptual synthesis in \`entities/concept-<name>.md\`.
- Use \`[[wikilink]]\` syntax to link related concept pages together.
- Extract recurring themes, literature citations, and personal reflections.
- Retain chronological context in \`log.md\`.
`;
  }
}
