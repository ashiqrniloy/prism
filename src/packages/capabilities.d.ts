/**
 * What a package may ask the SDK for (roadmap §2.6). Declared capabilities are enforced on the
 * SDK-mediated `PackageAPI` members; they document intent and gate access, and are not a process
 * sandbox.
 */
export type Capability = "models" | "host-ui" | "session-state" | "background" | "credentials" | "credentials:write" | "slot:loop" | "slot:compaction" | "slot:store" | "slot:credentials";
export declare const CAPABILITIES: ReadonlySet<string>;
export declare function isCapability(value: unknown): value is Capability;
/** Throws `capability_missing`, naming the package, the member, and the capability. */
export declare function requireCapability(owner: string, declared: ReadonlySet<Capability>, capability: Capability, member: string): void;
