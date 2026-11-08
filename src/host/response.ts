/**
 * The kernel's own forward-compatibility rule for `HostUi` answers (docs/compatibility.md): a response
 * whose `status` is not one this kernel knows, or an `answered` value of the wrong shape for its kind,
 * is read as `unavailable`. Callers then take their fail-closed path. Internal: not exported.
 */
import type { HostUi, HostUiRequest, HostUiRequestKind, HostUiResponse } from "./types.js";

const UNAVAILABLE = { status: "unavailable" } as const;

function answerFits(kind: HostUiRequestKind, value: unknown, request: HostUiRequest): boolean {
  switch (kind) {
    case "confirm":
      return typeof value === "boolean";
    case "input":
      return typeof value === "string";
    case "select":
      return request.kind === "select" && request.multiple === true
        ? Array.isArray(value) && value.every((item) => typeof item === "string")
        : typeof value === "string";
    case "secret":
      return value === undefined || typeof value === "string";
    case "terminal":
      return value !== null && typeof value === "object" && Number.isInteger((value as { exitCode?: unknown }).exitCode);
    case "open-url":
    case "notify":
      return true;
    default:
      return false;
  }
}

/** Map any host answer onto a `HostUiResponse` this kernel understands; everything else is `unavailable`. */
export function validateHostUiResponse<K extends HostUiRequestKind>(
  request: Extract<HostUiRequest, { kind: K }>,
  response: unknown,
): HostUiResponse<K> {
  if (response === null || typeof response !== "object") return UNAVAILABLE;
  const status = (response as { status?: unknown }).status;
  if (status === "dismissed") return { status: "dismissed" };
  if (status !== "answered") return UNAVAILABLE;
  const value = (response as { value?: unknown }).value;
  const kind = (request as HostUiRequest).kind;
  if (!answerFits(kind, value, request)) return UNAVAILABLE;
  if (kind === "open-url" || kind === "notify") return { status: "answered", value: undefined } as HostUiResponse<K>;
  return { status: "answered", value } as HostUiResponse<K>;
}

/** Ask the host and validate its answer. A missing UI answers `unavailable`. */
export async function requestHostUi<K extends HostUiRequestKind>(
  ui: HostUi | undefined,
  request: Extract<HostUiRequest, { kind: K }>,
): Promise<HostUiResponse<K>> {
  if (!ui) return UNAVAILABLE;
  return validateHostUiResponse(request, await ui.request(request));
}
