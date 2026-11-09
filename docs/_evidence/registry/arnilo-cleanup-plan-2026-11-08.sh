# Plan 215 Task 37 — retire the legacy @arnilo names.
# generated: 2026-11-08T23:05:03.554Z  registry: https://registry.npmjs.org
# 27 name(s) and 128 command(s); 6 refused by policy; 35 kept.
# Run top to bottom, signed in with 2FA; npm asks for an OTP per write. Dependents go first.
# An unpublish the registry refuses prints its reason; its deprecate fallback follows the name as a comment.
# Irreversible: an unpublished version never comes back, and a name whose every version goes is
# blocked for 24 hours before it can be published again (0.13.0 needs that gap).

# @arnilo/prism-all: delete the name (45 version(s)); retired *
npm unpublish @arnilo/prism-all --force

# @arnilo/prism-acp-agent: delete the name (22 version(s)); retired *
npm unpublish @arnilo/prism-acp-agent --force

# @arnilo/prism-channels: delete 7 retired version(s) of 7; 0.13.0 reuses the name, so only the <0.13.0 line is retired
npm unpublish @arnilo/prism-channels@0.10.0 --force
npm unpublish @arnilo/prism-channels@0.11.0 --force
npm unpublish @arnilo/prism-channels@0.11.1 --force
npm unpublish @arnilo/prism-channels@0.12.0 --force
npm unpublish @arnilo/prism-channels@0.12.1 --force
npm unpublish @arnilo/prism-channels@0.8.0 --force
npm unpublish @arnilo/prism-channels@0.9.0 --force

# @arnilo/prism-code: delete the name (44 version(s)); retired *
npm unpublish @arnilo/prism-code --force

# @arnilo/prism-ag-ui: delete 51 retired version(s) of 51; 0.13.0 reuses the name, so only the <0.13.0 line is retired
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

# @arnilo/prism-agent-sdk: delete the name (1 version(s)); retired *
npm unpublish @arnilo/prism-agent-sdk --force

# @arnilo/prism-hooks: delete the name (5 version(s)); retired *
npm unpublish @arnilo/prism-hooks --force

# @arnilo/prism-memory: delete the name (59 version(s)); retired *
npm unpublish @arnilo/prism-memory --force

# @arnilo/prism-provider-ai-sdk: delete the name (42 version(s)); retired *
npm unpublish @arnilo/prism-provider-ai-sdk --force

# @arnilo/prism-provider-alibaba: delete the name (33 version(s)); retired *
npm unpublish @arnilo/prism-provider-alibaba --force

# @arnilo/prism-provider-anthropic: delete the name (36 version(s)); retired *
npm unpublish @arnilo/prism-provider-anthropic --force

# @arnilo/prism-provider-azure: delete the name (34 version(s)); retired *
npm unpublish @arnilo/prism-provider-azure --force

# @arnilo/prism-provider-bedrock: delete the name (34 version(s)); retired *
npm unpublish @arnilo/prism-provider-bedrock --force

# @arnilo/prism-provider-clinepass: delete the name (3 version(s)); retired *
npm unpublish @arnilo/prism-provider-clinepass --force

# @arnilo/prism-provider-deepseek: delete the name (3 version(s)); retired *
npm unpublish @arnilo/prism-provider-deepseek --force

# @arnilo/prism-provider-google: delete the name (36 version(s)); retired *
npm unpublish @arnilo/prism-provider-google --force

# @arnilo/prism-provider-kimi: delete the name (46 version(s)); retired *
npm unpublish @arnilo/prism-provider-kimi --force

# @arnilo/prism-provider-neuralwatt: delete the name (45 version(s)); retired *
npm unpublish @arnilo/prism-provider-neuralwatt --force

# @arnilo/prism-provider-ollama: delete the name (33 version(s)); retired *
npm unpublish @arnilo/prism-provider-ollama --force

# @arnilo/prism-provider-openai: delete the name (46 version(s)); retired *
npm unpublish @arnilo/prism-provider-openai --force

# @arnilo/prism-provider-openrouter: delete 46 retired version(s) of 46; 0.13.0 reuses the name, so only the <0.13.0 line is retired
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

# @arnilo/prism-provider-vertex: delete the name (34 version(s)); retired *
npm unpublish @arnilo/prism-provider-vertex --force

# @arnilo/prism-provider-xai: delete the name (3 version(s)); retired *
npm unpublish @arnilo/prism-provider-xai --force

# @arnilo/prism-provider-zai: delete the name (46 version(s)); retired *
npm unpublish @arnilo/prism-provider-zai --force

# @arnilo/prism-providers: delete the name (63 version(s)); retired *
npm unpublish @arnilo/prism-providers --force

# @arnilo/prism-web-tools: delete the name (56 version(s)); retired *
npm unpublish @arnilo/prism-web-tools --force

# @arnilo/prism-work: delete the name (7 version(s)); retired *
npm unpublish @arnilo/prism-work --force

# Refused by npm's unpublish policy: deprecate instead.

# @arnilo/prism-coding-tools: @arnilo/prism-antigravity-agent is published and depends on it
npm deprecate '@arnilo/prism-coding-tools@*' 'Legacy 0.12 package. Prism 0.13+: @arnilo/prism-tools-coding. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
# @arnilo/prism-evals: @arnilo/prism-enterprise-postgres is published and depends on it
npm deprecate '@arnilo/prism-evals@<0.13.0' 'Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: @arnilo/prism-evals@0.13.0. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
# @arnilo/prism-mcp: @arnilo/prism-antigravity-agent, @arnilo/prism-sdk are published and depend on it
npm deprecate '@arnilo/prism-mcp@<0.13.0' 'Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: @arnilo/prism-mcp@0.13.0. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
# @arnilo/prism-model-router: @arnilo/prism-enterprise-postgres is published and depends on it
npm deprecate '@arnilo/prism-model-router@<0.13.0' 'Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: @arnilo/prism-model-router@0.13.0. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
# @arnilo/prism-workflows: @arnilo/prism-sdk is published and depends on it
npm deprecate '@arnilo/prism-workflows@<0.13.0' 'Legacy 0.12 release. Prism 0.13+ republishes this name at 0.13.0: @arnilo/prism-workflows@0.13.0. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'
# @arnilo/prism-core: @arnilo/prism-coding-tools is published and depends on it
npm deprecate '@arnilo/prism-core@*' 'Legacy 0.12 package. Prism 0.13+: @arnilo/prism and the native packages. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.13.md#012-family-package-native-package-map'

# Kept (35): @arnilo/liveframe (no 0.13 list names @arnilo/liveframe (owner decision)), @arnilo/prism (0.13.0 publishes this name), @arnilo/prism-antigravity-agent (no 0.13 list names @arnilo/prism-antigravity-agent (owner decision)), @arnilo/prism-base (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-browser (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-caveman (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-coding-agent (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-coding-security (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-compaction (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-compaction-llm (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-compaction-observational-memory (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-computer-use-linux (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-credentials-node (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-document-reader (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-enterprise-postgres (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-graft (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-impeccable (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-obscura (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-observability-opentelemetry (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-office (no 0.13 list names @arnilo/prism-office (owner decision)), @arnilo/prism-openapi-tools (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-policy (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-ponytail (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-provider-opencode-go (0.13.0 publishes this name), @arnilo/prism-rag (0.13.0 publishes this name), @arnilo/prism-sdk (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-server (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-session-store-codecs (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-session-store-nats (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-session-store-postgres (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-session-store-sqlite (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-supervisor (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-tool-validator-json-schema (every version is deprecated, but no 0.13 list names it (owner decision)), @arnilo/prism-wiki (0.13.0 publishes this name), @arnilo/prism-work-tools (every version is deprecated, but no 0.13 list names it (owner decision))
