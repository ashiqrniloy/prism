import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { QmdSearchResult, SearchMode } from "../types.js";

const execFileAsync = promisify(execFile);

export type QmdCommandRunner = (
  cmd: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export const defaultQmdRunner: QmdCommandRunner = async (cmd, args, options) => {
  const result = await execFileAsync(cmd, [...args], {
    cwd: options?.cwd,
    timeout: options?.timeout ?? 15000,
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

export interface QmdClientOptions {
  readonly qmdPath?: string;
  readonly runner?: QmdCommandRunner;
  readonly wikiRoot?: string;
  readonly workspaceRoot?: string;
}

export class QmdClient {
  readonly qmdPath: string;
  private readonly runner: QmdCommandRunner;
  private readonly wikiRoot: string;
  private readonly workspaceRoot: string;

  constructor(options: QmdClientOptions = {}) {
    this.qmdPath = options.qmdPath ?? "qmd";
    this.runner = options.runner ?? defaultQmdRunner;
    this.wikiRoot = options.wikiRoot ?? ".wiki";
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.runner(this.qmdPath, ["--version"], { cwd: this.workspaceRoot });
      return res.stdout.length > 0 || res.stderr.length === 0;
    } catch {
      return false;
    }
  }

  async collectionAdd(path: string, name = "prism-wiki"): Promise<boolean> {
    try {
      await this.runner(this.qmdPath, ["collection", "add", path, "--name", name], {
        cwd: this.workspaceRoot,
      });
      return true;
    } catch {
      return false;
    }
  }

  async update(): Promise<boolean> {
    try {
      await this.runner(this.qmdPath, ["update"], {
        cwd: this.workspaceRoot,
      });
      return true;
    } catch {
      return false;
    }
  }

  async search(query: string, options: { mode?: SearchMode; maxResults?: number; collection?: string } = {}): Promise<QmdSearchResult[]> {
    const mode = options.mode ?? "search";
    const subCommand = mode === "vsearch" ? "vsearch" : mode === "query" ? "query" : "search";
    const maxResults = options.maxResults ?? 4;

    const args = [subCommand, query, "--json"];

    try {
      const res = await this.runner(this.qmdPath, args, {
        cwd: this.workspaceRoot,
      });

      const parsed = JSON.parse(res.stdout.trim() || "[]");
      if (Array.isArray(parsed)) {
        const hits = parsed
          .slice(0, maxResults)
          .map((item, idx) => ({
            docId: item.docId ?? item.id ?? `#${idx + 1}`,
            file: item.file ?? item.path ?? "",
            score: typeof item.score === "number" ? item.score : 1.0,
            snippet: item.snippet ?? item.content ?? item.text ?? "",
            title: item.title,
          }))
          // qmd searches its whole global index (no collection scoping in the
          // CLI); foreign collections surface as qmd:// URIs and must never
          // outrank this workspace's own wiki content.
          .filter((hit) => hit.file.length > 0 && !hit.file.startsWith("qmd://"));
        if (hits.length > 0) {
          return hits;
        }
      }
      // An empty or foreign-only answer means no usable index (installed qmd
      // with an empty/wedged collection); fall back to the in-repo catalog
      // scan so wiki_search answers from the compiled entities themselves.
      return this.fallbackCatalogSearch(query, maxResults);
    } catch {
      // If qmd fails or is not installed, fall back to in-memory catalog scan
      return this.fallbackCatalogSearch(query, maxResults);
    }
  }

  async fallbackCatalogSearch(query: string, maxResults = 4): Promise<QmdSearchResult[]> {
    const results: QmdSearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const queryTokens = lowerQuery.split(/\s+/).filter(Boolean);

    const entitiesDir = join(this.workspaceRoot, this.wikiRoot, "entities");
    let files: string[] = [];
    try {
      files = await readdir(entitiesDir);
    } catch {
      return results;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const fullPath = join(entitiesDir, file);
      try {
        const content = await readFile(fullPath, "utf8");
        const lowerContent = content.toLowerCase();

        let score = 0;
        for (const token of queryTokens) {
          if (file.toLowerCase().includes(token)) score += 3;
          if (lowerContent.includes(token)) score += 1;
        }

        if (score > 0) {
          const lines = content.split("\n");
          const snippetLines = lines.slice(0, 10).join("\n");
          results.push({
            docId: file.replace(/\.md$/, ""),
            file: join(this.wikiRoot, "entities", file).replace(/\\/g, "/"),
            score,
            snippet: snippetLines,
            title: lines[0]?.replace(/^#+\s*/, "") || file,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }
}
