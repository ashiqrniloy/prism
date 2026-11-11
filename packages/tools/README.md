# @arnilo/prism-tools

Install once, then import and list only the capabilities your host needs. The bundle has no root export; importing one subpath does not activate another.

```sh
bun add @arnilo/prism @arnilo/prism-tools @arnilo/prism-extensions
```

| Subpath | Capability | Manifest install |
| --- | --- | --- |
| [coding](coding/README.md) | Files, search, shell and sandbox adapters | `prism add @arnilo/prism-tools/coding` |
| [web](web/README.md) | Search, fetch, extraction and web research skill | `prism add @arnilo/prism-tools/web` |
| [browser](browser/README.md) | Playwright browser tools and automation skill | `prism add @arnilo/prism-tools/browser` |
| [research](research/README.md) | Source ledger, citations and research skills | `prism add @arnilo/prism-tools/research` |
| [openapi](openapi/README.md) | Bounded tools from allow-listed operations | `prism add @arnilo/prism-tools/openapi` |
| [computer-use](computer-use/README.md) | Host-owned Linux desktop MCP tools | `prism add @arnilo/prism-tools/computer-use` |
| [work](work/README.md) | Office, connectors, reader and productivity skills | `prism add @arnilo/prism-tools/work` |

Work libraries are exported at `./work/{connectors,connectors/drafts,connectors/google-workspace,connectors/microsoft365,diagrams,document-extraction,document-reader,documents,sandbox,sheets,skills,tools}`.

## Dependencies and footprint

Sizes are the Task 1 installed-package measurements; transitive dependencies and filesystem blocks can change the total. The initial bundle measures 589,902 packed bytes, 2,372,441 unpacked bytes and 331 files. A clean `--ignore-scripts` install without optional peers occupies 21,416,317 bytes in `node_modules`, including the kernel, extensions and required transitive dependencies. The release gate enforces the bundle size budget.

| Dependency | Size on disk | Decision |
| --- | --- | --- |
| `diff` | 968 K | Required by coding |
| `@mozilla/readability` | 188 K | Required by native web fetch |
| `linkedom` | 2.7 M | Required by native web fetch |
| `turndown` | 208 K | Required by native web fetch |
| `@office-open/{docx,pptx,xlsx,xml}` | 5.5 M total | Optional peers for work Office libraries |
| `ajv` | 2.4 M | Optional peer for document validation |
| `fast-xml-parser` | 1.4 M | Optional peer for work diagrams |

`@arnilo/prism-extensions` is required because coding imports workflows. Web and computer-use retain lazy MCP loading; they do not load MCP simply by being imported. A peer's optional flag applies to the whole npm bundle, so extensions cannot also be marked optional for these two subpaths.

To enable the work Office libraries and OOXML reader:

```sh
bun add @office-open/docx@0.14.5 @office-open/pptx@0.14.5 @office-open/xlsx@0.14.5 @office-open/xml@0.14.5 ajv fast-xml-parser@5.11.1
```

When any of those peers is absent, the work package reports the missing names and registers no Office tools. Connectors, productivity skills and supported PDF/DOCX readers remain available. Direct document, sheets and diagram library imports need their corresponding peers; validation is never bypassed.

`playwright-core@1.63.0`, `e2b@2.49.1`, `@firecrawl/anydoc@0.2.4`, `mammoth` and `pdf-parse` remain optional peers. See the subpath pages and [peer dependencies](../../docs/peer-dependencies.md) for activation and host requirements. Vendored skills ship in the tarball; installation needs no postinstall script.
