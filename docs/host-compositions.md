# Host compositions

Prism agents are host-assembled: the host application owns credentials, providers, persistence, permissions, tool definitions, and connected-app transports. Prism provides two canonical, maintained host compositions and a zero-network inspection and readiness API to ensure host setups conform to their operational contracts:

- **`personal` (`personal-assistant`)**: Local-personal host composition for single-operator productivity, personal tools, local/memory persistence, and secret redaction.
- **`business` (`business-worker`)**: Multi-tenant enterprise worker host composition with verified tenant identity, mandatory durable storage, sandbox workspace containment, and strict governance enforcement.

## Profiles

| Profile | Ownership | Identity | Persistence | Sandbox | Governance |
| --- | --- | --- | --- | --- | --- |
| `personal` | Single user (`userId`) | Optional unverified operator | Memory or durable storage | Local workspace | Optional |
| `business` | Tenant + user (`tenantId`, `userId`) | Mandatory verified identity (`verified: true`) matching tenant | Mandatory durable store (`durable: true`); memory rejected | Contained sandbox roots within workspace | Required supported governance |

## Host composition API

Both helper functions and the error class are exported from `@arnilo/prism`:

```ts
import {
  inspectHostComposition,
  assertHostCompositionReadiness,
  HostCompositionError,
  type HostCompositionProfile,
  type HostCompositionOptions,
  type HostCompositionReport,
} from "@arnilo/prism";
```

### `inspectHostComposition(options)`

Inspects an agent configuration and returns a typed `HostCompositionReport`. Inspection is **completely inert and performs zero network calls**. Canary secrets in credentials are never leaked.

```ts
const report = inspectHostComposition({
  profile: "personal",
  agent: personalAgent,
  store: memoryStore,
  credentialRefs: ["OPENAI_API_KEY"],
  connectedApps: { appIds: ["slack"], serverIds: ["slack"] },
});
```

Report structure:

- `profile`: `"personal"` or `"business"`.
- `effectiveTools`: Readonly list of tool names registered on the agent.
- `credentialRefs`: Host credential references (sanitized, values never included).
- `connectedApps`: Optional copied `appIds` and `serverIds` (up to 32 identifiers per list); transports, environment, headers, and tokens are never accepted or reported. Business hosts require a verified identity when this field is present.
- `ownership`: Tenant and user ownership identifiers.
- `storage`: Storage summary with `kind` (`"memory"`, `"postgres"`, `"sqlite"`, etc.) and `durable` boolean. Memory stores are truthfully reported with `durable: false`. `snapshotRunBundle()` ([effective run bundle snapshots](run-bundle.md)) reuses this classification for the per-run store kinds.
- `sandbox`: Isolation status and resolved root paths.
- `governance`: Coverage flags (authorization, trust, and custom policies).
- `readiness`: Object with `ok: boolean` and list of `reasons` if not ready.

### `assertHostCompositionReadiness(options)`

Validates that the host composition satisfies all profile constraints. Throws `HostCompositionError` on the first violated rule:

| Error Code | Violation |
| --- | --- |
| `ERR_PRISM_HOST_COMPOSITION_PROFILE` | Unknown or missing profile. |
| `ERR_PRISM_HOST_COMPOSITION_OWNERSHIP` | Missing `userId` (personal), missing `tenantId` (business), or identity/ownership mismatch. |
| `ERR_PRISM_HOST_COMPOSITION_STORAGE` | Non-durable or in-memory persistence passed to a business composition. |
| `ERR_PRISM_HOST_COMPOSITION_SECRETS` | Agent lacks a configured `SecretRedactor`. |
| `ERR_PRISM_HOST_COMPOSITION_PROVIDER` | Agent lacks an active `AIProvider` or model selection. |
| `ERR_PRISM_HOST_COMPOSITION_SANDBOX` | Sandbox roots escape the declared `workspaceRoot`. |
| `ERR_PRISM_HOST_COMPOSITION_GOVERNANCE` | Governance policy disabled or unsupported. |

### Integration with `createSecureAgent`

`createSecureAgent` accepts an optional `composition` field. When provided, readiness is asserted immediately before the agent is returned:

```ts
import { createSecureAgent } from "@arnilo/prism";

const agent = createSecureAgent({
  id: "worker-1",
  definitionRevision: "1",
  ownership: { tenantId: "acme-corp", userId: "worker-prod" },
  identity: {
    tenantId: "acme-corp",
    userId: "worker-prod",
    principal: { kind: "user", id: "worker-prod" },
    scopes: ["task:execute"],
    verified: true,
    issuedAt: new Date().toISOString(),
  },
  composition: {
    profile: "business",
    store: postgresStore,
    workspaceRoot: "/data/acme",
    sandboxRoots: ["/data/acme/scratch"],
  },
  // ... other required secure agent options
});
```

## Package install vs. import subpaths

Always install containing packages directly. **NPM install never accepts subpaths**:

```bash
# Correct — install containing published packages:
npm install @arnilo/prism @arnilo/prism-core @arnilo/prism-providers @arnilo/prism-work

# Never install subpaths:
# npm install @arnilo/prism-work/connectors (WRONG: fails with 404 / E404)
```

In your application code, import from documented subpaths:

```ts
// Subpaths exported by @arnilo/prism-work:
import { createWorkTools } from "@arnilo/prism-work/connectors";
import { createJsonSchemaArgumentValidator } from "@arnilo/prism-core/validation/json-schema";

// Subpaths exported by @arnilo/prism-providers:
import { createOpenAIProvider } from "@arnilo/prism-providers/openai";
```

## Background workers

Business workers that share a durable checkpoint queue should pass `admission: { perTenant, drain }` into `createWorkflowCoordinator` and mount `createPrismOperatorHandler` beside health/drain. See [Operations runbook](operations.md) and [Workflows](workflows.md). Do not introduce a second scheduler.

## Starter templates

Scaffold fresh host compositions using `prism init`:

```bash
# Personal assistant composition
prism init my-assistant --template personal-assistant

# Business worker composition
prism init my-worker --template business-worker
```

Each template produces a runnable agent, mock test fixtures, environment templates, and strict typing.

## Dev inspector endpoint

When running `@arnilo/prism-coding-tools/dev`, host compositions can be inspected via HTTP:

```bash
GET /inspect
# or GET {basePath}/inspect
```

Returns the JSON serialized `HostCompositionReport` corresponding to the inspected agent and options.
