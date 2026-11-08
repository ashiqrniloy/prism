import type { JsonObject, PackageCommand } from "@arnilo/prism";
import type { WikiOntologyPort } from "../ontology/port.js";
import type { WikiScopeLevel } from "../ontology/types.js";
import { lintOntology, type WikiLintReport } from "../lint.js";

export const WIKI_LINT_COMMAND_NAME = "wiki:lint";
const LINT_SCOPES = ["user", "agent", "team", "project"] as const;

export function renderLint(report: WikiLintReport): string {
  const head = report.ok
    ? `wiki lint: ok, ${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}.`
    : "wiki lint: FAILED (unresolved citation or alias collision).";
  const lines = report.scopes.flatMap((entry) => [
    `- ${entry.scope}: ${entry.concepts} concept${entry.concepts === 1 ? "" : "s"}, ${entry.findings.length} finding${entry.findings.length === 1 ? "" : "s"}`,
    ...entry.findings.map(
      (finding) => `    ${finding.rule}${finding.subject === undefined ? "" : ` ${finding.subject}`}: ${finding.detail}`,
    ),
  ]);
  return [head, ...lines, ...(report.skipped === undefined ? [] : [`skipped: ${report.skipped}.`])].join("\n");
}

/** `wiki:lint [scope]`: a read-only health report over the ontology. Makes no model call. */
export function createWikiLintCommand(
  port: () => WikiOntologyPort | undefined,
  options: { readonly maxClaimsPerConcept: number; readonly passStarts: () => readonly string[] },
): PackageCommand {
  return {
    name: WIKI_LINT_COMMAND_NAME,
    description:
      "Lint the ontology: unresolved or stale citations, uncited human claims, alias collisions, missing relations and ontology gaps. Read-only; makes no model call.",
    args: {
      type: "object",
      properties: { scope: { type: "string", enum: [...LINT_SCOPES], description: "One scope; default every readable scope." } },
      additionalProperties: false,
    },
    async run(args): Promise<JsonObject> {
      const ontology = port();
      if (ontology === undefined) return { ok: false, text: "wiki: not available." };
      const scope = (args as { scope?: WikiScopeLevel }).scope;
      const report = await lintOntology(ontology, {
        ...(scope === undefined ? {} : { scopes: [scope] }),
        maxClaimsPerConcept: options.maxClaimsPerConcept,
        passStarts: options.passStarts(),
      });
      return { ...(report as unknown as JsonObject), text: renderLint(report) };
    },
  };
}
