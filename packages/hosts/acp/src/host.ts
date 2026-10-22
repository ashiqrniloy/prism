import type { HostPort, HostUi, HostUiRequest, HostUiResponse } from "@arnilo/prism";
import { boundAcpSession, brandAcpHost } from "./session-map.js";

/**
 * Host port whose `ui` routes by the kernel-stamped `sessionId`.
 * A kernel ask (`package` absent) and `secret` answer `unavailable`, so approvals
 * suspend onto `session/request_permission` instead of a boolean confirm.
 */
export function acpHost(): HostPort {
  const port: HostPort = {
    ui: {
      request: (async (request: HostUiRequest): Promise<HostUiResponse> => {
        if (request.package === undefined || request.kind === "secret" || request.kind === "terminal") return { status: "unavailable" };
        const bound = boundAcpSession(port, request.sessionId);
        if (!bound) return { status: "unavailable" };
        if (request.kind === "notify") {
          await bound.notify(request.message);
          return { status: "answered", value: undefined };
        }
        if (request.kind === "open-url") {
          await bound.notify(request.url);
          return { status: "answered", value: undefined };
        }
        if (!bound.elicitation) return { status: "unavailable" };
        return bound.elicit({
          kind: request.kind,
          title: request.title,
          detail: "detail" in request ? request.detail : undefined,
          ...(request.kind === "select" ? { options: request.options } : {}),
        });
      }) as HostUi["request"],
    },
  };
  brandAcpHost(port);
  return port;
}
