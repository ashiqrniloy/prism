import { createXaiOAuthProvider } from "@arnilo/prism-providers/xai";

export async function demo() {
  const seen: string[] = [];
  const oauth = createXaiOAuthProvider({
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/device/code")) {
        return Response.json({
          device_code: "dev",
          user_code: "ABCD-1234",
          verification_uri: "https://auth.x.ai/activate",
          expires_in: 300,
          interval: 0,
        });
      }
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    },
    sleep: async () => undefined,
  });
  const credentials = await oauth.login({
    onDeviceCode(code) {
      seen.push(`${code.userCode} ${code.verificationUri}`);
    },
  });
  return { seen, hasAccess: Boolean(credentials.access), hasRefresh: Boolean(credentials.refresh) };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
