import type { HostPort, HostUi, HostUiRequest, HostUiResponse } from "@arnilo/prism";
import { boundMcpSession, brandMcpHost } from "./session-map.js";

/**
 * Host port whose `ui` routes by the kernel-stamped `sessionId`.
 * A kernel ask (`package` absent) and `secret` answer `unavailable`, so approvals
 * suspend onto the tool result's `input_required` instead of a boolean confirm.
 * Package `confirm`/`select`/`input` reach the client only through the 2025-era
 * elicitation channel bound while a run is in flight; everything else, including
 * 2026-era mid-run package UI, answers `unavailable`.
 */
export function mcpHost(): HostPort {
  const port: HostPort = {
    ui: {
      request: (async (request: HostUiRequest): Promise<HostUiResponse> => {
        if (request.package === undefined || request.kind === "secret") return { status: "unavailable" };
        if (request.kind !== "confirm" && request.kind !== "select" && request.kind !== "input") return { status: "unavailable" };
        const bound = boundMcpSession(port, request.sessionId);
        if (!bound?.elicitation) return { status: "unavailable" };
        return bound.elicit({
          kind: request.kind,
          title: request.title,
          detail: "detail" in request ? request.detail : undefined,
          ...(request.kind === "select" ? { options: request.options } : {}),
        });
      }) as HostUi["request"],
    },
  };
  brandMcpHost(port);
  return port;
}
