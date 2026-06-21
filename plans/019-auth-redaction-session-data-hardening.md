# Phase 16 — Auth, Redaction, and Session-Data Hardening

## Objectives
- Make OpenAI Codex OAuth cryptographically correct (PKCE S256, CSPRNG verifier, scopes/redirect) or remove it from stable docs.
- Make secret redaction crash-proof on cyclic and non-plain-JSON object graphs across events, errors, prompts, tool results, and session metadata.
- Make JSONL session loading fail closed on corrupt entries without poisoning an entire session branch.
- Prevent callers from mutating persisted session state through in-memory store read results.
- Close symlink/realpath escape paths in Node filesystem path trust without adding deeper sandboxing to core.
- Keep every live provider/worker test opt-in behind explicit environment variables and network-free by default.

## Expected Outcome
- A mocked Codex OAuth login produces an RFC 7636 PKCE verifier and a base64url(SHA-256(verifier)) challenge with `code_challenge_method=S256`; API-key vs Codex-subscription base URLs are distinct, documented options.
- Redaction completes on self-referential objects, `Map`/`Set`/`Date`/`RegExp`/typed-array values, and `error.cause` loops without throwing, and still replaces known secrets in strings.
- A JSONL file with one malformed line yields usable entries plus a structured parse error instead of throwing for the whole file; invalid `message`/`summary`/`parentId`/`model`/custom `data` shapes are rejected per line.
- `createMemorySessionStore().list()` and `.get()` return deep-enough copies so caller mutation does not affect subsequent reads or persisted state.
- `isPathInside`/`createPathTrustPolicy` reject targets whose realpath escapes a trusted root through a symlink; lexical behavior remains available for non-filesystem contexts.
- Default `node:test` runs touch no network; every live smoke test is gated by a `PRISM_LIVE_*` env var and a workspace-level guard proves it.

## Tasks

- [x] Inventory auth/redaction/session/trust surface and lock the hardening scope
  - Acceptance Criteria:
    - Functional: Inventory current Codex OAuth (`packages/provider-openai/src/oauth.ts`, `codex.ts`), redaction (`src/redaction.ts`, callers in `agents.ts`, `compaction.ts`, `middleware.ts`, `provider-events.ts`, `providers/openai-compatible.ts`, `rpc.ts`, `tools.ts`), JSONL parsing (`src/node/session-store-jsonl.ts`), in-memory store (`src/session-stores.ts`), Node path trust (`src/node/trust.ts`, `src/security.ts`), and every `PRISM_LIVE_*` test gate. Record the exact defects and the minimal fix per file.
    - Performance: Review adds no runtime code, dependency, provider SDK, worker, queue, tokenizer, filesystem scan, or live network test.
    - Code Quality: The decision states which fixes stay core-local vs package-local, whether any public signature changes (and the migration note if so), and which helpers (if any) become public on `prism/testing`.
    - Security: The inventory preserves explicit credential boundaries, fake-only fixtures, redacted provider errors, no hidden provider/credential globals, and network-free default tests.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 16 deliverables, acceptance criteria, and non-negotiable boundaries.
      - `.agents/skills/create-plan/references/prism-wiki.md`; no `.agents/skills/project-patterns/` directory and no `.agents/skills/create-plan/references/wiki-task.md`; `.agents/skills/project-wiki/` is empty so no separate final code-wiki task is added (per-task `Documentation/Wiki Assessment` covers wiki updates).
      - `docs/credentials-and-redaction.md`, `docs/settings-auth-trust-security.md`, `docs/node-jsonl-session-store.md`, `docs/session-stores-and-branching.md`, `docs/resource-loading.md`, and `docs/providers/openai.md`.
      - `src/redaction.ts`, `src/session-stores.ts`, `src/node/session-store-jsonl.ts`, `src/node/trust.ts`, `src/security.ts`, `src/resources.ts`, `src/contracts.ts` (`SessionEntry`, `Message`, `ResourceLoader`, `OAuthProvider`, `OAuthCredentials`).
      - `packages/provider-openai/src/oauth.ts`, `packages/provider-openai/src/codex.ts`, `packages/provider-openai/src/__tests__/codex-oauth.test.ts`.
      - Live-test gates in `packages/provider-*/src/__tests__/live.test.ts`, `packages/compaction-llm/src/__tests__/live.test.ts`, `packages/compaction-observational-memory/src/__tests__/live.test.ts`.
      - External docs consulted via `code_search`: RFC 7636 PKCE S256 challenge derivation; Node `crypto.randomBytes`/`webcrypto.subtle.digest`; Node `fs.realpath` semantics.
    - Options Considered:
      - Harden incrementally per file vs lock scope first. Locking scope first prevents mid-phase drift across five unrelated files.
    - Chosen Approach:
      - Produce a short inventory in the task body (or this plan's Compromises section once executed) naming each defect and its fix file, then implement the remaining tasks unchanged.
    - Confirmed Findings (locked scope, 2026-06-21):
      - **OAuth (`packages/provider-openai/src/oauth.ts`):** `randomString()` uses `Math.random().toString(36)` for the PKCE verifier; the verifier is reused directly as `code_challenge` (no S256, no `code_challenge_method`); authorize URL omits `redirect_uri` and `scope`; device-code POST body omits `scope`; error redaction is local to the file (duplicates core logic). Confirmed defect.
      - **Codex base URL (`packages/provider-openai/src/codex.ts`):** `createOpenAICodexProvider` defaults `baseUrl` to `https://api.openai.com/v1` and inherits the package-level `baseUrl` from `createOpenAIProviderPackage`, so a Codex-subscription OAuth token and a plain API key hit the same base URL with no distinct Codex endpoint option. Confirmed defect.
      - **Redaction (`src/redaction.ts`):** `redact()` recurses through objects/arrays with no `WeakSet` seen-set, so cyclic graphs (self/mutual refs, `error.cause` loops) blow the stack; `Map`/`Set`/`Date`/`RegExp`/typed arrays are not handled and `Object.fromEntries` will throw or drop them; `errorToErrorInfo` reads `error.cause` via `String(...)` only, so a cyclic cause object survives but a cyclic string-built path would not. Confirmed defect.
      - **JSONL parsing (`src/node/session-store-jsonl.ts`):** `isSessionEntry` checks only `id`/`sessionId`/`timestamp`/`kind` are strings; per-kind shape (`message`, `summary`, `model_change`, custom `data`) is unchecked; `readEntries` throws on the first bad line via `parseEntry`, poisoning the whole file. Confirmed defect. Correction: the kind is `model_change` (not `model`) — downstream task 4 updated accordingly.
      - **In-memory store (`src/session-stores.ts`):** `createMemorySessionStore().list()` returns the live `bySession` array entries and `.get()` returns the live `byId` reference, so callers can mutate persisted history/summaries/custom data. `getSessionBranchEntries`/`rebuildSessionContext` return fresh arrays but alias the same entry objects. Confirmed defect.
      - **Path trust (`src/node/trust.ts`):** `isPathInside`/`createPathTrustPolicy` use lexical `resolve()` only; symlink targets escaping a trusted root pass. `TrustPolicy.check` already permits `Promise<TrustDecision>`, so making `createPathTrustPolicy.check` async is signature-safe. Confirmed defect.
      - **Live test gating:** every first-party provider package plus `compaction-llm` and `compaction-observational-memory` already gates its `live.test.ts` behind a `PRISM_LIVE_*` env var (`PRISM_LIVE_PROVIDER_TESTS`, `PRISM_LIVE_COMPACTION_TESTS`, `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS`). No workspace-level guard test asserts the gate is always present and that no non-live test does real network. Confirmed gap (not a code defect).
      - **Public API impact:** redaction (`createSecretRedactor`, `redactSecrets`, helpers) and security exports are stable and need no signature change; JSONL gains an additive `SessionEntryParseError`/read-result type; `isPathInsideReal` is additive; Codex OAuth options gain optional `scope`/`redirectUri`/`codexBaseUrl`. All changes are backward-compatible additions.
      - **Decisions:** all fixes stay in their own files (no new shared module, no new dependency). No helpers are promoted to `prism/testing` in this phase. The browser OAuth surface is fixed in place, not removed.
    - API Notes and Examples:
      ```text
      Confirmed defect map (see Confirmed Findings for evidence):
        oauth.ts      -> Math.random verifier; verifier reused as challenge; no scope/redirect
        codex.ts      -> Codex token and plain API key share one base URL; no distinct option
        redaction.ts  -> recursive redact() with no cycle/Map/Set/Date/RegExp handling
        session-store-jsonl.ts -> isSessionEntry checks 4 fields; one bad line throws for whole file
        session-stores.ts      -> list()/get() return live internal references
        trust.ts      -> lexical resolve() only; symlink escapes pass
        live gates    -> present per package; no workspace-level guard test
      ```
    - Files to Create/Edit:
      - `plans/019-auth-redaction-session-data-hardening.md`: confirm scope and defect map.
    - References:
      - `plans/018-provider-runtime-correctness-hardening.md` (precedent for inventory-first hardening task).
      - `plans/013-settings-auth-trust-security.md`, `plans/015-real-provider-packages.md` (auth/redaction origin).

  - Test Cases to Write:
    - No code tests; inventory correctness is verified by the subsequent tasks landing against the listed files only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — inventory only.
    - Docs pages to create/edit: `none` — no behavior change in this task.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Make Codex OAuth cryptographically correct and split API vs Codex base URLs
  - Acceptance Criteria:
    - Functional: Browser PKCE login generates a CSPRNG verifier of 43–128 chars from the RFC 7636 unreserved set, sends `code_challenge_method=S256` with a base64url(SHA-256(verifier)) challenge that is not equal to the verifier, includes `redirect_uri` and `scope` on the authorize URL when supplied, and exchanges the code with the original verifier. Device-code login sends `scope` when supplied. `createOpenAICodexProvider` exposes distinct API-key (`https://api.openai.com/v1`) and Codex-subscription base URL options and never blurs them into one default.
    - Performance: OAuth adds no new runtime dependency; hashing uses Node/web `crypto` already available. No live network in tests.
    - Code Quality: PKCE helpers are pure and unit-testable without `fetch`; `Math.random` is removed from the OAuth path; types stay backward-compatible (new options are optional).
    - Security: Verifier/challenge come from `crypto.getRandomValues`/`crypto.randomBytes`; tokens are never logged; error messages redact `access`/`refresh` values; mocked `fetch`/callbacks only in tests.
  - Approach:
    - Documentation Reviewed:
      - RFC 7636 §4.2 (verifier charset and length), §4.2 + §B (S256 `code_challenge = base64url(sha256(verifier))`).
      - `packages/provider-openai/src/oauth.ts`, `packages/provider-openai/src/codex.ts`, `packages/provider-openai/src/index.ts`.
      - `src/contracts.ts` `OAuthProvider`, `OAuthCredentials`, `OAuthLoginCallbacks`.
      - `code_search`: Node `crypto.randomBytes`, Web `SubtleCrypto.digest` with `"SHA-256"`, base64url encoding.
    - Options Considered:
      - Keep verifier-as-challenge (plain) method: rejected — non-compliant and the explicit Phase 16 ask is cryptographically secure PKCE.
      - Remove the browser OAuth surface entirely and keep only device-code: viable fallback only if PKCE cannot be made compliant; default is to fix it.
    - Chosen Approach:
      - Add `createPkceVerifier()` (CSPRNG, 43–128 chars, unreserved set) and `computeS256Challenge(verifier)` (base64url of SHA-256). Authorize URL carries `code_challenge`, `code_challenge_method=S256`, optional `redirect_uri`, optional `scope`. Device-code body carries optional `scope`. Token request keeps the verifier for `authorization_code` and is unchanged for `device_code`/`refresh_token`.
      - In `codex.ts`, split options into an explicit API-key base URL default and a Codex-subscription base URL option (e.g. `codexBaseUrl`), both documented, so callers cannot accidentally send Codex OAuth tokens to the plain API base URL.
    - API Notes and Examples:
      ```ts
      import { createHash, randomBytes } from "node:crypto";

      const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
      export function createPkceVerifier(bytes = 32): string {
        const buf = randomBytes(bytes);
        let out = "";
        for (let i = 0; i < bytes; i++) out += UNRESERVED[buf[i] % UNRESERVED.length];
        return out; // 32 chars, within 43–128
      }
      export function computeS256Challenge(verifier: string): string {
        return createHash("sha256").update(verifier).digest("base64url");
      }
      // authorize url:
      // ...&code_challenge=${computeS256Challenge(verifier)}&code_challenge_method=S256&redirect_uri=...&scope=...
      ```
    - Files to Create/Edit:
      - `packages/provider-openai/src/oauth.ts`: CSPRNG verifier, S256 challenge, `redirect_uri`/`scope`, redaction on errors.
      - `packages/provider-openai/src/codex.ts`: split API-key vs Codex-subscription base URL options.
      - `packages/provider-openai/src/__tests__/codex-oauth.test.ts`: assert S256 challenge, challenge != verifier, `code_challenge_method=S256`, scope/redirect propagation, and that refresh errors still redact.
      - `packages/provider-openai/src/index.ts`: export PKCE helpers; add `codexBaseUrl`; stop sharing `baseUrl` with the Codex provider.
      - `docs/providers/openai.md`: document PKCE S256, `scope`/`redirectUri`, and split base URLs.
    - Implementation Notes (2026-06-21):
      - PKCE helpers use `node:crypto` (`randomBytes(32).toString("base64url")` → 43-char verifier; `createHash("sha256").digest("base64url")` → S256 challenge). base64url charset is a subset of the RFC 7636 unreserved set, so compliant.
      - `createOpenAICodexProvider` default `baseUrl` changed from `https://api.openai.com/v1` to `https://chatgpt.com/backend-api/codex` (Codex subscription Responses backend). `createOpenAIProviderPackage` now wires `baseUrl` (API-key) and `codexBaseUrl` (Codex) to the two providers separately instead of sharing one `baseUrl`.
      - `createPkceVerifier`/`computeS256Challenge` exported from the package for direct unit testing.
      - Removed the old `Math.random()`-based `randomString`.
      - All 6 codex-oauth tests pass; full provider-openai suite 13 pass / 1 skipped (live); root + workspace totals 375 pass / 0 fail (node:test tallies).
    - References:
      - RFC 7636.
      - `packages/provider-openai/src/oauth.ts` (current `randomString` and `redact`).
      - `docs/providers/openai.md`.

  - Test Cases to Write:
    - `codex_oauth_browser_uses_s256_pkce_challenge`: challenge is base64url, 43 chars, equals `base64url(sha256(verifier))`, and verifier is sent to the token endpoint.
    - `codex_oauth_authorize_url_includes_redirect_and_scope`: when options/callbacks supply them, they appear on the authorize URL.
    - `codex_oauth_device_code_includes_scope_when_supplied`: device-code POST body and/or verification flow honors `scope`.
    - `codex_oauth_verifier_is_cryptographically_random`: two consecutive verifiers differ and match the unreserved charset.
    - `codex_provider_separates_api_and_codex_base_urls`: API-key default and Codex-subscription option resolve to distinct URLs.
    - `codex_oauth_refresh_redacts_tokens_from_errors`: existing regression stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — provider options gain `codexBaseUrl`/`scope`/`redirectUri`; PKCE behavior changes.
    - Docs pages to create/edit:
      - `docs/providers/openai.md`: document PKCE S256 flow, `scope`/`redirectUri` options, and API-key vs Codex-subscription base URL choice under the standard API-page headings.
    - `docs/index.md` update: no new page, but verify the `providers/openai.md` link description still fits.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Make redaction cycle-safe and JSON-shape preserving
  - Acceptance Criteria:
    - Functional: `redactSecrets` and the `SecretRedactor` returned by `createSecretRedactor` complete without throwing on cyclic object graphs (self-referential objects, mutual references, `error.cause` loops), on `Map`, `Set`, `Date`, `RegExp`, `ArrayBuffer`/typed arrays, and on objects with non-string keyed properties. Strings containing a known secret are still replaced with `[REDACTED]`. `errorToErrorInfo` remains robust when `error.cause` is cyclic.
    - Performance: Redaction runs in linear time per unique object visited; cycle tracking uses a `WeakSet` so no unbounded growth and no leak of the traversed graph.
    - Code Quality: Redaction never mutates input; output preserves plain-object/array/string JSON shape (non-JSON values like `Map`/`Date` are rendered to a safe JSON-compatible representation or passed through unchanged in a documented, deterministic way). No new dependency.
    - Security: A secret inside a nested string in a cyclic graph is still redacted; redaction cannot be bypassed by hiding a secret behind a self-reference.
  - Approach:
    - Documentation Reviewed:
      - `src/redaction.ts`, callers in `src/agents.ts`, `src/compaction.ts`, `src/middleware.ts`, `src/provider-events.ts`, `src/providers/openai-compatible.ts`, `src/rpc.ts`, `src/tools.ts`, and `packages/compaction-observational-memory/src/serialize.ts`, `packages/compaction-llm/src/serialize.ts`.
      - MDN / Node docs via `code_search`: `WeakSet` for visited-object tracking; structured-clone vs JSON round-trip tradeoffs for cycle handling.
    - Options Considered:
      - `JSON.parse(JSON.stringify(value))` to strip cycles up front: rejected — drops `Date`/`Map`/`Set`, throws on cycles instead of redacting them, and silently loses secrets-bearing non-serializable branches.
      - `structuredClone`: rejected for redaction traversal — throws on cycles too; useful only for defensive copies elsewhere.
      - Recursive walk with a `WeakSet` seen-set: chosen — minimal, dependency-free, preserves JSON shape, and lets us still replace secrets in strings.
    - Chosen Approach:
      - Thread a `seen: WeakSet<object>` through the recursive `redact`. On encountering an already-seen object, return a stable placeholder (e.g. `"[Circular]"`) so output stays JSON-compatible. Handle `Map`/`Set` by converting to plain object/array (or returning `"[Object]"` if non-JSON-convertible), handle `Date`/`RegExp` by keeping the value as-is (they are not strings and carry no secret), and treat `ArrayBuffer`/typed arrays as non-string primitives. Keep the existing string-replacement path unchanged.
    - API Notes and Examples:
      ```ts
      const redact = (input: unknown, seen = new WeakSet<object>()): unknown => {
        if (typeof input === "string") return redactString(input);
        if (input === null || typeof input !== "object") return input;
        if (seen.has(input as object)) return "[Circular]";
        seen.add(input as object);
        if (input instanceof Date || input instanceof RegExp) return input;
        if (input instanceof Map) return Object.fromEntries([...input].map(([k, v]) => [k, redact(v, seen)]));
        if (input instanceof Set) return [...input].map((v) => redact(v, seen));
        if (Array.isArray(input)) return input.map((v) => redact(v, seen));
        return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, redact(v, seen)]));
      };
      ```
    - Files to Create/Edit:
      - `src/redaction.ts`: add `WeakSet` cycle tracking and non-plain-object handling to `redactSecrets`; keep public helpers and signatures unchanged.
      - `src/__tests__/credentials-redaction.test.ts` and `src/__tests__/runtime-redaction.test.ts`: add cyclic-graph, `Map`/`Set`/`Date`/`RegExp`, and cyclic-`cause` cases.
      - `docs/credentials-and-redaction.md`: add the cycle/non-JSON handling note under Security and performance notes.
    - Implementation Notes (2026-06-21):
      - `redact()` now threads a `WeakSet<object>` `seen` set. On re-encountering a visited object it returns `"[Circular]"`. Leaves (`Date`, `RegExp`, `ArrayBuffer`, typed arrays via `ArrayBuffer.isView`) are passed through unchanged and not tracked, so repeated leaves render normally. `Map` → plain object (`Object.fromEntries`), `Set` → array, preserving JSON shape.
      - No public signature changes; output for plain objects/arrays/strings is identical to before (same `Object.fromEntries`/`.map` path). Output is always a fresh tree — input is never mutated.
      - `errorToErrorInfo` needed no code change: it already renders `cause` via `String()`, which does not recurse, so cyclic `Error.cause` was already crash-safe. Added a test to lock that behavior.
      - Added 5 unit cases to `credentials-redaction.test.ts` and 1 integration case to `runtime-redaction.test.ts` (exercises `createSecretRedactor`, the runtime-facing factory). 381 pass / 0 fail / 6 skipped (live gates) across core + 7 workspaces.
    - References:
      - `src/redaction.ts` (current `redact` recursion).
      - `docs/credentials-and-redaction.md`.

  - Test Cases to Write:
    - `redact_handles_self_referential_object`: a `tool_result` payload with `a.self = a` redacts a nested secret and returns `"[Circular]"` at the back-reference.
    - `redact_handles_mutual_and_cause_cycles`: mutual refs and an `Error` with `cause` pointing back to itself do not throw.
    - `redact_handles_map_set_date_regexp`: values of those types do not crash and any string secret inside a `Map` value is redacted.
    - `redact_does_not_mutate_input`: input graph is structurally unchanged after redaction.
    - `error_to_error_info_handles_cyclic_cause`: `errorToErrorInfo` returns a usable `ErrorInfo` when `error.cause` is cyclic.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — redaction now defines documented behavior on cyclic/non-JSON values (observable to callers that previously crashed).
    - Docs pages to create/edit:
      - `docs/credentials-and-redaction.md`: add a "Cycle and non-JSON value handling" note under Security/performance notes stating the `"[Circular]"` placeholder and passthrough of `Date`/`RegExp`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Harden JSONL session parsing against malformed entries
  - Acceptance Criteria:
    - Functional: `readEntries`/`parseEntry` validate `message` (when `kind === "message"`), `summary` (string when `kind === "summary"`), `parentId` (string when present), `model` (object shape when `kind === "model_change"`), and custom `data` (plain object, not array/primitive, for `custom`/`compaction` kinds). A single malformed or shape-invalid line does not throw for the whole file: usable entries are returned and invalid lines are reported through a structured parse-error list so the caller can quarantine or surface them.
    - Performance: Parsing stays single-pass O(n) over lines; validation adds no filesystem or network work.
    - Code Quality: A `readSessionEntries` (or extended `readEntries`) result type exposes `{ entries: SessionEntry[]; errors: SessionEntryParseError[] }`; existing `SessionStore` methods keep their signatures and surface a clear error only when a requested branch cannot be rebuilt.
    - Security: Invalid `data` cannot inject arbitrary runtime shapes; corrupt fixtures fail closed with useful errors and do not poison a session branch.
  - Approach:
    - Documentation Reviewed:
      - `src/node/session-store-jsonl.ts`, `src/contracts.ts` (`SessionEntry`, `SessionEntryKind`, `Message`, `CompactionEntryData`), `src/session-stores.ts` (`isCompactionEntryData` precedent).
      - `src/__tests__/node-session-store-jsonl.test.ts`.
      - `docs/node-jsonl-session-store.md`.
      - `code_search`: Node `readFile` line streaming; JSONL recovery patterns.
    - Options Considered:
      - Throw on first bad line (current behavior): rejected by Phase 16 acceptance — poisons the branch.
      - Skip silently: rejected — hides data loss; callers need to know.
      - Return entries plus structured per-line errors: chosen — fail closed per line, recover the rest, let the host decide.
    - Chosen Approach:
      - Replace `parseEntry` throwing with a validating parser that returns `{ entry } | { error }`. Extend `isSessionEntry` into a `validateSessionEntry(value): SessionEntry | SessionEntryValidationError` that checks the existing four string fields plus the per-kind shape rules above. `readEntries` collects valid entries and pushes invalid lines onto an errors array. Public `SessionStore.list`/`get` keep returning `SessionEntry[]`; the new structured result is exposed via an internal or opt-in helper used by tests and any host that wants quarantine. Corrupt input never reaches `getSessionBranchEntries`/`rebuildSessionContext`.
    - API Notes and Examples:
      ```ts
      export interface SessionEntryParseError {
        readonly line: number;
        readonly message: string;
        readonly raw?: string;
      }
      export interface SessionEntryReadResult {
        readonly entries: SessionEntry[];
        readonly errors: SessionEntryParseError[];
      }
      // validate per-kind:
      // kind === "message"     -> entry.message is a valid Message
      // kind === "summary"     -> typeof entry.summary === "string"
      // kind === "model_change"-> entry.model is { provider: string, model: string, ... } object
      // parentId present      -> typeof entry.parentId === "string"
      // kind in custom/compaction -> data is a plain object (not array, not primitive)
      ```
    - Files to Create/Edit:
      - `src/node/session-store-jsonl.ts`: add `validateSessionEntry`, `SessionEntryParseError`, structured read result, and per-line quarantine.
      - `src/__tests__/node-session-store-jsonl.test.ts`: add corrupt-line, bad-kind-shape, and mixed-valid-and-invalid fixtures.
      - `docs/node-jsonl-session-store.md`: document per-kind validation rules, the structured parse-error result, and fail-closed-per-line behavior.
    - Implementation Notes (2026-06-21):
      - Replaced the throw-on-first-bad-line `parseEntry` with `validateSessionEntry`, which returns a discriminated `{ ok, entry } | { ok, error }` result.
      - Added exported `readJsonlSessionEntries(path): Promise<{ entries: SessionEntry[]; errors: SessionEntryParseError[] }>` for hosts/tests that need quarantine diagnostics.
      - Public `createJsonlSessionStore().list()` and `.get()` now internally use the structured reader and return only valid entries, skipping corrupt lines silently.
      - Validated shapes: required `id`/`sessionId`/`timestamp`/`kind` strings; `parentId` string when present; `message` has `role` string and `content` array; `summary` is string; `model_change` has `provider`/`model` strings; `custom`/`compaction` have plain-object `data`; `compaction` also requires string `summary`; `label` is string.
      - The existing `serializes appends and writes json lines` and duplicate-id tests remain green; the old `rejects invalid json line` test was replaced with a quarantine test.
      - `docs/node-jsonl-session-store.md` remains in `apiPages` and passes the required-headings docs test.
      - All suites: 384 pass / 0 fail / 6 skipped.
    - References:
      - `src/session-stores.ts` `isCompactionEntryData` (shape-validation precedent).
      - `docs/node-jsonl-session-store.md`.

  - Test Cases to Write:
    - `jsonl_store_returns_valid_entries_when_one_line_is_corrupt`: a file with N valid lines and 1 unparseable line yields N entries and 1 error.
    - `jsonl_store_rejects_message_entry_with_invalid_message_shape`: `kind:"message"` with non-object `message` is quarantined.
    - `jsonl_store_rejects_summary_with_non_string_summary`: quarantined.
    - `jsonl_store_rejects_non_string_parent_id`: quarantined.
    - `jsonl_store_rejects_model_change_entry_with_invalid_model_shape`: `kind:"model_change"` with non-object `model` is quarantined.
    - `jsonl_store_rejects_custom_data_that_is_array_or_primitive`: quarantined.
    - `jsonl_store_does_not_poison_branch_when_one_entry_invalid`: `list`/branch rebuild succeed on the valid subset.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new structured parse-error type; `SessionStore.list` behavior on corrupt files changes from throw to skip-with-errors.
    - Docs pages to create/edit:
      - `docs/node-jsonl-session-store.md`: document per-kind validation rules, the structured parse-error result, and the fail-closed-per-line behavior under Inputs/Outputs and Security notes.
    - `docs/index.md` update: no new page; confirm the existing Node JSONL link description still fits.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Return defensive copies from the in-memory session store
  - Acceptance Criteria:
    - Functional: `createMemorySessionStore().list(sessionId)` and `.get(id)` return values that callers can mutate without affecting subsequent reads or the store's persisted entries; appending a new entry is unaffected. Branch helpers (`getSessionBranchEntries`, `rebuildSessionContext`) do not hand out live references that alias stored entries.
    - Performance: Copying uses `structuredClone` (or an equivalent deep clone) only on read return values; cost is proportional to returned entry size, which is already the cost of a read.
    - Code Quality: No new dependency; `structuredClone` is available on Node 17+ and the project's current Node target. Internal maps keep the single source of truth.
    - Security: Callers cannot mutate persisted history, summaries, or custom `data` to redact-trick later reads.
  - Approach:
    - Documentation Reviewed:
      - `src/session-stores.ts` (`createMemorySessionStore`, `getSessionBranchEntries`, `rebuildSessionContext`).
      - `src/__tests__/session-stores.test.ts`.
      - `code_search`: `structuredClone` availability and behavior vs `JSON.parse(JSON.stringify())`.
    - Options Considered:
      - Shallow copy of the array only: rejected — nested `message`/`data` stay aliased.
      - `JSON.parse(JSON.stringify())`: rejected — drops `undefined`, `Date`, `Map`; `structuredClone` is broader and built in.
      - `structuredClone` on read: chosen — built-in, handles nested objects, no dependency.
    - Chosen Approach:
      - In `createMemorySessionStore`, return `structuredClone(bySession.get(sessionId) ?? [])` from `list` and `structuredClone(entry)` (or `undefined`) from `get`. Keep `append` storing the original (or a stored clone-on-write — chosen: store as-is, clone-on-read, since reads dominate safety concerns and writes are append-only). Audit `getSessionBranchEntries`/`rebuildSessionContext` to ensure they do not leak the same array reference across calls.
    - API Notes and Examples:
      ```ts
      async list(sessionId) {
        return structuredClone(bySession.get(sessionId) ?? []);
      },
      async get(id) {
        const entry = byId.get(id);
        return entry ? structuredClone(entry) : undefined;
      },
      ```
    - Files to Create/Edit:
      - `src/session-stores.ts`: clone-on-read in `createMemorySessionStore`; clone entries/messages in branch helpers.
      - `src/__tests__/session-stores.test.ts`: mutation-does-not-affect-store cases.
      - `docs/session-stores-and-branching.md`: document the defensive-copy contract.
    - Implementation Notes (2026-06-21):
      - Added `cloneEntry<T>(entry: T): T` helper using the built-in `structuredClone` global.
      - `createMemorySessionStore.list()` now returns `(bySession.get(sessionId) ?? []).map(cloneEntry)` so the returned array and each entry are deep copies.
      - `createMemorySessionStore.get()` returns `entry ? cloneEntry(entry) : undefined`.
      - `getSessionBranchEntries()` now clones each entry before returning the reversed branch, fixing the aliasing noted in the inventory.
      - `rebuildSessionContext()` clones each message extracted from branch entries.
      - Stored entries remain the single source of truth; only read return values are cloned. Append behavior is unchanged.
      - Added 3 tests: memory store list/get isolation, `getSessionBranchEntries` isolation, and `rebuildSessionContext` isolation. All pass, including the existing branch-must-not-mutate-input test.
      - Full verification: 387 pass / 0 fail / 6 skipped.
    - References:
      - `src/session-stores.ts`.
      - `docs/session-stores-and-branching.md`.

  - Test Cases to Write:
    - `memory_store_list_result_is_not_aliased`: mutating a returned entry does not change a subsequent `list`/`get`.
    - `memory_store_get_result_is_not_aliased`: same for `get`.
    - `memory_store_append_still_visible_after_caller_mutates_prior_read`: append visibility is unaffected by caller mutations.
    - `branch_entries_are_not_aliased_across_rebuild_calls`: `getSessionBranchEntries` returns independent arrays.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (behavioral guarantee, not signature) — document the copy-on-read contract.
    - Docs pages to create/edit:
      - `docs/session-stores-and-branching.md`: note that the in-memory store returns defensive copies and that callers should not rely on reference identity.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Make Node path trust realpath-aware against symlink escapes
  - Acceptance Criteria:
    - Functional: `createPathTrustPolicy` rejects a target that resolves inside a trusted root lexically but whose realpath escapes it through a symlink, and accepts targets whose realpath stays inside. A pure lexical `isPathInside` helper remains available for non-filesystem contexts. Realpath failures (missing path, permission) fail closed (treated as untrusted) with a clear reason.
    - Performance: Realpath resolution runs once per `check`; no per-byte scanning. The lexical helper stays O(path-length) and allocation-free.
    - Code Quality: No new dependency; `fs.realpath` from `node:fs/promises` only. Async `check` signature is already allowed by `TrustPolicy.check` returning `Promise<TrustDecision>`.
    - Security: Symlinks inside a trusted root cannot be used to read/escape to arbitrary filesystem locations through Prism's resource loading path; deeper sandboxing (chroot, OS-level) stays out of core per the roadmap.
  - Approach:
    - Documentation Reviewed:
      - `src/node/trust.ts`, `src/security.ts` (`TrustPolicy`, `assertTrusted`, `TrustDeniedError`), `src/resources.ts` (`assertPermission` path; resource loaders are host-supplied but path trust is the documented Node guard).
      - `src/__tests__/settings-security.test.ts`.
      - `docs/settings-auth-trust-security.md`, `docs/resource-loading.md`.
      - `code_search`: Node `fs.realpath` vs `fs.realpathSync` semantics and ENOENT behavior.
    - Options Considered:
      - Keep lexical-only `isPathInside`: rejected — Phase 16 explicitly asks for symlink/realpath escape review.
      - Resolve symlinks at resource-load time only: rejected — trust policy is the reusable boundary; fixing it once protects every caller.
      - `fs.realpath` both root and target before lexical check: chosen — minimal, reuses existing `relative`/`isAbsolute` logic, fails closed on realpath error.
    - Chosen Approach:
      - Add an async `isPathInsideReal(root, target)` that resolves the root with `realpath` and resolves the target with `realpath`. If the target does not exist, its parent directory is `realpath`ed and the basename is appended so write-time checks can still validate paths inside the root. If the root cannot be resolved or any other realpath error occurs, the function returns `false` (fail closed). The resolved paths are then checked with the existing synchronous `isPathInside` helper.
      - `createPathTrustPolicy.check` becomes async and uses `isPathInsideReal`; the pure lexical `isPathInside` stays exported and synchronous for callers without filesystem access. Document that OS-level sandboxing (chroot, containers) remains the host's responsibility.
    - API Notes and Examples:
      ```ts
      import { realpath } from "node:fs/promises";
      import { isAbsolute, relative, resolve, dirname, basename, join } from "node:path";

      export function isPathInside(root: string, target: string): boolean { /* unchanged lexical */ }

      export async function isPathInsideReal(root: string, target: string): Promise<boolean> {
        let from: string;
        try { from = await realpath(root); } catch { return false; }
        let to: string | undefined;
        try { to = await realpath(target); } catch (error) {
          if (!isMissingFile(error)) return false;
          const parent = dirname(target);
          const resolvedParent = await realpath(parent).catch(() => undefined);
          if (!resolvedParent) return false;
          to = join(resolvedParent, basename(target));
        }
        return isPathInside(from, to);
      }
      // createPathTrustPolicy.check -> await isPathInsideReal(root, request.target); realpath throw -> trusted: false
      ```
    - Files to Create/Edit:
      - `src/node/trust.ts`: add `isPathInsideReal`, make `createPathTrustPolicy.check` async and realpath-aware.
      - `src/__tests__/settings-security.test.ts`: symlink-escape fixture using `fs.symlink` in `os.tmpdir()`; update existing normalized-path test to use real temp dirs/files.
      - `docs/settings-auth-trust-security.md`: document realpath-aware trust and symlink escape protection.
      - `docs/resource-loading.md`: cross-reference the realpath trust behavior.
    - Implementation Notes (2026-06-21):
      - Rewrote `src/node/trust.ts` with `isPathInsideReal(root, target)` using `node:fs/promises` `realpath`.
      - Missing targets resolve their parent directory so the policy can still validate creatable paths; missing root or unresolvable parent fails closed.
      - `createPathTrustPolicy.check` is now async and returns `trusted: false` for lexical-inside/realpath-outside paths.
      - The synchronous `isPathInside` is unchanged and remains exported for non-filesystem callers.
      - Added 4 trust tests: normalized realpath roots, symlink escape rejection, symlinked-root acceptance, and fail-closed on unresolvable root. The existing `isPathInside` lexical tests remain.
      - Updated `docs/settings-auth-trust-security.md` and `docs/resource-loading.md` with symlink/realpath notes.
      - Full verification: 390 pass / 0 fail / 6 skipped.
    - References:
      - `src/node/trust.ts`, `src/security.ts`.
      - `docs/settings-auth-trust-security.md`, `docs/resource-loading.md`.

  - Test Cases to Write:
    - `path_trust_rejects_symlink_escaping_trusted_root`: a symlink inside the root pointing outside is rejected.
    - `path_trust_accepts_symlink_staying_inside_root`: a symlink to another path inside the root is accepted.
    - `path_trust_fails_closed_when_realpath_unresolvable`: a missing target is treated as untrusted with a clear reason.
    - `is_path_inside_lexical_still_works_for_non_fs_contexts`: pure lexical helper still used where realpath is unavailable.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `isPathInsideReal` export and async `createPathTrustPolicy.check`.
    - Docs pages to create/edit:
      - `docs/settings-auth-trust-security.md`: document realpath-aware trust, fail-closed-on-unresolvable behavior, and the explicit "no deeper sandboxing in core" boundary.
      - `docs/resource-loading.md`: cross-reference the realpath trust behavior.
    - `docs/index.md` update: no new page; confirm the Security/auth/trust group entry still fits.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Audit and enforce network-free default tests with explicit live gates
  - Acceptance Criteria:
    - Functional: Every first-party package and the core workspace has a default test run that touches no network. Every live provider/worker smoke test is gated behind an explicit `PRISM_LIVE_*` env var (providers, compaction LLM, observational memory) and skipped by default. A workspace-level guard test asserts no test file performs a real `fetch`/socket unless its corresponding env var is set.
    - Performance: Default `node:test` runtime stays within the project's existing budget; the audit adds only cheap static/guard tests.
    - Code Quality: Gating env-var names are consistent and documented; the guard test is itself network-free.
    - Security: No accidental live credential use; no live test reads real secrets from the environment by default.
  - Approach:
    - Documentation Reviewed:
      - Existing gates: `packages/provider-*/src/__tests__/live.test.ts` (`PRISM_LIVE_PROVIDER_TESTS`), `packages/compaction-llm/src/__tests__/live.test.ts` (`PRISM_LIVE_COMPACTION_TESTS`), `packages/compaction-observational-memory/src/__tests__/live.test.ts` (`PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS`).
      - Root `package.json` test scripts and any CI workflow.
      - `code_search`: `node:test` skip semantics via `{ skip: ... }`.
    - Options Considered:
      - Rely on each package's existing gate: rejected — Phase 16 wants an explicit workspace-level guarantee, not per-package trust.
      - Add a static grep-based guard: chosen — cheapest network-free guarantee; fails if a `live.test.ts` is added without the env gate or if a non-live test imports a real network client.
    - Chosen Approach:
      - Add one workspace guard test that scans `packages/**/src/__tests__/**live*.test.ts` (and core) and asserts each is gated by a `PRISM_LIVE_*` check, plus asserts no other `*.test.ts` references `globalThis.fetch` without an injected mock. Document the three env vars in one place.
    - API Notes and Examples:
      ```ts
      // plans/019 guard test (sketch)
      import { readdirSync, readFileSync } from "node:fs";
      import { globSync } from "node:fs"; // or simple walk
      for (const file of findLiveTestFiles()) {
        const src = readFileSync(file, "utf8");
        if (!/PRISM_LIVE_[A-Z_]+/.test(src)) assert.fail(`${file} must gate on a PRISM_LIVE_* env var`);
      }
      ```
    - Files to Create/Edit:
      - `src/__tests__/network-free-guard.test.ts` (new): assert every live test is gated and no other test references `globalThis.fetch`.
      - `docs/credentials-and-redaction.md`: list the `PRISM_LIVE_*` env vars and default network-free policy.
    - Implementation Notes (2026-06-21):
      - Audited all 7 existing `*live*.test.ts` files across core + first-party packages; all already gate on `PRISM_LIVE_PROVIDER_TESTS`, `PRISM_LIVE_COMPACTION_TESTS`, or `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS`.
      - Added `src/__tests__/network-free-guard.test.ts` which walks `src/` and `packages/` (skipping `node_modules`, `dist`, `.git`, `.agents`, `plans`, `docs`, `coverage`) and asserts:
        - every file whose path matches `/live/i` contains a `PRISM_LIVE_[A-Z_]+` gate;
        - every other `.test.ts` does not contain `\bglobalThis\.fetch\b` (the guard file itself is excluded).
      - Added a Security note in `docs/credentials-and-redaction.md` documenting the three live-gate env vars and the network-free default.
      - Full verification: 392 pass / 0 fail / 6 skipped (all live tests skipped by default).
    - References:
      - Existing `live.test.ts` files.
      - `plans/017-observational-memory-strategy.md`, `plans/016-llm-compaction-strategy.md` (live-gate precedent).

  - Test Cases to Write:
    - `every_live_test_is_gated_by_prism_live_env_var`: scan + assert.
    - `no_default_test_performs_real_network`: scan + assert no ungated real network use.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no public API; testing contract only, but worth documenting for contributors.
    - Docs pages to create/edit:
      - `docs/credentials-and-redaction.md` (or an existing testing section): document the `PRISM_LIVE_*` env vars and default network-free policy. If a dedicated testing page is introduced, add it to `docs/index.md`.
    - `docs/index.md` update: yes only if a new testing page is added; otherwise no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final Phase 16 verification (typecheck, tests, docs checks)
  - Acceptance Criteria:
    - Functional: All new and existing tests pass for core and first-party packages; `tsc --noEmit` is clean; docs tests enforcing API-page headings stay green for any edited `/docs` page.
    - Performance: Default test run remains network-free and within the project time budget.
    - Code Quality: No new runtime dependencies added across the phase; redaction/session/trust/oauth changes keep public signatures backward-compatible except where this plan explicitly notes an additive option.
    - Security: Re-run redaction, JSONL-corrupt-fixture, in-memory-store mutation, symlink-escape, and OAuth-mocked tests together; confirm no secret appears in events, docs fixtures, or stored sessions.
  - Approach:
    - Documentation Reviewed:
      - This plan; `package.json` scripts; `src/__tests__/docs.test.ts`.
    - Options Considered:
      - Verify per task only: rejected — cross-cutting security hardening needs one combined gate.
    - Chosen Approach:
      - Run the workspace test suite, typecheck, and docs check; manually verify the four Phase 16 acceptance bullets from `roadmap.md` (cyclic redaction, corrupt JSONL fail-closed, in-memory copy isolation, mocked OAuth/no-credential-leak).
    - API Notes and Examples:
      ```bash
      npm test         # network-free, all workspaces
      npm run typecheck
      npm run docs:check || node --test src/__tests__/docs.test.ts
      ```
    - Files to Create/Edit:
      - `plans/019-auth-redaction-session-data-hardening.md`: tick final task, fill `Compromises Made` and `Further Actions`.
    - Implementation Notes (2026-06-21):
      - Ran `npm run typecheck`: clean across core and all 7 workspaces.
      - Ran `npm test`: 392 pass / 0 fail / 6 skipped; all live tests skipped by default, confirming network-free default.
      - Ran docs test (`dist/__tests__/docs.test.js`): 19 pass / 0 fail; all edited docs pages keep required headings and avoid real-looking secrets.
      - Re-ran the Phase 16 security-focused suites together:
        - Redaction: `credentials-redaction.test.js` + `runtime-redaction.test.js` → 15 pass, including cyclic-graph and cyclic-cause cases.
        - JSONL corrupt fixtures: `node-session-store-jsonl.test.js` → 11 pass, including quarantine tests.
        - In-memory store mutation isolation: `session-stores.test.js` → 11 pass, including defensive-copy tests.
        - Symlink escape: `settings-security.test.js` → 10 pass, including realpath-aware trust tests.
        - Mocked OAuth: `packages/provider-openai/dist/__tests__/codex-oauth.test.js` → 6 pass, no real credentials/network.
      - Confirmed no new runtime dependencies added in this phase.
      - Confirmed public signature changes are additive: `createPkceVerifier`/`computeS256Challenge`, `codexBaseUrl`, `readJsonlSessionEntries`/`SessionEntryParseError`, `isPathInsideReal`.
      - No secrets appear in test fixtures, docs examples, or stored session entries; docs secret-detection test enforces this.
    - References:
      - `roadmap.md` Phase 16 acceptance criteria.
      - `plans/018-provider-runtime-correctness-hardening.md` final-verification precedent.

  - Test Cases to Write:
    - No new tests; this task runs the union of the above plus existing suites.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: `none` — covered by per-task docs edits.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- JSONL session parsing now quarantines corrupt/shape-invalid lines per file rather than throwing on the first bad line. Public `SessionStore.list()`/`get()` silently skip bad lines; per-line errors are available only through the new opt-in `readJsonlSessionEntries()` helper. This trades immediate failure for branch recoverability, matching the Phase 16 acceptance criterion.
- Node path trust resolves a missing target's parent directory so write-time checks inside a trusted root still succeed. This is slightly more permissive than failing closed on every missing path, but it preserves host workflows that validate a path before creating the file while still rejecting symlink escapes.
- `Map`/`Set` values in redacted data are normalized to plain object/array. Session entries and provider payloads are JSON-serializable in Prism, so this is acceptable; hosts that need to preserve `Map`/`Set` identity through redaction must handle that at their edge.
- No OS-level sandbox (chroot, containers, MAC) was added to core. `createPathTrustPolicy` is a lexical/realpath guard only; hosts requiring stronger isolation must layer it themselves, as documented.
- All public API changes are backward-compatible additive options/exports (PKCE helpers, `codexBaseUrl`, `readJsonlSessionEntries`, `isPathInsideReal`, `SessionEntryParseError`). No signatures were removed or changed incompatibly.

## Further Actions
- Add shape validation for `event` and `metadata` session entry kinds if a host reports runtime crashes from malformed payloads (low priority; current acceptance criteria are satisfied).
- Cache resolved trusted-root realpaths if `createPathTrustPolicy` checks become a hot path (measure first; current FS cost is one `realpath` per root per check).
- Add a dedicated `docs/testing.md` contributor guide if additional live-gate env vars or test conventions are introduced; for now the guard test and `docs/credentials-and-redaction.md` note are sufficient.
- Re-audit after Node version bumps that `structuredClone` behavior remains compatible with session entry shapes.
