# `scripts/litellm`

Operator tooling for the LiteLLM provider (`@arnilo/prism-ai/litellm`, plan 214). Nothing here
ships in a package and nothing here runs during a normal Prism session.

## `reconcile.mjs` — Prism cost vs. the proxy's spend log

Compares the cost Prism recorded for a run with the `spend` LiteLLM logged for the same call ids, and
fails when they disagree or when a row never arrived.

```bash
LITELLM_API_KEY=sk-... bun scripts/litellm/reconcile.mjs \
  --report docs/_evidence/memory-bench/<run>.json \
  --base-url http://127.0.0.1:4000 \
  --out /tmp/reconciled
```

```
| callId | modelId | prismCost | litellmSpend | delta |
| --- | --- | --- | --- | --- |
| `0f2a6f0e-…` | chat-scout | 0.00007355 | 0.00007355 | 0.00000000 |

Totals: prism 0.00007355 USD, litellm 0.00007355 USD, delta 0.00000000 USD.
Missing rows: none.
Verdict: reconciled.
```

- **`--report`** takes a bench report (`{calls:[{callId, cost}]}`, or a `rows`/`usage`/`results`/`records`
  array, or a bare list) or a usage log (`*.jsonl`, one `{callId, cost}` per line; `requestId`/`litellmCallId`
  and `costUsd`/`usd`/`prismCost` are accepted aliases).
- **`--out PREFIX`** writes `PREFIX.md` and `PREFIX.json`; without it the table goes to stdout.
- **Exit codes:** `0` reconciled, `1` a delta over `--tolerance` (default `1e-6` USD) or at least one
  missing row, `2` usage or configuration error.
- **Cost:** zero model calls. One indexed read per id up to 20 ids, otherwise paged range reads; see
  "Spend logs" in the package README for the bounds and the measured flush delay.
- **Secrets:** the key comes from `LITELLM_API_KEY` only — there is no flag that takes a key value, so it
  never reaches argv. Errors are redacted, and rows carry no prompt, completion or key material.
- **Scope:** only the ids you pass are ever printed; rows the key can read for other tenants are dropped
  by the package before this script sees them.

`bun test scripts/litellm/reconcile.test.mjs` covers the reader, the delta/verdict logic, and the CLI
end to end against a local stub proxy.

## The free-model list — `free-models.mjs`

`docs/free-models.md` is the maintained list of free models per configured provider, generated from
each provider's own catalogue (`bun scripts/litellm/free-models.mjs`, `--json` for the raw report):

```bash
bun scripts/litellm/free-models.mjs      # rewrite docs/free-models.md, no model calls, no quota spent
```

It reads a key from the live env file by name, fetches each catalogue with a bounded body, and marks
free-ness with the provider's own criterion — OpenRouter: zero prompt *and* completion price;
Cloudflare: free-plan allowance; Groq/NVIDIA: free-tier quota; Google: Flash family only. A provider with
no key is listed as **skipped**, with the pool deployments it already carries, so the page never hides a
model. The last column names the `prism-free/*` group a test can reach the model through today, and
`free_models_committed_list_covers_every_pool_deployment` fails if a pool deployment is missing from the
committed page. Adding a provider is one entry in `PROVIDERS`; quotas and their sources stay in the table
below.

## The free test pool — `up.mjs`, `down.mjs`, `free-pool.mjs`

A loopback-only LiteLLM proxy on free tiers, for wire and integration tests. It starts no model
request by itself and costs nothing.

**What it is not.** It is not release evidence. Release evidence stays on Hyper and OpenCode Go
(`docs/live-testing.md`); a free tier can change its model list, throttle, or train on prompts without
notice, so nothing here may be quoted as a capability result.

```bash
timeout 240 bun scripts/litellm/up.mjs                 # start
timeout 240 bun scripts/litellm/up.mjs --write-key     # start and store LITELLM_API_KEY
timeout 60  bun scripts/litellm/down.mjs               # stop (keeps the volume)
timeout 60  bun scripts/litellm/down.mjs --purge       # stop and discard keys + spend logs
```

What `up.mjs` does, in order: loads the live env file (same rules as the bench: `PRISM_LIVE_ENV_FILE`,
else `~/.config/prism/live.env`, values never overwritten), renders `config.yaml` and `compose.yaml`
into `$XDG_CACHE_HOME/prism/litellm-pool` (mode `0600`, never inside the repo), starts compose, waits
for `/health/liveliness`, then mints one virtual key.

### Groups

| group | deployments | use |
| --- | --- | --- |
| `prism-free/smoke` | Groq `gpt-oss-20b`, Gemini `gemini-3.8-flash`, Cloudflare `@cf/openai/gpt-oss-20b` | wire and integration tests only |
| `prism-free/gpt-oss-120b` | Groq, NVIDIA NIM, Cloudflare `@cf/openai/gpt-oss-120b` | same-model, several hosts |
| `prism-free/gpt-oss-120b@groq`, `@nvidia`, `@cloudflare` | one deployment each | the only groups a scored arm may use |
| `prism-free/gpt-oss-20b@groq`, `@cloudflare` | one deployment each | pinned, scored-safe |
| `prism-free/gemini-3.8-flash@gemini` | one deployment | pinned, scored-safe |
| `prism-free/gemma-4-26b@openrouter`, `prism-free/nemotron-3.5-lightning@openrouter` | one deployment each | pinned, scored-safe (OpenRouter `:free`, 50 requests/day) |
| `prism-free/priced` | Cloudflare `gpt-oss-20b` with a **fabricated** price | the budget tripwire |

A deployment is rendered only when every env name it needs is set, and a group left empty is dropped
(so is a fallback that pointed at it). `up.mjs` prints what it skipped. Only `prism-free/smoke` has a
fallback, and only to a same-model pin: a same-model group never falls back to another model, and
`render_same_model_groups_have_no_cross_model_fallback` fails if one appears.

### Groq's model strings

Groq's own ids already start with `openai/` (its catalogue serves `openai/gpt-oss-120b`), so the LiteLLM
string needs the provider prefix too: `groq/openai/gpt-oss-120b`. Without it LiteLLM reads `openai/` as
the provider and sends the Groq key to `api.openai.com`, which answers `401 Incorrect API key provided:
gsk_…` — measured 2026-10-31, and the reason the pool only failed once a real `GROQ_API_KEY` existed.

### Add a backend

1. Add the env name to `scripts/live.env.example` and fill it in your live env file.
2. Add a host entry (`name`, `requireEnv`, `keyEnv`) and one or more deployments to
   `scripts/litellm/free-pool.mjs`: `group`, `host`, `model` (LiteLLM model string), `id` (the
   deployment id `x-litellm-model-id` will report — keep it stable, benches count it), `rpm`/`tpm`
   from the quota table, `caps` only for capabilities the host documents.
3. Run `bun test scripts/litellm/render.test.mjs`, then `up.mjs`, then `curl` one chat call and check
   `x-litellm-model-id` names the deployment you expect.

### Quotas (read 2026-10-31)

| host | deployment | free quota | set in the pool | source |
| --- | --- | --- | --- | --- |
| Groq | `openai/gpt-oss-120b`, `openai/gpt-oss-20b` | 30 RPM / 1 000 RPD / 8 000 TPM / 200 000 TPD per model per org | `rpm: 30, tpm: 8000` | `console.groq.com/docs/rate-limits` |
| NVIDIA NIM | `openai/gpt-oss-120b` | no published number; ~40 RPM reported | `rpm: 20, tpm: 8000` (conservative) | `forums.developer.nvidia.com/t/…384546` (2026-09-28) |
| Google AI Studio | `gemini/gemini-3.8-flash` | 5 RPM / 20 RPD on Flash (no longer published) | `rpm: 5, tpm: 250000` | `ai.google.dev/gemini-api/docs/rate-limits` |
| OpenRouter | `google/gemma-4-26b-a4b-it:free`, `nvidia/nemotron-3.5-lightning:free` | `:free` variants: 20 RPM, 50 RPD (1 000 RPD after $10 lifetime spend) | `rpm: 20, tpm: 20000` | `openrouter.ai/docs/api_reference/limits` |

OpenRouter's daily free quota is per **account**, and a probe run can spend it: on 2026-10-31 this
account had 1 000/day (`is_free_tier: false`, i.e. ≥$10 lifetime spend) and `remaining: 0` after the
Task 1b/2 probes, so both free deployments answered `429 free-models-per-day-high-balance` — a quota
answer, not a config error. `GET /api/v1/key` reports the counter; it resets at 00:00 UTC.
| Cloudflare Workers AI | `@cf/openai/gpt-oss-120b`, `@cf/openai/gpt-oss-20b` | 10 000 neurons/day on the free plan, no RPM | `rpm: 20, tpm: 10000` (conservative) | `developers.cloudflare.com/workers-ai/platform/pricing` |

Mistral was considered and dropped: its Free mode (Experiment plan) no longer lets an account create
API keys, so the host is not in the pool (checked 2026-10-31, owner report).

OpenRouter is a pool host for its `:free` variants only, and its free catalogue no longer
carries `gpt-oss-120b` (checked 2026-10-31), so it contributes no member to the same-model group. Cerebras is not either —
its free tier ended in 2026-09. Refresh a quota by re-reading the source column and updating both this
table and the `rpm`/`tpm` in `free-pool.mjs`; the plan's Task 1 (e) table is the history of the numbers.

**Data use.** Free tiers are not neutral: Google's free tier states that content is used to improve
Google's products, OpenRouter free models may be logged by their upstream vendor, and other hosts may log or
train on prompts. That is why `prism-free/smoke` is for
wire and integration tests only, and why no memory-bench arm may run on a group whose owner has not
accepted its data terms.

### Health checks cost quota

`general_settings.background_health_checks` is on with `health_check_interval: 300`, scoped by
`background_health_check_model_groups` to the rendered groups that opt in. A deployment sets
`healthCheck: false` when a check would eat its quota: OpenRouter (50 requests **per day** against 288
checks), Gemini (small daily allowance), and `prism-free/priced` (every check would accrue fake spend
and blow the tripwire's own budget). A group is checked only when all its deployments opt in, so
`prism-free/smoke` is unchecked while the single-host pins are checked. That is one request
per group per 5 minutes at most — cheap, but not free: a 24-hour run is ~288 requests per group. Raise
the interval rather than deleting the checks; they are what keeps a dead free deployment out of
rotation, and `enable_health_check_routing` is why a cooldown does not silently send a scored arm to a
different host.

### The key

`up.mjs` mints (or rotates, by alias `prism-free-pool`) one virtual key: models limited to the groups
that rendered, `max_budget: 0.01` USD over 30 days, `user_id: prism-free-pool` with role
`internal_user` — the role is what makes `/spend/logs/v2` scope rows to this user instead of returning
every tenant's rows. The key value is never printed and never written unless you pass `--write-key`,
which requires the live env file to be mode `0600` and upserts only the `LITELLM_API_KEY=` line.

The budget is a **tripwire, not a hard ceiling**: LiteLLM checks spend from a cached value, so a call
inside the flush window can overshoot, and the refusal arrives as `422 budget_exceeded` on a later call
(measured 2026-10-31: ~12-16 s flush, one call can overshoot by its own cost). `prism-free/priced`
exists so that a paid-call mistake accrues spend at all; the free deployments price at zero and never
trip it. A truly free pool therefore has no cost control worth the name — bound it by request count,
`rpm`, and the fact that a key cannot reach a model outside `prism-free/*`.

### Rendered files

`config.yaml`, `compose.yaml`, `db-password` and `pool.json` live in the scratch directory:

- the config references credentials as `os.environ/NAME`, never by value;
- compose hands them over as `${NAME}`, interpolated by compose from `up.mjs`'s environment, so no key
  is ever written to a file;
- images are pinned by `@sha256:` digest (plan 214 Task 1 (c) records the age waiver for 1.106.6);
- Postgres publishes no port and sits on an internal network; the proxy binds `127.0.0.1:4000`;
- one random Postgres password per **volume**, stored in `db-password`: `POSTGRES_PASSWORD` is only read
  when the volume is created, so a per-run password against an existing volume is an auth failure.

`yaml` is emitted by `render.mjs`'s small structured serialiser, not by string templating. A JSON body
is *not* accepted for `config.yaml` — LiteLLM answered `LLM Model List not loaded in` for it — and the
image's own entrypoint starts the proxy without `--config`, so compose names both explicitly.

### Tests

`bun test scripts/litellm/render.test.mjs` covers the renderer: key-gated deployments and dropped
groups, the no-cross-model-fallback rule, zero costs for free deployments, no secret in the output,
loopback binding plus digest pins, `--otel` on/off, and that nothing under `scripts/litellm/` is
published. `reconcile.test.mjs` covers the spend-log reader below.
