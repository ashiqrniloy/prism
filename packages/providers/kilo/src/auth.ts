/**
 * Kilo device login. Kilo's own protocol, not RFC 8628: initiate a code, show the verification URL
 * through `host.ui`, then poll until the owner approves. The token is stored as one `bearer` secret;
 * there is no refresh, so an expired token means signing in again.
 *
 * Nothing here prints the token, the account email, or a poll body. Only the code and the allowed
 * verification URL reach the host UI.
 */
import type { AuthContext, AuthMethod, Secret } from "@arnilo/prism";
import { readBoundedResponseJson } from "@arnilo/prism/provider-kit";

/** The `AuthMethod` id a host uses to find this login. */
export const KILO_AUTH_ID = "kilo";
/** Device-auth and profile host; the gateway uses a different host. */
export const KILO_AUTH_BASE_URL = "https://api.kilo.ai";
/** The CLI's poll cadence. */
export const KILO_AUTH_POLL_INTERVAL_MS = 3_000;
/** The CLI assumes one year when the token is not a JWT with `exp`; labelled as an assumption in the README. */
export const KILO_AUTH_FALLBACK_LIFETIME_MS = 365 * 24 * 60 * 60 * 1_000;
/** The default writable credential ref. */
export const KILO_DEFAULT_CREDENTIAL_REF = "keyring:kilo";

const VERIFICATION_HOSTS = ["app.kilo.ai"] as const;
const DEFAULT_EXPIRES_IN_SECONDS = 600;
const MAX_AUTH_BODY_BYTES = 64 * 1024;

/** Base for every login failure. Messages are user-facing and never carry the token or a raw body. */
export class KiloAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KiloAuthError";
  }
}

export interface KiloAuthConfig {
  /** Writable `keyring:` ref; defaults to `keyring:kilo`. */
  readonly credential?: string;
  /** Device-auth/profile base; defaults to `https://api.kilo.ai`. */
  readonly authBase?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Test seam; defaults to a timer that stops on abort. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Cancels open-url, polling, and the profile call; nothing is stored. */
  readonly signal?: AbortSignal;
}

export type KiloAuthMethod = Extract<AuthMethod, { kind: "oauth" }>;

interface DeviceInitiate {
  readonly code: string;
  readonly verificationUrl: string;
  readonly expiresIn: number;
}

interface DeviceProfile {
  readonly user?: { readonly email?: string };
  readonly organizations?: readonly { readonly id?: string; readonly name?: string; readonly role?: string }[];
  readonly selectedOrganizationId?: string;
  readonly hasPersonalAccount?: boolean;
}

interface DeviceApproval {
  readonly token: string;
  readonly userEmail?: string;
}

function authError(code: string, message: string): KiloAuthError {
  return new KiloAuthError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A login writes this ref, so an `env:` ref is refused before any request. */
export function assertKiloWritableCredentialRef(ref: string): void {
  if (!ref.startsWith("keyring:"))
    throw authError("ERR_KILO_AUTH_REF", `kilo: ${ref.split(":")[0]}: refs are read-only; use ${KILO_DEFAULT_CREDENTIAL_REF}`);
}

function abortError(): KiloAuthError {
  return authError("ERR_KILO_AUTH_ABORTED", "kilo: sign-in was cancelled");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

async function readJson(response: Response, signal: AbortSignal | undefined): Promise<unknown> {
  try {
    return await readBoundedResponseJson<unknown>(response, {
      maxResponseBodyBytes: MAX_AUTH_BODY_BYTES,
      signal,
    });
  } catch (_error) {
    if (signal?.aborted) throw abortError();
    // A transport/parse failure must not echo the body: it may hold the approval token.
    throw authError("ERR_KILO_AUTH_RESPONSE", "kilo: the sign-in service returned an unreadable response");
  }
}

function baseHost(base: string): string {
  try {
    return new URL(base).hostname;
  } catch {
    throw authError("ERR_KILO_AUTH_ORIGIN", "kilo: the configured auth base is not a valid URL");
  }
}

function assertVerificationUrl(value: unknown, authBase: string): string {
  const raw = text(value);
  if (!raw) throw authError("ERR_KILO_AUTH_ORIGIN", "kilo: the sign-in response carried no verification URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw authError("ERR_KILO_AUTH_ORIGIN", "kilo: the sign-in response carried an invalid verification URL");
  }
  const allowed = new Set<string>([baseHost(authBase), ...VERIFICATION_HOSTS]);
  if (url.protocol !== "https:" || url.username || url.password || !allowed.has(url.hostname))
    throw authError("ERR_KILO_AUTH_ORIGIN", "kilo: the verification URL is not a Kilo https URL; nothing was opened");
  return url.toString();
}

function initiateBody(value: unknown): DeviceInitiate {
  if (!isRecord(value)) throw authError("ERR_KILO_AUTH_RESPONSE", "kilo: the sign-in service returned an unreadable code");
  const code = text(value.code);
  if (!code) throw authError("ERR_KILO_AUTH_RESPONSE", "kilo: the sign-in service returned no code");
  const seconds =
    typeof value.expiresIn === "number" && Number.isFinite(value.expiresIn) && value.expiresIn > 0
      ? value.expiresIn
      : DEFAULT_EXPIRES_IN_SECONDS;
  return { code, verificationUrl: text(value.verificationUrl) ?? "", expiresIn: seconds };
}

function jwtExpiry(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const padded = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as unknown;
    if (!isRecord(payload)) return undefined;
    const exp = payload.exp;
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp * 1_000 : undefined;
  } catch {
    return undefined;
  }
}

function organizationChoices(profile: DeviceProfile): { readonly ids: readonly string[]; readonly hasPersonal: boolean } {
  const ids = (profile.organizations ?? []).map((org) => text(org.id)).filter((id): id is string => id !== undefined);
  return { ids, hasPersonal: profile.hasPersonalAccount === true };
}

function defaultOrganization(profile: DeviceProfile, ids: readonly string[]): string {
  const selected = text(profile.selectedOrganizationId);
  if (selected && ids.includes(selected)) return selected;
  return profile.hasPersonalAccount === true ? "personal" : (ids[0] ?? "personal");
}

async function chooseOrganization(profile: DeviceProfile, ctx: AuthContext): Promise<string | undefined> {
  const { ids, hasPersonal } = organizationChoices(profile);
  const choiceCount = ids.length + (hasPersonal ? 1 : 0);
  if (choiceCount <= 1) return ids.length === 1 ? ids[0] : undefined;

  const ui = ctx.host.ui;
  if (!ui) throw authError("ERR_KILO_AUTH_UI", "kilo: choosing an organization needs a host UI");
  const defaultValue = defaultOrganization(profile, ids);
  const options = [
    ...(hasPersonal ? [`personal (personal account)`] : []),
    ...(profile.organizations ?? []).flatMap((org) => {
      const id = text(org.id);
      return id === undefined ? [] : [`${id}${text(org.name) ? ` (${org.name})` : ""}`];
    }),
  ];
  const answer = await ui.request({
    kind: "input",
    title: "Choose a Kilo organization",
    detail: `Enter one of:\n${options.join("\n")}\nLeave blank or enter personal for the personal account.`,
    placeholder: defaultValue,
    value: defaultValue,
  });
  if (answer.status !== "answered") throw authError("ERR_KILO_AUTH_UI", "kilo: choosing an organization needs a host UI");
  const picked = answer.value.trim();
  if (!picked || picked === "personal") return undefined;
  if (ids.includes(picked)) return picked;
  // Also accept the exact `id (name)` line the detail showed; anything else must not silently pick an org.
  const byLine = (profile.organizations ?? []).find((org) => {
    const id = text(org.id);
    if (!id) return false;
    const name = text(org.name);
    return picked === `${id}${name ? ` (${name})` : ""}`;
  });
  const id = text(byLine?.id);
  if (id) return id;
  throw authError("ERR_KILO_AUTH_ORG", "kilo: that organization is not on this account; sign in again");
}

async function login(config: KiloAuthConfig, ctx: AuthContext): Promise<void> {
  const credential = config.credential ?? KILO_DEFAULT_CREDENTIAL_REF;
  assertKiloWritableCredentialRef(credential);
  const authBase = (config.authBase ?? KILO_AUTH_BASE_URL).replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? defaultSleep;
  const signal = config.signal;
  const ui = ctx.host.ui;
  if (!ui) throw authError("ERR_KILO_AUTH_UI", "kilo: sign-in needs a host UI (open-url and input)");
  throwIfAborted(signal);

  const initResponse = await doFetch(`${authBase}/api/device-auth/codes`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: "{}",
    ...(signal ? { signal } : {}),
  });
  if (initResponse.status === 429) throw authError("ERR_KILO_AUTH_BUSY", "kilo: too many pending sign-ins; try again later");
  if (!initResponse.ok) throw authError("ERR_KILO_AUTH_FAILED", `kilo: the sign-in service refused to start (${initResponse.status})`);
  const started = initiateBody(await readJson(initResponse, signal));
  const verificationUrl = assertVerificationUrl(started.verificationUrl, authBase);
  const opened = await ui.request({
    kind: "open-url",
    title: `Approve Kilo sign-in with code ${started.code}`,
    url: verificationUrl,
  });
  if (opened.status !== "answered") throw authError("ERR_KILO_AUTH_UI", "kilo: the host could not open the verification URL");

  const deadline = now() + started.expiresIn * 1_000;
  let approval: DeviceApproval | undefined;
  while (approval === undefined) {
    throwIfAborted(signal);
    if (now() >= deadline) throw authError("ERR_KILO_AUTH_EXPIRED", "kilo: the sign-in code expired; start again");
    await sleep(KILO_AUTH_POLL_INTERVAL_MS, signal);
    throwIfAborted(signal);
    const response = await doFetch(`${authBase}/api/device-auth/codes/${encodeURIComponent(started.code)}`, {
      headers: { accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
    if (response.status === 202) continue;
    if (response.status === 403) throw authError("ERR_KILO_AUTH_DENIED", "kilo: the sign-in was denied");
    if (response.status === 410) throw authError("ERR_KILO_AUTH_EXPIRED", "kilo: the sign-in code expired; start again");
    if (!response.ok) continue;
    const body = await readJson(response, signal);
    if (!isRecord(body)) throw authError("ERR_KILO_AUTH_RESPONSE", "kilo: the sign-in service returned an unreadable approval");
    const status = text(body.status);
    const token = text(body.token);
    if (status === "denied" || status === "rejected") throw authError("ERR_KILO_AUTH_DENIED", "kilo: the sign-in was denied");
    if (status === "expired") throw authError("ERR_KILO_AUTH_EXPIRED", "kilo: the sign-in code expired; start again");
    if (token) {
      approval = { token, ...(text(body.userEmail) !== undefined ? { userEmail: text(body.userEmail)! } : {}) };
      break;
    }
    // 200 with `status: "pending"` is an observed pending response, not approval.
  }

  const profileResponse = await doFetch(`${authBase}/api/profile`, {
    headers: { accept: "application/json", authorization: `Bearer ${approval.token}` },
    ...(signal ? { signal } : {}),
  });
  if (!profileResponse.ok) throw authError("ERR_KILO_AUTH_PROFILE", `kilo: the profile request failed (${profileResponse.status})`);
  const body = await readJson(profileResponse, signal);
  if (!isRecord(body)) throw authError("ERR_KILO_AUTH_PROFILE", "kilo: the profile response was unreadable");
  const profile = body as DeviceProfile;
  const organizationId = await chooseOrganization(profile, ctx);

  const obtainedAt = now();
  const expires = jwtExpiry(approval.token) ?? obtainedAt + KILO_AUTH_FALLBACK_LIFETIME_MS;
  const email = text(profile.user?.email) ?? approval.userEmail;
  const secret: Secret = {
    type: "bearer",
    value: approval.token,
    metadata: {
      v: 1,
      ...(email !== undefined ? { email } : {}),
      ...(organizationId !== undefined ? { organizationId } : {}),
      obtainedAt: new Date(obtainedAt).toISOString(),
      expires,
    },
  };
  await ctx.credentials.store(credential, secret);
}

/** The provider's `AuthMethod`. The host runs `login`; the kernel never does. */
export function kiloAuth(config: KiloAuthConfig = {}): KiloAuthMethod {
  return { kind: "oauth", id: KILO_AUTH_ID, login: (ctx) => login(config, ctx) };
}

/** Deletes the stored token. Kilo has no revoke endpoint, so this is local-only. */
export function kiloLogout(config: Pick<KiloAuthConfig, "credential"> = {}): (ctx: AuthContext) => Promise<void> {
  const credential = config.credential ?? KILO_DEFAULT_CREDENTIAL_REF;
  return async (ctx) => {
    assertKiloWritableCredentialRef(credential);
    await ctx.credentials.delete(credential);
  };
}
