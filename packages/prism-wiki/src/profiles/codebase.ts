import type { WikiProfileType } from "../types.js";

export interface ExtractedSymbol {
  readonly name: string;
  readonly kind: "function" | "class" | "interface" | "type" | "variable" | "export" | "heading" | "tag";
  readonly startLine: number;
  readonly endLine: number;
  readonly signature?: string;
}

export interface ScannedFile {
  readonly relativePath: string;
  readonly content: string;
  readonly hash: string;
  readonly extension: string;
}

export interface ExtractedEntityDraft {
  readonly id: string;
  readonly title: string;
  readonly category: "module" | "concept" | "decision" | "entity" | "person" | "tool";
  readonly tags: readonly string[];
  readonly rawSources: readonly string[];
  readonly symbols: readonly ExtractedSymbol[];
  readonly summary?: string;
}

export class CodebaseProfile {
  readonly name: WikiProfileType = "codebase";

  matches(files: readonly string[]): boolean {
    const codeExtensions = [".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp"];
    return files.some((file) => codeExtensions.some((ext) => file.endsWith(ext)));
  }

  extractSymbols(file: ScannedFile): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    const lines = file.content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // TypeScript / JavaScript export patterns
      const tsExportFunc = line.match(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/);
      if (tsExportFunc) {
        symbols.push({
          name: tsExportFunc[1],
          kind: "function",
          startLine: lineNum,
          endLine: Math.min(lineNum + 10, lines.length),
          signature: line.trim(),
        });
        continue;
      }

      const tsExportClass = line.match(/^export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/);
      if (tsExportClass) {
        symbols.push({
          name: tsExportClass[1],
          kind: "class",
          startLine: lineNum,
          endLine: Math.min(lineNum + 20, lines.length),
          signature: line.trim(),
        });
        continue;
      }

      const tsExportInterface = line.match(/^export\s+interface\s+([A-Za-z0-9_$]+)/);
      if (tsExportInterface) {
        symbols.push({
          name: tsExportInterface[1],
          kind: "interface",
          startLine: lineNum,
          endLine: Math.min(lineNum + 10, lines.length),
          signature: line.trim(),
        });
        continue;
      }

      const tsExportType = line.match(/^export\s+type\s+([A-Za-z0-9_$]+)/);
      if (tsExportType) {
        symbols.push({
          name: tsExportType[1],
          kind: "type",
          startLine: lineNum,
          endLine: lineNum,
          signature: line.trim(),
        });
        continue;
      }

      const tsExportConst = line.match(/^export\s+const\s+([A-Za-z0-9_$]+)/);
      if (tsExportConst) {
        symbols.push({
          name: tsExportConst[1],
          kind: "variable",
          startLine: lineNum,
          endLine: lineNum,
          signature: line.trim(),
        });
        continue;
      }

      // Python def / class
      const pyFunc = line.match(/^(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/);
      if (pyFunc) {
        symbols.push({
          name: pyFunc[1],
          kind: "function",
          startLine: lineNum,
          endLine: Math.min(lineNum + 10, lines.length),
          signature: line.trim(),
        });
        continue;
      }

      const pyClass = line.match(/^class\s+([A-Za-z0-9_]+)/);
      if (pyClass) {
        symbols.push({
          name: pyClass[1],
          kind: "class",
          startLine: lineNum,
          endLine: Math.min(lineNum + 20, lines.length),
          signature: line.trim(),
        });
        continue;
      }

      // Rust pub fn / struct / enum
      const rustFn = line.match(/^pub\s+(?:async\s+)?fn\s+([A-Za-z0-9_]+)/);
      if (rustFn) {
        symbols.push({
          name: rustFn[1],
          kind: "function",
          startLine: lineNum,
          endLine: Math.min(lineNum + 10, lines.length),
          signature: line.trim(),
        });
        continue;
      }

      const rustStruct = line.match(/^pub\s+(?:struct|enum|trait)\s+([A-Za-z0-9_]+)/);
      if (rustStruct) {
        symbols.push({
          name: rustStruct[1],
          kind: "class",
          startLine: lineNum,
          endLine: Math.min(lineNum + 15, lines.length),
          signature: line.trim(),
        });
      }
    }

    return symbols;
  }

  deriveEntities(files: readonly ScannedFile[]): ExtractedEntityDraft[] {
    const modulesByGroup = new Map<string, { sources: string[]; symbols: ExtractedSymbol[] }>();

    for (const file of files) {
      const symbols = this.extractSymbols(file);
      // Group by top-level directory or file basename
      const parts = file.relativePath.split("/");
      let groupName = "core";
      if (parts.length > 1) {
        groupName = parts[parts.length - 2] || parts[0];
      } else {
        groupName = parts[0].replace(/\.[^/.]+$/, "");
      }

      const existing = modulesByGroup.get(groupName) ?? { sources: [], symbols: [] };
      existing.sources.push(file.relativePath);
      existing.symbols.push(...symbols);
      modulesByGroup.set(groupName, existing);
    }

    const entities: ExtractedEntityDraft[] = [];
    for (const [group, data] of modulesByGroup.entries()) {
      const title = `${group.charAt(0).toUpperCase() + group.slice(1)} Module`;
      const id = `module-${group.toLowerCase().replace(/[^a-z0-9-_]/g, "-")}`;
      entities.push({
        id,
        title,
        category: "module",
        tags: [group.toLowerCase(), "codebase"],
        rawSources: data.sources,
        symbols: data.symbols,
        summary: `Compiled architectural model and symbols for the ${title}. Contains ${data.sources.length} source file(s) and ${data.symbols.length} exported symbol(s).`,
      });
    }

    return entities;
  }

  generateSchemaRules(): string {
    return `# Codebase Wiki Schema Rules
- Every claim regarding implementation logic must cite exact code line anchors: \`symbol (file:///path/to/file#L10-L40)\`.
- Group compiled entities by functional modules in \`entities/module-<name>.md\`.
- Keep architectural decision records in \`decisions/ADR-<num>-<name>.md\`.
- Do not repeat code verbatim; explain invariants, flow, and dependencies.
`;
  }
}
