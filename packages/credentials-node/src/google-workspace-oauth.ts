import type { OAuthProvider } from "@arnilo/prism";
import { createOAuth2Provider, type OAuth2ProviderConfig } from "./oauth2.js";
import { resolveWorkloadScopes, type WorkloadScopeAccess, type WorkloadScopeBundle } from "./scopes.js";

/** Google Workspace OAuth scopes, least-privilege per capability (read vs mutation). */
export const GOOGLE_WORKSPACE_SCOPE_BUNDLES: Readonly<Record<string, WorkloadScopeBundle>> = {
  mail: {
    read: ["https://www.googleapis.com/auth/gmail.readonly"],
    mutation: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.modify"],
  },
  calendar: {
    read: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    mutation: ["https://www.googleapis.com/auth/calendar.events"],
  },
  files: {
    read: ["https://www.googleapis.com/auth/drive.readonly"],
    mutation: ["https://www.googleapis.com/auth/drive.file"],
  },
  tasks: {
    read: ["https://www.googleapis.com/auth/tasks.readonly"],
    mutation: ["https://www.googleapis.com/auth/tasks"],
  },
  docs: { read: ["https://www.googleapis.com/auth/documents.readonly"], mutation: ["https://www.googleapis.com/auth/documents"] },
  sheets: { read: ["https://www.googleapis.com/auth/spreadsheets.readonly"], mutation: ["https://www.googleapis.com/auth/spreadsheets"] },
  slides: { read: ["https://www.googleapis.com/auth/presentations.readonly"], mutation: ["https://www.googleapis.com/auth/presentations"] },
};

/** Baseline scopes every GWS login carries (identity + refresh). */
export const GOOGLE_WORKSPACE_BASE_SCOPES = ["openid", "email", "profile"] as const;

export type GoogleWorkspaceCapability = "mail" | "calendar" | "files" | "tasks" | "docs" | "sheets" | "slides";

/** Least-privilege Google Workspace scopes for a capability bundle. */
export function resolveGoogleWorkspaceScopes(
  capabilities: readonly GoogleWorkspaceCapability[],
  access: WorkloadScopeAccess = "read",
): string[] {
  return resolveWorkloadScopes(GOOGLE_WORKSPACE_SCOPE_BUNDLES, GOOGLE_WORKSPACE_BASE_SCOPES, capabilities, access);
}

export interface GoogleWorkspaceOAuthOptions extends Partial<Omit<OAuth2ProviderConfig, "id" | "scope">> {
  /** Capabilities to request; defaults to read mail/calendar/files. */
  readonly capabilities?: readonly GoogleWorkspaceCapability[];
  readonly access?: WorkloadScopeAccess;
}

/**
 * Google Workspace (Gmail/Drive/…) OAuth provider over the shared OAuth2 seam.
 * Google supports RFC 7009 revocation; upstream revoke is best-effort and the
 * credential-store delete remains the fail-closed boundary.
 */
export function createGoogleWorkspaceOAuthProvider(options: GoogleWorkspaceOAuthOptions = {}): OAuthProvider {
  const scopes = resolveGoogleWorkspaceScopes(options.capabilities ?? ["mail", "calendar", "files"], options.access ?? "read");
  return createOAuth2Provider({
    id: "google-workspace",
    clientId: options.clientId,
    authorizeUrl: options.authorizeUrl ?? "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: options.tokenUrl ?? "https://oauth2.googleapis.com/token",
    deviceCodeUrl: options.deviceCodeUrl ?? "https://oauth2.googleapis.com/device/code",
    revocationUrl: options.revocationUrl ?? "https://oauth2.googleapis.com/revoke",
    redirectUri: options.redirectUri,
    scope: scopes.join(" "),
    accountId: options.accountId,
    fetch: options.fetch,
    now: options.now,
    sleep: options.sleep,
    extraTokenParams: options.extraTokenParams,
  });
}
