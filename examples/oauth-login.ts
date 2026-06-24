import {
  createPkceVerifier,
  computeS256Challenge,
  createOpenAICodexOAuthProvider,
} from "@arnilo/prism-provider-openai";

// Codex OAuth login uses RFC 7636 PKCE with S256. The verifier is exchanged at
// the token endpoint, never sent on the authorize URL. This example only builds
// the verifier/challenge and the OAuth provider; callbacks are host-supplied.
export function demo() {
  const verifier = createPkceVerifier();
  const challenge = computeS256Challenge(verifier);

  const oauth = createOpenAICodexOAuthProvider({
    redirectUri: "http://localhost:1455/auth/callback",
    scope: "openai.chatgpt",
  });

  return {
    verifierLength: verifier.length, // 43 base64url chars
    challengeMethod: "S256",
    oauthProvider: oauth,
  };
}
