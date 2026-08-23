import type { CommandDefinition } from "@arnilo/prism";
import { WikiLinter } from "../engine/linter.js";
import type { LintReport, WikiExtensionOptions } from "../types.js";

export async function lintWiki(options: WikiExtensionOptions = {}): Promise<LintReport> {
  const wikiRoot = options.wikiRoot ?? ".wiki";
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const linter = new WikiLinter();
  return linter.lint(wikiRoot, workspaceRoot);
}

export function createWikiLintCommand(options: WikiExtensionOptions = {}): CommandDefinition {
  return {
    name: "wiki-lint",
    description: "Check wiki health for broken links, dead source line anchors, and orphan pages.",
    async execute(args, context) {
      const report = await lintWiki(options);

      const statusText = report.ok
        ? "✅ Wiki health check passed. No broken links or dead anchors found."
        : `⚠️ Wiki health check found issues: ${report.deadAnchors.length} dead anchor(s), ${report.brokenLinks.length} broken link(s), ${report.orphans.length} orphan(s).`;

      return {
        name: "wiki-lint",
        value: report,
        content: [{ type: "text", text: statusText }],
        metadata: { trust: "untrusted_external", ok: report.ok },
      };
    },
  };
}
