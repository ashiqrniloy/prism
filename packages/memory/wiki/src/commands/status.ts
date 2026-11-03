import type { JsonObject, PackageCommand, SessionContext } from "@arnilo/prism";
import type { FabricOntologyPort } from "@arnilo/prism-memory-fabric";
import type { WikiPassReport } from "../consolidate/pass.js";
import type { WikiStatusReport, WikiStatusScope } from "../types.js";
import { renderPass } from "./consolidate.js";

export const WIKI_STATUS_COMMAND_NAME = "wiki:status";

/**
 * Counts the ontology tier per readable scope: concept notes, and the ones that need a pass with their reasons.
 * Reads the `memory.fabric` port only (no model call, no note text), plus the last concept pass and its cost.
 */
export async function wikiStatus(port: FabricOntologyPort, last?: WikiPassReport, signal?: AbortSignal): Promise<WikiStatusReport> {
  const scopes: WikiStatusScope[] = [];
  for (const scope of port.scopes()) {
    const [subjects, dirty] = await Promise.all([
      port.subjects(scope, signal === undefined ? {} : { signal }),
      port.dirty(scope, signal === undefined ? {} : { signal }),
    ]);
    const reasons: Record<string, number> = {};
    for (const entry of dirty) for (const reason of entry.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    scopes.push({ scope, subjects: subjects.length, dirty: dirty.length, reasons });
  }
  return {
    scopes,
    subjects: scopes.reduce((sum, entry) => sum + entry.subjects, 0),
    dirty: scopes.reduce((sum, entry) => sum + entry.dirty, 0),
    ...(last === undefined ? {} : { last }),
  };
}

export function renderWikiStatus(report: WikiStatusReport): string {
  if (report.scopes.length === 0) return "wiki: no readable memory scope.";
  const lines = report.scopes.map((entry) => {
    const reasons = Object.entries(entry.reasons)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, count]) => `${reason} ${count}`)
      .join(", ");
    return `- ${entry.scope}: ${entry.subjects} subject${entry.subjects === 1 ? "" : "s"}, ${entry.dirty} dirty${reasons ? ` (${reasons})` : ""}`;
  });
  return [
    `wiki: ${report.subjects} subject${report.subjects === 1 ? "" : "s"}, ${report.dirty} dirty.`,
    ...lines,
    ...(report.last === undefined ? ["last pass: none in this process."] : [`last pass: ${renderPass(report.last)}`]),
  ].join("\n");
}

/** `wiki:status`. The port is resolved per call: the fabric may load after this package. */
export function createWikiStatusCommand(
  port: () => FabricOntologyPort | undefined,
  last: (session?: SessionContext) => WikiPassReport | undefined = () => undefined,
): PackageCommand {
  return {
    name: WIKI_STATUS_COMMAND_NAME,
    description: "Report the ontology tier: concept notes and dirty subjects per scope. Makes no model call.",
    async run(_args, context): Promise<JsonObject> {
      const fabric = port();
      if (fabric === undefined) return { text: "wiki: the memory.fabric service is not available." };
      const report = await wikiStatus(fabric, last(context.session));
      return { ...(report as unknown as JsonObject), text: renderWikiStatus(report) };
    },
  };
}
