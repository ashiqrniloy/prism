# @arnilo/prism-provider-xai

xAI Grok Chat Completions provider for Prism. API key **or** SuperGrok / X Premium OAuth.

```ts
import { createXaiOAuthProvider, createXaiProviderPackage } from "@arnilo/prism-provider-xai";
import { refreshOAuthCredential } from "@arnilo/prism";

api.registerProviderPackage(createXaiProviderPackage({ apiKey: "fake-xai-key" }));

const oauth = createXaiOAuthProvider();
const creds = await oauth.login({
  onDeviceCode: ({ userCode, verificationUri }) => {
    console.log(`Open ${verificationUri} and enter ${userCode}`);
  },
});
await store.set("xai", creds);

api.registerProviderPackage(
  createXaiProviderPackage({
    apiKey: async () => {
      const current = await store.get("xai");
      return (await refreshOAuthCredential({ provider: oauth, credentials: current, store })).access;
    },
  }),
);
```

Default OAuth client id `b1a00492-073a-47ea-816f-4c329264a828` is the published Grok CLI public client, not a secret. Hosts may override `clientId`. No PKCE loopback. No `~/.grok` scan.

Cache: sanitized `x-grok-conv-id` from `cache.key ?? cacheKey ?? sessionId`. Thinking on reasoning models is replayed as `reasoning_content`.
