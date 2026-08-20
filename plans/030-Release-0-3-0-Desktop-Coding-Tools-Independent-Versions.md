# 030 — Release 0.3.0: Linux desktop, coding/ACP tools, independent versions

Roadmap phase: **0.3.x** line, milestone **0.3.0**.
Baseline: `@arnilo/prism` **0.2.9** (plan 029 complete; 55 publishable manifests; Decision A exact peers; lockstep `validateRelease`).
Target: `@arnilo/prism` **0.3.0** last lockstep, then per-package semver.
Status: **locked scope** (blueprint D1–D10 approved as the implementation contract).

0.3.0 is a **demand cut**, not a catalog dump. Three named jobs: wrap [computer-use-linux](https://github.com/agent-sh/computer-use-linux) as a first-party device vendor; close the remaining coding/ACP tool holes; stop bumping packages that did not change.

## Objectives

- Ship `@arnilo/prism-computer-use-linux` so a Prism agent can observe and operate a local Linux desktop through the existing `DeviceAdapter` + MCP + `ExecutionPolicy` seams.
- Make coding tools efficient and ACP-correct: `read.findText`, loud fuzzy/`edit` misses, ACP editor-buffer operations, spawnable-agent wiring, `delete`/`move` projection.
- Cut every package to **0.3.0** once, rewrite internal/peer pins to `^0.3.0`, then publish only unpublished versions.

## Expected Outcome

- Hosts `npm install @arnilo/prism-computer-use-linux`, admit `desktop-control`, register bounded desktop tools. Non-Linux and unadmitted sessions fail closed. Import is inert. Package is **not** in `prism-code` / `prism-all`.
- `read` can jump to in-file text. `edit` reports `metadata.fuzzy` and nearby miss snippets. When an ACP client advertised `fs/*`, spawnable-agent `read`/`write`/`edit` hit editor buffers, not a silent second disk copy.
- After the train cut, `scripts/release.mjs` validates range satisfaction, refuses unchanged packages with a new version, refuses changed packages without a bump, and publishes only unpublished `name@version`. Package-truth records per-package versions. Peer policy is `^0.3.0` (Decision A retired).

## Locked in / out

| Item | Decision | Why |
| --- | --- | --- |
| D1 Desktop wrap | **In** — `@arnilo/prism-computer-use-linux`, host-owned binary, MCP stdio | Do not vendor Rust. Do not require `@agent-sh/computer-use-linux` as a runtime dep. |
| D2 Tool surface | **In** — 1:1 upstream MCP names | No collapsed `desktop_act` API. |
| D3 Admission | **In** — `DeviceAdapter` + `ExecutionPolicy`; setup tools off by default | Linux-only factory. |
| D4 Umbrellas | **Out of umbrellas** | Same honesty rule as document-reader / NATS / Impeccable. |
| D5 Coding adds | **In** — `findText`, fuzzy flag + miss context, `createAcpFilesystemOperations` | Shared operations, not a second edit. |
| D6 Coding skips | **Out** — `apply_patch`, notebooks, trash, append/binary write, regex search, image-resizer dep, ACP protocol extension | `git_apply` already covers patches. |
| D7 Spawnable ACP | **In** — wire client fs when advertised | Today `createCodingTools(config.cwd)` always hits disk. |
| D8 Versioning | **In** — last lockstep 0.3.0, then `^0.3.0` peers | npm caret on 0.x = `>=0.3.0 <0.4.0`. |
| D9 Detect / publish | **In** — extend `release.mjs`; no Changesets | Tags: `@arnilo/<name>@<version>`. `v0.3.0` last train tag. |
| D10 Deferred | **Out** — live canary matrix, Cursor/Antigravity, Cedar / second object store, macOS/Windows desktop, Caveman 2, Impeccable live detector | Named leftovers stay leftovers. |

## Research record

### computer-use-linux

- Rust MCP server + CLI. Invoke: `computer-use-linux mcp`.
- Tools (upstream names): `doctor`, `setup_accessibility`, `setup_window_targeting`, `list_apps`, `list_windows`, `focused_window`, `get_app_state`, `screenshot`, `click`, `drag`, `scroll`, `press_key`, `type_text`, `perform_action`, `set_value`, `activate_window`, `move_window`, `resize_window`.
- MCP annotations: doctor/list/get/screenshot = read-only; setup = local config mutators; click/type/key/drag/action/set_value = destructive; window move/resize/activate/scroll = UI mutators.
- Screenshot bounded upstream at 1920px / 2 MiB. Prism still runs `acceptDeviceChunk` (1 MiB default / 8 MiB hard).
- Skill procedure: `doctor` first, target the window, prefer AT-SPI selectors (`role|name`), never click blind, never concurrent input.
- Prism already has: `src/devices.ts` (`desktop-control`), `packages/mcp` stdio (`connectMcpTools` + `createMcpTransport`), `assertExecutionAllowed`, skill registries.

### Coding / ACP gaps (this plan implements)

- `read` parameters today: `path`, `offset`, `limit`. No in-file find. `ReadOperations.readText` already pages; `findText` can loop those pages — **no operations-interface change**.
- `edit` miss: `Could not find the exact text in ${path}` with no snippet (`edit-diff.ts` `getNotFoundError`). Fuzzy success is silent; `fuzzyFindText` already returns `usedFuzzyMatch`.
- `EditToolDetails` already has `path`; docs omit it.
- ACP client: `fs/read_text_file` (path, line, limit) + `fs/write_text_file` (path, content). No `fs/edit`. No images. No stat/mkdir. No terminal stdin.
- `createAcpClientFilesystem` and `EditOperations` exist; glue does not.
- `createSpawnableAgent` never passes `coding` seams and builds one disk `ToolRegistry` at process start. `AcpSessionBinding.tools` is the per-session override.
- Projection allow-list: `edit` (diff+location), `write` (location). `delete` already has `metadata.path`; `move` has `metadata.from`/`to`.

### Release lockstep (this plan replaces after the cut)

- `validateRelease` requires every manifest + every internal pin + lockfile entry == one version.
- `bumpRelease` already skips manifests not at `--from`.
- `runRelease` publishes every package at `--version`.
- CI publish: `on.push.tags: ["v*"]` → `release:publish --version "${GITHUB_REF_NAME#v}"`.
- `package-truth.json` `root.version` + `peerPolicy.decision: "A"` exact `0.2.9`.
- npm `^0.3.0` on a 0.x minor is `>=0.3.0 <0.4.0`. That is the 0.3 window. Core 0.4.0 is the next coordinated peer bump.

## Tasks

- [x] Task 0 — Freeze manifest and baseline
  - Acceptance Criteria:
    - Functional: `scripts/phase30-freeze-manifest.json` lists allowed surfaces (desktop package, coding/ACP edits, release scripts, listed docs) and forbidden categories (live canary matrix, delegated Cursor/Antigravity, Cedar/second object store, macOS/Windows desktop, `apply_patch`/notebooks/trash, Changesets, umbrella membership of desktop). Empty deviation log at freeze.
    - Functional: `scripts/phase30-baseline.json` records 0.2.9 `exitGate` counts, audit 0 moderate, 55-package graph, Decision A peers, lockstep validate.
    - Performance: freeze test is schema-only; no live network, no desktop binary.
    - Code Quality: `scripts/phase30-freeze.test.mjs` wired into `npm test` after phase29; deviation entries require task+change+rationale.
    - Security: restates audit `--audit-level=moderate` = 0, additive-only public runtime compat, no new runtime deps in core, desktop binary host-owned.
  - Approach:
    - Documentation Reviewed:
      - `plans/030-Release-0-3-0-Desktop-Coding-Tools-Independent-Versions.md` locked table; `scripts/phase29-freeze-manifest.json` / `scripts/phase29-freeze.test.mjs`; `docs/release-and-install.md` Decision A; `roadmap.md` 0.3.x; `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Skip freeze: rejected — 0.2.x/0.3.x precedent is machine-checked scope.
      - Keep 029 forbidden `independent-package-versions`: rejected — that is this release.
    - Chosen Approach:
      - Same phase-N freeze triad as 014/027/029. Locked table above is the scope.
    - API Notes and Examples:
      ```jsonc
      {
        "release": "0.3.0",
        "line": "0.3.x",
        "type": "demand",
        "baseline": "0.2.9",
        "allowed": [
          "packages/computer-use-linux/**",
          "packages/coding-agent/src/read.ts",
          "packages/coding-agent/src/edit.ts",
          "packages/coding-agent/src/edit-diff.ts",
          "packages/coding-agent/src/acp-operations.ts",
          "packages/coding-agent/src/index.ts",
          "packages/acp-agent/src/index.ts",
          "packages/ag-ui/src/acp/coding-projection.ts",
          "scripts/release.mjs",
          "scripts/release-gates.mjs",
          "scripts/package-truth.mjs",
          ".github/workflows/release.yml",
          "docs/**"
        ],
        "forbidden": [
          "live-canary-matrix",
          "delegated-cursor-antigravity",
          "cedar-second-object-store",
          "macos-windows-desktop",
          "apply-patch-tool",
          "notebook-tools",
          "changesets",
          "desktop-in-umbrellas",
          "reimplement-computer-use-linux"
        ],
        "deviations": [],
        "packageBudget": { "publishableFrom": 55, "publishableTo": 56 }
      }
      ```
    - Files to Create/Edit:
      - `scripts/phase30-freeze-manifest.json`: create.
      - `scripts/phase30-freeze.test.mjs`: create.
      - `scripts/phase30-baseline.json`: create.
      - `package.json`: add `scripts/phase30-freeze.test.mjs` to `npm test`.
      - `roadmap.md`: replace empty 0.3.0 stub with this locked list; move live-canary / delegated agents to later 0.3.x.
      - `plans/README.md`: 030 row (this file).
    - References:
      - `plans/029-Release-0-2-9-Provider-Adoption-And-Behavior-Packages.md` Task 0; `plans/027-Release-0-2-7-Enterprise-ERP-Production-Readiness.md` Task 0.
  - Test Cases to Write:
    - freeze schema: required keys, deviation shape, packageBudget 55→56.
    - forbidden-category tripwire: `changesets`, `desktop-in-umbrellas`, `reimplement-computer-use-linux`, `live-canary-matrix`.
    - allowed tokens: `packages/computer-use-linux/**`, `findText`, `^0.3.0`, `createAcpFilesystemOperations`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (process evidence).
    - Docs pages to create/edit:
      - `roadmap.md`: lock 0.3.0 scope (not a `/docs` API page).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (docs-not-required path).

- [x] Task 1 — Primitive review
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase30-primitive-review.md` inventories existing primitives vs each workstream and records implement-or-defer for: collapsed desktop API, `@agent-sh/computer-use-linux` npm peer, core device-primitive changes, `ReadOperations` interface change, ACP `fs/edit` / terminal stdin, Changesets, umbrella membership.
    - Functional: names **zero** new core primitives. Desktop uses `DeviceAdapter` / `assertDeviceAdmit` / `acceptDeviceChunk` / `connectMcpTools` / `assertExecutionAllowed`. Coding uses existing `ReadOperations.readText` paging + `EditOperations` + `AcpClientFilesystem`. Release stays in `scripts/release.mjs`.
    - Performance: evidence only.
    - Code Quality: one evidence file; no `DesktopRuntime` / `VersionManager` type in core.
    - Security: restates no implicit desktop activation, no ambient binary download, no permission broadening, ACP image/document fail closed on client fs.
  - Approach:
    - Documentation Reviewed:
      - `docs/device-adapters.md`, `src/devices.ts`, `docs/mcp-tools.md`, `packages/mcp/src/{bridge,transport,types}.ts`, `docs/browser-automation.md`, `docs/coding-agent-tools.md`, `docs/acp.md`, `packages/coding-agent/src/{read,write,edit,edit-diff,index}.ts`, `packages/ag-ui/src/acp/{fs-client,coding-projection,agent/coding,agent/types}.ts`, `packages/acp-agent/src/index.ts`, `scripts/release.mjs`, `docs/release-and-install.md`.
      - Upstream: https://github.com/agent-sh/computer-use-linux README + MCP tool list; local skill `/home/arn/.pi/agent/npm/node_modules/@agent-sh/computer-use-linux/skills/computer-use-linux/SKILL.md`.
    - Options Considered:
      - Host-only MCP config, no package: skips DeviceAdapter, kinds, skill. Rejected — named demand is a first-party package.
      - Collapse 18 tools to 5: extra Prism surface, drift. Rejected (D2).
      - Change `ReadOperations` to add `findText`: unnecessary; tool can page. Rejected.
      - Core version broker: rejected — scripts only.
    - Chosen Approach:
      - Reuse primitives. Package/script work sits on top. Only generic gap that would justify a core change is a missing device/MCP/execution seam; review must prove none.
    - API Notes and Examples:
      ```ts
      import { assertDeviceAdmit, resolveDevicePolicy } from "@arnilo/prism";
      import { connectMcpTools } from "@arnilo/prism-mcp";

      const policy = resolveDevicePolicy(
        { kind: "desktop-control", enabled: true, requireApproval: true, sandbox: "linux-desktop" },
        { runLimits: { maxTurns: 32, maxToolCalls: 200 } },
      );
      assertDeviceAdmit(policy, { approved: true, activeSessions: 0 });
      const bridge = await connectMcpTools({
        serverId: "computer-use-linux",
        transport: { type: "stdio", command: "computer-use-linux", args: ["mcp"] },
      });
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase30-primitive-review.md`: create.
      - `scripts/phase30-freeze-manifest.json`: record verified deferrals as Task 1 deviations.
    - References:
      - create-plan primitive-review rule; `runDevicePolicyConformance`; browser package as UX analog (host-supplied backend).
  - Test Cases to Write:
    - freeze test: evidence file contains tokens `DeviceAdapter`, `connectMcpTools`, `assertExecutionAllowed`, `ReadOperations.readText`, `AcpClientFilesystem`, `no core primitive`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal evidence). Public docs land with later tasks.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (docs-not-required path).

- [x] Task 2 — Independent versioning machinery (dual-mode, default still lockstep)
  - Acceptance Criteria:
    - Functional: `release.mjs` grows `changed`, per-package `bump --package <name> --type patch|minor`, and an `independent` validate/publish path. Lockstep `validateRelease(version)` and `bump --from --to` still pass on the 0.2.9 tree.
    - Functional: independent validate accepts mixed versions when every internal/peer `@arnilo/*` range satisfies the workspace version (`semver.satisfies` via Node, no new dep — implement the 0.x caret/tilde/exact subset needed, or shell out to `npm pkg get` + a 30-line matcher). Unchanged package with a bumped version fails. Changed package (git diff vs last `@arnilo/<name>@*` tag, or vs `v0.2.9` if no package tag) without a bump fails.
    - Functional: independent publish walks topo order and publishes only `name@version` absent from the registry; resume + same-manifest skip stay.
    - Performance: change detection is `git diff --name-only` + dependency graph, not 55 tarball packs.
    - Code Quality: no Changesets. No new runtime dependency. Tests use tmp fixtures, do not mutate the repo manifests.
    - Security: real publish still requires a clean tree; cannot republish a version with different release fields; `--allow-dirty` / `--allow-untagged` still forbidden on real publish.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs` (`validateRelease`, `bumpRelease`, `runRelease`, `assertGitState`, `parseArgs`).
      - `scripts/release-gates.mjs` (`release.validate(version)`).
      - `scripts/release-gate.test.mjs`.
      - `.github/workflows/release.yml` (read-only this task; tag flip is Task 9).
      - `docs/release-and-install.md` Decision A.
    - Options Considered:
      - Changesets: extra workflow + dep. Rejected (D9).
      - Flip default now: would break current 0.2.9 lockstep CI. Rejected — dual-mode until Task 9.
      - Full node-semver dependency: rejected — 0.x `^` / `~` / exact is a tiny matcher.
    - Chosen Approach:
      - Add `mode: "lockstep" | "independent"` (CLI `--independent`). Default lockstep.
      - `changed`: for each package, dirty if `git diff <baseline> -- <pkg.path>` is non-empty. Baseline = latest matching tag `@arnilo/<name>@*` or `v0.2.9`.
      - Per-package bump: increment that manifest; rewrite its internal `@arnilo/*` pins only when `--align-deps` (not default). Dependents do **not** auto-bump when the new version still satisfies their range.
      - `assertGitState` independent: clean tree; HEAD must carry the package tag of each version about to be published **or** `--allow-untagged` for dry-run/check only.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs changed
      node scripts/release.mjs bump --package @arnilo/prism-coding-agent --type patch
      node scripts/release.mjs check --version 0.2.9                 # lockstep (default)
      node scripts/release.mjs check --independent                  # mixed OK
      node scripts/release.mjs publish --independent --dry-run
      node scripts/release.mjs bump --from 0.2.9 --to 0.3.0         # last lockstep, Task 9
      ```
    - Files to Create/Edit:
      - `scripts/release.mjs`: `changedPackages`, `satisfiesInternalRange`, `bumpPackage`, independent `validateRelease` / `runRelease`, CLI flags.
      - `scripts/release-gates.mjs`: accept independent validate (still called with a version in lockstep).
      - `scripts/phase30-release.test.mjs`: tmp three-package graph.
      - `package.json`: add `scripts/phase30-release.test.mjs` to `npm test`.
      - `docs/release-and-install.md`: document dual-mode CLI now; Decision B text waits for Task 9.
    - References:
      - npm caret on `0.3.0` = `>=0.3.0 <0.4.0`.
      - `bumpRelease` already skips manifests not at `--from`.
  - Test Cases to Write:
    - lockstep-still-works: fixture all-at-0.2.9 validates; mixed fails lockstep.
    - independent-mixed: coding-agent 0.3.1 + core 0.3.0 with `^0.3.0` validates.
    - independent-unsatisfied: peer `^0.3.0` vs core 0.4.0 fails.
    - changed-without-bump-fails: source dirty + same version fails independent check.
    - unchanged-new-version-fails: clean tree + version++ fails independent check.
    - publish-unpublished-only: already-on-registry same manifest skipped on resume; different release fields throw.
    - bump-one: `--package` increments only that manifest.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — release CLI (operator surface). Default lockstep keeps 0.2.9 CI green.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: add dual-mode commands; do not yet retire Decision A.
    - `docs/index.md` update: no (blurb still 0.2.9 until Task 10).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — `read.findText`
  - Acceptance Criteria:
    - Functional: `read` accepts `findText` (string) and optional `findMode` (`exact` | `case-insensitive`, default `exact`). Search starts at `offset` or line 1. Returns one page whose first line is the first match. No match → error result, file unread by the model. Does not change `ReadOperations`.
    - Functional: `findText` + `offset` past the last match → not-found. Empty `findText` → input error. `findText` works with custom `operations.readText` (ACP later).
    - Performance: scan stops at existing `maxScanBytes` / `maxLines` page loop. No full-file retain.
    - Code Quality: logic lives in `createReadTool.execute` (page loop), not a new reader type.
    - Security: no regex. `findMode` is two literals. Path + policy unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/read.ts` (`ReadTextOptions`, `readLocalTextPage`, parameters schema).
      - `docs/coding-agent-tools.md` read section.
      - Pi read tool `findText` (behavioral reference only).
    - Options Considered:
      - Extend `ReadTextOptions` / local pager: extra backend contract. Rejected — tool can page.
      - Fuzzy findText: overlaps edit. Rejected.
      - `findOccurrence` Nth match: YAGNI. Skip; model can raise `offset`.
    - Chosen Approach:
      - Loop `ops.readText` pages. On first page containing the needle, if the hit is not at `startLine`, re-read from the hit line so the match is at the top. Footer still carries `nextOffset` / `hasMore`.
    - API Notes and Examples:
      ```ts
      await read.execute({ path: "src/edit.ts", findText: "createEditTool", limit: 40 }, ctx);
      await read.execute({ path: "src/edit.ts", findText: "edittol", findMode: "case-insensitive" }, ctx);
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/read.ts`: parameters + page-loop find.
      - `packages/coding-agent/src/__tests__/read.test.ts`: cases below.
      - `docs/coding-agent-tools.md`: `findText` / `findMode` on the read API.
    - References:
      - Existing `maxScanBytes` / `maxLines` / `maxBytes` caps.
  - Test Cases to Write:
    - find-first: match at line 80 returns a page starting at 80.
    - find-case: `exact` misses different case; `case-insensitive` hits.
    - find-none: error, no file body in result.
    - find-empty: input error.
    - find-offset: starts search at `offset`, ignores earlier hits.
    - find-scan-cap: custom `readText` that never ends + small `maxScanBytes` errors.
    - find-custom-ops: fake `readText` pages, no disk.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `read` parameters.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: read inputs table + example.
    - `docs/index.md` update: no this task (Task 10 refreshes the blurb).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — `edit` miss context + loud fuzzy
  - Acceptance Criteria:
    - Functional: no-match error includes up to 3 nearby unique line snippets (line number + clipped text) when a cheap first-line substring hits; otherwise the current sentence stays. File unchanged.
    - Functional: fuzzy apply sets `metadata.fuzzy: true` and the model-visible text mentions `(fuzzy match)`. Exact apply leaves `fuzzy` absent or `false` and the current success sentence.
    - Functional: existing miss/duplicate/overlap/empty/no-change tests still fail closed.
    - Performance: nearby scan is O(lines of the already-loaded file), cap 3 snippets × 120 chars.
    - Code Quality: `AppliedEditsResult` gains `usedFuzzyMatch`. `EditToolDetails` gains optional `fuzzy`.
    - Security: snippets are file content the model already needed to edit; no extra file read. Redaction unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/edit-diff.ts` (`getNotFoundError`, `fuzzyFindText`, `applyEditsToNormalizedContent`).
      - `packages/coding-agent/src/edit.ts` (`EditToolDetails`, success metadata).
      - `docs/coding-agent-tools.md` edit metadata table (missing `path`).
    - Options Considered:
      - Remove fuzzy: rejected — already documented; make it loud instead.
      - Levenshtein ranking: extra code. Rejected — first-line substring is enough.
    - Chosen Approach:
      - `getNotFoundError` takes content + oldText. Needle = first non-empty oldText line, trimmed, clipped to 16 chars (min 4). Collect unique lines containing it.
      - Thread `usedFuzzyMatch` from `applyEditsToNormalizedContent` into metadata + success text.
    - API Notes and Examples:
      ```ts
      // miss
      "Could not find the exact text in src/a.ts. Nearby:\n  L14: const foo = bar\n  L88: const foo = baz"
      // fuzzy hit
      metadata: { path, diff, patch, firstChangedLine, fuzzy: true }
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/edit-diff.ts`: miss context + `usedFuzzyMatch` on result.
      - `packages/coding-agent/src/edit.ts`: metadata + success text; `EditToolDetails.fuzzy?`.
      - `packages/coding-agent/src/__tests__/edit-diff.test.ts`, `edit.test.ts`.
      - `docs/coding-agent-tools.md`: metadata table (`path`, `fuzzy`); fuzzy is now loud.
    - References:
      - Existing `usedFuzzyMatch` on `FuzzyMatchResult`.
  - Test Cases to Write:
    - miss-nearby: unique nearby lines appear; file bytes unchanged.
    - miss-none: no similar line → original error sentence, no `Nearby:`.
    - fuzzy-loud: trailing-whitespace miss applies and sets `metadata.fuzzy === true`.
    - exact-quiet: exact match does not claim fuzzy.
    - existing-guards: duplicate / overlap / empty / no-change still throw the same classes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — edit result metadata + error text.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: edit metadata + fuzzy note.
    - `docs/index.md` update: no this task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — `createAcpFilesystemOperations`
  - Acceptance Criteria:
    - Functional: new export maps a duck-typed `{ readTextFile, writeTextFile }` (ACP `AcpClientFilesystem` shape) onto `ReadOperations` + `WriteOperations` + `EditOperations`. `createCodingTools` with those ops never touches disk.
    - Functional: `readText` uses client `line`/`limit`. `findText` (Task 3 loop) works through it. `writeFile` is client write. `mkdir` is a no-op. `detectImageMimeType` is always `null`. `readFile` of a sniffed image/document path is not used; if `readFile` is called, return UTF-8 bytes of a text read capped by ACP max.
    - Functional: image/document `createReadTool` path through these ops fails closed (no MIME, no silent disk fallback).
    - Functional: `statFile` uses UTF-8 byte length of a bounded text read (ACP has no stat). Oversize vs `maxFileBytes` still refuses.
    - Performance: one client read per `statFile`/`readFile` pair is acceptable; do not add a cache type. Per-path mutation queue already serializes edit/write.
    - Code Quality: **no** dependency on `@arnilo/prism-ag-ui`. Interface lives in coding-agent.
    - Security: honor caller-supplied byte caps; do not raise ACP `maxTextBytes`. No disk fallback unless the host keeps default ops.
  - Approach:
    - Documentation Reviewed:
      - `packages/ag-ui/src/acp/fs-client.ts` (`AcpClientFilesystem`).
      - `packages/coding-agent/src/{read,write,edit}.ts` operations interfaces.
    - Options Considered:
      - Depend on `ag-ui` for the type: rejected — peer graph + circular risk.
      - `ToolsOptions.filesystem` helper: optional one-liner later; not required.
      - Invent ACP `fs/edit`: rejected (D6).
    - Chosen Approach:
      ```ts
      export interface TextFileClient {
        readTextFile(input: { path: string; line?: number; limit?: number }): Promise<{ text: string }>;
        writeTextFile(input: { path: string; content: string }): Promise<void>;
      }
      export function createAcpFilesystemOperations(client: TextFileClient): {
        read: ReadOperations;
        write: WriteOperations;
        edit: EditOperations;
      }
      ```
      `access`: `readTextFile({ path, line: 1, limit: 1 })` throw → not accessible.
    - API Notes and Examples:
      ```ts
      const fs = createAcpClientFilesystem(client, sessionId);
      const ops = createAcpFilesystemOperations(fs);
      const tools = createCodingTools(cwd, {
        read: { operations: ops.read },
        write: { operations: ops.write },
        edit: { operations: ops.edit },
      });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/acp-operations.ts`: create.
      - `packages/coding-agent/src/index.ts`: export function + `TextFileClient`.
      - `packages/coding-agent/src/read.ts`: avoid local existence probes when a custom read backend is supplied.
      - `packages/coding-agent/src/__tests__/acp-operations.test.ts`: create.
      - `docs/coding-agent-tools.md`: ACP operations section.
      - `docs/acp.md`: point at the adapter; editor-vs-disk hybrid caveat.
    - References:
      - Edit = client read + `applyEditsToNormalizedContent` + client write (existing tool).
  - Test Cases to Write:
    - edit-roundtrip: fake client map; disk file untouched; content replaced.
    - read-page: `line`/`limit` forwarded.
    - write-mkdir: `mkdir` no-op; write reaches client.
    - image-closed: `detectImageMimeType` null → read treats as text and `readFile`/`statFile` disk fallbacks are never called.
    - access-miss: client throw → access/edit error, no write.
    - stat-cap: huge client text vs small `maxFileBytes` refuses before write.
    - custom-backend path: remote operations use pure path resolution without local existence probing.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new export.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: export table + example.
      - `docs/acp.md`: editor-buffer mode + hybrid search/glob/delete/move stay on disk.
    - `docs/index.md` update: no this task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Spawnable ACP wiring + `delete`/`move` projection
  - Acceptance Criteria:
    - Functional: `createSpawnableAgent` passes `coding.filesystem: createAcpClientFilesystem`. `sessionFactory` builds a **per-session** registry: advertised fs → Task 5 ops on `read`/`write`/`edit`; absent fs → disk `createCodingTools(cwd)` as today.
    - Functional: `createCodingToolProjection` emits path locations for successful `delete` (`metadata.path`) and `move` (`metadata.to` or `from`+`to`). No fake diffs.
    - Functional: ACP terminals remain pull-only; no stdin shim.
    - Performance: no extra protocol round-trips beyond the tool ops themselves.
    - Code Quality: no second edit implementation in `acp-agent`. Session tools are exposed through existing `AcpSessionBinding.tools` and selected in the per-session Prism agent config.
    - Security: client-fs payloads stay under existing AG-UI/ACP byte caps. `requireReadBeforeWrite` stays off by default; docs recommend on for editor mode.
  - Approach:
    - Documentation Reviewed:
      - `packages/acp-agent/src/index.ts` (global disk registry).
      - `packages/ag-ui/src/acp/agent/types.ts` (`AcpSessionBinding.tools`, `AcpCodingSeams`).
      - `packages/ag-ui/src/acp/coding-projection.ts`.
      - `packages/coding-agent/src/{delete,move}.ts` metadata.
    - Options Considered:
      - Process-global tools even with fs: rejected — session A must not write session B's buffers.
      - Default `requireReadBeforeWrite` on: breaking for disk hosts. Rejected.
    - Chosen Approach:
      - Wire seams + per-session tools. Projection grows two names. Hybrid staleness (search/glob/list/delete/move on disk) documented only. The spawnable agent uses a session-specific agent id for editor-backed registries so durable approval resumes resolve the same buffer adapter; local config identity satisfies the existing durable-effect gate without broadening permissions.
    - API Notes and Examples:
      ```ts
      const ops = input.coding?.filesystem
        ? createAcpFilesystemOperations(input.coding.filesystem)
        : undefined;
      const sessionTools = createToolRegistry(createCodingTools(input.cwd, ops
        ? { read: { operations: ops.read }, write: { operations: ops.write }, edit: { operations: ops.edit } }
        : undefined));
      const sessionAgent = input.coding?.filesystem
        ? createAgent({ ...prismAgent.config, id: `prism-acp-agent:${input.sessionId}`, tools: sessionTools })
        : prismAgent;
      return {
        session: sessionAgent.createSession({ id: input.sessionId ?? randomUUID() }),
        agentId: sessionAgent.config.id,
        tools: sessionTools,
      };
      ```
    - Files to Create/Edit:
      - `packages/acp-agent/src/index.ts`: coding seams + per-session tools.
      - `packages/acp-agent` tests (existing spawnable tests or new).
      - `packages/ag-ui/src/acp/coding-projection.ts`: delete/move locations.
      - `packages/ag-ui/src/acp/__tests__/` projection tests.
      - `docs/acp.md`: spawnable agent now uses client fs when advertised.
    - References:
      - `examples/acp-coding-host.ts` already receives `input.coding.filesystem` (example-only).
  - Test Cases to Write:
    - spawnable-with-fs: fake client fs; approved write/edit reaches the client map, not cwd disk; durable resume keeps same session adapter.
    - spawnable-without-fs: disk tools (today).
    - projection-delete: `{ path }` location.
    - projection-move: location uses `to` (and `from` if the mapper allows one path — prefer `to`).
    - projection-error: failed delete/move → no location.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — spawnable-agent behavior when client advertises fs; projection allow-list.
    - Docs pages to create/edit:
      - `docs/acp.md`: spawnable + projection table.
    - `docs/index.md` update: no this task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — `@arnilo/prism-computer-use-linux` package
  - Acceptance Criteria:
    - Functional: `createComputerUseLinuxTools(options)` fails closed when `process.platform !== "linux"` (overridable `platform` for tests). Requires `DeviceAdapter` `kind: "desktop-control"`, `enabled: true`, `sandbox`, and `runLimits`. Import of the package is inert (no spawn).
    - Functional: default tool set is the upstream MCP names **minus** `setup_accessibility` / `setup_window_targeting`. `includeSetupTools: true` adds them. Unknown upstream tools are omitted (fail closed), not forwarded.
    - Functional: read tools (`doctor`, lists, `get_app_state`, `screenshot`) skip `requireApproval` but still require an enabled sandboxed device. Mutators call `assertDeviceAdmit` + `assertExecutionAllowed` before MCP. Screenshots/a11y payloads pass `acceptDeviceChunk`; oversize → dropped marker, not forwarded.
    - Functional: mutating calls share one mutex (no concurrent input). `close()` closes the MCP bridge.
    - Performance: no extra screenshot scale beyond upstream + device chunk cap. Fake-bridge tests, no real binary in default CI.
    - Code Quality: workspace package; peers `@arnilo/prism` + `@arnilo/prism-mcp`. No `@agent-sh/computer-use-linux` dependency. Optional `connect` inject for tests.
    - Security: results `details.trust = "untrusted_external"` (or package equivalent already used by MCP bridge). Setup off by default. Telemetry redacted via host redactor if provided. No permission broadening.
  - Approach:
    - Documentation Reviewed:
      - `docs/device-adapters.md`, `src/devices.ts`, `docs/browser-automation.md`, `packages/browser/package.json`.
      - `packages/mcp/src/{bridge,types,transport}.ts`.
      - Context7 `/agent-sh/computer-use-linux` (upstream `README.md`, `_autodocs/mcp-tools.md`, and `npm/README.md`): stdio `mcp` startup, 18-tool catalog, screenshot bounds, and safety annotations.
    - Options Considered:
      - Required npm binary peer: supply-chain + optional-peer mess. Rejected (D1).
      - Depend on `@arnilo/prism-coding-agent` for `enforceExecutionPolicy`: rejected — call `assertExecutionAllowed` from core.
      - Prefix `desktop_*`: rejected — keep upstream names so the skill matches.
    - Chosen Approach:
      - Mirror browser: host supplies backend (binary), Prism supplies tools + policy + limits.
      - Classify by a frozen name table, not only MCP hints (hints are a check).
      - `connect` default = `connectMcpTools({ serverId, transport: { type: "stdio", command, args: ["mcp"] } })`.
      - Mutating approval is an explicit host `approved` option (default `false`); observations bypass that per-call approval but still pass device admission. Results use Prism's existing `metadata.trust = "untrusted_external"` shape.
    - API Notes and Examples:
      ```ts
      import { createComputerUseLinuxTools } from "@arnilo/prism-computer-use-linux";

      const desktop = await createComputerUseLinuxTools({
        command: "computer-use-linux",
        device: { kind: "desktop-control", enabled: true, requireApproval: true, sandbox: "linux-desktop" },
        runLimits: { maxTurns: 32, maxToolCalls: 200 },
        executionPolicy,
        approved: true, // set only after host approval; defaults false
        includeSetupTools: false,
      });
      for (const tool of desktop.tools) registry.register(tool);
      // later: await desktop.close();
      ```
    - Files to Create/Edit:
      - `packages/computer-use-linux/package.json`: create (`0.2.9` until Task 9).
      - `packages/computer-use-linux/tsconfig.json`, `LICENSE`, `README.md`, `CHANGELOG.md`.
      - `packages/computer-use-linux/src/index.ts`, `create.ts`, `classify.ts`.
      - `packages/computer-use-linux/src/__tests__/create.test.ts`.
      - root `package.json` `workspaces`: add `packages/computer-use-linux`.
      - `package-lock.json`: workspace link and peer graph.
      - `scripts/package-truth.json`: generated 56-package graph; no family add.
      - `scripts/phase24-truth.test.mjs`, `scripts/phase27-release.test.mjs`, `scripts/phase29-freeze.test.mjs`, `scripts/phase30-freeze.test.mjs`, `scripts/phase30-freeze-manifest.json`: package-count/task-state tripwires.
      - `scripts/phase13-freeze.test.mjs` through `scripts/phase21-freeze.test.mjs`: historical graph checks exclude the later 0.3.0 desktop package.
      - `src/__tests__/packaging.test.ts`, `src/__tests__/release.test.ts`, `src/__tests__/docs.test.ts`: package list, umbrella omission, changelog, and generated-count guards.
      - `README.md`, `docs/release-and-install.md`: generated package count and explicit umbrella omission.
      - `scripts/coverage-thresholds.json`: evidence-based line threshold for the new package.
    - References:
      - Browser package layout (`tsconfig.packages.json`, pack files, `sideEffects: false`).
      - MCP bridge already prefixes on collision; this factory exposes **unprefixed** upstream names.
  - Test Cases to Write:
    - factory-non-linux: throws.
    - factory-disabled / missing sandbox / missing runLimits: throws before connect.
    - default-set: setup tools absent; doctor+click present.
    - include-setup: setup tools present.
    - unknown-tool: fake bridge extra tool omitted.
    - click-denied-device: `approved: false` → no MCP execute.
    - click-denied-policy: `ExecutionDeniedError` → no MCP execute.
    - screenshot-oversize: `acceptDeviceChunk` drop; result names `dropped_oversize`.
    - serial-mutex: overlapping click+type; execute order is serial.
    - inert-import: importing the module does not call `connect`.
    - close: `close()` invoked on the fake bridge.
    - redaction-trust: accepted external result is redacted and carries `metadata.trust = "untrusted_external"`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package. Full API page is Task 8.
    - Docs pages to create/edit:
      - `packages/computer-use-linux/README.md`: install + 10-line example (package readme, not `/docs`).
      - `README.md`, `docs/release-and-install.md`: generated graph and umbrella omission must remain truthful after adding the workspace package.
    - `docs/index.md` update: no this task (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8 — Desktop skill + `/docs` API page
  - Acceptance Criteria:
    - Functional: `loadComputerUseLinuxSkill()` returns a Prism `SkillDefinition` from a package-local `SKILL.md` (doctor first, target window, prefer `role|name`, no concurrent input, setup is host-only). No upstream tree resolve. `files` includes the skill path.
    - Functional: `docs/computer-use-linux.md` follows the API page template. `docs/device-adapters.md` states a vendor package now exists and stays generic. `docs/index.md` Tools group gains an entry.
    - Performance: skill load is a bounded file read (`MAX_SKILL_FILE_BYTES` pattern from impeccable, reuse constant or a local 64 KiB cap).
    - Code Quality: skill body is Prism-authored, short. Do not vendor the full upstream skill tree.
    - Security: skill text does not tell the model to run setup tools or disable approval.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API page template.
      - `docs/device-adapters.md`, `docs/browser-automation.md`, `docs/impeccable.md`.
      - `packages/prism-impeccable/src/skills.ts` (resolve pattern — **do not copy** upstreamPath).
      - Upstream SKILL.md procedure (cite, do not vendor).
    - Options Considered:
      - `upstreamPath` to the npm package: optional peer + resolve complexity. Rejected.
      - No skill, docs only: rejected — agents need the procedure next to the tools.
    - Chosen Approach:
      - Ship `packages/computer-use-linux/skills/computer-use-linux/SKILL.md`. Loader reads it with a byte cap.
    - API Notes and Examples:
      ```ts
      import { createComputerUseLinuxTools, loadComputerUseLinuxSkill } from "@arnilo/prism-computer-use-linux";
      skills.register(loadComputerUseLinuxSkill());
      ```
    - Files to Create/Edit:
      - `packages/computer-use-linux/skills/computer-use-linux/SKILL.md`: create.
      - `packages/computer-use-linux/src/skill.ts` + `src/__tests__/skill.test.ts`.
      - `packages/computer-use-linux/src/index.ts`: export skill loader and bounded-load constants.
      - `packages/computer-use-linux/package.json` `files`: include `skills`; `README.md`: document bundled skill.
      - `src/__tests__/packaging.test.ts`: assert the packaged skill path is present.
      - `scripts/phase30-freeze-manifest.json`: mark Task 8 done after verification.
      - `docs/computer-use-linux.md`: create (full template).
      - `docs/device-adapters.md`: vendor exists; contract stays generic.
      - `docs/index.md`: Tools entry.
      - `src/__tests__/docs.test.ts`: API-page and Tools-navigation guards.
    - References:
      - prism-wiki API page sections (What / When / Inputs / Outputs / examples / Security / Related).
  - Test Cases to Write:
    - skill-load: name + non-empty body, size under cap.
    - skill-mentions: `doctor`, `get_app_state`, `role|name`; does not mention `includeSetupTools: true` as default.
    - docs-index: freeze or docs test that the new index bullet exists (if a docs-index test already greps groups; otherwise Task 10).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — skill export + public docs.
    - Docs pages to create/edit:
      - `docs/computer-use-linux.md`: full API page.
      - `docs/device-adapters.md`: vendor pointer.
    - `docs/index.md` update: yes — Tools: Linux desktop control (`@arnilo/prism-computer-use-linux`) over host-owned `computer-use-linux` MCP, DeviceAdapter admit, setup tools off by default.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9 — 0.3.0 lockstep cut, `^0.3.0` ranges, flip default to independent
  - Acceptance Criteria:
    - Functional: every publishable manifest is `0.3.0`. Internal `@arnilo/*` `dependencies` / `optionalDependencies` / `peerDependencies` that were exact `0.2.9` become `^0.3.0`. Lockfile matches. `package-truth.json` records per-package versions and `peerPolicy: { decision: "B", spec: "^0.3.0", atomicUpgrade: false }`.
    - Functional: default `release.mjs check` / `publish` is independent (no `--version` required). Lockstep remains available as `--lockstep --version 0.3.0` for one more emergency train, then unused.
    - Functional: `.github/workflows/release.yml` publish job triggers on tags `@arnilo/*@*` (and still on `v0.3.0` for this cut only). After this cut, a `v*` tag must **not** publish all 56 packages. Verify job stays monorepo-wide on PR/main.
    - Functional: a simulated coding-agent-only bump to `0.3.1` with others at `0.3.0` passes independent check and would publish one package.
    - Performance: one lockstep bump + one lockfile regen.
    - Code Quality: freeze/docs tripwires that assert a single version are updated, not deleted without replacement.
    - Security: `sdk:ready` + `release:gate` (or documented subset) green on the cut; dry-run publish does not skip unexplained surfaces.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs`, `scripts/package-truth.mjs`, `docs/release-and-install.md` Decision A.
      - `.github/workflows/release.yml` publish job.
      - `scripts/phase24-truth.test.mjs` / docs tests that pin `0.2.9`.
    - Options Considered:
      - Flip first, then bump only dirty packages to 0.3.0: mixed 0.2.9/0.3.0 graph. Rejected.
      - Keep exact peers at 0.3.0: rejected (D8) — that is still lockstep.
    - Chosen Approach:
      - `bump --from 0.2.9 --to 0.3.0`, then rewrite exact internal pins → `^0.3.0` (same script, `--ranges caret`). Regen lockfile + package-truth + compat baselines (additive only; `--allow-break` only if a real removal appears — it should not).
      - Flip CLI default to independent. Update CI publish tag filter.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.2.9 --to 0.3.0
      node scripts/release.mjs bump --ranges caret --from 0.3.0 --to 0.3.0
      npm install --package-lock-only --ignore-scripts
      node scripts/package-truth.mjs
      npm run release:check -- --independent
      ```
    - Files to Create/Edit:
      - every publishable `package.json` version + internal ranges (including the new desktop package).
      - `package-lock.json`.
      - `src/index.ts`, current package/version/install-smoke/packaging tests, and package manifest tests that pinned exact peers.
      - `scripts/package-truth.mjs` / `scripts/package-truth.json`.
      - `scripts/release.mjs`: default mode independent, explicit `--lockstep`, caret-range rewrite, changed-package publish filtering, and package-tag validation.
      - `.github/workflows/release.yml`: package-tag publish; generic `v*` excluded after the one `v0.3.0` lockstep publish.
      - `scripts/compat-baseline/**`: add the desktop package declaration baseline and refresh the root version-literal baseline.
      - `scripts/phase30-baseline.json`: retain inherited release-evidence counts/protected references for the phase gate.
      - `scripts/phase30-freeze-manifest.json`, phase30/phase24/phase27/phase26 tripwires, and docs tests that hard-coded Decision A / 55 packages / exact peers.
    - References:
      - Plan 024 Decision A; this release is Decision B.
  - Test Cases to Write:
    - truth: 56 publishable, `peerPolicy.decision === "B"`, mixed versions allowed in schema.
    - post-flip fixture: coding-agent 0.3.1 + others 0.3.0 + `^0.3.0` → independent check passes; lockstep check fails.
    - CI workflow file contains `@arnilo/*@*` and does not publish on generic `v*` after the cut (assert YAML).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — install/release contract.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: Decision B, tag scheme, caret window.
      - `docs/migration.md`: `0.2.9 → 0.3.0` (lockstep then independent; peer range change; new package; coding/ACP adds).
    - `docs/index.md` update: yes — Task 10 owns the blurb refresh but this task may already need the version literal.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 10 — Docs, roadmap, changelogs, closeout verification
  - Acceptance Criteria:
    - Functional: `docs/index.md` Tools + release blurbs match 0.3.0 (56 packages, desktop vendor, `findText`, ACP buffer wiring, Decision B). `roadmap.md` 0.3.0 is this cut; live canary / delegated agents listed under later 0.3.x. Root + package CHANGELOGs record the cut.
    - Functional: `docs/coding-agent-tools.md`, `docs/acp.md`, `docs/computer-use-linux.md`, `docs/device-adapters.md`, `docs/release-and-install.md`, `docs/migration.md` are mutually consistent (no leftover “no vendor package”, no Decision A as current).
    - Performance: docs-only; existing docs tests / package-truth gates pass.
    - Code Quality: no new abstraction; no extra evidence files beyond what tasks already added.
    - Security: migration states desktop is deny-by-default and omitted from umbrellas; ACP image/document stay fail-closed on client fs.
  - Approach:
    - Documentation Reviewed:
      - All pages touched by Tasks 2–9; `docs/index.md`; `roadmap.md`; `CHANGELOG.md`; `docs/migration.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Skip index blurb (too long already): rejected — index is the navigation contract.
    - Chosen Approach:
      - One closeout pass. Run `npm test` subset: freeze, phase30-release, coding-agent, acp-agent, ag-ui projection, computer-use-linux, package-truth, docs tests that pin versions.
    - API Notes and Examples:
      ```md
      ## 0.2.9 → 0.3.0
      - Last lockstep. First-party peers become ^0.3.0.
      - New optional @arnilo/prism-computer-use-linux (not in prism-all / prism-code).
      - read.findText; edit fuzzy/miss context; ACP editor-buffer operations.
      ```
    - Files to Create/Edit:
      - `docs/index.md`, `docs/migration.md`, `docs/release-and-install.md` (final pass).
      - `docs/0.1.0-readiness.md`: current-line status.
      - `roadmap.md` 0.3.0 / leftovers.
      - `CHANGELOG.md` plus `packages/computer-use-linux/CHANGELOG.md`, `packages/coding-agent/CHANGELOG.md`, `packages/ag-ui/CHANGELOG.md`, and `packages/acp-agent/CHANGELOG.md`.
      - `README.md` version/package count and current package list.
      - `scripts/phase30-freeze.test.mjs`: closeout docs/changelog tripwire.
      - `src/__tests__/docs.test.ts`: refresh current 0.3.0 package-count assertion.
      - `plans/README.md`: 030 status.
    - References:
      - Plan 029 Task 10 closeout pattern.
  - Test Cases to Write:
    - freeze still green; deviations from Tasks 1–9 recorded with rationale.
    - package-truth 56 + Decision B.
    - index contains `computer-use-linux` and `findText` / Decision B tokens (docs test or freeze evidence grep).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — navigation + migration + release story.
    - Docs pages to create/edit:
      - `docs/index.md`: Tools entry + release blurb (0.3.0, 56 packages, Decision B).
      - `docs/migration.md`: 0.2.9 → 0.3.0.
      - `docs/release-and-install.md`: current-line counts.
    - `docs/index.md` update: yes — Tools: Linux desktop control; Release: 0.3.0 / 56 / independent versions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

Known constraints (locked before execution):

- Desktop is a wrap, not a port. Upstream bugs stay upstream.
- Desktop stays out of umbrellas.
- Independent versions use the 0.3 caret window. Core 0.4.0 is a coordinated peer bump.
- No live Linux desktop in default CI. Fake MCP + named protected skip.
- Fuzzy matching stays, but becomes visible.
- Live canary matrix and delegated-agent adapters stay off this train.
- `findText` does not extend `ReadOperations`; it pages existing `readText`.
- ACP `fs/edit` and terminal stdin are not invented.

Post-execution deviations:

- Task 5: ACP text responses expose no pagination metadata; adapter infers continuation from a full requested page, so an exact page-at-EOF may advertise one harmless empty continuation. This avoids a stateful cache and protocol extension.
- Task 6: coding tools declare durable local effects, so spawnable agents now project trusted local config identity from `userId`; this satisfies the existing approval/effect gate without adding permission or scope.
- Task 7: mutating desktop approval is a factory-level host boolean (`approved`, default `false`) rather than a new approval callback; existing Agent/ExecutionPolicy seams remain the per-run approval path. The upstream binary remains a host prerequisite, so CI uses fake MCP bridges only.
- Task 9: `phase30-baseline.json` retains inherited 0.2.9 release-evidence counts/protected references so the release-skip machine stays truthful until Task 10 records fresh 0.3.0 protected evidence; it does not claim a new Postgres/live-canary run.
- Task 10: closeout verification is network-free and validates the current docs/changelog contract; it intentionally does not fabricate fresh live-canary or Postgres evidence. Historical release sections remain as migration records, while current-line headings and 0.3.0 summaries are explicit. The documented readiness subset is green; full `sdk:ready` was not green in this host because setting `PRISM_TEST_POSTGRES_URL` opts the Postgres example into a connection and no local server is available.

## Further Actions

- **High — operator publication:** create the signed `v0.3.0` tag after protected prerequisites, run the lockstep publish once, then use `@arnilo/<package>@<version>` tags for independent publication. This checkout has not published to npm.
- **High — protected evidence refresh:** replace inherited phase30 release-skip references with fresh 0.3.0 Postgres/live-canary evidence before claiming full protected release readiness.
- **Medium — later 0.3.x:** activate live canaries, delegated-agent adapters, and enterprise/catalog breadth only with named demand and a new numbered plan.

Known deferrals (do not pull in):

- Collapsed desktop tools, optional npm binary peer — only if tool-count or install friction is measured.
- `apply_patch`, notebooks, default image transform helper.
- Live canary matrix, Cursor/Antigravity, Cedar / second object store — later 0.3.x on demand.
- 0.4.0: next core breaking window; all first-party peers move together.
