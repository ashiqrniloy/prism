import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { HydratedSearchHit, QmdSearchResult, SearchMode, WikiManifest, WikiSearchResponse, WikiSourceAnchor } from "../types.js";
import { parseMarkdownHeading } from "../heading.js";

export class Context7Hydrator {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  async hydrate(hits: readonly QmdSearchResult[], manifest?: WikiManifest): Promise<HydratedSearchHit[]> {
    const hydrated: HydratedSearchHit[] = [];

    for (const hit of hits) {
      const relWikiPath = hit.file;
      const absWikiPath = resolve(this.workspaceRoot, relWikiPath);

      let content = "";
      try {
        content = await readFile(absWikiPath, "utf8");
      } catch {
        content = hit.snippet;
      }

      // Extract title and breadcrumbs from headings
      const lines = content.split("\n");
      const breadcrumbs: string[] = [];
      let currentH1 = "";
      let currentH2 = "";

      for (const line of lines) {
        // Linear heading parses (CodeQL js/polynomial-redos, alerts 64-65)
        const h1Match = parseMarkdownHeading(line);
        if (h1Match?.level === 1) currentH1 = h1Match.text;

        const h2Match = parseMarkdownHeading(line);
        if (h2Match?.level === 2) {
          currentH2 = h2Match.text;
          if (currentH1 && currentH2) {
            breadcrumbs.push(`${currentH1} > ${currentH2}`);
          }
        }
      }

      const entityId = basename(relWikiPath, ".md");
      const entityMeta = manifest?.entities[entityId];

      const anchors: readonly WikiSourceAnchor[] = entityMeta?.anchors ?? [];
      const title = entityMeta?.title ?? currentH1 ?? hit.title ?? entityId;

      // Extract summary (first paragraph after H1)
      let summary = "";
      let foundH1 = false;
      for (const line of lines) {
        if (line.startsWith("# ")) {
          foundH1 = true;
          continue;
        }
        if (foundH1 && line.trim() && !line.startsWith("##") && !line.startsWith("---")) {
          summary = line.trim();
          break;
        }
      }
      if (!summary) summary = hit.snippet.slice(0, 200).replace(/\n/g, " ");

      // Check freshness against manifest source hashes
      let isStale = false;
      if (manifest && entityMeta) {
        for (const anchor of entityMeta.anchors) {
          const currentHash = manifest.sourceFileHashes[anchor.filePath];
          if (currentHash && anchor.sourceHash && currentHash !== anchor.sourceHash) {
            isStale = true;
            break;
          }
        }
      }

      hydrated.push({
        title,
        wikiPath: relWikiPath,
        breadcrumbs: breadcrumbs.length > 0 ? breadcrumbs : [title],
        summary,
        anchors,
        isStale,
        rawScore: hit.score,
      });
    }

    return hydrated;
  }

  formatResponse(query: string, mode: SearchMode, hits: readonly HydratedSearchHit[]): WikiSearchResponse {
    if (hits.length === 0) {
      const formattedMarkdown = `### Wiki Search: "${query}" (Mode: \`${mode}\`)\n\n*No matching entities or concepts found in the wiki.*\n\n> [!TIP]\n> If this is a new topic, run \`wiki-refresh\` or record an insight using \`wiki_record_insight\`.`;
      return { query, mode, hits: [], formattedMarkdown };
    }

    const sections: string[] = [];
    sections.push(`### Wiki Search: "${query}" (Mode: \`${mode}\`, Hits: ${hits.length})\n`);

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const matchNum = i + 1;
      const freshnessLabel = hit.isStale ? "⚠️ Stale (Source code modified since compilation)" : "✅ Current";

      let section = `#### Match ${matchNum}: ${hit.title}\n`;
      section += `- **Wiki Page:** \`[[${hit.wikiPath}]]\`\n`;
      section += `- **Breadcrumbs:** \`${hit.breadcrumbs.join(" | ")}\`\n`;
      section += `- **Freshness:** ${freshnessLabel}\n\n`;
      section += `**Synthesized Summary:**\n${hit.summary}\n\n`;

      if (hit.anchors.length > 0) {
        section += `**Direct Code & Source Anchors (Clickable):**\n`;
        for (const anchor of hit.anchors.slice(0, 6)) {
          const absPath = resolve(this.workspaceRoot, anchor.filePath).replace(/\\/g, "/");
          const symbolName = anchor.symbol ?? basename(anchor.filePath);
          const link = `[\`${symbolName}\`](file:///${absPath.replace(/^\/+/, "")}#L${anchor.startLine}-L${anchor.endLine})`;
          section += `- ${link} (\`${anchor.filePath}:${anchor.startLine}-${anchor.endLine}\`)\n`;
        }
        section += "\n";
      }

      sections.push(section);
    }

    sections.push(`> [!TIP]\n> Use the clickable file links above to inspect specific line implementations directly without grepping.`);

    return {
      query,
      mode,
      hits,
      formattedMarkdown: sections.join("\n---\n\n"),
    };
  }
}
