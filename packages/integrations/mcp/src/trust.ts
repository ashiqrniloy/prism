import { createHash } from "node:crypto";
import type { PackageAPI } from "@arnilo/prism";
import type { McpPackageConfig, McpServerConfig } from "./config.js";

const MAX_URL_LENGTH = 2048;
const AMBIGUOUS_PATH_PATTERN = /\/\.\.(?:\/|$)|(?:\/|^)\.\.(?:\/|$)/;

export interface AllowDestinationUrl {
  readonly kind: "url";
  readonly origin: string;
  readonly path: string;
}

export interface AllowDestinationStdio {
  readonly kind: "stdio";
}

export interface AllowDestinationRaw {
  readonly kind: "raw";
}

export type AllowDestination = AllowDestinationUrl | AllowDestinationStdio | AllowDestinationRaw;

export function parseAllowDestination(entry: string): AllowDestination | null {
  if (entry === "stdio" || entry.startsWith("stdio:")) {
    return { kind: "stdio" };
  }
  if (entry === "raw" || entry.startsWith("raw:") || entry === "*") {
    return { kind: "raw" };
  }
  if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_URL_LENGTH) {
    return null;
  }
  const urlWithoutQuery = entry.split(/[?#]/, 1)[0] ?? entry;
  if (AMBIGUOUS_PATH_PATTERN.test(urlWithoutQuery)) {
    return null;
  }
  try {
    const url = new URL(entry);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) {
      return null;
    }
    let path = url.pathname;
    if (path.endsWith("/") && path.length > 1) {
      path = path.slice(0, -1);
    }
    return { kind: "url", origin: url.origin, path };
  } catch {
    return null;
  }
}

export function mcpServerFingerprint(server: McpServerConfig): string {
  const parts =
    server.transport === "stdio"
      ? ["stdio", server.command ?? "", ...(server.args ?? []), server.cwd ?? "", ...Object.keys(server.env ?? {}).sort()]
      : server.transport === "raw"
        ? ["raw", server.id]
        : ["url", server.url ?? ""];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function isServerAllowed(
  server: McpServerConfig,
  planeAllow?: string | readonly string[],
): { readonly allowed: boolean; readonly reason?: string } {
  const serverAllowEntries = Array.isArray(server.allow) ? server.allow : server.allow ? [server.allow] : [];
  const planeAllowEntries = Array.isArray(planeAllow) ? planeAllow : planeAllow ? [planeAllow] : [];

  if (server.transport === "stdio") {
    const allowedByServer =
      serverAllowEntries.length === 0 || serverAllowEntries.some((entry) => entry === "stdio" || entry.startsWith("stdio:"));
    const allowedByPlane =
      planeAllowEntries.length === 0 || planeAllowEntries.some((entry) => entry === "stdio" || entry.startsWith("stdio:"));

    if (!allowedByServer || !allowedByPlane) {
      return { allowed: false, reason: "stdio transport is outside allow specification" };
    }
    return { allowed: true };
  }

  if (server.transport === "raw") {
    const allowedByServer =
      serverAllowEntries.length === 0 || serverAllowEntries.some((entry) => entry === "raw" || entry.startsWith("raw:") || entry === "*");
    const allowedByPlane =
      planeAllowEntries.length === 0 || planeAllowEntries.some((entry) => entry === "raw" || entry.startsWith("raw:") || entry === "*");

    if (!allowedByServer || !allowedByPlane) {
      return { allowed: false, reason: "raw transport is outside allow specification" };
    }
    return { allowed: true };
  }

  // URL-based
  const urlStr = server.url;
  let candidateUrl: URL;
  try {
    candidateUrl = new URL(urlStr);
  } catch {
    return { allowed: false, reason: `invalid server URL "${urlStr}"` };
  }

  const matchesEntries = (entries: readonly string[]): boolean => {
    if (entries.length === 0) return true;
    return entries.some((entry) => {
      const dest = parseAllowDestination(entry);
      if (dest?.kind !== "url" || !dest.origin) return false;
      if (candidateUrl.origin !== dest.origin) return false;
      const pathname = candidateUrl.pathname;
      return dest.path === "/" || dest.path === "" || pathname === dest.path || pathname.startsWith(`${dest.path}/`);
    });
  };

  if (!matchesEntries(serverAllowEntries)) {
    return { allowed: false, reason: `server URL "${urlStr}" is outside server allow specification` };
  }
  if (!matchesEntries(planeAllowEntries)) {
    return { allowed: false, reason: `server URL "${urlStr}" is outside plane allow specification` };
  }

  return { allowed: true };
}

export async function checkServerTrust(
  server: McpServerConfig,
  prism: PackageAPI<McpPackageConfig>,
  trustedFingerprints: ReadonlySet<string>,
  knownTrustedServers: Set<string>,
): Promise<boolean> {
  if (knownTrustedServers.has(server.id)) {
    return true;
  }

  // Check config source provenance
  const serversSource = prism.configSources.servers;
  const isFromProject = serversSource === "project";

  if (!isFromProject) {
    knownTrustedServers.add(server.id);
    return true;
  }

  const fingerprint = mcpServerFingerprint(server);
  if (trustedFingerprints.has(fingerprint)) {
    knownTrustedServers.add(server.id);
    return true;
  }

  // Not in trusted list; prompt through host.ui
  if (!prism.host.ui) {
    return false;
  }

  try {
    const detail =
      server.transport === "stdio"
        ? `Command: ${server.command} ${(server.args ?? []).join(" ")}`
        : server.transport === "raw"
          ? `Raw transport for server "${server.id}"`
          : `URL: ${server.url}`;

    const response = await prism.host.ui.request({
      kind: "confirm",
      title: `Allow MCP server "${server.id}"?`,
      detail,
    });

    if (response.status === "answered" && response.value === true) {
      knownTrustedServers.add(server.id);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
