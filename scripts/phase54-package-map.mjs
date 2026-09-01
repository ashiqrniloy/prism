// scripts/phase54-package-map.mjs
// Plan 054 Task 1: Freeze the 0.3.3 package/export baseline and record the 0.4 import map.
// Single source of truth for 0.4 package consolidation: 62 current manifests -> 11 active packages.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandWorkspaceDirs, readManifest } from "./package-truth.mjs";
import { baselineName, extractDeclaredSurface } from "./release-gates.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const CONSOLIDATION_SPEC = {
  activePackages: [
    {
      name: "@arnilo/prism",
      role: "root",
      type: "retained",
      description: "Root contracts, runtime API, CLI, providers/*, testing/*, node/* exports. Dependency-free.",
      subpaths: [
        ".",
        "./providers/openai-compatible",
        "./providers/transport",
        "./providers/openai",
        "./providers/schema",
        "./providers/media",
        "./testing/provider-conformance",
        "./testing/agent-event-source-conformance",
        "./testing/state-concurrency-conformance",
        "./testing/session-store-conformance",
        "./testing/compaction-conformance",
        "./testing/tool-conformance",
        "./testing/tool-effect-store-conformance",
        "./testing/extension-conformance",
        "./testing/persistence-schema",
        "./testing/run-ledger-conformance",
        "./testing/feedback",
        "./node/config",
        "./node/settings",
        "./node/trust",
        "./node/session-store-jsonl",
        "./node/contribution-discovery",
        "./node/instruction-injectors",
        "./node/system-prompts",
        "./node/agent-definitions",
      ],
      bins: ["prism"],
      peers: {},
      optionalPeers: [],
      securityBoundaries: ["Root dependency freedom: zero runtime dependencies; strict trust boundary at root."],
    },
    {
      name: "@arnilo/prism-core",
      role: "family",
      type: "new",
      description:
        "Unified Prism core: runtime (server/supervisor/workflows), sessions, governance, credentials, enterprise postgres, work integrations, and schema validation.",
      subpaths: [
        "/runtime/server",
        "/runtime/supervisor",
        "/runtime/workflows",
        "/sessions/codecs",
        "/sessions/sqlite",
        "/sessions/postgres",
        "/sessions/nats",
        "/governance/policy",
        "/governance/evals",
        "/governance/prompts",
        "/governance/model-router",
        "/governance/observability",
        "/credentials/node",
        "/enterprise/postgres",
        "/integrations/work",
        "/validation/json-schema",
      ],
      bins: [],
      peers: {
        "@arnilo/prism": "^0.4.0",
      },
      optionalPeers: ["better-sqlite3", "pg", "@nats-io/jetstream", "@nats-io/transport-node"],
      securityBoundaries: [
        "/sessions/postgres & /enterprise/postgres: PostgreSQL transaction isolation, schema migrations, and parameterized query execution.",
        "/sessions/sqlite: SQLite file locking, synchronous journal modes, and path containment.",
        "/governance/policy: Fail-closed capability admission, tool authorization, and audit log tamper detection.",
        "/governance/evals: Evaluation run isolation, dataset curation redaction, and metric integrity.",
        "/governance/prompts: Versioned prompt promotion gating, rollback protection, and evaluation score thresholds.",
        "/credentials/node: OS keychain integration via @napi-rs/keyring; credentials never leak to logs or memory dumps.",
      ],
    },
    {
      name: "@arnilo/prism-providers",
      role: "family",
      type: "retained-converted",
      description: "Unified provider code family containing all 17 provider adapters.",
      subpaths: [
        "/ai-sdk",
        "/alibaba",
        "/anthropic",
        "/azure",
        "/bedrock",
        "/clinepass",
        "/deepseek",
        "/google",
        "/kimi",
        "/neuralwatt",
        "/ollama",
        "/openai",
        "/opencode-go",
        "/openrouter",
        "/vertex",
        "/xai",
        "/zai",
      ],
      bins: [],
      peers: {
        "@arnilo/prism": "^0.4.0",
        "@ai-sdk/provider": "^1.0.0 || ^2.0.0",
      },
      optionalPeers: ["@ai-sdk/provider"],
      securityBoundaries: [
        "Credential handling: API keys and auth headers passed only to declared upstream endpoints; zero cross-provider key leakage.",
        "Lazy activation: Importing one adapter never evaluates or activates another.",
      ],
    },
    {
      name: "@arnilo/prism-coding-tools",
      role: "family",
      type: "new",
      description:
        "Unified coding agent tools, security sandboxing, document parsing, OpenAPI tools, Linux desktop integration, Dev inspector, and persona extensions.",
      subpaths: [
        "/agent",
        "/security",
        "/document-reader",
        "/openapi",
        "/computer-use-linux",
        "/dev",
        "/caveman",
        "/ponytail",
        "/impeccable",
      ],
      bins: ["prism-dev"],
      peers: {
        "@arnilo/prism": "^0.4.0",
      },
      optionalPeers: ["mammoth", "pdf-parse", "@dietrichgebert/ponytail"],
      securityBoundaries: [
        "/security: Docker/OCI disposable sandbox containment, execution approval policies, and workspace path containment.",
        "/document-reader: Bounded byte parsing, XML entity expansion defense, redaction of sensitive spans, fail-closed on missing parser peers.",
        "/openapi: SSRF protection, loopback/private IP filtering, allowlist domain enforcement.",
        "/computer-use-linux: Linux device access policy, screen capture bounds, rate-limited mouse/keyboard inputs.",
        "/dev: Loopback-only binding (127.0.0.1), no external host exposure.",
        "Persona extensions (/caveman, /ponytail, /impeccable): Pure prompt/behavior modifiers; zero implicit host privilege escalation.",
      ],
    },
    {
      name: "@arnilo/prism-web-tools",
      role: "family",
      type: "retained-expanded",
      description: "Unified web tools family: root Brave/Exa/Firecrawl search plus /browser and /obscura subpaths.",
      subpaths: [".", "./brave", "./exa", "./firecrawl", "/browser", "/obscura"],
      bins: [],
      peers: {
        "@arnilo/prism": "^0.4.0",
      },
      optionalPeers: ["playwright-core"],
      securityBoundaries: [
        "/browser: BrowserNetworkPolicy URL allowlist/blocklist, private IP egress blocking, quarantined download/upload budgets, CDP access isolation.",
        "/obscura: Strict SSRF protection, loopback gating, CDP sandboxing, host binary integrity verification.",
        "Lazy dependency probe: Generic root web-tools import never requires Playwright or Obscura host binary.",
      ],
    },
    {
      name: "@arnilo/prism-memory",
      role: "family",
      type: "retained-expanded",
      description:
        "Unified memory and context family: working/vector memory, RAG, LLM compaction, observational memory, Graft context graph, and Wiki knowledge system.",
      subpaths: [".", "/rag", "/compaction/llm", "/compaction/observational-memory", "/graft", "/wiki"],
      bins: ["prism-wiki"],
      peers: {
        "@arnilo/prism": "^0.4.0",
      },
      optionalPeers: ["@nanonets/graft"],
      securityBoundaries: [
        "/rag: Chunk/query input size bounds, scope containment, embedder dimension mismatch prevention.",
        "/graft: Subprocess execution timeout, stdout/stderr size bounds, graph traversal depth limits.",
        "/wiki: Workspace path containment, local file boundaries, untrusted markdown link sanitization.",
      ],
    },
    {
      name: "@arnilo/prism-mcp",
      role: "interop",
      type: "retained",
      description: "Model Context Protocol client/server/OAuth bridge.",
      subpaths: ["."],
      bins: [],
      peers: {
        "@arnilo/prism": "^0.4.0",
      },
      optionalPeers: [],
      securityBoundaries: ["MCP transport security: Local stdio process bounds, SSE URL allowlist, OAuth token redaction in errors."],
    },
    {
      name: "@arnilo/prism-acp-agent",
      role: "interop",
      type: "retained",
      description: "Agent Client Protocol adapter and CLI.",
      subpaths: ["."],
      bins: ["prism-acp-agent"],
      peers: {
        "@arnilo/prism": "^0.4.0",
      },
      optionalPeers: [],
      securityBoundaries: ["Protocol framing: Strict JSON-RPC validation, message size bounds, connection termination on error."],
    },
    {
      name: "@arnilo/prism-ag-ui",
      role: "interop",
      type: "retained",
      description: "AG-UI / A2A / A2UI streaming UI adapter.",
      subpaths: ["."],
      bins: [],
      peers: {
        "@arnilo/prism": "^0.4.0",
        zod: "^3.24.0",
      },
      optionalPeers: ["@arnilo/prism-mcp", "@arnilo/prism-supervisor"],
      securityBoundaries: ["Streaming sanitization: UI event payload bounds, sensitive state masking, loopback connection restriction."],
    },
    {
      name: "@arnilo/prism-antigravity-agent",
      role: "interop",
      type: "retained",
      description: "Google Antigravity CLI and agent adapter.",
      subpaths: ["."],
      bins: [],
      peers: {
        "@arnilo/prism": "^0.4.0",
      },
      optionalPeers: [],
      securityBoundaries: ["CLI integration: Sandboxed session execution, environment variable redaction, tool permission prompts."],
    },
    {
      name: "@arnilo/prism-office",
      role: "family",
      type: "new",
      description: "Unified office documents suite: Word/PowerPoint documents, Excel spreadsheets, and Mermaid/SVG diagram generation.",
      subpaths: ["/documents", "/sheets", "/diagrams"],
      bins: [],
      peers: {
        "@arnilo/prism": "^0.4.0",
      },
      optionalPeers: ["playwright-core"],
      securityBoundaries: [
        "/documents: Document byte limits, XML entity expansion defense, safe archive decompression.",
        "/sheets: Formula injection escaping, workbook size bounds, malicious macro neutralization.",
        "/diagrams: Playwright rendering sandbox, SVG script stripping, rasterization memory limits.",
      ],
    },
  ],

  // 54 retired 0.3.x package manifests
  retiredPackages: [
    // 5 Profiles
    {
      name: "@arnilo/prism-base",
      category: "profile",
      targetPackage: "@arnilo/prism",
      targetSubpath: null,
      notes: "Pure profile manifest deleted. Install @arnilo/prism, @arnilo/prism-memory, @arnilo/prism-core directly.",
      migrationAnchor: "#removed-profile-packages",
    },
    {
      name: "@arnilo/prism-code",
      category: "profile",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: null,
      notes: "Pure profile manifest deleted. Install @arnilo/prism, @arnilo/prism-coding-tools, @arnilo/prism-mcp directly.",
      migrationAnchor: "#removed-profile-packages",
    },
    {
      name: "@arnilo/prism-sdk",
      category: "profile",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: null,
      notes: "Pure profile manifest deleted. Install @arnilo/prism, @arnilo/prism-core, @arnilo/prism-mcp directly.",
      migrationAnchor: "#removed-profile-packages",
    },
    {
      name: "@arnilo/prism-compaction",
      category: "profile",
      targetPackage: "@arnilo/prism-memory",
      targetSubpath: "/compaction/*",
      notes: "Compaction profile deleted. Compaction strategies live under @arnilo/prism-memory/compaction/{llm,observational-memory}.",
      migrationAnchor: "#memory-rag-compaction-and-context",
    },
    {
      name: "@arnilo/prism-all",
      category: "profile",
      targetPackage: null,
      targetSubpath: null,
      notes: "Pure profile manifest deleted. Install explicit family packages per application needs.",
      migrationAnchor: "#removed-profile-packages",
    },

    // 17 Provider adapters
    {
      name: "@arnilo/prism-provider-ai-sdk",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/ai-sdk",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-alibaba",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/alibaba",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-anthropic",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/anthropic",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-azure",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/azure",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-bedrock",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/bedrock",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-clinepass",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/clinepass",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-deepseek",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/deepseek",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-google",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/google",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-kimi",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/kimi",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-neuralwatt",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/neuralwatt",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-ollama",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/ollama",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-openai",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/openai",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-opencode-go",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/opencode-go",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-openrouter",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/openrouter",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-vertex",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/vertex",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-xai",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/xai",
      migrationAnchor: "#providers",
    },
    {
      name: "@arnilo/prism-provider-zai",
      category: "provider",
      targetPackage: "@arnilo/prism-providers",
      targetSubpath: "/zai",
      migrationAnchor: "#providers",
    },

    // 16 Core runtime / sessions / governance / integrations
    {
      name: "@arnilo/prism-server",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/runtime/server",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-supervisor",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/runtime/supervisor",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-workflows",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/runtime/workflows",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-session-store-codecs",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/sessions/codecs",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-session-store-sqlite",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/sessions/sqlite",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-session-store-postgres",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/sessions/postgres",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-session-store-nats",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/sessions/nats",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-policy",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/governance/policy",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-evals",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/governance/evals",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-prompts",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/governance/prompts",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-model-router",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/governance/model-router",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-observability-opentelemetry",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/governance/observability",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-credentials-node",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/credentials/node",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-enterprise-postgres",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/enterprise/postgres",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-work-tools",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/integrations/work",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },
    {
      name: "@arnilo/prism-tool-validator-json-schema",
      category: "core",
      targetPackage: "@arnilo/prism-core",
      targetSubpath: "/validation/json-schema",
      migrationAnchor: "#runtime-sessions-governance-and-work-integration",
    },

    // 9 Coding tools & personas
    {
      name: "@arnilo/prism-coding-agent",
      category: "coding",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: "/agent",
      migrationAnchor: "#coding-tools-and-personas",
    },
    {
      name: "@arnilo/prism-coding-security",
      category: "coding",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: "/security",
      migrationAnchor: "#coding-tools-and-personas",
    },
    {
      name: "@arnilo/prism-document-reader",
      category: "coding",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: "/document-reader",
      migrationAnchor: "#coding-tools-and-personas",
    },
    {
      name: "@arnilo/prism-openapi-tools",
      category: "coding",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: "/openapi",
      migrationAnchor: "#coding-tools-and-personas",
    },
    {
      name: "@arnilo/prism-computer-use-linux",
      category: "coding",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: "/computer-use-linux",
      migrationAnchor: "#coding-tools-and-personas",
    },
    {
      name: "@arnilo/prism-dev",
      category: "coding",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: "/dev",
      migrationAnchor: "#coding-tools-and-personas",
    },
    {
      name: "@arnilo/prism-caveman",
      category: "coding",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: "/caveman",
      migrationAnchor: "#coding-tools-and-personas",
    },
    {
      name: "@arnilo/prism-ponytail",
      category: "coding",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: "/ponytail",
      migrationAnchor: "#coding-tools-and-personas",
    },
    {
      name: "@arnilo/prism-impeccable",
      category: "coding",
      targetPackage: "@arnilo/prism-coding-tools",
      targetSubpath: "/impeccable",
      migrationAnchor: "#coding-tools-and-personas",
    },

    // 2 Web tools
    {
      name: "@arnilo/prism-browser",
      category: "web",
      targetPackage: "@arnilo/prism-web-tools",
      targetSubpath: "/browser",
      migrationAnchor: "#web-browser-and-obscura",
    },
    {
      name: "@arnilo/prism-obscura",
      category: "web",
      targetPackage: "@arnilo/prism-web-tools",
      targetSubpath: "/obscura",
      migrationAnchor: "#web-browser-and-obscura",
    },

    // 5 Memory & context
    {
      name: "@arnilo/prism-rag",
      category: "memory",
      targetPackage: "@arnilo/prism-memory",
      targetSubpath: "/rag",
      migrationAnchor: "#memory-rag-compaction-and-context",
    },
    {
      name: "@arnilo/prism-compaction-llm",
      category: "memory",
      targetPackage: "@arnilo/prism-memory",
      targetSubpath: "/compaction/llm",
      migrationAnchor: "#memory-rag-compaction-and-context",
    },
    {
      name: "@arnilo/prism-compaction-observational-memory",
      category: "memory",
      targetPackage: "@arnilo/prism-memory",
      targetSubpath: "/compaction/observational-memory",
      migrationAnchor: "#memory-rag-compaction-and-context",
    },
    {
      name: "@arnilo/prism-graft",
      category: "memory",
      targetPackage: "@arnilo/prism-memory",
      targetSubpath: "/graft",
      migrationAnchor: "#memory-rag-compaction-and-context",
    },
    {
      name: "@arnilo/prism-wiki",
      category: "memory",
      targetPackage: "@arnilo/prism-memory",
      targetSubpath: "/wiki",
      migrationAnchor: "#memory-rag-compaction-and-context",
    },
  ],

  // 3 Draft packages from plans 051-053 consolidating into @arnilo/prism-office
  officeDrafts: [
    {
      name: "@arnilo/prism-documents",
      targetPackage: "@arnilo/prism-office",
      targetSubpath: "/documents",
      migrationAnchor: "#office-suite",
    },
    { name: "@arnilo/prism-sheets", targetPackage: "@arnilo/prism-office", targetSubpath: "/sheets", migrationAnchor: "#office-suite" },
    { name: "@arnilo/prism-diagrams", targetPackage: "@arnilo/prism-office", targetSubpath: "/diagrams", migrationAnchor: "#office-suite" },
  ],
};

export function buildPackageMap(rootDir = DEFAULT_ROOT) {
  const rootPkg = readManifest(join(rootDir, "package.json"));
  const workspaceDirs = expandWorkspaceDirs(rootDir, rootPkg.workspaces);
  const manifests = [
    { dir: ".", relDir: ".", pkg: rootPkg },
    ...workspaceDirs.map((d) => ({
      dir: d,
      relDir: d.replace(`${rootDir}/`, ""),
      pkg: readManifest(join(d, "package.json")),
    })),
  ];

  const manifestMap = new Map(manifests.map((m) => [m.pkg.name, m]));
  const baselineDir = join(rootDir, "scripts", "compat-baseline");

  // Process all retired packages with symbol analysis
  const retiredWithDetails = CONSOLIDATION_SPEC.retiredPackages.map((item) => {
    const m = manifestMap.get(item.name);
    const distDir = m ? join(m.dir, "dist") : null;
    let symbols = [];
    if (distDir && existsSync(distDir)) {
      const surface = extractDeclaredSurface(distDir);
      symbols = [...surface.keys()].sort();
    } else {
      const bFile = join(baselineDir, baselineName(item.name));
      if (existsSync(bFile)) {
        symbols = readFileSync(bFile, "utf8")
          .split("\n")
          .map((line) => line.split("\t")[0]?.trim())
          .filter(Boolean)
          .sort();
      }
    }

    const bins = m ? Object.keys(m.pkg.bin ?? {}) : [];
    const optionalPeers = m
      ? Object.entries(m.pkg.peerDependenciesMeta ?? {})
          .filter(([, v]) => v?.optional)
          .map(([k]) => k)
      : [];

    const fullSuccessor = item.targetSubpath
      ? `${item.targetPackage}${item.targetSubpath.startsWith("/") ? item.targetSubpath : `/${item.targetSubpath}`}`
      : item.targetPackage;

    const version = m ? m.pkg.version : "0.3.3";
    const directory = m ? m.relDir : `packages/${item.name.replace("@arnilo/prism-", "")}`;

    return {
      ...item,
      version,
      directory,
      symbolCount: symbols.length,
      symbols,
      bins,
      optionalPeers,
      fullSuccessor,
      deprecationMessage: item.targetPackage
        ? `Legacy 0.3 package. Prism 0.4+: ${fullSuccessor}. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md${item.migrationAnchor}`
        : `Legacy 0.3 profile. Prism 0.4+: Install explicit family packages. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md${item.migrationAnchor}`,
      distTagCommand: `npm dist-tag add ${item.name}@${version} legacy`,
      deprecateCommand: `npm deprecate ${item.name}@"<0.4.0" "${
        item.targetPackage
          ? `Legacy 0.3 package. Prism 0.4+: ${fullSuccessor}. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md${item.migrationAnchor}`
          : `Legacy 0.3 profile. Prism 0.4+: Install explicit family packages. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md${item.migrationAnchor}`
      }"`,
    };
  });

  // Process office drafts
  const officeDraftsWithDetails = CONSOLIDATION_SPEC.officeDrafts.map((item) => {
    const m = manifestMap.get(item.name);
    const distDir = m ? join(m.dir, "dist") : null;
    let symbols = [];
    if (distDir && existsSync(distDir)) {
      symbols = [...extractDeclaredSurface(distDir).keys()].sort();
    }
    return {
      ...item,
      version: m?.pkg.version ?? "0.3.0",
      directory: m?.relDir ?? `packages/${item.name.replace("@arnilo/prism-", "")}`,
      symbolCount: symbols.length,
      symbols,
      fullSuccessor: `${item.targetPackage}${item.targetSubpath}`,
    };
  });

  // Process active packages
  const activeWithDetails = CONSOLIDATION_SPEC.activePackages.map((active) => {
    const m = manifestMap.get(active.name);
    let currentSymbols = 0;
    if (m) {
      const distDir = join(m.dir, "dist");
      if (existsSync(distDir)) {
        currentSymbols = extractDeclaredSurface(distDir).size;
      }
    }
    return {
      ...active,
      currentVersion: m?.pkg.version ?? "0.4.0-dev",
      currentSymbols,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    rootVersion: rootPkg.version,
    counts: {
      totalCurrentManifests: manifests.length,
      baselineManifests: 62,
      officeDraftManifests: CONSOLIDATION_SPEC.officeDrafts.length,
      retiredPackages: CONSOLIDATION_SPEC.retiredPackages.length,
      retainedPackages: CONSOLIDATION_SPEC.activePackages.filter((p) => p.type.startsWith("retained")).length,
      newPackages: CONSOLIDATION_SPEC.activePackages.filter((p) => p.type === "new").length,
      targetActivePackages: CONSOLIDATION_SPEC.activePackages.length,
    },
    activePackages: activeWithDetails,
    retiredPackages: retiredWithDetails,
    officeDrafts: officeDraftsWithDetails,
    manifests,
  };
}

export function generateMarkdown(map) {
  const lines = [];

  lines.push("# Phase 54 — 0.3.3 Package/Export Baseline & 0.4 Import Map Evidence");
  lines.push("");
  lines.push(`Generated: \`${map.generatedAt}\`  `);
  lines.push(`Repository root version: \`${map.rootVersion}\`  `);
  lines.push("");
  lines.push("## 1. Executive Summary & Counts");
  lines.push("");
  lines.push(
    `- **Current repository manifests:** ${map.counts.totalCurrentManifests} (${map.counts.totalCurrentManifests === 65 ? "62 baseline 0.3.3 packages + 3 office draft packages" : "50 packages during consolidation transition"})`,
  );
  lines.push(
    `- **Retired 0.3.x package names:** ${map.counts.retiredPackages} (hard-frozen at final 0.3.x releases, deprecated with legacy tag)`,
  );
  lines.push(
    `- **Retained package names:** ${map.counts.retainedPackages} (\`@arnilo/prism\`, \`@arnilo/prism-providers\`, \`@arnilo/prism-web-tools\`, \`@arnilo/prism-memory\`, \`@arnilo/prism-mcp\`, \`@arnilo/prism-acp-agent\`, \`@arnilo/prism-ag-ui\`, \`@arnilo/prism-antigravity-agent\`)`,
  );
  lines.push(
    `- **New family packages:** ${map.counts.newPackages} (\`@arnilo/prism-core\`, \`@arnilo/prism-coding-tools\`, \`@arnilo/prism-office\`)`,
  );
  lines.push(
    `- **Target active 0.4 packages:** **${map.counts.targetActivePackages}** (Consolidation ratio: ${map.counts.baselineManifests} → ${map.counts.targetActivePackages}, −51 manifests net)`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Target Active Package Topology (11 Active Packages)");
  lines.push("");
  lines.push("| # | Active Package | Role | Status | Subpaths / Exports | Key Bins | Optional Peers / Drivers |");
  lines.push("|---|---|---|---|---|---|---|");

  map.activePackages.forEach((pkg, idx) => {
    const subpathsStr =
      pkg.subpaths.length > 3 ? `${pkg.subpaths.slice(0, 3).join(", ")} +${pkg.subpaths.length - 3} more` : pkg.subpaths.join(", ");
    const binsStr = pkg.bins.length ? pkg.bins.map((b) => `\`${b}\``).join(", ") : "none";
    const peersStr = pkg.optionalPeers.length ? pkg.optionalPeers.map((p) => `\`${p}\``).join(", ") : "none";
    lines.push(`| ${idx + 1} | \`${pkg.name}\` | ${pkg.role} | ${pkg.type} | ${subpathsStr} | ${binsStr} | ${peersStr} |`);
  });

  lines.push("");
  lines.push("### Subpath Breakdown for Active Packages");
  lines.push("");
  for (const pkg of map.activePackages) {
    lines.push(`#### \`${pkg.name}\` (${pkg.role})`);
    lines.push(`- **Description:** ${pkg.description}`);
    lines.push(`- **Declared Subpaths:**`);
    for (const sp of pkg.subpaths) {
      lines.push(`  - \`${pkg.name}${sp.startsWith("/") ? sp : sp === "." ? "" : `/${sp}`}\``);
    }
    if (pkg.bins.length) {
      lines.push(`- **Retained Executables (bin):** ${pkg.bins.map((b) => `\`${b}\``).join(", ")}`);
    }
    if (pkg.optionalPeers.length) {
      lines.push(`- **Optional Peers / Host Drivers:** ${pkg.optionalPeers.map((p) => `\`${p}\``).join(", ")}`);
    }
    lines.push("- **Security & Trust Boundaries:**");
    for (const sec of pkg.securityBoundaries) {
      lines.push(`  - ${sec}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 3. Complete 0.3.3 → 0.4 Import Migration Map (54 Retired Packages)");
  lines.push("");
  lines.push(
    "| Current Package (0.3.3) | Category | Final Version | 0.4 Successor Import Specifier | Exported Symbols | Optional Peers / Bins |",
  );
  lines.push("|---|---|---|---|---|---|");

  for (const ret of map.retiredPackages) {
    const opt = ret.optionalPeers.concat(ret.bins).join(", ") || "none";
    lines.push(
      `| \`${ret.name}\` | ${ret.category} | \`${ret.version}\` | \`${ret.fullSuccessor ?? "None (Profile Deleted)"}\` | ${ret.symbolCount} symbols | ${opt} |`,
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 4. Draft Office Manifests Consolidation");
  lines.push("");
  lines.push("The three draft office manifests created in plans 051–053 consolidate into `@arnilo/prism-office`:");
  lines.push("");
  lines.push("| Draft Workspace Manifest | 0.4 Successor Subpath | Exported Symbols |");
  lines.push("|---|---|---|");
  for (const off of map.officeDrafts) {
    lines.push(`| \`${off.name}\` | \`${off.fullSuccessor}\` | ${off.symbolCount} symbols |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 5. Retained CLI / Binaries");
  lines.push("");
  lines.push("| Executable Name | 0.3 Package Origin | 0.4 Home Package | Invocation / Entrypoint |");
  lines.push("|---|---|---|---|");
  lines.push("| `prism` | `@arnilo/prism` | `@arnilo/prism` | `dist/cli.js` (Root CLI) |");
  lines.push("| `prism-dev` | `@arnilo/prism-dev` | `@arnilo/prism-coding-tools` | `dist/dev/cli.js` (Dev Inspector) |");
  lines.push("| `prism-wiki` | `@arnilo/prism-wiki` | `@arnilo/prism-memory` | `dist/wiki/cli.js` (LLM Wiki & Context7 CLI) |");
  lines.push("| `prism-acp-agent` | `@arnilo/prism-acp-agent` | `@arnilo/prism-acp-agent` | `dist/cli.js` (ACP Protocol CLI) |");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 6. Optional Peers and Host Binary Requirements");
  lines.push("");
  lines.push("| Subpath / Family | Requirement | Category | Failure Mode / Enforcement |");
  lines.push("|---|---|---|---|");
  lines.push(
    "| `@arnilo/prism-core/sessions/sqlite` | `better-sqlite3` | Optional Peer | Fail-closed before opening SQLite db; emits install hint |",
  );
  lines.push("| `@arnilo/prism-core/sessions/postgres` | `pg` | Optional Peer | Fail-closed before pool connection; emits install hint |");
  lines.push(
    "| `@arnilo/prism-core/sessions/nats` | `@nats-io/jetstream`, `@nats-io/transport-node` | Optional Peer | Fail-closed before NATS client connect |",
  );
  lines.push(
    "| `@arnilo/prism-core/credentials/node` | `@napi-rs/keyring` | Hard Dependency | Native keyring backend for secure token storage |",
  );
  lines.push(
    "| `@arnilo/prism-coding-tools/document-reader` | `mammoth`, `pdf-parse` | Optional Peer | Fail-closed when parsing .docx or .pdf if parser missing |",
  );
  lines.push(
    "| `@arnilo/prism-coding-tools/computer-use-linux` | `xdotool` / desktop MCP | Host Binary | Probed at device initialization; fails before action dispatch |",
  );
  lines.push("| `@arnilo/prism-coding-tools/ponytail` | `@dietrichgebert/ponytail` | Optional Peer | Optional persona peer |");
  lines.push("| `@arnilo/prism-web-tools/browser` | `playwright-core` | Optional Peer | Fail-closed before browser launch/connect |");
  lines.push(
    "| `@arnilo/prism-web-tools/obscura` | `obscura` CLI / binary | Host Binary | SSRF-checked loopback probe; fails before session start |",
  );
  lines.push("| `@arnilo/prism-memory/graft` | `@nanonets/graft` | Optional Peer | Process probe before running graph queries |");
  lines.push(
    "| `@arnilo/prism-office/diagrams` | `playwright-core` | Optional Peer | Fail-closed when rendering raster PNG diagrams if missing |",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 7. Security Trust Boundaries");
  lines.push("");
  lines.push("| Subpath / Domain | Primary Threat / Risk | Boundary Mechanism & Enforcement | Preserved Test Suites |");
  lines.push("|---|---|---|---|");
  lines.push(
    "| `coding-tools/security` | Host filesystem destruction, unauthorized command execution | Disposable Docker/OCI container isolation, path traversal checks, execution approval ledger | `packages/coding-security/src/__tests__/*` |",
  );
  lines.push(
    "| `web-tools/browser` | Intranet probing, data exfiltration, drive-by downloads | URL allowlist/blocklist, private IP egress block, quarantine directories for uploads/downloads | `packages/browser/src/__tests__/*` |",
  );
  lines.push(
    "| `web-tools/obscura` | SSRF, loopback forgery, unauthorized CDP session manipulation | Strict loopback pinning, token auth, process isolation | `packages/obscura/src/__tests__/*` |",
  );
  lines.push(
    "| `core/sessions/postgres` | SQL injection, schema corruption, multi-tenant state bleed | Parameterized queries, migration locking, transaction savepoints | `packages/session-store-postgres/src/__tests__/*` |",
  );
  lines.push(
    "| `coding-tools/document-reader` | Billion laughs XML bomb, out-of-memory denial of service | Byte limits, entity expansion limits, memory-bounded parsing | `packages/document-reader/src/__tests__/*` |",
  );
  lines.push(
    "| `memory/rag` | Cross-tenant document leak, vector dimension mismatch | Scope containment, strict namespace isolation, embedder ID check | `packages/rag/src/__tests__/*` |",
  );
  lines.push(
    "| `memory/graft` | Infinite recursion, command hanging | Process execution timeout, bounded stdout/stderr buffers | `packages/prism-graft/src/__tests__/*` |",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 8. Legacy Registry Plan & Deprecation Commands (54 Packages)");
  lines.push("");
  lines.push("```bash");
  for (const ret of map.retiredPackages) {
    lines.push(`# ${ret.name} (${ret.category})`);
    lines.push(ret.distTagCommand);
    lines.push(ret.deprecateCommand);
    lines.push("");
  }
  lines.push("```");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 9. Baseline Export Symbol Snapshot Summary");
  lines.push("");
  lines.push("Total declared exports across all packages are frozen in `scripts/compat-baseline/*.txt`:");
  lines.push("");
  lines.push("| Package Name | Declared Public Exports | Snapshot Baseline File |");
  lines.push("|---|---|---|");
  for (const m of map.manifests) {
    const bName = baselineName(m.pkg.name);
    const distDir = join(m.dir, "dist");
    let count = 0;
    if (existsSync(distDir)) {
      count = extractDeclaredSurface(distDir).size;
    }
    lines.push(`| \`${m.pkg.name}\` | ${count} | \`scripts/compat-baseline/${bName}\` |`);
  }
  lines.push("");

  return lines.join("\n");
}

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const root = flag("--root") ?? DEFAULT_ROOT;
    const out = flag("--out") ?? join(DEFAULT_ROOT, "docs", "_evidence", "phase54-package-map.md");
    const map = buildPackageMap(root);
    const md = generateMarkdown(map);
    if (flag("--stdout")) {
      process.stdout.write(md);
    } else {
      writeFileSync(out, md);
      process.stderr.write(`phase54-package-map: wrote ${out}\n`);
    }
  } catch (error) {
    process.stderr.write(`phase54-package-map error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
