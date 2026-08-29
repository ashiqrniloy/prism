/** routing (0.2.5 plan 025 Task 1 split). Moved verbatim from handler.ts; public surface unchanged behind the barrel. */
import { trimTrailingSlashes } from "@arnilo/prism";
import { PrismServerError } from "../types.js";
import { validId } from "./readers.js";

type Route =
  | { readonly kind: "agent-run" | "agent-stream"; readonly operation: "agent.run" | "agent.stream"; readonly capabilityId: string }
  | { readonly kind: "agent-status"; readonly operation: "agent.status"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "agent-resume"; readonly operation: "agent.resume"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "agent-events"; readonly operation: "agent.events"; readonly capabilityId: string; readonly runId: string }
  | {
      readonly kind: "workflow-run" | "workflow-stream" | "workflow-enqueue";
      readonly operation: "workflow.run" | "workflow.stream" | "workflow.enqueue";
      readonly capabilityId: string;
    }
  | { readonly kind: "workflow-status"; readonly operation: "workflow.status"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "workflow-cancel"; readonly operation: "workflow.cancel"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "workflow-resume"; readonly operation: "workflow.resume"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "workflow-replay"; readonly operation: "workflow.replay"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "schedule-list"; readonly operation: "schedule.list"; readonly capabilityId: "*" }
  | { readonly kind: "schedule-create"; readonly operation: "schedule.create"; readonly capabilityId: string }
  | { readonly kind: "schedule-pause"; readonly operation: "schedule.pause"; readonly capabilityId: string }
  | { readonly kind: "schedule-resume"; readonly operation: "schedule.resume"; readonly capabilityId: string }
  | { readonly kind: "schedule-trigger"; readonly operation: "schedule.trigger"; readonly capabilityId: string }
  | { readonly kind: "schedule-delete"; readonly operation: "schedule.delete"; readonly capabilityId: string };

export function parseRoute(request: Request, base: string): Route | undefined {
  const pathname = new URL(request.url).pathname;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return undefined;
  let parts: string[];
  try {
    parts = pathname.slice(base.length).split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new PrismServerError("Invalid route", 400, "ERR_PRISM_SERVER_ROUTE");
  }
  const [group, id, segment, runId, action] = parts;
  if (group === "schedules" && parts.length === 1 && request.method === "GET") {
    return { kind: "schedule-list", operation: "schedule.list", capabilityId: "*" };
  }
  if (!id || !validId(id)) return undefined;
  if (group === "schedules") {
    if (parts.length === 2 && request.method === "POST") return { kind: "schedule-create", operation: "schedule.create", capabilityId: id };
    if (parts.length === 2 && request.method === "DELETE")
      return { kind: "schedule-delete", operation: "schedule.delete", capabilityId: id };
    if (parts.length === 3 && segment === "pause" && request.method === "POST")
      return { kind: "schedule-pause", operation: "schedule.pause", capabilityId: id };
    if (parts.length === 3 && segment === "resume" && request.method === "POST")
      return { kind: "schedule-resume", operation: "schedule.resume", capabilityId: id };
    if (parts.length === 3 && segment === "trigger" && request.method === "POST")
      return { kind: "schedule-trigger", operation: "schedule.trigger", capabilityId: id };
    return undefined;
  }
  if (group === "agents" && segment === "runs" && parts.length === 3 && request.method === "POST") {
    return { kind: "agent-run", operation: "agent.run", capabilityId: id };
  }
  if (group === "agents" && segment === "stream" && parts.length === 3 && request.method === "POST") {
    return { kind: "agent-stream", operation: "agent.stream", capabilityId: id };
  }
  if (group === "agents" && segment === "runs" && runId && validId(runId)) {
    if (parts.length === 4 && request.method === "GET") return { kind: "agent-status", operation: "agent.status", capabilityId: id, runId };
    if (parts.length === 5 && action === "resume" && request.method === "POST")
      return { kind: "agent-resume", operation: "agent.resume", capabilityId: id, runId };
    if (parts.length === 5 && action === "events" && request.method === "GET")
      return { kind: "agent-events", operation: "agent.events", capabilityId: id, runId };
  }
  if (group !== "workflows") return undefined;
  if (segment === "runs" && parts.length === 3 && request.method === "POST") {
    return { kind: "workflow-run", operation: "workflow.run", capabilityId: id };
  }
  if (segment === "stream" && parts.length === 3 && request.method === "POST") {
    return { kind: "workflow-stream", operation: "workflow.stream", capabilityId: id };
  }
  if (segment === "enqueue" && parts.length === 3 && request.method === "POST") {
    return { kind: "workflow-enqueue", operation: "workflow.enqueue", capabilityId: id };
  }
  if (segment !== "runs" || !runId || !validId(runId)) return undefined;
  if (parts.length === 4 && request.method === "GET") {
    return { kind: "workflow-status", operation: "workflow.status", capabilityId: id, runId };
  }
  if (parts.length === 4 && request.method === "DELETE") {
    return { kind: "workflow-cancel", operation: "workflow.cancel", capabilityId: id, runId };
  }
  if (parts.length === 5 && action === "resume" && request.method === "POST") {
    return { kind: "workflow-resume", operation: "workflow.resume", capabilityId: id, runId };
  }
  if (parts.length === 5 && action === "replay" && request.method === "POST") {
    return { kind: "workflow-replay", operation: "workflow.replay", capabilityId: id, runId };
  }
  return undefined;
}

export function normalizeBasePath(value: string): string {
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) throw new RangeError("basePath must be an absolute URL path");
  const normalized = value.length > 1 ? trimTrailingSlashes(value) : value;
  if (normalized === "/") throw new RangeError("basePath cannot expose the URL root");
  return normalized;
}
