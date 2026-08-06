/** Allow-list egress policy: deny-all default, exact host/port/protocol rules, frozen presets. */

import { createHash } from "node:crypto";
import { EgressError } from "./types.js";
import { DEFAULT_MAX_EGRESS_RULES, HARD_MAX_EGRESS_RULES } from "./limits.js";

export type EgressProtocol = "http" | "https";

export interface EgressRule {
  readonly host: string;
  readonly port: number;
  readonly protocol: EgressProtocol;
  /** Allow private/link-local/metadata addresses for this rule (default false). */
  readonly allowPrivate?: boolean;
}

export type EgressPreset = "npm-registry" | "github";

export interface EgressPolicy {
  readonly rules: readonly EgressRule[];
  readonly fingerprint: string;
  allows(host: string, port: number, protocol: EgressProtocol): boolean;
  /** Exact rule match (undefined when denied). */
  match(host: string, port: number, protocol: EgressProtocol): EgressRule | undefined;
}

/** Frozen preset expansions — explicit rule lists, no wildcards. */
export const EGRESS_PRESETS: Record<EgressPreset, readonly EgressRule[]> = {
  "npm-registry": [{ host: "registry.npmjs.org", port: 443, protocol: "https" }],
  github: [
    { host: "api.github.com", port: 443, protocol: "https" },
    { host: "github.com", port: 443, protocol: "https" },
    { host: "codeload.github.com", port: 443, protocol: "https" },
    { host: "objects.githubusercontent.com", port: 443, protocol: "https" },
    { host: "raw.githubusercontent.com", port: 443, protocol: "https" },
    { host: "uploads.github.com", port: 443, protocol: "https" },
  ],
};

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:]+$/;

function validateHost(host: string): string {
  if (typeof host !== "string" || host.length === 0 || host.length > 253) {
    throw new EgressError("ERR_PRISM_EGRESS_POLICY", "egress rule host must be a non-empty string at most 253 chars");
  }
  if (host.includes("*") || host.includes(" ") || host.includes("\t") || host.includes("/")) {
    throw new EgressError("ERR_PRISM_EGRESS_POLICY", `egress rule host must not contain wildcards or whitespace: ${host}`);
  }
  const lower = host.toLowerCase();
  if (!HOSTNAME_RE.test(lower) && !IPV4_RE.test(lower) && !IPV6_RE.test(lower)) {
    throw new EgressError("ERR_PRISM_EGRESS_POLICY", `egress rule host is not a valid hostname or IP literal: ${host}`);
  }
  return lower;
}

function validatePort(port: number): number {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new EgressError("ERR_PRISM_EGRESS_POLICY", `egress rule port must be an integer in 1..65535: ${port}`);
  }
  return port;
}

function validateRule(rule: EgressRule): EgressRule {
  if (!rule || typeof rule !== "object") {
    throw new EgressError("ERR_PRISM_EGRESS_POLICY", "egress rule must be an object");
  }
  if (rule.protocol !== "http" && rule.protocol !== "https") {
    throw new EgressError("ERR_PRISM_EGRESS_POLICY", `egress rule protocol must be http or https: ${String(rule.protocol)}`);
  }
  if (rule.allowPrivate !== undefined && typeof rule.allowPrivate !== "boolean") {
    throw new EgressError("ERR_PRISM_EGRESS_POLICY", "egress rule allowPrivate must be a boolean when present");
  }
  return {
    host: validateHost(rule.host),
    port: validatePort(rule.port),
    protocol: rule.protocol,
    ...(rule.allowPrivate ? { allowPrivate: true } : {}),
  };
}

function fingerprint(rules: readonly EgressRule[]): string {
  const canonical = rules
    .map((r) => `${r.protocol}|${r.host}|${r.port}|${r.allowPrivate === true ? 1 : 0}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export interface CreateEgressPolicyOptions {
  readonly allow?: readonly EgressRule[];
  readonly presets?: readonly EgressPreset[];
  /** Rule-count cap (default 128, hard 1024). */
  readonly maxRules?: number;
}

export function createEgressPolicy(options: CreateEgressPolicyOptions = {}): EgressPolicy {
  const maxRules = options.maxRules ?? DEFAULT_MAX_EGRESS_RULES;
  if (!Number.isSafeInteger(maxRules) || maxRules < 1 || maxRules > HARD_MAX_EGRESS_RULES) {
    throw new EgressError("ERR_PRISM_EGRESS_POLICY", `maxRules must be a positive safe integer at most ${HARD_MAX_EGRESS_RULES}`);
  }
  const seen = new Set<string>();
  const rules: EgressRule[] = [];
  const push = (rule: EgressRule): void => {
    const key = `${rule.protocol}|${rule.host}|${rule.port}|${rule.allowPrivate === true ? 1 : 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    rules.push(rule);
  };
  for (const preset of options.presets ?? []) {
    if (preset !== "npm-registry" && preset !== "github") {
      throw new EgressError("ERR_PRISM_EGRESS_POLICY", `unknown egress preset: ${String(preset)}`);
    }
    for (const rule of EGRESS_PRESETS[preset]) push(rule);
  }
  for (const rule of options.allow ?? []) push(validateRule(rule));
  if (rules.length > maxRules) {
    throw new EgressError("ERR_PRISM_EGRESS_POLICY", `egress policy exceeds maxRules (${maxRules})`);
  }
  const frozen = Object.freeze(rules);
  const policy: EgressPolicy = {
    rules: frozen,
    fingerprint: fingerprint(frozen),
    allows(host, port, protocol) {
      return policy.match(host, port, protocol) !== undefined;
    },
    match(host, port, protocol) {
      const h = host.toLowerCase();
      for (const rule of frozen) {
        if (rule.host === h && rule.port === port && rule.protocol === protocol) return rule;
      }
      return undefined;
    },
  };
  return policy;
}
