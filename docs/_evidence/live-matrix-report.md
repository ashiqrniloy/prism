# Live matrix report

- generated: 2026-09-25T08:39:09.731Z
- totals: 4 ran, 52 skipped, 0 failed, 1 planned

| suite | status | ms | detail |
|---|---|---|---|
| providers/openai | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, OPENAI_API_KEY |
| providers/anthropic | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, ANTHROPIC_API_KEY |
| providers/google | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS |
| providers/alibaba | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, PRISM_LIVE_DASHSCOPE_KEY |
| providers/clinepass | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, CLINE_API_KEY |
| providers/commandcode | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, COMMAND_CODE_API_KEY |
| providers/deepseek | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, DEEPSEEK_API_KEY |
| providers/hyper | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, HYPER_API_KEY |
| providers/kimi | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, KIMI_API_KEY |
| providers/neuralwatt | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, NEURALWATT_API_KEY |
| providers/opencode-go | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, OPENCODE_API_KEY |
| providers/openrouter | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, OPENROUTER_API_KEY |
| providers/xai | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, XAI_API_KEY |
| providers/zai | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, ZAI_API_KEY |
| web-tools/brave | skipped | 0 | missing PRISM_LIVE_WEB, PRISM_BRAVE_SEARCH_TOKEN |
| web-tools/exa | skipped | 0 | missing PRISM_LIVE_WEB, PRISM_EXA_API_KEY |
| web-tools/firecrawl | skipped | 0 | missing PRISM_LIVE_WEB, PRISM_FIRECRAWL_API_KEY |
| web-tools/browser-live | skipped | 0 | missing one of PRISM_LIVE_PLAYWRIGHT, PRISM_TEST_PLAYWRIGHT |
| web-tools/obscura-live | skipped | 0 | missing PRISM_LIVE_OBSCURA, PRISM_OBSCURA_BIN |
| memory/observational-live | skipped | 0 | missing PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS, OPENAI_API_KEY |
| memory/compaction-llm-live | skipped | 0 | missing PRISM_LIVE_COMPACTION_TESTS |
| work/libreoffice-golden | skipped | 0 | missing PRISM_TEST_LIBREOFFICE |
| work/drawio-live | skipped | 0 | missing one of PRISM_LIVE_DRAWIO_URL, PRISM_TEST_DRAWIO_URL |
| core/postgres | skipped | 0 | missing PRISM_TEST_POSTGRES_URL |
| core/nats | skipped | 0 | missing PRISM_TEST_NATS_URL |
| coding-tools/docker-sandbox | skipped | 0 | missing PRISM_TEST_DOCKER_SANDBOX, PRISM_TEST_DOCKER_BIN, PRISM_TEST_DOCKER_IMAGE, PRISM_TEST_DOCKER_USER |
| coding-tools/e2b-sandbox-live | skipped | 0 | missing PRISM_TEST_E2B_API_KEY |
| work/mistral-ocr-live | skipped | 0 | missing PRISM_TEST_MISTRAL_API_KEY |
| core/keychain | skipped | 0 | missing PRISM_TEST_KEYCHAIN |
| acp/client-smoke | skipped | 0 | missing PRISM_TEST_ACP_CLIENT |
| canaries/deployed | skipped | 0 | missing PRISM_LIVE_CANARIES |
| providers/azure | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, PRISM_LIVE_AZURE_MODEL |
| providers/bedrock | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION |
| providers/vertex | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, GOOGLE_VERTEX_PROJECT, PRISM_VERTEX_ACCESS_TOKEN |
| providers/ollama | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, OLLAMA_BASE_URL |
| providers/ai-sdk | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS, OPENAI_API_KEY |
| providers/model-discovery | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS |
| calibration/vendor-count-tokens | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS |
| memory/rag-rerankers-live | skipped | 0 | missing one of PRISM_TEST_TEI_RERANKER_URL, PRISM_TEST_HOSTED_RERANK_URL |
| memory/local-rerank-live | skipped | 0 | missing PRISM_TEST_LOCAL_RERANK |
| memory/drive-sync-live | skipped | 0 | missing PRISM_TEST_DRIVE_ACCESS_TOKEN |
| coding-tools/openapi-live | skipped | 0 | missing PRISM_LIVE_OPENAPI_TOOLS |
| coding-tools/computer-use-live | skipped | 0 | missing PRISM_TEST_COMPUTER_USE, PRISM_COMPUTER_USE_BIN |
| mcp/client-smoke | skipped | 0 | missing PRISM_TEST_MCP_CLIENT |
| core/opa-live | skipped | 0 | missing PRISM_TEST_OPA_URL |
| core/oidc-live | skipped | 0 | missing PRISM_TEST_OIDC_ISSUER, PRISM_TEST_OIDC_AUDIENCE, PRISM_TEST_OIDC_TOKEN |
| core/webhooks-live | skipped | 0 | missing PRISM_TEST_WEBHOOK_URL |
| core/artifact-bodies-s3-live | skipped | 0 | missing PRISM_TEST_S3_ENDPOINT, PRISM_TEST_S3_KEY, PRISM_TEST_S3_SECRET, PRISM_TEST_S3_BUCKET |
| cli/journey | skipped | 0 | missing PRISM_LIVE_PROVIDER_TESTS |
| memory/postgres | skipped | 0 | missing PRISM_TEST_POSTGRES_URL |
| memory/wiki | ran | 183 |  |
| coding-tools/lsp-forge | ran | 2149 |  |
| ag-ui/conformance | ran | 981 |  |
| prism-providers/conformance | ran | 120 |  |
| channels/telegram-live | skipped | 0 | missing PRISM_LIVE_TELEGRAM, TELEGRAM_BOT_TOKEN |
| channels/signal-live | skipped | 0 | missing PRISM_LIVE_SIGNAL, PRISM_LIVE_SIGNAL_SOCKET, PRISM_LIVE_SIGNAL_ACCOUNT, PRISM_LIVE_SIGNAL_TERMS_VERSION |
| cli/live-journey | planned | 0 | Task 5. |
