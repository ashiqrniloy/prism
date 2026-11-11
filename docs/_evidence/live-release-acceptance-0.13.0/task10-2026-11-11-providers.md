# Live matrix report

- generated: 2026-11-11T10:45:05.723Z
- env file: /home/arn/.config/prism/live.env
- filter: providers/
- mode: strict (skips fail the run)
- totals: 4 ran, 5 skipped, 3 failed, 0 planned

| suite | status | ms | detail |
|---|---|---|---|
| providers/ollama-cloud | ran | 38626 | PRISM_LIVE_OLLAMA_CLOUD_MODEL=gemma4:31b, PRISM_LIVE_OLLAMA_CLOUD_THINKING_MODEL=gpt-oss:20b, PRISM_LIVE_OLLAMA_CLOUD_DECISION_MODEL=clef:27b |
| providers/hyper | failed | 5828 | exit 1 (output tail in json report) |
| providers/opencode-go | failed | 4792 | exit 1 (output tail in json report) |
| providers/typesafe | skipped | 0 | missing TYPESAFE_API_KEY |
| providers/laya | skipped | 0 | missing PRISM_LIVE_LAYA |
| providers/openrouter | ran | 7971 | PRISM_LIVE_OPENROUTER_MODEL=recursive/flint-v1.0:free, PRISM_LIVE_OPENROUTER_CACHE_MODEL=anthropic/claude-haiku-4.5 |
| providers/liquid | skipped | 0 | missing LIQUID_API_KEY |
| providers/liquid-local | skipped | 0 | missing PRISM_LIVE_LLAMA_SERVER_URL |
| providers/commandcode | ran | 36221 | PRISM_LIVE_COMMANDCODE_CHAT_MODEL=minimax/minimax-m3.1-flash, PRISM_LIVE_COMMANDCODE_RESPONSES_MODEL=gpt-5.6-luna, PRISM_LIVE_COMMANDCODE_MESSAGES_MODEL=claude-haiku-5-5, PRISM_LIVE_COMMANDCODE_NON_ZDR_MODEL=stealth/glyph-cluster:free |
| providers/openai-codex | skipped | 0 | missing PRISM_TEST_KEYCHAIN |
| providers/kilo | failed | 9106 | exit 1 (output tail in json report) |
| providers/litellm | ran | 146 | PRISM_LIVE_LITELLM_MODEL=prism-free/gpt-oss-20b@groq |
