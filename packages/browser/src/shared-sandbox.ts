/**
 * Helpers for aligning browser policy with a Task 1 disposable sandbox workspace.
 * No Playwright dependency — mounts and network attestation only.
 */
import type { BrowserDownloadOptions } from "./downloads.js";
import type { BrowserNetworkPolicy } from "./network.js";
import type { BrowserUploadOptions } from "./uploads.js";

export interface SharedSandboxBrowserAlignment {
  /** Host workspace root mirrored as sandbox `/workspace`. */
  readonly workspaceRoot: string;
  /** Host quarantine directory mirrored as sandbox `/downloads`. */
  readonly downloadsRoot: string;
  /**
   * Required for real external browsing. Playwright routing remains defense in depth;
   * the host proxy/firewall owns DNS and private egress.
   */
  readonly containedProxyAttestation?: BrowserNetworkPolicy["containedProxyAttestation"];
  readonly approveDownloadRelease?: BrowserDownloadOptions["approveRelease"];
  readonly allowLoopback?: boolean;
  readonly allowPrivateHosts?: boolean;
}

export interface SharedSandboxBrowserOptions {
  readonly networkPolicy: BrowserNetworkPolicy;
  readonly uploads: BrowserUploadOptions;
  readonly downloads: BrowserDownloadOptions;
}

/**
 * Build browser manager/tool options that share the disposable sandbox workspace
 * and download quarantine mounts. Callers still supply the Playwright Browser and
 * must close the browser context before disposing the sandbox.
 */
export function createSharedSandboxBrowserOptions(
  input: SharedSandboxBrowserAlignment,
): SharedSandboxBrowserOptions {
  if (!input.workspaceRoot || !input.downloadsRoot) {
    throw new Error("workspaceRoot and downloadsRoot are required");
  }
  const networkPolicy: BrowserNetworkPolicy = {
    requireContainedProxy: true,
    allowLoopback: input.allowLoopback ?? false,
    allowPrivateHosts: input.allowPrivateHosts ?? false,
    ...(input.containedProxyAttestation
      ? { containedProxyAttestation: input.containedProxyAttestation }
      : {}),
  };
  return {
    networkPolicy,
    uploads: { roots: [input.workspaceRoot] },
    downloads: {
      quarantine: input.downloadsRoot,
      ...(input.approveDownloadRelease ? { approveRelease: input.approveDownloadRelease } : {}),
    },
  };
}
