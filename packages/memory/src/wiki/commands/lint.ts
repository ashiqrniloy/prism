import type { CommandDefinition } from "@arnilo/prism";
import { WikiLinter } from "../engine/linter.js";
import type { LintReport, WikiExtensionOptions } from "../types.js";

export async function lintWiki(options: WikiExtensionOptions = {}): Promise<LintReport> {
  const wikiRoot = options.wikiRoot ?? ".wiki";
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const linter = new WikiLinter();
  return linter.lint(wikiRoot, workspaceRoot);
}

/** First few pruned pages/paths shown in command and CLI text; the report itself is uncapped. */
const PRUNED_PREVIEW = 3;

/**
 * Non-fatal pruned-source line shared by the `wiki-lint` command and the standalone CLI: a count plus
 * the first few workspace-relative page and source paths, kept separate from anchors/links/orphans.
 */
export function renderPrunedSources(report: LintReport): string {
  const shown = report.prunedSources.slice(0, PRUNED_PREVIEW);
  const detail = shown
    .map(
      (entry) =>
        `${entry.page} (${entry.missing.slice(0, PRUNED_PREVIEW).join(", ")}${entry.missing.length > PRUNED_PREVIEW ? ", …" : ""})`,
    )
    .join("; ");
  const rest = report.prunedSources.length - shown.length;
  return `${report.prunedSources.length} entity page(s) need re-filing after source pruning: ${detail}${rest > 0 ? `, +${rest} more` : ""}`;
}

export function createWikiLintCommand(options: WikiExtensionOptions = {}): CommandDefinition {
  return {
    name: "wiki-lint",
    description: "Check wiki health for broken links, dead source line anchors, and orphan pages.",
    async execute(_args, _context) {
      const report = await lintWiki(options);

      const prunedText = report.prunedSources.length > 0 ? renderPrunedSources(report) : "";
      const statusText = report.ok
        ? prunedText === ""
          ? "✅ Wiki health check passed. No broken links or dead anchors found."
          : `✅ Wiki health check passed. ${prunedText}.`
        : `⚠️ Wiki health check found issues: ${report.deadAnchors.length} dead anchor(s), ${report.brokenLinks.length} broken link(s), ${report.orphans.length} orphan(s)${prunedText === "" ? "" : `; plus ${prunedText}`}.`;

      return {
        name: "wiki-lint",
        value: report,
        content: [{ type: "text", text: statusText }],
        metadata: { trust: "untrusted_external", ok: report.ok },
      };
    },
  };
}
