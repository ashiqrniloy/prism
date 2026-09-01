# Migrate legacy 0.3 packages to Prism 0.4

> **Status: 0.4 release draft.** Follow this guide only after the 0.4 packages are published.
> Until then, stay on your current 0.3.x package set. This page is the permanent destination of
> npm's legacy-package warnings.

## What changes

Prism 0.4 replaces 62 separate 0.3 package manifests with 11 active packages and explicit
subpaths. The code and behavior move; this is not a database/data migration. It is a **package
name and import-specifier migration**.

- Existing applications pinned to 0.3.x continue to work.
- Retired packages are not unpublished. Their final release remains on npm with its `latest`
  tag and gains a `legacy` tag plus an install-time deprecation warning.
- `npm install` cannot automatically replace one package name with another. Upgrade each package
  dependency and its imports together.
- There are no 0.4 compatibility wrappers. New packages never import old package names, so the
  package graph cannot form a wrapper cycle.
- `@arnilo/prism` stays small and dependency-free. Runtime, sessions, governance, and optional
  drivers live in `@arnilo/prism-core`, not root-package subpaths.

## Before you start

1. Commit or lock your working 0.3.x application.
2. Record installed Prism packages and direct imports:

   ```bash
   npm ls --all @arnilo/prism @arnilo/prism-*
   rg -n 'from "@arnilo/prism|import\("@arnilo/prism' src test
   ```

3. Classify each package using the tables below. Leave unchanged interop packages in place.
4. Upgrade package dependencies and imports in one pull request; then run your normal typecheck,
   tests, and packed-install smoke test.
5. Add optional peers only for subpaths you use. Do not add a database, browser, parser, or host
   binary merely because a family package is installed.

## Active 0.4 packages

| Package | Use it for |
|---|---|
| `@arnilo/prism` | Contracts, agent APIs, CLI, root `node/*` and `testing/*` exports. |
| `@arnilo/prism-core` | Runtime, sessions, governance, credentials, persistence, work integration, JSON Schema validation. |
| `@arnilo/prism-providers` | All first-party provider adapters as explicit subpaths. |
| `@arnilo/prism-coding-tools` | Coding agent/security, document reader, OpenAPI, desktop control, Dev inspector, Caveman, Ponytail, Impeccable. |
| `@arnilo/prism-web-tools` | Generic web tools plus browser and Obscura subpaths. |
| `@arnilo/prism-memory` | Memory, RAG, compaction, Graft, Wiki. |
| `@arnilo/prism-office` | Documents, sheets, and diagrams. |
| `@arnilo/prism-mcp` | MCP interop. |
| `@arnilo/prism-acp-agent` | ACP interop. |
| `@arnilo/prism-ag-ui` | AG-UI/A2A/A2UI interop. |
| `@arnilo/prism-antigravity-agent` | Antigravity interop. |

## Package and import mapping

Replace the package name in `package.json` and every corresponding source import. The tables map
root package entrypoints. Any documented non-root entrypoint keeps its feature suffix under the
new family path; the 0.4 API page for that family is authoritative for exact nested exports.

### Providers

Install `@arnilo/prism-providers` once, then import only the provider subpath used by the host.

| Legacy 0.3 package | 0.4 import |
|---|---|
| `@arnilo/prism-provider-ai-sdk` | `@arnilo/prism-providers/ai-sdk` |
| `@arnilo/prism-provider-alibaba` | `@arnilo/prism-providers/alibaba` |
| `@arnilo/prism-provider-anthropic` | `@arnilo/prism-providers/anthropic` |
| `@arnilo/prism-provider-azure` | `@arnilo/prism-providers/azure` |
| `@arnilo/prism-provider-bedrock` | `@arnilo/prism-providers/bedrock` |
| `@arnilo/prism-provider-clinepass` | `@arnilo/prism-providers/clinepass` |
| `@arnilo/prism-provider-deepseek` | `@arnilo/prism-providers/deepseek` |
| `@arnilo/prism-provider-google` | `@arnilo/prism-providers/google` |
| `@arnilo/prism-provider-kimi` | `@arnilo/prism-providers/kimi` |
| `@arnilo/prism-provider-neuralwatt` | `@arnilo/prism-providers/neuralwatt` |
| `@arnilo/prism-provider-ollama` | `@arnilo/prism-providers/ollama` |
| `@arnilo/prism-provider-openai` | `@arnilo/prism-providers/openai` |
| `@arnilo/prism-provider-opencode-go` | `@arnilo/prism-providers/opencode-go` |
| `@arnilo/prism-provider-openrouter` | `@arnilo/prism-providers/openrouter` |
| `@arnilo/prism-provider-vertex` | `@arnilo/prism-providers/vertex` |
| `@arnilo/prism-provider-xai` | `@arnilo/prism-providers/xai` |
| `@arnilo/prism-provider-zai` | `@arnilo/prism-providers/zai` |

```ts
// Before
import * as openai from "@arnilo/prism-provider-openai";

// After
import * as openai from "@arnilo/prism-providers/openai";
```

### Runtime, sessions, governance, and work integration

Install `@arnilo/prism-core`, then choose the specific subpath. This family does not add
optional drivers to your host automatically.

| Legacy 0.3 package | 0.4 import |
|---|---|
| `@arnilo/prism-server` | `@arnilo/prism-core/runtime/server` |
| `@arnilo/prism-supervisor` | `@arnilo/prism-core/runtime/supervisor` |
| `@arnilo/prism-workflows` | `@arnilo/prism-core/runtime/workflows` |
| `@arnilo/prism-session-store-codecs` | `@arnilo/prism-core/sessions/codecs` |
| `@arnilo/prism-session-store-nats` | `@arnilo/prism-core/sessions/nats` |
| `@arnilo/prism-session-store-postgres` | `@arnilo/prism-core/sessions/postgres` |
| `@arnilo/prism-session-store-sqlite` | `@arnilo/prism-core/sessions/sqlite` |
| `@arnilo/prism-policy` | `@arnilo/prism-core/governance/policy` |
| `@arnilo/prism-evals` | `@arnilo/prism-core/governance/evals` |
| `@arnilo/prism-prompts` | `@arnilo/prism-core/governance/prompts` |
| `@arnilo/prism-model-router` | `@arnilo/prism-core/governance/model-router` |
| `@arnilo/prism-observability-opentelemetry` | `@arnilo/prism-core/governance/observability` |
| `@arnilo/prism-credentials-node` | `@arnilo/prism-core/credentials/node` |
| `@arnilo/prism-enterprise-postgres` | `@arnilo/prism-core/enterprise/postgres` |
| `@arnilo/prism-work-tools` | `@arnilo/prism-core/integrations/work` |
| `@arnilo/prism-tool-validator-json-schema` | `@arnilo/prism-core/validation/json-schema` |

`work-tools` belongs to core because enterprise Postgres composes its work-idempotency store.
It is not part of coding tools.

### Coding tools and personas

Install `@arnilo/prism-coding-tools`; import the smallest needed subpath. The `prism-dev` binary
continues to be named `prism-dev` after migration.

| Legacy 0.3 package | 0.4 import |
|---|---|
| `@arnilo/prism-coding-agent` | `@arnilo/prism-coding-tools/agent` |
| `@arnilo/prism-coding-security` | `@arnilo/prism-coding-tools/security` |
| `@arnilo/prism-document-reader` | `@arnilo/prism-coding-tools/document-reader` |
| `@arnilo/prism-openapi-tools` | `@arnilo/prism-coding-tools/openapi` |
| `@arnilo/prism-computer-use-linux` | `@arnilo/prism-coding-tools/computer-use-linux` |
| `@arnilo/prism-dev` | `@arnilo/prism-coding-tools/dev` |
| `@arnilo/prism-caveman` | `@arnilo/prism-coding-tools/caveman` |
| `@arnilo/prism-ponytail` | `@arnilo/prism-coding-tools/ponytail` |
| `@arnilo/prism-impeccable` | `@arnilo/prism-coding-tools/impeccable` |

### Web, browser, and Obscura

`@arnilo/prism-web-tools` keeps its root entrypoint for generic research tools. Browser and
Obscura become explicit subpaths; neither activates a browser or process on import.

| Legacy 0.3 package | 0.4 import |
|---|---|
| `@arnilo/prism-browser` | `@arnilo/prism-web-tools/browser` |
| `@arnilo/prism-obscura` | `@arnilo/prism-web-tools/obscura` |

### Memory, RAG, compaction, and context

`@arnilo/prism-memory` retains its root memory entrypoint and gains explicit subpaths. The
`prism-wiki` binary remains named `prism-wiki` and continues to ship Wiki skills.

| Legacy 0.3 package | 0.4 import or install |
|---|---|
| `@arnilo/prism-rag` | `@arnilo/prism-memory/rag` |
| `@arnilo/prism-compaction-llm` | `@arnilo/prism-memory/compaction/llm` |
| `@arnilo/prism-compaction-observational-memory` | `@arnilo/prism-memory/compaction/observational-memory` |
| `@arnilo/prism-graft` | `@arnilo/prism-memory/graft` |
| `@arnilo/prism-wiki` | `@arnilo/prism-memory/wiki` |
| `@arnilo/prism-compaction` | Install `@arnilo/prism-memory`; choose one or both compaction subpaths. No direct import replacement: it was a profile-only manifest. |

### Office suite

Plans 051–053 drafted three separate packages. They were never published to npm.
Install `@arnilo/prism-office` and import the subpath:

| Draft 0.3 name | 0.4 import |
|---|---|
| `@arnilo/prism-documents` | `@arnilo/prism-office/documents` |
| `@arnilo/prism-sheets` | `@arnilo/prism-office/sheets` |
| `@arnilo/prism-diagrams` | `@arnilo/prism-office/diagrams` |

```ts
import { generateDocument } from "@arnilo/prism-office/documents";
import { parseCsv } from "@arnilo/prism-office/sheets";
```

`@office-open/{docx,xlsx,pptx,xml}` are exact-pinned regular dependencies of the
office tarball. The diagrams live-embed optionally peers `playwright-core`; XML
canonicalization does not.

### Removed profile packages

Profiles were dependency lists, not runtime APIs. Choose the families your host uses; do not look
for a 0.4 profile replacement package.

| Legacy 0.3 profile | 0.4 starting recipe |
|---|---|
| `@arnilo/prism-base` | `npm i @arnilo/prism@^0.4.0 @arnilo/prism-core@^0.4.0 @arnilo/prism-memory@^0.4.0` |
| `@arnilo/prism-code` | Base recipe + `@arnilo/prism-coding-tools@^0.4.0 @arnilo/prism-mcp@^0.4.0` |
| `@arnilo/prism-sdk` | Base recipe + `@arnilo/prism-mcp@^0.4.0`; Core contains credentials, observability, and workflows. |
| `@arnilo/prism-all` | Select required families explicitly. Begin with Core, Providers, Coding tools, Web tools, Memory, and required interop; add Office only if needed. |

### Names that remain

These package names remain valid. Review their imports if they now consume one of the new family
subpaths, but do not rename the dependency merely because of 0.4.

| Package | 0.4 status |
|---|---|
| `@arnilo/prism` | Unchanged root package; remains dependency-free. |
| `@arnilo/prism-providers` | Same name, now code family; provider imports use `/provider-name`. |
| `@arnilo/prism-web-tools` | Same name; root web tools unchanged, browser/Obscura use subpaths. |
| `@arnilo/prism-memory` | Same name; RAG/compaction/Graft/Wiki use subpaths. |
| `@arnilo/prism-mcp` | Unchanged interop package. |
| `@arnilo/prism-acp-agent` | Unchanged interop package. |
| `@arnilo/prism-ag-ui` | Unchanged interop package. |
| `@arnilo/prism-antigravity-agent` | Unchanged interop package. |

## Optional peers, host binaries, and trust boundaries

Installing a family does not install or activate its optional capabilities. Add the peer only for
the subpath you use and preserve its existing host policy.

| Feature | Required host dependency / action | Do not weaken |
|---|---|---|
| SQLite sessions or prompt store | Install `better-sqlite3`; use only the selected `prism-core` session/governance subpath. | Database ownership, migration checks, and file permissions. |
| PostgreSQL sessions, prompts, or enterprise state | Install `pg`; use the selected `prism-core` subpath. | TLS, roles, checksummed migrations, and tenant boundaries. |
| NATS sessions | Install/configure the NATS client required by the sessions NATS subpath. | Stream/consumer ownership and durable cursor isolation. |
| Browser tools | Install `playwright-core` and provide the approved host browser/context. | Egress, upload/download, screenshot, and side-effect policies. |
| Obscura | Install/configure `playwright-core`, `@arnilo/prism-mcp`, and an approved host Obscura binary. | Absolute shell-free command, SSRF controls, process limits, MCP authorization. |
| Document reader | Install `mammoth` and/or `pdf-parse` for used formats. | Magic-byte format gating, input/page/text caps, and no embedded-content execution. |
| Graft | Install/configure `@nanonets/graft` or approved host CLI. | Workspace confinement, output/time limits, and no implicit process start. |
| Wiki | Provide the documented host `qmd`/Context7 setup when using Wiki commands. | Workspace path, process, and untrusted-content limits. |
| Computer Use Linux | Provide the approved `computer-use-linux` MCP host binary. | Consent, sandbox, approval, serialized input, and redaction. |

## Recommended upgrade sequence

1. **Move root/version first.** Set `@arnilo/prism` to `^0.4.0`; retain the Node version required
   by the release.
2. **Replace retired dependency names.** Use the appropriate family package in `package.json`.
3. **Replace imports.** Apply the tables above. Do not keep both old and new imports in the same
   runtime path.
4. **Add only needed peers.** Follow the previous table; subpath import failures should name the
   missing peer rather than fall back to an unsafe implementation.
5. **Recheck host wiring.** Re-register tools/providers/extensions explicitly. Package install
   remains inert; it must not activate providers, listeners, database connections, browsers,
   credentials, or tools.
6. **Run verification.**

   ```bash
   npm run typecheck
   npm test
   npm pack --dry-run
   ```

   Run protected PostgreSQL, browser, Obscura, MCP, or host-binary checks separately when your
   application uses those integrations.

## Legacy warning and lifecycle

Each retired package's final 0.3 release is marked with npm's `legacy` dist-tag and a deprecation
warning like:

```text
npm warn deprecated @arnilo/prism-browser@0.3.x:
Legacy 0.3 package. Prism 0.4+: @arnilo/prism-web-tools/browser.
https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#web-browser-and-obscura
```

The warning is informational: it does not delete the package or rewrite your dependency. `latest`
continues to point at the final 0.3 release because npm dist-tags cannot redirect one package name
to a different package. New 0.4 development must use the successor listed above.

The markers are generated and applied from one reviewed registry plan — never hand-copied. Run
`node scripts/phase54-legacy-registry.mjs --dry-run` to resolve every retired name's final
published version, verify the anchors above exist in this guide, and print the exact
`npm dist-tag add ... legacy` and `npm deprecate ..."<0.4.0"` commands without mutating the
registry. After the 0.4 packages and this guide are public (Task 9 cutover),
`node scripts/phase54-legacy-registry.mjs --apply --confirm` pre-flights every entry and fails
closed — zero mutations — on any mismatch, then applies the tags and warnings idempotently:
already-correct entries are skipped on resume, and per-entry status is written to
`release-artifacts/legacy-registry-plan.json` for safe resume. Two retired names
(`@arnilo/prism-prompts`, `@arnilo/prism-dev`) were never published; they are recorded in the
plan with no registry action.

## Rollback

If the 0.4 migration fails before deployment:

1. Restore the committed 0.3.x `package.json` and lockfile.
2. Restore old imports from the mapping table.
3. Reinstall with the lockfile (`npm ci`).
4. Do not unpublish any package or remove the `legacy` marker; those are registry metadata, not a
   runtime migration.

The package reorganization itself does not change persisted store schemas. If the same deployment
also adopted a separate database/session feature release, follow that feature's migration and
rollback instructions; do not assume package rollback reverses a forward-only database migration.

## FAQ

**Can I install `@arnilo/prism-all` in 0.4?** No. It was a pure manifest and is retired. Install
only the family packages your host needs.

**Why is `@arnilo/prism-core` separate from `@arnilo/prism`?** Root Prism remains dependency-free.
Database drivers, optional Node integrations, and governance/runtime modules must not become
implicit root dependencies.

**Why not keep old packages as wrappers?** Wrappers preserve 54 active manifests and create a
cycle if a new family imports the old implementation while the old package re-exports the family.
The direct migration is smaller and unambiguous.

**Do unchanged interop packages need changes?** No package-name change. Keep MCP, ACP, AG-UI, or
Antigravity installed only when your host uses that protocol; update imports only if their own 0.4
API page says so.

## Related APIs

- [Release and install](release-and-install.md): package contents, peer rules, and publication.
- [Migration guide](migration.md): migration history for prior releases.
- [Provider packages](provider-packages.md): provider adapter behavior.
- [Host security guide](host-security.md): preserve host trust boundaries while upgrading.
