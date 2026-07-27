import type { OAuthProvider } from "@arnilo/prism";
import { createOAuth2Provider, type OAuth2ProviderConfig } from "./oauth2.js";
import { resolveWorkloadScopes, type WorkloadScopeAccess, type WorkloadScopeBundle } from "./scopes.js";

/** Microsoft Graph delegated permissions, least-privilege per capability (read vs mutation). */
export const MICROSOFT365_SCOPE_BUNDLES: Readonly<Record<string, WorkloadScopeBundle>> = {
  mail: { read: ["Mail.Read"], mutation: ["Mail.Send", "Mail.ReadWrite"] },
  calendar: { read: ["Calendars.Read"], mutation: ["Calendars.ReadWrite"] },
  files: { read: ["Files.Read", "Sites.Read.All"], mutation: ["Files.ReadWrite", "Sites.ReadWrite.All"] },
  todo: { read: ["Tasks.Read"], mutation: ["Tasks.ReadWrite"] },
  planner: { read: ["Tasks.Read"], mutation: ["Tasks.ReadWrite"] },
};

/** Baseline delegated scopes every M365 login carries (identity + refresh). */
export const MICROSOFT365_BASE_SCOPES = ["openid", "profile", "offline_access", "User.Read"] as const;

export type Microsoft365Capability = "mail" | "calendar" | "files" | "todo" | "planner";

/** Least-privilege Microsoft Graph scopes for a capability bundle. */
export function resolveMicrosoft365Scopes(capabilities: readonly Microsoft365Capability[], access: WorkloadScopeAccess = "read"): string[] {
  return resolveWorkloadScopes(MICROSOFT365_SCOPE_BUNDLES, MICROSOFT365_BASE_SCOPES, capabilities, access);
}

export interface Microsoft365OAuthOptions extends Partial<Omit<OAuth2ProviderConfig, "id" | "scope">> {
  /** Capabilities to request; defaults to read mail/calendar/files. */
  readonly capabilities?: readonly Microsoft365Capability[];
  readonly access?: WorkloadScopeAccess;
  readonly tenantId?: string;
}

/**
 * Microsoft 365 (Outlook/OneDrive/…) OAuth provider over the shared OAuth2 seam.
 * Microsoft exposes no public RFC 7009 revocation endpoint, so `revoke` is a no-op upstream
 * and the credential-store delete is the fail-closed boundary.
 */
export function createMicrosoft365OAuthProvider(options: Microsoft365OAuthOptions = {}): OAuthProvider {
  const tenant = options.tenantId ?? "common";
  const scopes = resolveMicrosoft365Scopes(options.capabilities ?? ["mail", "calendar", "files"], options.access ?? "read");
  return createOAuth2Provider({
    id: "microsoft365",
    clientId: options.clientId,
    authorizeUrl: options.authorizeUrl ?? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: options.tokenUrl ?? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    deviceCodeUrl: options.deviceCodeUrl ?? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`,
    redirectUri: options.redirectUri,
    scope: scopes.join(" "),
    accountId: options.accountId,
    fetch: options.fetch,
    now: options.now,
    sleep: options.sleep,
    extraTokenParams: options.extraTokenParams,
  });
}
