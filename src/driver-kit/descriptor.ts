import type { ToolCapabilityKind } from "../contracts.js";
import { DriverError } from "./errors.js";

/** One way a profile can authenticate. Policy is data: the guard (Task 4) enforces it, the kit never hardcodes a vendor. */
export interface AuthMode {
  readonly name: string;
  readonly kind: "account" | "api-key";
  readonly deployments: readonly ("local" | "hosted")[];
  /** Terms a host must acknowledge before this mode runs `hosted`. */
  readonly hostedAcknowledgements?: readonly string[];
  /** Credential locations the kit must never open (relative to the profile home, or `~`-anchored) or accept as a ref. */
  readonly protected: { readonly paths: readonly string[]; readonly env: readonly string[] };
  /** The vendor's own sign-in command, run through a `terminal` request. */
  readonly login?: readonly string[];
  /** The vendor's status command. The driver's `parseStatus` reads its result. */
  readonly status?: readonly string[];
  /** The environment variable that relocates the vendor's home to the profile. */
  readonly homeEnv?: string;
}

/** What the vendor binary can enforce and capture (roadmap §2.12.10). Hosts check it with {@link DriverRequires}. */
export interface DriverDescriptor {
  readonly vendor: string;
  readonly usesModel: false;
  readonly models: "passthrough" | "none";
  readonly controls: {
    readonly systemPrompt: readonly ("replace" | "append")[];
    readonly builtinTools: "per-tool" | "partial" | "none";
    readonly clientTools: "mcp" | "native" | "experimental" | "none";
    readonly skills: boolean;
    readonly subagents: boolean;
    readonly permissionCallback: boolean;
    readonly rewrite: boolean;
    readonly continueOnStop: boolean;
    readonly steer: "mid-turn" | "next-turn" | "none";
    readonly resume: "store" | "vendor" | "none";
    readonly isolation: "flags" | "workspace-files" | "none";
  };
  readonly capture: {
    readonly textDeltas: boolean;
    readonly thinking: "deltas" | "final" | "summary" | "tokens-only" | "none";
    readonly skillActivation: "native" | "tool" | "explicit-or-path" | "none";
    readonly toolCalls: boolean;
    readonly fileDiffs: boolean;
    readonly subagents: "full" | "summary" | "none";
    readonly usage: "tokens+cost" | "tokens" | "none";
  };
  readonly auth: { readonly modes: readonly AuthMode[] };
}

/** What a host needs from the driver. A miss fails `createAgent` with `driver_capability_missing`. */
export interface DriverRequires {
  readonly systemPrompt?: "replace" | "append";
  readonly builtinTools?: "per-tool" | "partial";
  /** Tool effects the host must be able to gate: needs `permissionCallback`. */
  readonly gated?: readonly ToolCapabilityKind[];
  readonly steer?: "mid-turn" | "next-turn";
  readonly resume?: "store" | "vendor";
  /** The least thinking capture acceptable. */
  readonly thinking?: "deltas" | "final" | "summary" | "tokens-only";
  readonly skillActivation?: true;
  readonly subagents?: true;
  /** Some auth mode signs in with a vendor account. */
  readonly accountSignIn?: true;
}

const THINKING_RANK = ["none", "tokens-only", "summary", "final", "deltas"] as const;
const BUILTIN_RANK = ["none", "partial", "per-tool"] as const;

const validators = {
  systemPrompt: (d: DriverDescriptor, want: "replace" | "append") => d.controls.systemPrompt.includes(want),
  builtinTools: (d: DriverDescriptor, want: "per-tool" | "partial") =>
    BUILTIN_RANK.indexOf(d.controls.builtinTools) >= BUILTIN_RANK.indexOf(want),
  gated: (d: DriverDescriptor, want: readonly ToolCapabilityKind[]) => want.length === 0 || d.controls.permissionCallback,
  steer: (d: DriverDescriptor, want: "mid-turn" | "next-turn") =>
    d.controls.steer === "mid-turn" || (want === "next-turn" && d.controls.steer === "next-turn"),
  resume: (d: DriverDescriptor, want: "store" | "vendor") =>
    d.controls.resume === "store" || (want === "vendor" && d.controls.resume === "vendor"),
  thinking: (d: DriverDescriptor, want: NonNullable<DriverRequires["thinking"]>) =>
    THINKING_RANK.indexOf(d.capture.thinking) >= THINKING_RANK.indexOf(want),
  skillActivation: (d: DriverDescriptor) => d.controls.skills && d.capture.skillActivation !== "none",
  subagents: (d: DriverDescriptor) => d.controls.subagents,
  accountSignIn: (d: DriverDescriptor) => d.auth.modes.some((mode) => mode.kind === "account"),
} as const;

/** Throws `driver_capability_missing` naming the first control the descriptor cannot provide. */
export function assertDriverRequires(descriptor: DriverDescriptor, requires: DriverRequires | undefined): void {
  if (requires === undefined) return;
  for (const key of Object.keys(validators) as (keyof typeof validators)[]) {
    const want = requires[key];
    if (want === undefined) continue;
    const ok = (validators[key] as (d: DriverDescriptor, w: never) => boolean)(descriptor, want as never);
    if (!ok) {
      throw new DriverError("driver_capability_missing", `driver "${descriptor.vendor}" cannot provide requires.${key}`, key);
    }
  }
}

/** Fails closed on a malformed descriptor. Auth-mode shape rules are checked here; the policy guard enforces them per run. */
export function assertDriverDescriptor(descriptor: DriverDescriptor): void {
  const bad = (message: string): never => {
    throw new DriverError("driver_definition_invalid", message);
  };
  if (typeof descriptor.vendor !== "string" || descriptor.vendor === "") bad("descriptor.vendor must be a non-empty string");
  if ((descriptor.usesModel as unknown) !== false) bad("descriptor.usesModel must be false");
  if (descriptor.models !== "passthrough" && descriptor.models !== "none") bad('descriptor.models must be "passthrough" or "none"');
  if (!Array.isArray(descriptor.auth?.modes)) bad("descriptor.auth.modes must be a list");
  const names = new Set<string>();
  for (const mode of descriptor.auth.modes) {
    if (typeof mode.name !== "string" || mode.name === "" || names.has(mode.name)) bad("auth mode names must be unique non-empty strings");
    names.add(mode.name);
    if (mode.kind !== "account" && mode.kind !== "api-key") bad(`auth mode "${mode.name}" has an unknown kind`);
    if (!Array.isArray(mode.deployments) || mode.deployments.some((d) => d !== "local" && d !== "hosted")) {
      bad(`auth mode "${mode.name}" deployments must list "local" and/or "hosted"`);
    }
    if (!Array.isArray(mode.protected?.paths) || !Array.isArray(mode.protected?.env))
      bad(`auth mode "${mode.name}" must declare protected.paths and protected.env`);
    if (mode.kind === "account" && mode.protected.paths.length === 0 && mode.protected.env.length === 0) {
      bad(`account auth mode "${mode.name}" must declare protected paths or env`);
    }
    if (mode.deployments.includes("hosted") && mode.kind === "account" && (mode.hostedAcknowledgements ?? []).length === 0) {
      bad(`account auth mode "${mode.name}" allows hosted use and must list hostedAcknowledgements`);
    }
  }
}
