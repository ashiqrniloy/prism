/**
 * A scripted `HostUi` for package tests (`@arnilo/prism/testing`). Answers, dismisses, or reports
 * `unavailable` per kind and records every request it saw, so a test asserts both the answer a
 * package got and the untrusted text it handed the host.
 */
import type { HostUi, HostUiAnswerMap, HostUiRequest, HostUiRequestKind, HostUiResponse } from "../host/types.js";

/** What the scripted UI answers for one request: a value, `dismissed`, or `unavailable` (the default). */
export type ScriptedAnswer<K extends HostUiRequestKind = HostUiRequestKind> = HostUiResponse<K> | HostUiAnswerMap[K];

export interface ScriptedHostUi {
  /** A real `HostUi` to hand the agent. Records every request in `requests`. */
  readonly ui: HostUi;
  /** Every request that reached the host, in order, with the kernel-stamped `package`/`sessionId`. */
  readonly requests: readonly HostUiRequest[];
  /** Requests of one kind, for a narrower assertion. */
  requestsOf<K extends HostUiRequestKind>(kind: K): readonly Extract<HostUiRequest, { kind: K }>[];
}

/**
 * @param script An answer per request kind, or a function of the request. Anything not named
 *   answers `unavailable`, which is what a host without the surface does — the fail-closed default.
 */
export function createScriptedHostUi(
  script: Partial<Record<HostUiRequestKind, ScriptedAnswer>> | ((request: HostUiRequest) => ScriptedAnswer) = {},
): ScriptedHostUi {
  const requests: HostUiRequest[] = [];
  const answerFor = (request: HostUiRequest): ScriptedAnswer => (typeof script === "function" ? script(request) : script[request.kind]);
  return {
    requests,
    requestsOf: <K extends HostUiRequestKind>(kind: K) =>
      requests.filter((request): request is Extract<HostUiRequest, { kind: K }> => request.kind === kind),
    ui: {
      async request<K extends HostUiRequestKind>(request: Extract<HostUiRequest, { kind: K }>): Promise<HostUiResponse<K>> {
        requests.push(request);
        const answer = answerFor(request);
        if (answer === undefined) return { status: "unavailable" };
        if (typeof answer === "object" && answer !== null && "status" in answer) return answer as HostUiResponse<K>;
        return { status: "answered", value: answer } as HostUiResponse<K>;
      },
    },
  };
}
