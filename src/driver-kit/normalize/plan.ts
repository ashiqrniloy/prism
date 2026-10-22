import type { ExternalActivity } from "../../loop/index.js";

type PlanActivity = Extract<ExternalActivity, { kind: "plan" }>;

/** Builds a `plan` activity from `{ title, status }`-like entries; a blank title is dropped, a missing status is `pending`. */
export function mapPlan(entries: readonly { readonly title?: string; readonly status?: string }[]): PlanActivity {
  return {
    kind: "plan",
    entries: entries.filter((entry) => entry.title && entry.title.trim() !== "").map((entry) => ({ title: entry.title as string, status: entry.status ?? "pending" })),
  };
}
