# Phase 55 — Provider addition evidence (Hyper + Command Code, plan 055)

## What was added

- Two first-class provider adapters in `@arnilo/prism-providers`:
  - `./hyper` — Charm Hyper (pay-per-use Hypercredits gateway), triple route:
    `/chat/completions` (default), `/messages` (`compat.route: "anthropic"`,
    qwen3.6-*), `/responses` (`compat.route: "responses"`, OpenAI-standard
    pass-through reusing the shared Responses machinery).
  - `./commandcode` — Command Code Provider API, dual route: chat default,
    `claude-*` tiers on `/messages` via server-enforced routing.
- Family cut: `@arnilo/prism-providers` 0.4.0 → **0.4.1** (Decision B
  changed-package cut; peer `^0.4.0` unchanged); 19 adapter subpaths total.
- Shared extraction (Task 1): `src/shared/anthropic-messages.ts` +
  offline tests — see `docs/_evidence/phase55-primitive-review.md`.

## Release verification results (Task 11, 2026-09)

| Gate | Result |
| --- | --- |
| Full offline `npm test` (no gates set) | **1579 tests / 1579 pass / 0 fail** (network-free) |
| `tsc --noEmit` (tsconfig.packages) | clean |
| biome check | clean |
| `scripts/package-truth.mjs` + phase24-truth | 12/12; canonical doc counts match generated artifact (11 manifests / 10 workspaces / 19 provider adapters / 3 family / 7 capability) |
| Provider family subpath exports | exactly the 19 adapters, no root barrel (packaging gate) |
| Fresh offline tarball install smoke | passes; family tarball `arnilo-prism-providers-0.4.1.tgz` |
| Doc link integrity (`phase15-freeze`) | 21/21 |
| Default provider-family suite | 445 pass / 0 fail (61 skipped incl. all live probes) |

Gate updates required by the 055 addition (all landed in this task):

- `package-lock.json` synced to the 0.4.1 family manifest (release gate).
- `packaging.test.ts`: adapter list 17 → 19; lockstep gate now records the
  plan-055 changed-package cut (providers 0.4.1, other 10 manifests 0.4.0);
  adapter-isolation gate records the two deliberate family-internal imports
  (`shared/` for all adapters, `openai/` for hyper only).
- `install-smoke.test.ts`: family tarball version read from its manifest.
- `docs.test.ts`: "all 17" literals → 19; every generated provider listed in
  README + release page (hyper, commandcode added); plans index links plan 055.
- `docs/release-and-install.md` + `README.md` + `docs/index.md` counts/rows.

## Security spot check (redaction on error paths)

- Hyper: `hyper_402_billing_error_is_non_retryable_and_redacted` (402 body
  echoes the key → `assertNoSecretLeak`), responses-route 401 redaction test,
  `assertNoSecretLeak` in all 7 gated live probes.
- Command Code: `commandcode_403_and_422_are_non_retryable_and_redacted`
  (API-key echo in error body), `assertNoSecretLeak` in the gated live suite.
- No live secret ever enters events (asserted offline + live); keys read only
  from `PRISM_LIVE_PROVIDER_TESTS=1` + `HYPER_API_KEY` / `COMMAND_CODE_API_KEY`.

## Live-probe findings ledger

**Probe status: pending operator run — no operator key at execution time.**
Both provider packages ship operator-gated probes behind
`PRISM_LIVE_PROVIDER_TESTS=1` plus the provider key; each probe assertion
encodes the documented claim and a failure **is** the finding to record.

Operator command:

```bash
PRISM_LIVE_PROVIDER_TESTS=1 HYPER_API_KEY=… COMMAND_CODE_API_KEY=… \
  npm test -w @arnilo/prism-providers
```

Unknowns enumerated (findings go in each provider's docs page ledger):

- Hyper (`docs/providers/hyper.md`): (1) chat-route cached-token field names;
  (2) messages-route `cache_control` creation/read reporting; (3) TTL ≥ one
  request; (4) `reasoning_effort` acceptance.
- Command Code (`docs/providers/commandcode.md`): (1) chat-route implicit
  cached tokens; (2) messages-route creation/read tokens; (3) TTL ≥ one
  request; (4) **GPT-5.6 `prompt_cache_key` passthrough — decides Task 9**
  (closed gated without code change); (5) `reasoning_effort` acceptance;
  (6) ZDR routing (done) or `422 cmd_zdr_no_providers`.

No probe result is required for release: the default offline suite is the
mandatory gate (per `docs/release-and-install.md` protected canary matrix);
live rows run only in protected environments and are recorded on report.

## Related

- `docs/provider-packages.md` (OAuth matrix, Phase 10 matrix, cache notes)
- `docs/provider-caching.md` (per-provider table rows)
- `docs/providers/hyper.md`, `docs/providers/commandcode.md`
- `plans/055-First-Class-Hyper-And-Command-Code-Providers.md`