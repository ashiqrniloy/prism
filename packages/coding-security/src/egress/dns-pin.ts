/** DNS pinning and rebinding defense: resolve once, connect to pinned answers, verify the socket. */

import { lookup } from "node:dns/promises";
import { EgressError } from "./types.js";

/** Normalize IPv6-mapped IPv4 (`::ffff:1.2.3.4` → `1.2.3.4`) for comparison. */
export function normalizeAddress(address: string): string {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return lower.slice("::ffff:".length);
  return lower;
}

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

/** Private, loopback, link-local, metadata, multicast, and reserved ranges. */
export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeAddress(address);
  if (normalized.includes(":")) {
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 ULA
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb"))
      return true; // fe80::/10
    if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice("::ffff:".length));
    if (normalized.startsWith("2001:db8:")) return true; // documentation
    if (normalized.startsWith("ff")) return true; // multicast
    return false;
  }
  const value = ipv4ToInt(normalized);
  if (value === undefined) return true; // malformed → treat as non-routable
  if (value === 0) return true; // 0.0.0.0/8
  if (value >>> 24 === 10) return true; // 10/8
  if (value >>> 24 === 127) return true; // 127/8 loopback
  if (value >>> 16 === 0xa9fe) return true; // 169.254/16 link-local + metadata
  if (value >>> 20 === 0xac1) return true; // 172.16/12
  if (value >>> 16 === 0xc0a8) return true; // 192.168/16
  if (value >>> 22 === 0x191) return true; // 100.64/10 CGNAT
  if (value >>> 24 === 192 && (value & 0xff) === 0) return true; // 192.0.0.0/24
  if (value >>> 24 === 192 && (value & 0xff) === 2) return true; // 192.0.2.0/24 TEST-NET
  if (value >>> 16 === 0xc612) return true; // 198.18/15 benchmarking
  if (value >>> 24 === 198 && (value & 0xff) === 51) return true; // 198.51.100/24
  if (value >>> 24 === 203 && (value & 0xff) === 113) return true; // 203.0.113/24
  if (value >>> 28 === 0xe) return true; // 224/4 multicast
  if (value >>> 28 === 0xf) return true; // 240/4 reserved
  return false;
}

/** 169.254.169.254 and IPv6 link-local metadata endpoints. */
export function isMetadataAddress(address: string): boolean {
  const normalized = normalizeAddress(address);
  if (normalized === "169.254.169.254") return true;
  if (normalized.startsWith("fe80:")) return true;
  return false;
}

export type AddressResolver = (host: string) => Promise<readonly string[]>;

/** Resolve a host to pinned addresses; IP literals resolve to themselves. */
export async function resolvePinned(host: string, resolve?: AddressResolver): Promise<readonly string[]> {
  if (resolve) return resolve(host);
  if (host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return [host];
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch {
    throw new EgressError("ERR_PRISM_EGRESS_DNS", `DNS resolution failed for ${host}`);
  }
}

/** Rebind defense: the connected socket must belong to the pinned answer set. */
export function assertPinned(host: string, remoteAddress: string | undefined, pinned: readonly string[]): void {
  if (!remoteAddress) {
    throw new EgressError("ERR_PRISM_EGRESS_DNS", `no remote address for ${host}`);
  }
  const normalized = normalizeAddress(remoteAddress);
  if (!pinned.some((ip) => normalizeAddress(ip) === normalized)) {
    throw new EgressError("ERR_PRISM_EGRESS_DNS", `connection address ${remoteAddress} is not a pinned answer for ${host}`);
  }
}
