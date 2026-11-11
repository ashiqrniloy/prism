import type { ExperimentReportRecord, OwnershipScope } from "@arnilo/prism";
import { prepareExperimentReportRecord } from "@arnilo/prism-extensions/store-codecs";
import { EvalError } from "./errors.js";
import type { ExperimentReport } from "./types.js";

/** One bounded, content-free summary; ownership comes from the host, never a scored row. */
export function toExperimentReportRecord(report: ExperimentReport, ownership: OwnershipScope = {}): ExperimentReportRecord {
  const ids = new Set<string>();
  const itemMeans = Object.fromEntries(
    report.items.map((item) => {
      if (!item.item.id || ids.has(item.item.id)) throw new EvalError("Unique item ids required", "ERR_PRISM_EVAL_REPORT_BOUNDS");
      ids.add(item.item.id);
      const scores = new Map<string, number[]>();
      for (const row of item.evaluations) {
        if (row.status !== "scored") continue;
        if (row.score === undefined || !Number.isFinite(row.score) || row.score < 0 || row.score > 1) {
          throw new EvalError("Invalid scored observation in experiment report", "ERR_PRISM_EVAL_REPORT_BOUNDS");
        }
        const values = scores.get(row.scorerId) ?? [];
        values.push(row.score);
        scores.set(row.scorerId, values);
      }
      return [
        item.item.id,
        Object.fromEntries([...scores].map(([scorer, values]) => [scorer, values.reduce((a, b) => a + b, 0) / values.length])),
      ];
    }),
  );
  try {
    return prepareExperimentReportRecord({
      id: report.experimentId,
      ...ownership,
      datasetId: report.datasetId,
      datasetVersion: report.datasetVersion,
      datasetContentHash: report.datasetContentHash,
      manifest: report.manifest,
      aggregate: report.aggregate,
      itemMeans,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_PRISM_EVAL_REPORT_BOUNDS") {
      throw new EvalError("Experiment summary exceeds 1 MiB", "ERR_PRISM_EVAL_REPORT_BOUNDS");
    }
    throw error;
  }
}
