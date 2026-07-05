# Extension conformance

## What it does

Extension conformance helpers are dependency-free assertions for `Extension` adapter tests. They exercise setup execution, inert contribution registration, and setup-error handling under the kernel's error policy, without network or credentials.

Exported from `@arnilo/prism/testing/extension-conformance`:

- `assertExtensionConforms(extension, options?)`
- `ExtensionConformanceOptions`

## When to use it

Use this helper when authoring an `Extension` package. It asserts:

- `setup` runs on load
- registered contributions land in the inert contribution registries (no side effects until host code resolves and invokes them)
- under the default `errorPolicy: "event"`, a failing setup emits a redacted `extension_error` event (when `secrets` is supplied)
- under `expectThrow: true`, a failing setup rethrows to the caller

## Inputs / request

```ts
import { assertExtensionConforms } from "@arnilo/prism/testing/extension-conformance";
import type { Extension } from "@arnilo/prism";

const extension: Extension = {
  name: "demo",
  setup(api) { api.registerSkill({ name: "brief", instructions: "Be brief." }); },
};

const kernel = await assertExtensionConforms(extension, { secrets: ["token-123"] });
```

`ExtensionConformanceOptions`:
- `secrets?: readonly string[]` — secrets that must be redacted in the `extension_error` event (default policy only)
- `expectThrow?: boolean` — assert a failing setup rethrows under `errorPolicy: "throw"`

## Outputs / response / events

Returns `Promise<ExtensionKernel>` so the caller can inspect registered contributions; throws a plain `Error` on the first violation. No runner.

## Request/response example

```ts
import { assertExtensionConforms } from "@arnilo/prism/testing/extension-conformance";

const kernel = await assertExtensionConforms(myExtension, { secrets: ["api-key"] });
// throws if a failing setup's error event leaks one of the supplied secrets.
```

## Implementation example

```ts
import { assertExtensionConforms } from "@arnilo/prism/testing/extension-conformance";

const kernel = await assertExtensionConforms({
  name: "demo",
  setup(api) { api.registerTool({ name: "ping", execute: () => ({ value: "pong" }) }); },
});
```

## Extension and configuration notes

- The helper builds a fresh `ExtensionKernel` for each call; it does not reuse host kernel state.
- Contributions are inert by construction — the kernel stores envelopes and never invokes provider/tool/skill capabilities until host code resolves and calls them.
- Under `expectThrow`, the helper asserts the kernel rethrows a failing setup rather than isolating it.

## Security and performance notes

- No credentials, no network required; pass fake secret strings.
- Redaction is exact-match (mirroring `createSecretRedactor`); the helper does not detect arbitrary secret patterns.
- The kernel does not sandbox tool/extension execution — hosts retain responsibility for trust and permission gating (see [Settings, auth, trust, security](settings-auth-trust-security.md)).

## Related APIs

- [Extensions](extensions.md)
- [Contribution registries](contribution-registries.md)
- [Settings, auth, trust, security](settings-auth-trust-security.md)
- [Provider conformance](provider-conformance.md)
