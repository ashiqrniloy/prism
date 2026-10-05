export {
  createGoogleWorkspaceOAuthProvider,
  GOOGLE_WORKSPACE_BASE_SCOPES,
  GOOGLE_WORKSPACE_SCOPE_BUNDLES,
  type GoogleWorkspaceCapability,
  type GoogleWorkspaceOAuthOptions,
  resolveGoogleWorkspaceScopes,
} from "./google-workspace-oauth.js";
export {
  createMicrosoft365OAuthProvider,
  MICROSOFT365_BASE_SCOPES,
  MICROSOFT365_SCOPE_BUNDLES,
  type Microsoft365Capability,
  type Microsoft365OAuthOptions,
  resolveMicrosoft365Scopes,
} from "./microsoft365-oauth.js";
export {
  computeOAuth2S256Challenge,
  createOAuth2PkceVerifier,
  createOAuth2Provider,
  type OAuth2ProviderConfig,
} from "./oauth2.js";
export { resolveWorkloadScopes, type WorkloadScopeAccess, type WorkloadScopeBundle } from "./scopes.js";
export {
  createOAuthWorkTokenProvider,
  type OAuthWorkTokenOptions,
  type OAuthWorkTokenProvider,
  type WorkTokenOAuthStore,
} from "./work-token.js";
