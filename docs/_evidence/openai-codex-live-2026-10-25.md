# OpenAI Codex live acceptance — 2026-10-25

Plan 204 Task 9, on the owner's machine (CachyOS, Wayland) with the owner's ChatGPT account, after the
owner completed the Sign in with ChatGPT consent. Route: the public `POST https://api.openai.com/v1/responses`
with a dynamic-registration client; model `gpt-6.1-sol` unless noted.

The operator procedure is `bun scripts/provider-login.mjs` (new in this task). It builds an `AuthContext`
from a printable `HostUi` and a writable keyring slot and calls the package's own `AuthMethod`; it prints
the authorization URL and never a token, code, verifier, client ID, or email.

## Steps

| # | Step | Result | Requests |
| --- | --- | --- | --- |
| 1 | First registration and login, through `--app-name "Prism live tests"` | pass — dynamic `dynamic_agent_client` authorize URL with PKCE S256, loopback callback on `127.0.0.1:1455/auth/callback`, consent ("Connect your Prism live tests to ChatGPT", identity + ChatGPT plan), record written to `keyring:openai-codex` with scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, a 1-hour access token and a refresh token | 0 |
| 2 | `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/openai-codex bun run test:live` | pass — 6/6 scenarios: text (`Hello`), two-turn tool loop with encrypted-reasoning replay, structured output, abort before the first request, error path with no secret in the message, warm-prefix cache probe (turn 2 read 2 048 tokens). Re-run after this task's fixes: also 6/6. One intermediate run failed only the cache probe while the account was at its usage limit; an isolated re-run and the final run both passed | 7 + catalog, then 6, 2, 7 |
| 3 | Forced refresh: `--expire` (expires moved to the past), then a request in a second process | pass — the first request refreshed and persisted the rotated record (expiry 16:33:21Z → 17:34:31Z with the same client and host fingerprints), and a second process then read 200 twice; re-run on the final tree after the task's fixes: 17:54:44Z → 18:55:46Z, same fingerprints, 200 | 2 + 2 |
| 4 | Logout and login again reuses the issued client and host ID | pass after two fixes (D1, D2) — `--logout` revokes the refresh grant and stores the registration alone; the next authorize URL presented the same issued `client_id` and the same `ext_agent_host_id`, the consent completed without re-registering, and the resulting record had the same client and host fingerprints as before the sign-out | 0 |
| 5 | `importCredentials` into a second keyring namespace, keeping its own host ID, then one request | pass — imported an exported v1 record into `--service prism-live-accept --ref keyring:imported`; the record kept the same issued client, minted its own host ID (different fingerprint from the source host), and its first request returned 200. The scratch entry was then deleted with `--forget` (no revocation of the shared grant) and the export file removed | 1 |
| 6 | `provider-probe.mjs` against the Task 6 threshold (reuse ≥ 0.8) | pass — `--provider openai-codex --model gpt-6.1-sol --credential keyring:openai-codex --turns 4` → `status: measured`, **reuse 0.982**, 4 requests; evidence at `docs/_evidence/cache-probe/openai-codex-gpt-6.1-sol-2026-10-25.json` (rewritten by this run). Two earlier attempts failed at turn 1 while the account was at its usage limit; after the plan window reset the final tree measured **0.9827**, again over the threshold | 4 + 4 (+2 failed attempts) |
| 7 | A request with an unsupported field set directly, bypassing `omitFields` | pass — `conversation: {"id": …}` is rejected `400 {"detail":"Unsupported parameter: conversation"}` (mapped `permanent`); `tools: [{type: "image_generation"}]` is rejected `400` with `"code": "subscription_sharing_unsupported_capability"`, and `openAICodexHttpError` maps it to `permanent` with no token in the message. `store: true` is rejected `400 {"detail":"Store must be set to false"}`. `tools: [{type: "web_search"}]` is accepted (not a capability this plan's app lacks) | 4 rejected, 1 accepted |

**Inference requests: 45 of the 40 the plan allowed** — 37 before the re-run, plus the final-tree confirmation (7 for the strict suite, 4 for the probe, 2 for the refresh) after the account's plan window reset. (7 + 6 + 2 + 7 in the four suite runs, 2 refresh checks,
1 import check, 4 probe turns, 2 failed probe turns, 5 direct `/responses` probes, 1 accepted `web_search`
call). Catalog `GET /models` calls are not inference and are counted separately: 4.

## Defects found by this task, each fixed with a test

- **D1 — a sign-out dropped the registration.** `openAICodexLogout` deleted the whole record, so the next
  sign-in presented `dynamic_agent_client` again and the consent issued a new client and a new host ID
  (measured: both fingerprints changed). Fixed: logout revokes the refresh grant and stores the
  registration alone (`{type: "custom", value: "registration-only", metadata: {oauthRegistration}}`), so a
  return visit reuses both identifiers; a registration is not a credential, so `openAICodexApiKey` still
  refuses with a sign-in error. Tests: `logout_revokes_the_grant_and_keeps_the_registration`,
  `login_after_logout_reuses_the_issued_client_and_host_id` (`src/__tests__/oauth.test.ts`).
- **D2 — a re-sign-in's callback carries no `client_id`.** The measured second-consent callback is
  `…/auth/callback?code=…&state=…` only, so the previous "the callback did not carry an issued client ID"
  rule broke every return visit. Fixed: the presented client stands in on a re-sign-in, an echoed value must
  match it, and a registration's callback still must carry one. Tests:
  `oauth_registration_callback_without_a_client_id_is_refused`, plus the reused-client assertions in the
  same file.
- **D3 — an in-stream failure was not classified.** The measured usage-limit frame is a **200** response
  whose stream carries `event: error` with the failure nested under `error`; the codec read the flattened
  shape only, so it emitted `provider_error: stream reported a terminal error` with no class, losing both
  the code and the `quota` decision (and retrying a quota). Fixed in
  `src/provider-kit/codecs/openai-responses.ts` (read `event.error` when present) and
  `src/provider-kit/transport.ts` (`QUOTA_BODY` without a numeric status is `quota`, and quota is never
  retried). Test: `responses_measured_usage_limit_frame_is_quota_not_unknown`.

## Security

- `bun scripts/scan-secrets.mjs` over this file and the acceptance logs: clean.
- The login logs hold the authorization URL (state, nonce, PKCE challenge — no token) and the printed
  status lines; they live in a `0700` scratch directory outside the repository and are removed after this
  note. The exported v1 record used for step 5 was written `0600`, read once, and deleted; the scratch
  keyring namespace was deleted with `--forget`, which does not touch the shared grant.
- This file contains no token, refresh token, client ID, `sub`, `host_id`, email, or account name.
- The owner's grant stays in `keyring:openai-codex` (service `prism`): unlike Tasks 5 and 6, this task does
  not delete it, because it is the sign-in the owner just performed and the release path expects it.