import { assertSsrfAllowedUrl, type SecretRedactor, type SsrfPolicy } from "@arnilo/prism";
import { PolicyError } from "./errors.js";
import { createPolicyEvaluator } from "./evaluator.js";
import { assertNoUnrestrictedPayload } from "./prepare.js";
import type { PolicyEvaluateRequest, PolicyEvaluateResult, PolicyEvaluator } from "./types.js";

/**
 * OPA REST decision adapter (plan 011 Task 2): `POST /v1/data/<path>` with
 * `{"input": <document>}` over native fetch. No OPA SDK dependency.
 *
 * - Endpoint URL is host-pinned and SSRF-checked (`assertSsrfAllowedUrl`);
 *   SSRF denials surface the core `MediaContentError`, never a policy outcome.
 * - Default input carries only redacted actor refs (tenant/account/user/
 *   principal/sponsor/scopes + action + resource) — never prompts, tool args,
 *   JWTs, or credentials. Hosts opt into bounded context via `mapInput`;
 *   top-level payload-like keys are rejected (`ERR_PRISM_POLICY_PAYLOAD`).
 * - Timeout/transport/parse/bounds/version/mapping failures fail closed:
 *   `onFailure: "deny"` (default) returns a deny result (recorded by
 *   `evaluateAndAppend`); `onFailure: "escalate"` rethrows the `PolicyError`.
 * - `requirePolicyVersion` sends `provenance=true` and requires at least one
 *   OPA bundle revision to match; stale/missing provenance fails closed
 *   (`ERR_PRISM_OPA_VERSION_MISMATCH`).
 * - Redirects are never followed; response body read is capped; retries are
 *   bounded (default 0, hard 2) and only for timeout/transport/5xx.
 * - Frozen error codes: ERR_PRISM_OPA_TIMEOUT, ERR_PRISM_OPA_TRANSPORT,
 *   ERR_PRISM_OPA_RESPONSE_PARSE, ERR_PRISM_OPA_RESPONSE_BOUNDS,
 *   ERR_PRISM_OPA_DECISION_MAPPING, ERR_PRISM_OPA_VERSION_MISMATCH.
 */

export type OpaDecisionDocument = Readonly<Record<string, unknown>>;

const OUTCOMES = new Set<PolicyEvaluateResult["outcome"]>(["allow", "deny", "modify", "approval"]);
const RETRYABLE_CODES = new Set(["ERR_PRISM_OPA_TIMEOUT", "ERR_PRISM_OPA_TRANSPORT"]);

interface OpaLimits {
  timeoutMs: number;
  maxInputBytes: number;
  maxResponseBytes: number;
  maxRetries: number;
}

const DEFAULT_OPA_LIMITS: OpaLimits = Object.freeze({
  timeoutMs: 2000,
  maxInputBytes: 16 * 1024,
  maxResponseBytes: 64 * 1024,
  maxRetries: 0,
});

const HARD_OPA_LIMITS: OpaLimits = Object.freeze({
  timeoutMs: 30_000,
  maxInputBytes: 256 * 1024,
  maxResponseBytes: 1024 * 1024,
  maxRetries: 2,
});

function resolveOpaLimits(input: Partial<OpaLimits> = {}): OpaLimits {
  const out = {} as OpaLimits;
  for (const key of Object.keys(DEFAULT_OPA_LIMITS) as (keyof OpaLimits)[]) {
    const value = input[key] ?? DEFAULT_OPA_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 0 || value > HARD_OPA_LIMITS[key]) {
      throw new PolicyError(`${key} must be a safe integer 0..${HARD_OPA_LIMITS[key]}`, "ERR_PRISM_POLICY_LIMITS");
    }
    out[key] = value;
  }
  return out;
}

/** Transport-level error carrying HTTP status (retry policy distinguishes 5xx). */
class OpaFetchError extends PolicyError {
  readonly status?: number;
  constructor(message: string, code: string, status?: number) {
    super(message, code);
    this.status = status;
  }
}

/** Default input builder: redacted actor refs only; context omitted by design. */
function defaultOpaMapInput(request: PolicyEvaluateRequest): OpaDecisionDocument {
  const id = request.identity;
  return Object.freeze({
    action: request.action,
    resource: Object.freeze({ kind: request.resource.kind, id: request.resource.id }),
    identity: Object.freeze({
      tenantId: id.tenantId,
      ...(id.accountId !== undefined ? { accountId: id.accountId } : {}),
      ...(id.userId !== undefined ? { userId: id.userId } : {}),
      principal: Object.freeze({ kind: id.principal.kind, id: id.principal.id }),
      ...(id.sponsor !== undefined ? { sponsorId: id.sponsor.id } : {}),
      ...(id.scopes?.length ? { scopes: Object.freeze([...id.scopes]) } : {}),
    }),
  });
}

function mappingError(message: string): PolicyError {
  return new PolicyError(message, "ERR_PRISM_OPA_DECISION_MAPPING");
}

/** Default decision mapper: boolean, `{allow}`, or `{outcome, reason?, evidenceRefs?, expiresAt?}`. */
function defaultOpaMapDecision(decision: unknown): PolicyEvaluateResult {
  if (typeof decision === "boolean") return { outcome: decision ? "allow" : "deny" };
  if (typeof decision !== "object" || decision === null) {
    throw mappingError("OPA decision must be boolean or object");
  }
  const doc = decision as Record<string, unknown>;
  const outcome = doc.outcome !== undefined ? doc.outcome : typeof doc.allow === "boolean" ? (doc.allow ? "allow" : "deny") : undefined;
  if (typeof outcome !== "string" || !OUTCOMES.has(outcome as PolicyEvaluateResult["outcome"])) {
    throw mappingError("OPA decision outcome must be allow|deny|modify|approval");
  }
  const normalized = outcome as PolicyEvaluateResult["outcome"];
  if (doc.reason !== undefined && (typeof doc.reason !== "string" || !doc.reason.trim())) {
    throw mappingError("OPA decision reason must be a non-empty string");
  }
  if (
    doc.evidenceRefs !== undefined &&
    (!Array.isArray(doc.evidenceRefs) || !doc.evidenceRefs.every((ref) => typeof ref === "string" && ref.trim()))
  ) {
    throw mappingError("OPA decision evidenceRefs must be an array of strings");
  }
  if (doc.expiresAt !== undefined && (typeof doc.expiresAt !== "string" || !Number.isFinite(Date.parse(doc.expiresAt)))) {
    throw mappingError("OPA decision expiresAt must be an ISO timestamp");
  }
  return {
    outcome: normalized,
    ...(doc.reason !== undefined ? { reason: doc.reason as string } : {}),
    ...(doc.evidenceRefs !== undefined ? { evidenceRefs: [...(doc.evidenceRefs as string[])] } : {}),
    ...(doc.expiresAt !== undefined ? { expiresAt: doc.expiresAt as string } : {}),
  };
}

export interface OpaPolicyEvaluatorOptions {
  /** Host-pinned OPA decision URL, e.g. `https://opa:8181/v1/data/prism/allow`. */
  readonly url: string;
  readonly policyId: string;
  readonly policyVersion: string;
  /** Bounded input builder; default is `defaultOpaMapInput` (redacted refs only). */
  readonly mapInput?: (request: PolicyEvaluateRequest) => OpaDecisionDocument | Promise<OpaDecisionDocument>;
  /** Decision mapper; default is `defaultOpaMapDecision`. */
  readonly mapDecision?: (decision: unknown) => PolicyEvaluateResult | Promise<PolicyEvaluateResult>;
  /** Applied to mapped reason/evidenceRefs before the result leaves the adapter. */
  readonly redactor?: SecretRedactor;
  /** `deny` (default) returns a deny result on OPA failures; `escalate` rethrows. */
  readonly onFailure?: "deny" | "escalate";
  /** When set, sends `provenance=true` and requires a matching bundle revision. */
  readonly requirePolicyVersion?: string;
  readonly timeoutMs?: number;
  readonly maxInputBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxRetries?: number;
  readonly ssrf?: SsrfPolicy;
  readonly fetch?: typeof fetch;
}

const FAILURE_REASONS: Record<string, string> = {
  ERR_PRISM_OPA_TIMEOUT: "OPA decision timed out",
  ERR_PRISM_OPA_TRANSPORT: "OPA endpoint unavailable",
  ERR_PRISM_OPA_RESPONSE_PARSE: "OPA response malformed",
  ERR_PRISM_OPA_RESPONSE_BOUNDS: "OPA response exceeded bounds",
  ERR_PRISM_OPA_VERSION_MISMATCH: "OPA policy version mismatch",
  ERR_PRISM_OPA_DECISION_MAPPING: "OPA decision could not be mapped",
};

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PolicyError(`OPA response exceeds ${maxBytes} bytes`, "ERR_PRISM_OPA_RESPONSE_BOUNDS");
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

interface OpaEnvelope {
  readonly result: unknown;
  readonly provenance?: { readonly bundles?: Readonly<Record<string, { readonly revision?: string }>> };
}

/** One bounded POST attempt; throws PolicyError (or MediaContentError on SSRF). */
async function callOpa(
  url: URL,
  body: string,
  request: PolicyEvaluateRequest,
  limits: OpaLimits,
  ssrf: SsrfPolicy | undefined,
  fetchImpl: typeof fetch,
): Promise<OpaEnvelope> {
  assertSsrfAllowedUrl(url.toString(), ssrf);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      signal,
      redirect: "manual",
    });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpaFetchError("OPA decision timed out", "ERR_PRISM_OPA_TIMEOUT");
    }
    throw new OpaFetchError("OPA endpoint unreachable", "ERR_PRISM_OPA_TRANSPORT");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    // Never follow redirects; 5xx is retryable, other statuses fail immediately.
    throw new OpaFetchError(`OPA endpoint returned HTTP ${response.status}`, "ERR_PRISM_OPA_TRANSPORT", response.status);
  }
  const text = await readBoundedBody(response, limits.maxResponseBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PolicyError("OPA response is not valid JSON", "ERR_PRISM_OPA_RESPONSE_PARSE");
  }
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) {
    throw new PolicyError("OPA response missing result", "ERR_PRISM_OPA_RESPONSE_PARSE");
  }
  return parsed as OpaEnvelope;
}

/** OPA REST decision evaluator (see module comment). */
export function createOpaPolicyEvaluator(options: OpaPolicyEvaluatorOptions): PolicyEvaluator {
  if (!options.url?.trim()) throw new PolicyError("url required", "ERR_PRISM_POLICY_VALIDATION");
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new PolicyError("url must be an absolute URL", "ERR_PRISM_POLICY_VALIDATION");
  }
  const limits = resolveOpaLimits({
    timeoutMs: options.timeoutMs,
    maxInputBytes: options.maxInputBytes,
    maxResponseBytes: options.maxResponseBytes,
    maxRetries: options.maxRetries,
  });
  const onFailure = options.onFailure ?? "deny";
  const mapInput = options.mapInput ?? defaultOpaMapInput;
  const mapDecision = options.mapDecision ?? defaultOpaMapDecision;
  const fetchImpl = options.fetch ?? fetch;
  if (options.requirePolicyVersion !== undefined && !options.requirePolicyVersion.trim()) {
    throw new PolicyError("requirePolicyVersion must be a non-empty string", "ERR_PRISM_POLICY_VALIDATION");
  }
  if (options.requirePolicyVersion) url.searchParams.set("provenance", "true");

  return createPolicyEvaluator({
    policyId: options.policyId,
    policyVersion: options.policyVersion,
    async evaluate(request) {
      let envelope: OpaEnvelope;
      try {
        const doc = await mapInput(request);
        if (typeof doc !== "object" || doc === null) {
          throw new PolicyError("mapInput must return an object", "ERR_PRISM_POLICY_VALIDATION");
        }
        assertNoUnrestrictedPayload(doc);
        let body: string;
        try {
          body = JSON.stringify({ input: doc });
        } catch {
          throw new PolicyError("OPA input is not JSON-serializable", "ERR_PRISM_POLICY_VALIDATION");
        }
        if (Buffer.byteLength(body, "utf8") > limits.maxInputBytes) {
          throw new PolicyError(`OPA input exceeds ${limits.maxInputBytes} bytes`, "ERR_PRISM_OPA_RESPONSE_BOUNDS");
        }
        envelope = await retryingCall(url, body, request, limits, options.ssrf, fetchImpl);
      } catch (error) {
        return handleFailure(error, onFailure);
      }

      if (options.requirePolicyVersion) {
        const bundles = envelope.provenance?.bundles;
        const match = bundles ? Object.values(bundles).some((bundle) => bundle?.revision === options.requirePolicyVersion) : false;
        if (!match) {
          const error = new PolicyError(
            `OPA bundle revision does not match ${options.requirePolicyVersion}`,
            "ERR_PRISM_OPA_VERSION_MISMATCH",
          );
          return handleFailure(error, onFailure);
        }
      }

      let result: PolicyEvaluateResult;
      try {
        result = await mapDecision(envelope.result);
      } catch (error) {
        if (error instanceof PolicyError) return handleFailure(error, onFailure);
        throw error;
      }
      if (options.redactor) {
        result = {
          ...result,
          ...(result.reason !== undefined ? { reason: options.redactor.redact(result.reason) } : {}),
          ...(result.evidenceRefs !== undefined ? { evidenceRefs: options.redactor.redact([...result.evidenceRefs]) } : {}),
        };
      }
      return result;
    },
  });
}

async function retryingCall(
  url: URL,
  body: string,
  request: PolicyEvaluateRequest,
  limits: OpaLimits,
  ssrf: SsrfPolicy | undefined,
  fetchImpl: typeof fetch,
): Promise<OpaEnvelope> {
  let last: unknown;
  for (let attempt = 0; attempt <= limits.maxRetries; attempt++) {
    try {
      return await callOpa(url, body, request, limits, ssrf, fetchImpl);
    } catch (error) {
      last = error;
      if (attempt < limits.maxRetries && isRetryable(error)) continue;
      throw error;
    }
  }
  throw last;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof OpaFetchError) {
    return RETRYABLE_CODES.has(error.code) && (error.status === undefined || error.status >= 500);
  }
  return false;
}

function handleFailure(error: unknown, onFailure: "deny" | "escalate"): PolicyEvaluateResult | never {
  if (onFailure === "escalate") throw error;
  if (error instanceof PolicyError && FAILURE_REASONS[error.code]) {
    return { outcome: "deny", reason: FAILURE_REASONS[error.code] };
  }
  throw error;
}
