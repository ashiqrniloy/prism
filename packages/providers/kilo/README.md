# `@arnilo/prism-ai/kilo`

Kilo AI Gateway provider package for [Prism](https://github.com/ashiqrniloy/prism): registers the `kilo` provider, resolves its key from `env:`/`keyring:` refs, and serves the gateway's three wires — Chat Completions, Responses and Anthropic Messages — plus the model catalog.

## Install

```sh
bun add @arnilo/prism-ai
```

## Use

```ts
import { kilo } from "@arnilo/prism-ai/kilo";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "kilo/anthropic/claude-haiku-5.5",
  packages: [kilo()],
});
```

The bare definition uses the schema defaults, so `packages: [kilo]` is the same as `kilo()`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:KILO_API_KEY` | Resolved per request; wins over the login. A literal key is rejected (`secret_literal`). |
| `credential` | writable `keyring:` ref | `keyring:kilo` | Where the device login stores its token. An `env:` ref is refused at load. |
| `baseUrl` | string | `https://ai-gateway.kilo.ai/api/v1` | Gateway base. |
| `organizationId` | string | — | Sends `X-KILOCODE-ORGANIZATIONID` and switches discovery to `/organizations/{id}/models`. |
| `dataCollection` | `"allow"` \| `"deny"` | — | Body `provider.data_collection`, only when set. |
| `mode` | string | — | `x-kilocode-mode`, sent only on `kilo-auto/*` models. The CLI sends its agent name on every request; Prism deliberately sends fewer invented bytes. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks `GET /models`. |

With neither the key nor a login the package still registers and emits the `warn` note
`kilo: no API key at env:KILO_API_KEY and no login at keyring:kilo; only :free models are reachable`.
The gateway accepts anonymous free requests, so no fake `Bearer anonymous` is sent.

## Routes

One provider, three wires. `compat.route` wins; otherwise the catalog's `opencode.ai_sdk_provider`
decides, and an absent value is Chat:

| wire | catalog value | path | auth |
| --- | --- | --- | --- |
| `messages` | `anthropic` | `/messages` | `x-api-key` + bearer + `anthropic-version` |
| `responses` | `openai` | `/responses` | bearer |
| `chat` | absent or `openrouter` | `/chat/completions` | bearer |

- **Chat** replays `reasoning_details`, passes the OpenAI-style `reasoning` object through, and gates
  images by model capability.
- **Responses** always sends `store: false`. Item references are accepted; encrypted reasoning replay
  could not be captured on a free model (the gateway returned no `encrypted_content`).
- **Messages** uses adaptive thinking for Claude 5.x (the wire rejects `{type: "enabled"}`) and places
  `cache_control` on the first two system messages and the last two messages — the Kilo CLI's
  placement, up to four markers.

Every wire carries `X-KILOCODE-TASKID` from the sanitized `cacheKey ?? sessionId` (capped at 128
characters; the CLI sends it unclamped). Caller headers cannot override the authorization,
`X-KILOCODE-TASKID`, `X-KILOCODE-ORGANIZATIONID` or `x-kilocode-mode` headers.

## Authentication

There are two paths, and the key wins when both resolve:

1. **API key** — `env:KILO_API_KEY` (or any `env:`/`keyring:` ref in `apiKey`).
2. **Device login** — the provider declares an `oauth` `AuthMethod` with id `kilo` next to the
   `api-key` method. A host, not the kernel, runs it:

```ts
import { kilo, kiloLogout } from "@arnilo/prism-ai/kilo";

const provider = /* the registered kilo provider */;
const login = provider.auth?.find((method) => method.kind === "oauth" && method.id === "kilo");
if (login) await login.login({ host, credentials }); // host.ui + the credentials:write slot

// Signing out is local: Kilo has no revoke endpoint.
await kiloLogout({ credential: "keyring:kilo" })({ host, credentials });
```

The login opens Kilo's verification URL through `host.ui` `open-url` with the code in the title, then
polls every 3 seconds until the code is approved or expires (about 10 minutes). It stores one bearer
secret at the `credential` ref (`keyring:kilo` by default) with `{v: 1, email, organizationId?,
obtainedAt, expires}`. `expires` is the JWT `exp` when the token is a JWT; otherwise it is one year
after sign-in, the same assumption the Kilo CLI makes. Device tokens do not refresh — when one expires,
run the login again. A credential shaped like `https://host:…` is treated as an opaque token: Prism
never derives the request host from it and always uses `baseUrl`.

If the account has more than one organization choice (the personal account plus organizations), the
login asks through `host.ui` `input`, defaulting to `selectedOrganizationId` when it is valid, otherwise
the first organization when there is no personal account — the CLI's rule. The chosen organization is
stored in the credential metadata; a config `organizationId` overrides it.

## Organizations

`organizationId` sends `X-KILOCODE-ORGANIZATIONID` on every request and asks discovery for
`/organizations/{id}/models`. The account used for the recorded probes has no organization, so the
organization-specific rows are documented from the CLI, not measured. Discovery itself is one request
and needs no key for the personal catalog.

## Prompt caching

The gateway places and accounts its own breakpoints, independently of the client: with a fresh ~6.4k
prefix, turn 1 read 0 tokens and turn 2 read 8672 on every wire, with `X-KILOCODE-TASKID`,
`prompt_cache_key` and Messages `cache_control` each on and off. Toggling the levers changed nothing;
one Messages series even warmed only on turn 3. Prism therefore treats the task-id header as an
operational session key, not a cache lever, and its markers as harmless parity with the CLI. Responses
sends no `prompt_cache_key`: the Kilo CLI sends none, and the shared Responses codec would otherwise
derive one from the session.

The plan-203 4-turn probe on the free `nvidia/nemotron-3.5-super-vl:free` row measured an 8571-token
stable prefix with `4336` cache-read tokens on turns 2–4 (reuse `0.506`) on Chat and, with the route
forced in the probe, `0.506` on Responses. Messages recorded the same `4336` on two warm turns and a
cold turn 3 (reuse `0.337`), so that free-route diagnostic is below the 0.8 ratio threshold; the
gateway exposes only about half of this prefix as cache reads. The standard Responses and Messages
cells use the paid GPT-6 Luna and Claude Haiku 5.5 exemplars, which the reference account cannot run
while its balance is negative. Those cells stay unmeasured, not passing. See
`docs/_evidence/cache-probe/kilo-nvidia-nemotron-3.5-super-vl-free*.json`.

`Usage` maps what the gateway reports: Chat `prompt_tokens_details.cached_tokens` and
`cache_write_tokens`; Responses `input_tokens_details.cached_tokens`; Messages
`cache_read_input_tokens` / `cache_creation_input_tokens` (a `null` write stays undefined). `cost` is a
number in USD on every wire and is copied to `Usage.cost`; `is_byok` and the served model/provider go
to `usage.metadata.kilo`. Cache pricing per model is in the catalog cost (`input_cache_read` /
`input_cache_write`, ×1e6). A cache-read ratio computed from a small prompt is not a saving guarantee.

## Free models and data collection

`:free` rows and `kilo-auto/free` need no credit; the gateway still accepts anonymous free requests.
They may route to upstreams that log prompts. The catalog's `mayTrainOnYourPrompts` and `isFree` flags
are surfaced in `compat` so a host can filter. `dataCollection: "deny"` sends
`provider.data_collection: "deny"`; the gateway decides whether it can honour it. Free models are
limited to 200 requests per hour per the docs; 429 carries `Retry-After`.

## Cost

The paid exemplars are Claude Haiku 5.5 (Messages), GPT-6 Luna (Responses) and Gemma 4 26B A4B (Chat),
with costs in USD per million tokens from the 2026-10-31 catalog. A live run is roughly 30 requests,
under $0.05 at those rates. Point `PRISM_LIVE_KILO_*_MODEL` at free ids such as
`nvidia/nemotron-3.5-super-vl:free` for a zero-cost run; the wire fixtures were captured that way.
`organizationId` and `mode` add no requests.
