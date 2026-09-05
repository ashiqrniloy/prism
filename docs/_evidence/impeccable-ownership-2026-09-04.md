# Impeccable ownership decision

**Date:** 2026-09-04
**Plan:** 062 (Ecosystem gaps and dependency majors) — Impeccable ownership task
**Decision:** **(b) host-owned vendored snapshot with a digest pin** — consume-from-npm rejected with evidence; no third state documented.

## Decision tree (as exercised)

1. **Can we consume the upstream npm package?** No. Verified 2026-09-04 by inspecting the published tarball
   (`npm pack impeccable@3.6.1`): the package ships the **detector CLI** only
   (`cli/engine/detect-antipatterns.mjs`, `cli/bin/skills.mjs`, detector rules) — the skill tree
   is **not published**. The npm package's own README installs skills into harness folders by
   fetching/copying from the repo; the package itself contains zero `SKILL.md` files.
   Root cause: the skill tree lives in dot-directories (`.agent/skills/impeccable/`, `.agents/skills/impeccable/`),
   which npm publish excludes by default, so the published artifact is structurally the wrong one for a
   skill-consuming host. This matches what the local seam has always asserted
   (`upstream.ts`: *"npm impeccable is the detector CLI, not a skill tree"*).
2. **Vendor the snapshot in-repo?** Rejected. `@arnilo/prism-coding-tools` intentionally does not vendor the
   ~multi-MB skill body ("Prism does not vendor skill bodies", docs/impeccable.md); the fixture
   `fixtures/impeccable/upstream-minimal/` is a test fixture (<1 KB stand-in), not a snapshot.
3. **Selected state: host-owned vendored snapshot, pinned.** The integration consumes a host-supplied
   checkout (`upstreamPath`, any tree with `skills/impeccable/SKILL.md` or `SKILL.md`), and the seam now
   enforces an optional **digest pin** so "vendored with upstream commit recorded" is real, not prose.

## What was already true before this task

- `createImpeccableExtension({ upstreamPath })` registers exactly one skill + one dispatch command on `kernel.load`.
- Hosts point `upstreamPath` at their own Impeccable checkout (e.g. `dist/universal/impeccable` from a clone
  or `npx impeccable link` output) — that copy **is** the vendored snapshot; the host owns it via git.
- "No third state": there was never a mixed model — the only supported input is a host path whose
  `SKILL.md` parses as `name: impeccable`.

## What landed (2026-09-04)

- **`expectedSnapshotDigest` option** on `ImpeccableExtensionOptions` (sha256 hex of the resolved `SKILL.md`
  bytes, computed via `snapshotDigestOf` in `packages/prism-coding-tools/src/impeccable/skills.ts`).
  When set, `kernel.load` fails closed on drift *before* any registration; when absent, behavior is unchanged.
- **Tests** (`src/impeccable/__tests__/impeccable.test.ts`): matching pin loads, drift pin fails closed
  (digest mismatch error, zero registrations). Suite 10/10 green.
- **docs/impeccable.md** documents the pin + provenance convention.

## Provenance record

- Upstream repo: `https://github.com/pbakaus/impeccable`
- Upstream commit at decision time: `695df68a5860da4d25cd629fc3727ec8f3c0991b`
  ("Sync generated provider output", 2026-09-04, committer date 2026-09-04T09:31:58Z)
- Skill path in upstream: `.agent/skills/impeccable/SKILL.md` (compiled provider output also distributed
  under `dist/universal/impeccable/` for harness linking)

## Migration steps for hosts

State before: `createImpeccableExtension({ upstreamPath })` — upstream content untracked at the seam.
State after: same call shape; optionally add `expectedSnapshotDigest`.

1. Vendored snapshot (git checkout or `npx impeccable link` output) unchanged.
2. To pin: `sha256sum <snapshot>/skills/impeccable/SKILL.md` (or the `SKILL.md` at the snapshot root),
   pass as `expectedSnapshotDigest`.
3. Upgrade path: pull upstream fixes → recompute digest → bump the pin. A digest mismatch fails `kernel.load`
   with a redacted, bounded error naming the refresh step — a silent content swap is impossible.

## Security tracking

- Pin is content-addressed (sha256 of the parsed artifact) — commit-pin-equivalent without requiring `.git`
   in the compiled skill dir (which compiled provider output does not have).
- Untrusted content bounds unchanged: `MAX_SKILL_FILE_BYTES` (256 KiB) cap, path-escape rejection,
   redacted absolute-path errors.
- No network, no `npx`, no hook install on import/setup (unchanged).

## Decision record

- Options considered: leave ambiguous (rejected — review §6 flags it), consume npm (rejected — artifact is the
  CLI, not the skill tree; verified), vendor-in-repo (rejected — package policy), host-owned vendored + pin (chosen).
- Next review check: ownership model is one state; pin makes drift an explicit bump.