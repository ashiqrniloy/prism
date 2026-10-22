import type { HostUiRequestKind } from "@arnilo/prism";
import { HeadlessError } from "./errors.js";
import { HOST_UI_KINDS } from "./limits.js";
import type { HostUiRoute } from "./route.js";

export type PolicyAnswers = Partial<{
  readonly [K in HostUiRequestKind]: "unavailable" | "dismiss" | (K extends "notify" ? "ack" : never);
}>;

/** A policy can decline or acknowledge a notification, but can never approve. */
export function policyDefault(answers: PolicyAnswers = {}): HostUiRoute {
  for (const [kind, action] of Object.entries(answers as Record<string, unknown>)) {
    if (kind === "confirm" && action === "allow") throw new HeadlessError("policy_allow_refused");
    if (
      !HOST_UI_KINDS.includes(kind as HostUiRequestKind) ||
      !(action === "unavailable" || action === "dismiss" || (kind === "notify" && action === "ack"))
    )
      throw new HeadlessError("invalid_policy");
  }
  const policy = { ...answers };
  return {
    name: "policy",
    ui: {
      async request(request) {
        switch (policy[request.kind]) {
          case "dismiss":
            return { status: "dismissed" };
          case "ack":
            return { status: "answered", value: undefined } as never;
          default:
            return { status: "unavailable" };
        }
      },
    },
  };
}
