# Task 37 — manual registry cleanup list

`@arnilo` scope as read on 2026-11-08 (`docs/_evidence/registry/arnilo-scope-2026-11-08.json`).
Owner-run half of plan 215 Task 37: the executor has no TTY, so npm 12 refuses the passkey
browser flow with `EOTP` (`/usr/lib/node_modules/npm/lib/utils/auth.js`) and cannot run these.
Exact copy-paste commands in the same order are in `arnilo-cleanup-plan-2026-11-08.sh`.

Run signed in, on a machine where a browser can open: npm asks for a passkey per write.
Nothing here is reversible, and an unpublished version never comes back.

## 1. Delete the whole name — 24 names

Each line removes every published version of the name. The last column counts versions that
the registry never marked deprecated — deleting the name takes those too, which is intended
because `scripts/deprecations-0.13.json` retires the whole name.

| package | versions | latest | never deprecated |
| --- | --- | --- | --- |
| `@arnilo/prism-all` | 45 | 0.3.0 | 0 |
| `@arnilo/prism-acp-agent` | 22 | 0.12.1 | 22 |
| `@arnilo/prism-code` | 44 | 0.4.1 | 2 |
| `@arnilo/prism-agent-sdk` | 1 | 0.1.0 | 1 |
| `@arnilo/prism-hooks` | 5 | 0.12.1 | 5 |
| `@arnilo/prism-memory` | 59 | 0.12.1 | 59 |
| `@arnilo/prism-provider-ai-sdk` | 42 | 0.3.1 | 0 |
| `@arnilo/prism-provider-alibaba` | 33 | 0.3.1 | 0 |
| `@arnilo/prism-provider-anthropic` | 36 | 0.3.1 | 0 |
| `@arnilo/prism-provider-azure` | 34 | 0.3.1 | 0 |
| `@arnilo/prism-provider-bedrock` | 34 | 0.3.1 | 0 |
| `@arnilo/prism-provider-clinepass` | 3 | 0.3.1 | 0 |
| `@arnilo/prism-provider-deepseek` | 3 | 0.3.1 | 0 |
| `@arnilo/prism-provider-google` | 36 | 0.3.1 | 0 |
| `@arnilo/prism-provider-kimi` | 46 | 0.3.1 | 0 |
| `@arnilo/prism-provider-neuralwatt` | 45 | 0.3.1 | 0 |
| `@arnilo/prism-provider-ollama` | 33 | 0.3.1 | 0 |
| `@arnilo/prism-provider-openai` | 46 | 0.3.1 | 0 |
| `@arnilo/prism-provider-vertex` | 34 | 0.3.1 | 0 |
| `@arnilo/prism-provider-xai` | 3 | 0.3.1 | 0 |
| `@arnilo/prism-provider-zai` | 46 | 0.3.1 | 0 |
| `@arnilo/prism-providers` | 63 | 0.12.1 | 63 |
| `@arnilo/prism-web-tools` | 56 | 0.12.1 | 56 |
| `@arnilo/prism-work` | 7 | 0.12.1 | 7 |

```sh
npm unpublish @arnilo/prism-all --force
npm unpublish @arnilo/prism-acp-agent --force
npm unpublish @arnilo/prism-code --force
npm unpublish @arnilo/prism-agent-sdk --force
npm unpublish @arnilo/prism-hooks --force
npm unpublish @arnilo/prism-memory --force
npm unpublish @arnilo/prism-provider-ai-sdk --force
npm unpublish @arnilo/prism-provider-alibaba --force
npm unpublish @arnilo/prism-provider-anthropic --force
npm unpublish @arnilo/prism-provider-azure --force
npm unpublish @arnilo/prism-provider-bedrock --force
npm unpublish @arnilo/prism-provider-clinepass --force
npm unpublish @arnilo/prism-provider-deepseek --force
npm unpublish @arnilo/prism-provider-google --force
npm unpublish @arnilo/prism-provider-kimi --force
npm unpublish @arnilo/prism-provider-neuralwatt --force
npm unpublish @arnilo/prism-provider-ollama --force
npm unpublish @arnilo/prism-provider-openai --force
npm unpublish @arnilo/prism-provider-vertex --force
npm unpublish @arnilo/prism-provider-xai --force
npm unpublish @arnilo/prism-provider-zai --force
npm unpublish @arnilo/prism-providers --force
npm unpublish @arnilo/prism-web-tools --force
npm unpublish @arnilo/prism-work --force
```

## 2. Delete the retired versions only — 3 names, 104 commands

0.13.0 republishes these names. Delete exactly the versions below and **never the name**:
a name whose every version is gone is blocked from republishing for 24 hours.

| package | versions to delete | latest on the retired line |
| --- | --- | --- |
| `@arnilo/prism-channels` | 7 (0.8.0 … 0.12.1) | 0.12.1 |
| `@arnilo/prism-ag-ui` | 51 (0.0.12 … 0.12.1) | 0.12.1 |
| `@arnilo/prism-provider-openrouter` | 46 (0.0.1 … 0.3.1) | 0.3.1 |

```sh
npm unpublish @arnilo/prism-channels@0.10.0 --force
npm unpublish @arnilo/prism-channels@0.11.0 --force
npm unpublish @arnilo/prism-channels@0.11.1 --force
npm unpublish @arnilo/prism-channels@0.12.0 --force
npm unpublish @arnilo/prism-channels@0.12.1 --force
npm unpublish @arnilo/prism-channels@0.8.0 --force
npm unpublish @arnilo/prism-channels@0.9.0 --force
npm unpublish @arnilo/prism-ag-ui@0.0.12 --force
npm unpublish @arnilo/prism-ag-ui@0.0.13 --force
npm unpublish @arnilo/prism-ag-ui@0.0.14 --force
npm unpublish @arnilo/prism-ag-ui@0.0.15 --force
npm unpublish @arnilo/prism-ag-ui@0.0.16 --force
npm unpublish @arnilo/prism-ag-ui@0.0.17 --force
npm unpublish @arnilo/prism-ag-ui@0.0.18 --force
npm unpublish @arnilo/prism-ag-ui@0.0.19 --force
npm unpublish @arnilo/prism-ag-ui@0.0.20 --force
npm unpublish @arnilo/prism-ag-ui@0.0.22 --force
npm unpublish @arnilo/prism-ag-ui@0.0.23 --force
npm unpublish @arnilo/prism-ag-ui@0.0.24 --force
npm unpublish @arnilo/prism-ag-ui@0.0.25 --force
npm unpublish @arnilo/prism-ag-ui@0.0.26 --force
npm unpublish @arnilo/prism-ag-ui@0.0.27 --force
npm unpublish @arnilo/prism-ag-ui@0.1.0 --force
npm unpublish @arnilo/prism-ag-ui@0.1.1 --force
npm unpublish @arnilo/prism-ag-ui@0.1.2 --force
npm unpublish @arnilo/prism-ag-ui@0.1.3 --force
npm unpublish @arnilo/prism-ag-ui@0.1.4 --force
npm unpublish @arnilo/prism-ag-ui@0.1.5 --force
npm unpublish @arnilo/prism-ag-ui@0.1.6 --force
npm unpublish @arnilo/prism-ag-ui@0.1.7 --force
npm unpublish @arnilo/prism-ag-ui@0.10.0 --force
npm unpublish @arnilo/prism-ag-ui@0.11.0 --force
npm unpublish @arnilo/prism-ag-ui@0.11.1 --force
npm unpublish @arnilo/prism-ag-ui@0.12.0 --force
npm unpublish @arnilo/prism-ag-ui@0.12.1 --force
npm unpublish @arnilo/prism-ag-ui@0.2.0 --force
npm unpublish @arnilo/prism-ag-ui@0.2.1 --force
npm unpublish @arnilo/prism-ag-ui@0.2.2 --force
npm unpublish @arnilo/prism-ag-ui@0.2.3 --force
npm unpublish @arnilo/prism-ag-ui@0.2.4 --force
npm unpublish @arnilo/prism-ag-ui@0.2.5 --force
npm unpublish @arnilo/prism-ag-ui@0.2.6 --force
npm unpublish @arnilo/prism-ag-ui@0.2.7 --force
npm unpublish @arnilo/prism-ag-ui@0.2.8 --force
npm unpublish @arnilo/prism-ag-ui@0.2.9 --force
npm unpublish @arnilo/prism-ag-ui@0.3.0 --force
npm unpublish @arnilo/prism-ag-ui@0.4.0 --force
npm unpublish @arnilo/prism-ag-ui@0.5.0 --force
npm unpublish @arnilo/prism-ag-ui@0.5.1 --force
npm unpublish @arnilo/prism-ag-ui@0.5.2 --force
npm unpublish @arnilo/prism-ag-ui@0.5.3 --force
npm unpublish @arnilo/prism-ag-ui@0.5.4 --force
npm unpublish @arnilo/prism-ag-ui@0.5.5 --force
npm unpublish @arnilo/prism-ag-ui@0.5.6 --force
npm unpublish @arnilo/prism-ag-ui@0.6.0 --force
npm unpublish @arnilo/prism-ag-ui@0.7.0 --force
npm unpublish @arnilo/prism-ag-ui@0.8.0 --force
npm unpublish @arnilo/prism-ag-ui@0.9.0 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.1 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.10 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.11 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.12 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.13 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.14 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.15 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.16 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.17 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.18 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.19 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.2 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.20 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.22 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.23 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.24 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.25 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.26 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.27 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.3 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.4 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.5 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.6 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.7 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.8 --force
npm unpublish @arnilo/prism-provider-openrouter@0.0.96 --force
npm unpublish @arnilo/prism-provider-openrouter@0.1.0 --force
npm unpublish @arnilo/prism-provider-openrouter@0.1.1 --force
npm unpublish @arnilo/prism-provider-openrouter@0.1.2 --force
npm unpublish @arnilo/prism-provider-openrouter@0.1.3 --force
npm unpublish @arnilo/prism-provider-openrouter@0.1.4 --force
npm unpublish @arnilo/prism-provider-openrouter@0.1.5 --force
npm unpublish @arnilo/prism-provider-openrouter@0.1.6 --force
npm unpublish @arnilo/prism-provider-openrouter@0.1.7 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.0 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.1 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.2 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.3 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.4 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.5 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.6 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.7 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.8 --force
npm unpublish @arnilo/prism-provider-openrouter@0.2.9 --force
npm unpublish @arnilo/prism-provider-openrouter@0.3.0 --force
npm unpublish @arnilo/prism-provider-openrouter@0.3.1 --force
```

## 3. Do not delete — deprecate instead — 6 names

The registry refuses these: a published package outside the deleted set depends on them.
Their entries in `scripts/deprecations-0.13.json` stay, and these commands carry the same
messages, so re-running them is harmless.

| package | why the registry refuses | never deprecated |
| --- | --- | --- |
| `@arnilo/prism-coding-tools` | @arnilo/prism-antigravity-agent is published and depends on it | 17 |
| `@arnilo/prism-evals` | @arnilo/prism-enterprise-postgres is published and depends on it | 0 |
| `@arnilo/prism-mcp` | @arnilo/prism-antigravity-agent, @arnilo/prism-sdk are published and depend on it | 59 |
| `@arnilo/prism-model-router` | @arnilo/prism-enterprise-postgres is published and depends on it | 0 |
| `@arnilo/prism-workflows` | @arnilo/prism-sdk is published and depends on it | 0 |
| `@arnilo/prism-core` | @arnilo/prism-coding-tools is published and depends on it | 17 |

```sh
npm deprecate '@arnilo/prism-coding-tools@*' 'Legacy 0.12 package. Prism 0.13+: @arnilo/prism-tools-coding. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
npm deprecate '@arnilo/prism-evals@<0.13.0' 'Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: @arnilo/prism-evals@0.13.0. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
npm deprecate '@arnilo/prism-mcp@<0.13.0' 'Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: @arnilo/prism-mcp@0.13.0. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
npm deprecate '@arnilo/prism-model-router@<0.13.0' 'Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: @arnilo/prism-model-router@0.13.0. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
npm deprecate '@arnilo/prism-workflows@<0.13.0' 'Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: @arnilo/prism-workflows@0.13.0. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
npm deprecate '@arnilo/prism-core@*' 'Legacy 0.12 package. Prism 0.13+: @arnilo/prism and the native packages. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
```

Not deprecated on the registry today, so this is their first deprecation, not a re-issue: `@arnilo/prism-coding-tools`, `@arnilo/prism-mcp`, `@arnilo/prism-core`.

## 4. Leave alone

**0.13.0 publishes the name — 4:** `@arnilo/prism`, `@arnilo/prism-provider-opencode-go`, `@arnilo/prism-rag`, `@arnilo/prism-wiki`.

**Every version deprecated, named by no retirement list, so an owner decision — 28:**

`@arnilo/prism-base`, `@arnilo/prism-browser`, `@arnilo/prism-caveman`, `@arnilo/prism-coding-agent`, `@arnilo/prism-coding-security`, `@arnilo/prism-compaction`, `@arnilo/prism-compaction-llm`, `@arnilo/prism-compaction-observational-memory`, `@arnilo/prism-computer-use-linux`, `@arnilo/prism-credentials-node`, `@arnilo/prism-document-reader`, `@arnilo/prism-enterprise-postgres`, `@arnilo/prism-graft`, `@arnilo/prism-impeccable`, `@arnilo/prism-obscura`, `@arnilo/prism-observability-opentelemetry`, `@arnilo/prism-openapi-tools`, `@arnilo/prism-policy`, `@arnilo/prism-ponytail`, `@arnilo/prism-sdk`, `@arnilo/prism-server`, `@arnilo/prism-session-store-codecs`, `@arnilo/prism-session-store-nats`, `@arnilo/prism-session-store-postgres`, `@arnilo/prism-session-store-sqlite`, `@arnilo/prism-supervisor`, `@arnilo/prism-tool-validator-json-schema`, `@arnilo/prism-work-tools`.

These are the ones `--plan --include-unlisted` would delete.

**Neither shipped nor deprecated, named by no list — 3:** `@arnilo/liveframe`, `@arnilo/prism-antigravity-agent`, `@arnilo/prism-office`.

## After

1. `bun scripts/registry-cleanup.mjs --inventory` rewrites the evidence JSON; the executor runs it
   and re-plans, so the plan file is regenerated rather than edited.
2. Deletions land within about ten minutes. The republish of `prism-mcp`, `prism-evals`,
   `prism-model-router` and `prism-workflows` at 0.13.0 must come after this run — the ordering
   Task 37 requires, and Task 39 does the republish.
3. `docs/migrate-to-0.13.md` gains its removal list only once the registry confirms the result.
