import type { CheckSettings } from "./inspect.js";
import { type CheckOutcome, runCheck } from "./runner.js";
import type { CheckTarget } from "./targets.js";

export interface ConformanceReport {
  readonly ok: boolean;
  readonly checks: readonly { readonly name: string; readonly ok: boolean; readonly message?: string }[];
}

/** Runs `packageConformance` from the host's installed `@arnilo/prism/testing` on the configured package. */
export function checkPackage(settings: CheckSettings, target: CheckTarget): Promise<CheckOutcome<ConformanceReport>> {
  return runCheck<ConformanceReport>({ ...settings, kind: "conformance", file: target.file, exportName: target.exportName });
}
