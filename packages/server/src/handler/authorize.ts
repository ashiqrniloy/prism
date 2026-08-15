/** authorize (0.2.5 plan 025 Task 1 split). Moved verbatim from handler.ts; public surface unchanged behind the barrel. */
import type { Agent, AgentSession } from "@arnilo/prism";
import { assertIdentityActive, assertIdentityMatchesOwnership } from "@arnilo/prism";
import type { CreatePrismHandlerOptions, PrismAgentExposure, PrismServerAuthorization, PrismServerOperation } from "../types.js";

export async function authorize(
  options: CreatePrismHandlerOptions,
  request: Request,
  operation: PrismServerOperation,
  capabilityId: string,
  timeoutMs: number,
): Promise<PrismServerAuthorization | false> {
  let result: false | PrismServerAuthorization;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  try {
    result = await Promise.race([
      options.authorize({ request, operation, capabilityId, signal: controller.signal }),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort(new Error("authorization timed out"));
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
  if (!result || !hasOwnership(result.ownership)) return false;
  if (result.identity) {
    try {
      assertIdentityActive(result.identity);
      assertIdentityMatchesOwnership(result.identity, result.ownership);
    } catch {
      return false;
    }
  }
  return result;
}

function hasOwnership(value: PrismServerAuthorization["ownership"]): boolean {
  return [value.tenantId, value.accountId, value.userId].some((item) => typeof item === "string" && item.length > 0);
}

export async function createSession(
  exposure: Agent | PrismAgentExposure,
  authorization: PrismServerAuthorization,
): Promise<{ readonly session: AgentSession; readonly runOptions?: PrismAgentExposure["runOptions"] }> {
  if ("sessionFactory" in exposure) {
    return { session: await exposure.sessionFactory(authorization), runOptions: exposure.runOptions };
  }
  return { session: exposure.createSession() };
}

export function sameOwnership(left: PrismServerAuthorization["ownership"], right: PrismServerAuthorization["ownership"]): boolean {
  return left.tenantId === right.tenantId && left.accountId === right.accountId && left.userId === right.userId;
}
