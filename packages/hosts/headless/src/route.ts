import type { HostUi, HostUiRequest, HostUiRequestKind, HostUiResponse, OwnershipScope, PendingDecision, Session } from "@arnilo/prism";
import type { CheckpointStore } from "@arnilo/prism-extensions/workflows";
import { type AnswerQuery, createAnswerLog, type RoutedAnswer } from "./answers.js";
import type { ResumeAuthority } from "./authority.js";
import { HeadlessError } from "./errors.js";
import { answerLimit, HOST_UI_KINDS } from "./limits.js";
import { type ResumeWhenAnsweredOptions, type ResumeWhenAnsweredResult, resumeWhenAnswered } from "./resume.js";

export interface HostUiRoute {
  readonly name: string;
  readonly ui: HostUi;
  /** Absent: every kind except secret and terminal. */
  readonly kinds?: readonly HostUiRequestKind[];
  readonly timeoutMs?: number;
}

export interface RouteHostUiOptions {
  readonly resumeAuthority?: ResumeAuthority;
  readonly answerLog?: CheckpointStore;
  readonly ownership?: OwnershipScope;
  readonly limits?: { readonly maxAnswers?: number };
}

export interface RoutedHostUi extends HostUi {
  resumeWhenAnswered(
    session: Session,
    pending?: readonly PendingDecision[],
    options?: ResumeWhenAnsweredOptions,
  ): Promise<ResumeWhenAnsweredResult>;
  answers(query?: AnswerQuery): Promise<readonly RoutedAnswer[]>;
}

export function routeHostUi(routes: readonly HostUiRoute[], options: RouteHostUiOptions = {}): RoutedHostUi {
  if (!routes.length) throw new HeadlessError("no_routes");
  const names = new Set<string>();
  for (const route of routes) {
    if (typeof route.name !== "string" || !route.name.trim() || typeof route.ui?.request !== "function")
      throw new HeadlessError("invalid_route");
    if (names.has(route.name)) throw new HeadlessError("duplicate_route");
    names.add(route.name);
    if (route.kinds?.some((kind) => !HOST_UI_KINDS.includes(kind))) throw new HeadlessError("unknown_kind");
    if (route.timeoutMs !== undefined && (!Number.isSafeInteger(route.timeoutMs) || route.timeoutMs < 1 || route.timeoutMs > 600_000))
      throw new HeadlessError("invalid_timeout");
  }
  const authority = options.resumeAuthority;
  const ownership = { ...options.ownership };
  const configured = routes.map((route) => ({ ...route, kinds: route.kinds === undefined ? undefined : [...route.kinds] }));
  const log = createAnswerLog(answerLimit(options.limits?.maxAnswers), options.answerLog, options.ownership);
  const offering = new Set<string>();
  const offer = async (
    request: HostUiRequest,
    approvalId?: string,
    signal?: AbortSignal,
    accept?: (answer: HostUiResponse, route: string) => boolean,
  ) => {
    for (const route of configured) {
      if (signal?.aborted) return;
      if (route.kinds ? !route.kinds.includes(request.kind) : request.kind === "secret" || request.kind === "terminal") continue;
      const metadata = {
        route: route.name,
        kind: request.kind,
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        ...(approvalId === undefined ? {} : { approvalId }),
      };
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      const result = Promise.resolve()
        .then(() => route.ui.request(request))
        .then(
          (answer) => {
            if (expired) log.recordLate({ ...metadata, status: "late", at: new Date().toISOString() });
            return {
              answer,
              status: validAnswer(request.kind, answer) && (!accept || accept(answer, route.name)) ? answer.status : "unavailable",
            } as const;
          },
          () => {
            if (expired) log.recordLate({ ...metadata, status: "error", at: new Date().toISOString() });
            return { answer: { status: "unavailable" } as const, status: "error" } as const;
          },
        );
      const waiting = [result];
      // Resume offers have no route timeout; only the host's signal bounds their wait.
      if (approvalId === undefined && route.timeoutMs !== undefined)
        waiting.push(
          new Promise((resolve) => {
            timer = setTimeout(() => {
              expired = true;
              resolve({ answer: { status: "unavailable" }, status: "unavailable" });
            }, route.timeoutMs);
          }),
        );
      if (signal)
        waiting.push(
          new Promise((resolve) => {
            abort = () => {
              expired = true;
              resolve({ answer: { status: "unavailable" }, status: "unavailable" });
            };
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
          }),
        );
      const outcome = await Promise.race(waiting);
      clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
      await log.record({ ...metadata, status: outcome.status, at: new Date().toISOString() });
      if (signal?.aborted) return;
      if (outcome.status === "answered" || outcome.status === "dismissed") return { answer: outcome.answer, route: route.name };
    }
  };
  return {
    answers: log.answers,
    async request<K extends HostUiRequestKind>(request: Extract<HostUiRequest, { kind: K }>): Promise<HostUiResponse<K>> {
      return ((await offer(request))?.answer ?? { status: "unavailable" }) as HostUiResponse<K>;
    },
    async resumeWhenAnswered(session, pending, resumeOptions = {}) {
      if (!authority) throw new HeadlessError("resume_authority_required");
      for (const key of ["tenantId", "accountId", "userId"] as const) {
        if (ownership[key] !== undefined && ownership[key] !== authority.ownership[key]) throw new HeadlessError("session_not_found");
      }
      if (offering.has(session.id)) throw new HeadlessError("resume_busy");
      offering.add(session.id);
      try {
        return await resumeWhenAnswered(authority, session, pending, resumeOptions, offer);
      } finally {
        offering.delete(session.id);
      }
    },
  };
}

function validAnswer(kind: HostUiRequestKind, answer: HostUiResponse): boolean {
  if (!answer || typeof answer !== "object") return false;
  if (answer.status === "dismissed" || answer.status === "unavailable") return true;
  if (answer.status !== "answered") return false;
  const value = answer.value;
  switch (kind) {
    case "confirm":
      return typeof value === "boolean";
    case "input":
      return typeof value === "string";
    case "select":
      return typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"));
    case "secret":
      return value === undefined || typeof value === "string";
    case "terminal":
      return value !== null && typeof value === "object" && "exitCode" in value && Number.isInteger(value.exitCode);
    default:
      return value === undefined;
  }
}
