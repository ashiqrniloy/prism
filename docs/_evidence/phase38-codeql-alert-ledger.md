# Phase 38 CodeQL Alert Ledger

## Snapshot

- Repository: `ashiqrniloy/prism`
- Default branch: `main`
- Audited commit: `c600eaa18f65b56764ec2fb408ec813536eff6f7`
- Local HEAD: `c600eaa18f65b56764ec2fb408ec813536eff6f7` (exact match)
- Fetched: 2026-08-27 via authenticated GitHub REST API
- Open alerts: **59**
- Fixed alerts: **7**
- Dismissed alerts: **0**
- Raw API snapshots: temporary files under `/tmp`; not committed

```bash
gh api --paginate --slurp \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  '/repos/ashiqrniloy/prism/code-scanning/alerts?state=open&per_page=100'
```

All 59 open alerts are marked `high` by their CodeQL rule metadata and point to the same audited commit on `refs/heads/main`.

## Open Alert Summary

| Rule | Open | Root-cause group |
| --- | ---: | --- |
| `js/polynomial-redos` | 50 | A (36), B (13), D (1) |
| `js/insecure-randomness` | 4 | E |
| `js/incomplete-multi-character-sanitization` | 2 | C |
| `js/incomplete-url-substring-sanitization` | 1 | H |
| `js/clear-text-logging` | 1 | F |
| `js/insufficient-password-hash` | 1 | G |
| **Total** | **59** | |

## Root-Cause Groups

### A — Repeated trailing-slash regular expression (36 alerts)

Alerts: `7`, `8`, `23`–`51`, `57`–`61`.

All use `value.replace(/\/+$/, "")` or the equivalent on a library/configuration input. Replace them with one shared bounded `trimTrailingSlashes()` primitive where package dependency direction permits. Preserve `/`, URL validation, and provider/server route semantics with conformance tests. Alert `50` is especially high leverage because the shared OpenAI-compatible primitive serves many providers.

### B — Unbounded parsing regular expressions (13 alerts)

Alerts: `3`, `4`, `5`, `11`, `15`, `16`, `19`, `20`, `21`, `63`, `64`, `65`, `66`.

Affected parsing surfaces are browser target output, coding checkpoints, uncompressed PDF text, Markdown headings, Context7 headings, and skill frontmatter. Replace ambiguous nested/repeated regex parsing with bounded scanners or simple prefix/index operations. Existing document/checkpoint byte limits remain required but are not substitutes for linear parsing.

### C — Incomplete HTML sanitization (2 alerts)

Alerts: `17`, `18`.

The regex chain in `packages/rag/src/parsers.ts` can leave `<script` or `<!--` material after one replacement changes adjacency. Replace the sanitization chain with a single-pass HTML-to-text scanner or a proven already-installed parser; do not repeatedly patch individual tag regexes.

### D — Cache-key sanitization regular expression (1 alert)

Alert: `22`.

`sanitizeCacheKey()` uses an anchored alternation trim after replacement. Replace edge trimming with indexes/slicing while retaining the allowlist and max-length bound. This alert was previously fixed as alert `2` and later reappeared, so add a direct regression case.

### E — Insecure random identifiers in an executable fixture (4 alerts)

Alerts: `52`–`55`.

`Math.random()` supplies session/link identifiers in `scripts/fixtures/phase26-coding-journey.mjs`. Replace the shared suffix generation with `randomUUID()` or `randomBytes()` from `node:crypto`; no custom generator.

### F — Clear-text error logging (1 alert)

Alert: `56`.

The DR script prints arbitrary `error.message` and `error.stack` from a path that handles password checks. Emit a fixed failure message and bounded/redacted diagnostic metadata instead of raw error text.

### G — PKCE SHA-256 false-positive candidate (1 alert)

Alert: `6`.

`computeOAuth2S256Challenge()` implements RFC 7636 S256 exactly: `BASE64URL(SHA256(verifier))`. The verifier is a random one-time PKCE secret, not a stored password. Keep SHA-256 for protocol compliance and, after maintainer review, dismiss narrowly as `false positive` with the RFC reference rather than changing cryptography to a password hash.

### H — Documentation assertion false-positive candidate (1 alert)

Alert: `62`.

`src/__tests__/docs.test.ts` asserts that documentation does **not** contain a prohibited hostname. It does not validate or route a URL. After maintainer review, dismiss narrowly as `false positive`, or rewrite the test to compare parsed documentation links if that improves the assertion independently.

## Open Alerts

| # | Rule | Location | Group | Planned disposition |
| ---: | --- | --- | :---: | --- |
| [3](https://github.com/ashiqrniloy/prism/security/code-scanning/3) | `js/polynomial-redos` | `packages/browser/src/targets.ts:36` | B | Linear quoted-field parser |
| [4](https://github.com/ashiqrniloy/prism/security/code-scanning/4) | `js/polynomial-redos` | `packages/coding-agent/src/coding-checkpoint.ts:272` | B | Bounded checkpoint-line parser |
| [5](https://github.com/ashiqrniloy/prism/security/code-scanning/5) | `js/polynomial-redos` | `packages/coding-agent/src/coding-checkpoint.ts:277` | B | Bounded ID/text split |
| [6](https://github.com/ashiqrniloy/prism/security/code-scanning/6) | `js/insufficient-password-hash` | `packages/credentials-node/src/oauth2.ts:19` | G | False-positive review: RFC 7636 S256 |
| [7](https://github.com/ashiqrniloy/prism/security/code-scanning/7) | `js/polynomial-redos` | `packages/server/src/conversations.ts:701` | A | Shared slash trim |
| [8](https://github.com/ashiqrniloy/prism/security/code-scanning/8) | `js/polynomial-redos` | `packages/server/src/artifacts.ts:913` | A | Shared slash trim |
| [11](https://github.com/ashiqrniloy/prism/security/code-scanning/11) | `js/polynomial-redos` | `packages/rag/src/parsers.ts:43` | B | Linear bounded PDF scanner |
| [15](https://github.com/ashiqrniloy/prism/security/code-scanning/15) | `js/polynomial-redos` | `packages/rag/src/parsers.ts:97` | B | Linear bounded PDF scanner |
| [16](https://github.com/ashiqrniloy/prism/security/code-scanning/16) | `js/polynomial-redos` | `packages/rag/src/parsers.ts:98` | B | Linear bounded PDF scanner |
| [17](https://github.com/ashiqrniloy/prism/security/code-scanning/17) | `js/incomplete-multi-character-sanitization` | `packages/rag/src/parsers.ts:75` | C | Single-pass HTML-to-text parsing |
| [18](https://github.com/ashiqrniloy/prism/security/code-scanning/18) | `js/incomplete-multi-character-sanitization` | `packages/rag/src/parsers.ts:75` | C | Single-pass HTML-to-text parsing |
| [19](https://github.com/ashiqrniloy/prism/security/code-scanning/19) | `js/polynomial-redos` | `packages/rag/src/parsers.ts:75` | B | Single-pass HTML-to-text parsing |
| [20](https://github.com/ashiqrniloy/prism/security/code-scanning/20) | `js/polynomial-redos` | `packages/rag/src/parsers.ts:95` | B | Linear bounded PDF scanner |
| [21](https://github.com/ashiqrniloy/prism/security/code-scanning/21) | `js/polynomial-redos` | `packages/rag/src/parsers.ts:96` | B | Linear bounded PDF scanner |
| [22](https://github.com/ashiqrniloy/prism/security/code-scanning/22) | `js/polynomial-redos` | `src/cache-helpers.ts:25` | D | Index/slice edge trim |
| [23](https://github.com/ashiqrniloy/prism/security/code-scanning/23) | `js/polynomial-redos` | `packages/provider-alibaba/src/models.ts:33` | A | Shared slash trim |
| [24](https://github.com/ashiqrniloy/prism/security/code-scanning/24) | `js/polynomial-redos` | `packages/provider-anthropic/src/provider.ts:36` | A | Shared slash trim |
| [25](https://github.com/ashiqrniloy/prism/security/code-scanning/25) | `js/polynomial-redos` | `packages/provider-anthropic/src/models.ts:82` | A | Shared slash trim |
| [26](https://github.com/ashiqrniloy/prism/security/code-scanning/26) | `js/polynomial-redos` | `packages/provider-azure/src/provider.ts:45` | A | Shared slash trim |
| [27](https://github.com/ashiqrniloy/prism/security/code-scanning/27) | `js/polynomial-redos` | `packages/provider-bedrock/src/provider.ts:48` | A | Shared slash trim |
| [28](https://github.com/ashiqrniloy/prism/security/code-scanning/28) | `js/polynomial-redos` | `packages/provider-google/src/provider.ts:35` | A | Shared slash trim |
| [29](https://github.com/ashiqrniloy/prism/security/code-scanning/29) | `js/polynomial-redos` | `packages/provider-google/src/models.ts:76` | A | Shared slash trim |
| [30](https://github.com/ashiqrniloy/prism/security/code-scanning/30) | `js/polynomial-redos` | `packages/provider-kimi/src/moonshot.ts:32` | A | Shared slash trim |
| [31](https://github.com/ashiqrniloy/prism/security/code-scanning/31) | `js/polynomial-redos` | `packages/provider-kimi/src/models.ts:72` | A | Shared slash trim |
| [32](https://github.com/ashiqrniloy/prism/security/code-scanning/32) | `js/polynomial-redos` | `packages/provider-kimi/src/provider.ts:58` | A | Shared slash trim |
| [33](https://github.com/ashiqrniloy/prism/security/code-scanning/33) | `js/polynomial-redos` | `packages/provider-neuralwatt/src/quota.ts:74` | A | Shared slash trim |
| [34](https://github.com/ashiqrniloy/prism/security/code-scanning/34) | `js/polynomial-redos` | `packages/provider-neuralwatt/src/models.ts:80` | A | Shared slash trim |
| [35](https://github.com/ashiqrniloy/prism/security/code-scanning/35) | `js/polynomial-redos` | `packages/provider-neuralwatt/src/provider.ts:37` | A | Shared slash trim |
| [36](https://github.com/ashiqrniloy/prism/security/code-scanning/36) | `js/polynomial-redos` | `packages/provider-ollama/src/models.ts:27` | A | Shared slash trim |
| [37](https://github.com/ashiqrniloy/prism/security/code-scanning/37) | `js/polynomial-redos` | `packages/provider-openai/src/models.ts:69` | A | Shared slash trim |
| [38](https://github.com/ashiqrniloy/prism/security/code-scanning/38) | `js/polynomial-redos` | `packages/provider-openai/src/realtime.ts:175` | A | Shared slash trim |
| [39](https://github.com/ashiqrniloy/prism/security/code-scanning/39) | `js/polynomial-redos` | `packages/provider-openai/src/uploads.ts:33` | A | Shared slash trim |
| [40](https://github.com/ashiqrniloy/prism/security/code-scanning/40) | `js/polynomial-redos` | `packages/provider-openai/src/responses.ts:115` | A | Shared slash trim |
| [41](https://github.com/ashiqrniloy/prism/security/code-scanning/41) | `js/polynomial-redos` | `packages/provider-opencode-go/src/provider.ts:19` | A | Shared slash trim |
| [42](https://github.com/ashiqrniloy/prism/security/code-scanning/42) | `js/polynomial-redos` | `packages/provider-opencode-go/src/models.ts:108` | A | Shared slash trim |
| [43](https://github.com/ashiqrniloy/prism/security/code-scanning/43) | `js/polynomial-redos` | `packages/provider-openrouter/src/provider.ts:29` | A | Shared slash trim |
| [44](https://github.com/ashiqrniloy/prism/security/code-scanning/44) | `js/polynomial-redos` | `packages/provider-openrouter/src/models.ts:72` | A | Shared slash trim |
| [45](https://github.com/ashiqrniloy/prism/security/code-scanning/45) | `js/polynomial-redos` | `packages/provider-vertex/src/provider.ts:37` | A | Shared slash trim |
| [46](https://github.com/ashiqrniloy/prism/security/code-scanning/46) | `js/polynomial-redos` | `packages/provider-zai/src/provider.ts:20` | A | Shared slash trim |
| [47](https://github.com/ashiqrniloy/prism/security/code-scanning/47) | `js/polynomial-redos` | `packages/provider-zai/src/models.ts:82` | A | Shared slash trim |
| [48](https://github.com/ashiqrniloy/prism/security/code-scanning/48) | `js/polynomial-redos` | `packages/server/src/health.ts:121` | A | Shared slash trim |
| [49](https://github.com/ashiqrniloy/prism/security/code-scanning/49) | `js/polynomial-redos` | `packages/server/src/replay.ts:105` | A | Shared slash trim |
| [50](https://github.com/ashiqrniloy/prism/security/code-scanning/50) | `js/polynomial-redos` | `src/providers/openai-compatible.ts:177` | A | Shared slash trim |
| [51](https://github.com/ashiqrniloy/prism/security/code-scanning/51) | `js/polynomial-redos` | `packages/server/src/handler/routing.ts:93` | A | Shared slash trim |
| [52](https://github.com/ashiqrniloy/prism/security/code-scanning/52) | `js/insecure-randomness` | `scripts/fixtures/phase26-coding-journey.mjs:326` | E | `node:crypto` suffix |
| [53](https://github.com/ashiqrniloy/prism/security/code-scanning/53) | `js/insecure-randomness` | `scripts/fixtures/phase26-coding-journey.mjs:435` | E | `node:crypto` suffix |
| [54](https://github.com/ashiqrniloy/prism/security/code-scanning/54) | `js/insecure-randomness` | `scripts/fixtures/phase26-coding-journey.mjs:619` | E | `node:crypto` suffix |
| [55](https://github.com/ashiqrniloy/prism/security/code-scanning/55) | `js/insecure-randomness` | `scripts/fixtures/phase26-coding-journey.mjs:707` | E | `node:crypto` suffix |
| [56](https://github.com/ashiqrniloy/prism/security/code-scanning/56) | `js/clear-text-logging` | `scripts/phase27-dr.test.mjs:836` | F | Redacted/fixed diagnostic |
| [57](https://github.com/ashiqrniloy/prism/security/code-scanning/57) | `js/polynomial-redos` | `packages/provider-clinepass/src/provider.ts:20` | A | Shared slash trim |
| [58](https://github.com/ashiqrniloy/prism/security/code-scanning/58) | `js/polynomial-redos` | `packages/provider-deepseek/src/models.ts:60` | A | Shared slash trim |
| [59](https://github.com/ashiqrniloy/prism/security/code-scanning/59) | `js/polynomial-redos` | `packages/provider-deepseek/src/provider.ts:20` | A | Shared slash trim |
| [60](https://github.com/ashiqrniloy/prism/security/code-scanning/60) | `js/polynomial-redos` | `packages/provider-xai/src/models.ts:69` | A | Shared slash trim |
| [61](https://github.com/ashiqrniloy/prism/security/code-scanning/61) | `js/polynomial-redos` | `packages/provider-xai/src/provider.ts:21` | A | Shared slash trim |
| [62](https://github.com/ashiqrniloy/prism/security/code-scanning/62) | `js/incomplete-url-substring-sanitization` | `src/__tests__/docs.test.ts:3619` | H | False-positive review: negative docs assertion |
| [63](https://github.com/ashiqrniloy/prism/security/code-scanning/63) | `js/polynomial-redos` | `packages/prism-wiki/src/profiles/pkm.ts:21` | B | Prefix/index heading parser |
| [64](https://github.com/ashiqrniloy/prism/security/code-scanning/64) | `js/polynomial-redos` | `packages/prism-wiki/src/search/context7-hydrator.ts:33` | B | Prefix/index heading parser |
| [65](https://github.com/ashiqrniloy/prism/security/code-scanning/65) | `js/polynomial-redos` | `packages/prism-wiki/src/search/context7-hydrator.ts:36` | B | Prefix/index heading parser |
| [66](https://github.com/ashiqrniloy/prism/security/code-scanning/66) | `js/polynomial-redos` | `packages/prism-wiki/src/skills.ts:35` | B | Line/frontmatter parser |

## Previously Fixed Alerts

| # | Rule | Historical location | Fixed at |
| ---: | --- | --- | --- |
| 1 | `js/polynomial-redos` | `packages/server/src/handler.ts:819` | 2026-08-15 |
| 2 | `js/polynomial-redos` | `src/cache-helpers.ts:25` | 2026-07-27 |
| 9 | `js/incomplete-multi-character-sanitization` | `packages/rag/src/parsers.ts:72` | 2026-07-27 |
| 10 | `js/incomplete-multi-character-sanitization` | `packages/rag/src/parsers.ts:72` | 2026-07-27 |
| 12 | `js/polynomial-redos` | `packages/rag/src/parsers.ts:72` | 2026-07-27 |
| 13 | `js/polynomial-redos` | `packages/rag/src/parsers.ts:91` | 2026-07-27 |
| 14 | `js/polynomial-redos` | `packages/rag/src/parsers.ts:91` | 2026-07-27 |

Alerts `2`, `9`, `10`, `12`, `13`, and `14` were fixed on an earlier revision, but equivalent current paths now have open alerts `22` and `17`–`21`. Regression tests must prevent another reintroduction.

## Verification

- Flattened open-page count: `59`.
- Unique open alert numbers: `59`.
- Rule-count sum: `59`.
- All open instances use `refs/heads/main`.
- All open instances use commit `c600eaa18f65b56764ec2fb408ec813536eff6f7`.
- Local HEAD matched that commit during snapshot.
- No token or raw API response is stored in this file.

## Scope Note

The GitHub CodeQL ledger is distinct from local `scripts/lint-report.sarif`. Findings previously observed only in local SARIF are not represented as GitHub CodeQL alerts unless uploaded by the configured CodeQL workflow; they remain remediation inputs in Plan 038 but must not be counted among these 59 GitHub alerts.
