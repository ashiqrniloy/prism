# Current CodeQL and dependency-security ledger — 2026-09-03

## Snapshot

- Repository: `ashiqrniloy/prism`
- Branch/commit analyzed by GitHub: `main` / `0166bf53c9dc7fc047b840615b04f02e502c27d4`
- GitHub CodeQL open alerts: **28**
- Severity: **21 high**, **7 medium**
- Local `npm audit` after dependency updates: **0 vulnerabilities**
- Dependabot alerts API: unavailable because Dependabot alerts are disabled for this repository.

CodeQL rule totals:

| Rule | Open |
|---|---:|
| `js/file-system-race` | 8 |
| `js/insecure-temporary-file` | 5 |
| `js/incomplete-url-substring-sanitization` | 3 |
| `js/polynomial-redos` | 3 |
| `js/remote-property-injection` | 2 |
| `js/prototype-polluting-assignment` | 2 |
| `js/stack-trace-exposure` | 2 |
| `js/regex/missing-regexp-anchor` | 1 |
| `js/insufficient-password-hash` | 1 |
| `js/clear-text-logging` | 1 |

## Prioritized disposition

### P0 — production true positives

1. **Prototype-polluting assignment — alerts 91–92**  
   `packages/office/src/documents/patch.ts:149,171`. Reject `__proto__`, `prototype`, and `constructor` path segments before dynamic assignment. Post-patch schema validation is too late because mutation has already happened.
2. **Polynomial regexes — alerts 84–86**  
   `packages/office/src/sheets/decimal.ts:36,90,92`. Replace decimal/currency regex parsing with bounded index scans or prove and enforce a small input cap before matching.
3. **Filesystem TOCTOU — alerts 95–96**  
   `packages/prism-coding-tools/src/agent/effects.ts:57`; `packages/web-tools/src/browser/uploads.ts:121`. Avoid check-then-use path operations; open once, operate through descriptor/handle, and verify identity with `fstat` where possible.
4. **Stack/error exposure — alerts 87–88**  
   `packages/prism-coding-tools/src/dev/index.ts:318`; `packages/prism-coding-tools/src/dev/server.ts:152`. Fixed locally in this review by returning a constant external 500 message.

### P1 — executable CI/tooling paths

- **Insecure temporary files — 81–83**: coding-journey and DR scripts must use `mkdtemp`/exclusive create plus `try/finally` cleanup.
- **Filesystem races — 72–74**: restart-recovery test, secret scanner, and build lock need atomic create/rename or descriptor-based operations. `scripts/with-build-lock.mjs` is especially important because it guards builds.
- **Clear-text logging — 67**: DR script must emit fixed/redacted diagnostics only.
- **Vendored executable fixture race — 94**: `ponytail-activate.js` ships as upstream fixture; update vendored source or stop shipping/executing it.

### P2 — test-only alerts and reviewed false positives

- Test-only findings: 75, 97–101. All five hardened locally (no dismissals needed): anchor at `web.test.ts:86`, null-prototype objects in the fake-S3 signer (`artifact-bodies.test.ts:48,61`), exclusive `mkdtemp` dirs in `delete-move.test.ts:98,157` (+ the third instance at 258); alert 75 was fixed earlier with `withFileTypes` in `provider-transport.test.ts:191`. Alerts close after push and CodeQL re-analysis.
- **93 (`insufficient-password-hash`)** is RFC 7636 PKCE S256, not password storage. **Dismissed 2026-09-03** (reason: false positive): "RFC 7636 (PKCE) S256 code challenge: base64url(SHA-256(verifier)) is deliberately a one-shot, unsalted challenge hash, not password storage. Changing the algorithm breaks OAuth2 PKCE."
- **89–90 (`incomplete-url-substring-sanitization`)** are Visio-format rejection checks, not URL sanitization or routing. **Dismissed 2026-09-03** (reason: false positive): "Visio-format rejection check in drawio validation: substring match against file header/content to exclude .vsd/.vsdx inputs. Not a URL sanitization or routing decision; no security boundary."
- **62 (`incomplete-url-substring-sanitization`)** is a negative documentation assertion. **Dismissed 2026-09-03** (reason: used in tests): "Negative documentation assertion: fails unless docs/index.md text excludes cli-chat-proxy.grok.com. Asserts documentation content, not URL processing."
- **68 (`file-system-race`)** was in `packages/antigravity-agent`; package is deleted locally. Alert closes after push and CodeQL re-analysis.

## Complete open-alert snapshot

| # | Severity | Rule | Location |
|---:|---|---|---|
| 101 | ~~high~~ | `js/insecure-temporary-file` | `packages/prism-coding-tools/src/agent/__tests__/delete-move.test.ts:157` — hardened (mkdtemp) |
| 100 | ~~high~~ | `js/insecure-temporary-file` | `packages/prism-coding-tools/src/agent/__tests__/delete-move.test.ts:98` — hardened (mkdtemp) |
| 99 | ~~high~~ | `js/remote-property-injection` | `packages/prism-core/src/runtime/server/__tests__/artifact-bodies.test.ts:61` — hardened (null-proto headers) |
| 98 | ~~high~~ | `js/remote-property-injection` | `packages/prism-core/src/runtime/server/__tests__/artifact-bodies.test.ts:48` — hardened (null-proto query) |
| 97 | ~~high~~ | `js/regex/missing-regexp-anchor` | `packages/web-tools/src/obscura/__tests__/web.test.ts:86` — hardened (`$` anchor) |
| 96 | high | `js/file-system-race` | `packages/web-tools/src/browser/uploads.ts:121` |
| 95 | high | `js/file-system-race` | `packages/prism-coding-tools/src/agent/effects.ts:57` |
| 94 | high | `js/file-system-race` | `packages/prism-coding-tools/fixtures/ponytail/upstream-full/hooks/ponytail-activate.js:57` |
| 93 | ~~high~~ | `js/insufficient-password-hash` | `packages/prism-core/src/credentials/node/oauth2.ts:19` — dismissed 2026-09-03 (false positive) |
| 92 | medium | `js/prototype-polluting-assignment` | `packages/office/src/documents/patch.ts:171` |
| 91 | medium | `js/prototype-polluting-assignment` | `packages/office/src/documents/patch.ts:149` |
| 90 | ~~high~~ | `js/incomplete-url-substring-sanitization` | `packages/office/src/diagrams/xml.ts:54` — dismissed 2026-09-03 (false positive) |
| 89 | ~~high~~ | `js/incomplete-url-substring-sanitization` | `packages/office/src/diagrams/xml.ts:53` — dismissed 2026-09-03 (false positive) |
| 88 | medium | `js/stack-trace-exposure` | `packages/prism-coding-tools/src/dev/server.ts:152` |
| 87 | medium | `js/stack-trace-exposure` | `packages/prism-coding-tools/src/dev/index.ts:318` |
| 86 | high | `js/polynomial-redos` | `packages/office/src/sheets/decimal.ts:92` |
| 85 | high | `js/polynomial-redos` | `packages/office/src/sheets/decimal.ts:90` |
| 84 | high | `js/polynomial-redos` | `packages/office/src/sheets/decimal.ts:36` |
| 83 | high | `js/insecure-temporary-file` | `scripts/phase27-dr.test.mjs:116` |
| 82 | high | `js/insecure-temporary-file` | `scripts/fixtures/phase26-coding-journey.mjs:903` |
| 81 | high | `js/insecure-temporary-file` | `scripts/fixtures/phase26-coding-journey.mjs:236` |
| 75 | high | `js/file-system-race` | `src/__tests__/provider-transport.test.ts:191` |
| 74 | high | `js/file-system-race` | `scripts/with-build-lock.mjs:70` |
| 73 | high | `js/file-system-race` | `scripts/scan-secrets.mjs:37` |
| 72 | high | `js/file-system-race` | `scripts/phase12-restart-recovery.test.mjs:258` |
| 68 | high | `js/file-system-race` | deleted `packages/antigravity-agent/src/agent-file.ts:126` |
| 67 | high | `js/clear-text-logging` | `scripts/phase27-dr.test.mjs:838` |
| 62 | ~~high~~ | `js/incomplete-url-substring-sanitization` | `src/__tests__/docs.test.ts:3718` — dismissed 2026-09-03 (used in tests) |

## Dependency remediation performed

- `fast-xml-parser` `4.5.0` → `5.11.1`; clears critical entity-expansion/entity-name injection findings.
- Transitive `fast-uri` and `qs` updated by `npm audit fix`; clears high SSRF/host-confusion and moderate DoS findings.
- Office Open packages `0.12.3` → `0.13.1`.
- `@ag-ui/core` / `@ag-ui/client` `0.0.57` → `0.0.59`.
- `@ai-sdk/provider` `4.0.4` → `4.0.10`.
- `@biomejs/biome` `2.5.5` → `2.5.11`.
- Graft peer/tool `0.13.0` → `0.16.0`.

Deferred majors need migration work rather than blind updates: `@napi-rs/keyring` 2, `better-sqlite3` 13, `pdf-parse` 2, and associated type packages.
