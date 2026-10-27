import { PackageLoadError } from "./errors.js";

/**
 * What a package may ask the SDK for (roadmap §2.6). Declared capabilities are enforced on the
 * SDK-mediated `PackageAPI` members; they document intent and gate access, and are not a process
 * sandbox.
 */
export type Capability =
  | "models"
  | "host-ui"
  | "session-state"
  | "background"
  | "credentials"
  | "credentials:write"
  | "slot:loop"
  | "slot:compaction"
  | "slot:store"
  | "slot:credentials";

export const CAPABILITIES: ReadonlySet<string> = new Set<Capability>([
  "models",
  "host-ui",
  "session-state",
  "background",
  "credentials",
  "credentials:write",
  "slot:loop",
  "slot:compaction",
  "slot:store",
  "slot:credentials",
]);

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && CAPABILITIES.has(value);
}

/** Throws `capability_missing`, naming the package, the member, and the capability. */
export function requireCapability(owner: string, declared: ReadonlySet<Capability>, capability: Capability, member: string): void {
  if (declared.has(capability)) return;
  throw new PackageLoadError("capability_missing", `Package ${owner} called ${member} without declaring the "${capability}" capability.`, {
    package: owner,
  });
}
