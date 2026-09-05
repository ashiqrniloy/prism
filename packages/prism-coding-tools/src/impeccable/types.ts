import type { ResolveUpstreamRootOptions } from "./upstream.js";

export interface ImpeccableExtensionOptions extends ResolveUpstreamRootOptions {
  /**
   * Optional pin (sha256 hex of the resolved SKILL.md bytes) for the vendored
   * snapshot; when set, setup fails closed on drift. Record it when vendoring
   * an upstream checkout so fixes arrive as a deliberate pin bump.
   */
  readonly expectedSnapshotDigest?: string;
}
