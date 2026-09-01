---
name: wiki-searcher
description: Queries the compiled LLM Wiki (.wiki/) using local qmd hybrid search and Context7-style line navigation. Use when looking up architecture patterns, module relationships, design decisions (ADRs), or compounding newly synthesized insights back into the knowledge base.
---

# Wiki Searcher

Query the compiled LLM Wiki (`.wiki/`) with Context7-style hierarchical breadcrumbs and clickable source line anchors.

## Search Workflow

1. **Query Formulation**:
   - Call `wiki_search` with a descriptive query before using broad filesystem search (`grep`/`rg`).
   - Use specific architectural or conceptual phrases:
     - Good: `"How are user permissions evaluated in middleware?"`
     - Bad: `"auth"`

2. **Select Appropriate Search Mode**:
   - `search` (default): Fast on-device BM25 keyword matching for exact terms or symbols.
   - `vsearch`: Semantic vector embedding search for conceptual queries without exact keyword overlap.
   - `query`: Hybrid search with on-device LLM reranking for multi-document synthesis questions.

3. **Context7-Style Navigation (Zero-Grep)**:
   - Inspect the returned section hierarchy (`# Category > ## Topic`) for structural context.
   - Jump directly to source code implementations using the returned clickable line links:
     `verifyToken (file:///path/to/file.ts#L45-L89)`
   - Never run broad regex searches across the repo when direct file/line links are returned in search results.

4. **Compounding Answers & Insights**:
   - When an interactive session yields a valuable new architectural comparison, decision rationale, or synthesized solution, call `wiki_record_insight`.
   - Recording high-value findings back into `.wiki/decisions/` or `.wiki/entities/` ensures knowledge accumulates over time.
