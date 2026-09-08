# Memory — compaction, OM, RAG, wiki, skills, prompt assembly

Compaction strategies, observational memory, retrieval, skills, context/prompt
assembly. Package home: `packages/memory` plus core context seams.

## Docs (current contracts)

- [compaction-and-retry.md](../../../../docs/compaction-and-retry.md): host-replaceable summarize/retry policies.
- [compaction-llm.md](../../../../docs/compaction-llm.md): provider-backed summarization caps, coding strategy.
- [compaction-observational-memory.md](../../../../docs/compaction-observational-memory.md): observations/reflections, recall, nested-only settings.
- [working-and-semantic-memory.md](../../../../docs/working-and-semantic-memory.md): working memory, semantic recall, pgvector.
- [rag.md](../../../../docs/rag.md): bounded source lifecycle, hybrid retrieval, reranking, citations.
- [wiki.md](../../../../docs/wiki.md): OKF knowledge compiler (`prism-wiki` CLI).
- [context-and-skills.md](../../../../docs/context-and-skills.md): context providers, progressive skill disclosure.
- [input-and-prompt-assembly.md](../../../../docs/input-and-prompt-assembly.md): input-to-message builders, context budget.

## Graft queries

- `graft ask "observational memory observation reflection recall" --source`
- `graft ask "compaction strategy abort reserve" --source`
- `graft callers estimateTextTokens`

## Tests

- `packages/memory/src/**/__tests__/` (run from the workspace dir)
- `src/__tests__/compaction.test.ts`, `skills*.test.ts`, `input-pipeline.test.ts`, `context-budget.test.ts`

## Don't do

- Don't accept flat OM settings keys — removed keys fail closed naming the nested replacement.
- Don't let token estimates masquerade as billing numbers (`ceil(len/4)` is context-budget only).
- Summary generates use the agent session id (cache hits); OM worker uses derived `om:{session.id}` — keep them separate.

Adjacent: `system-prompts.md`, `prompt-registry.md`, `instruction-injection.md` (prompt layers — text only, no capability grants).
