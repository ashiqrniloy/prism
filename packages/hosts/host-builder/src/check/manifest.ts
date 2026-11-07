import type { CheckSettings } from "./inspect.js";
import { type CheckOutcome, runCheck } from "./runner.js";

export interface ManifestReport {
  readonly ok: boolean;
  readonly packages: readonly {
    readonly name: string;
    readonly scope: string;
    readonly enabled: boolean;
    readonly ok: boolean;
    readonly issues: readonly { readonly code: string; readonly message: string }[];
    /** `false` when the entry's code was not imported (disabled, or a project entry the host did not trust). */
    readonly configChecked: boolean;
  }[];
}

/**
 * What `prism verify` does: re-hash every install and re-check config against the package's schema. A project
 * package is imported only with `trustProject`; without it that entry gets the integrity check alone.
 */
export function checkManifest(settings: CheckSettings, trustProject: boolean): Promise<CheckOutcome<ManifestReport>> {
  return runCheck<ManifestReport>({ ...settings, kind: "manifest", trustProject });
}
