# @arnilo/prism-provider-clinepass

ClinePass Chat Completions provider for Prism. Stream-only. Static `cline-pass/*` catalog.

```ts
import { createClinePassProviderPackage } from "@arnilo/prism-provider-clinepass";

api.registerProviderPackage(createClinePassProviderPackage({ apiKey: "fake-cline-key" }));
```

No `GET /models`. No WorkOS / Cline OAuth. Host supplies `CLINE_API_KEY` via `apiKey`.

Thinking: per-model `compat.thinkingLevelMap` → `reasoning_effort`. GLM `xhigh` is passed through (`max` is not). Cache is upstream-implicit.
