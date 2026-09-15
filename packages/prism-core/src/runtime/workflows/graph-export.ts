import { WorkflowDefinitionError } from "./errors.js";
import type { WorkflowGraphEdge, WorkflowGraphNode, WorkflowGraphView } from "./graph.js";
import { HARD_MAX_NODES } from "./limits.js";

// ─── Export Options ───────────────────────────────────────────────────────────

export interface MermaidExportOptions {
  /** Layout direction. Default `"TD"`. */
  readonly direction?: "TD" | "LR" | "BT" | "RL";
}

export interface DotExportOptions {
  /** Layout rank direction. Default `"TB"`. */
  readonly rankdir?: "TB" | "LR" | "BT" | "RL";
}

// ─── Mermaid Escaping ─────────────────────────────────────────────────────────

/**
 * Escapes characters in Mermaid label strings to prevent syntax breakage and XSS.
 * Replaces double quotes with `#quot;`, `<` with `#lt;`, and `>` with `#gt;`.
 * Also handles `-->` escaping so literal arrows in labels don't parse as edge syntax.
 */
function escapeMermaidLabel(text: string): string {
  if (!text) return "";
  return text.replace(/&/g, "#amp;").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;").replace(/\n/g, "<br/>");
}

function renderMermaidNode(node: WorkflowGraphNode): string {
  const escaped = escapeMermaidLabel(node.label);
  switch (node.kind) {
    case "conditional":
      return `${node.id}{"${escaped}"}`;
    case "loop":
      return `${node.id}{{"${escaped}"}}`;
    case "agent":
      return `${node.id}(["${escaped}"])`;
    case "workflow":
      return `${node.id}[["${escaped}"]]`;
    case "tool":
      return `${node.id}("${escaped}")`;
    case "fan_out":
      return `${node.id}[/"${escaped}"/]`;
    case "join":
      return `${node.id}[\\"${escaped}"\\]`;
    default:
      return `${node.id}["${escaped}"]`;
  }
}

function renderMermaidEdge(edge: WorkflowGraphEdge): string {
  if (edge.kind === "then") {
    return `${edge.from} -->|then| ${edge.to}`;
  }
  if (edge.kind === "else") {
    return `${edge.from} -->|else| ${edge.to}`;
  }
  return `${edge.from} --> ${edge.to}`;
}

/**
 * Exports a WorkflowGraphView to a deterministic Mermaid flowchart string.
 */
export function workflowGraphToMermaid(view: WorkflowGraphView, options: MermaidExportOptions = {}): string {
  if (view.nodes.length > HARD_MAX_NODES) {
    throw new WorkflowDefinitionError(`Graph node count (${view.nodes.length}) exceeds maximum limit (${HARD_MAX_NODES})`);
  }

  const direction = options.direction ?? "TD";
  const lines: string[] = [`flowchart ${direction}`];

  // Deterministically sort nodes by id
  const sortedNodes = [...view.nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (const node of sortedNodes) {
    lines.push(`  ${renderMermaidNode(node)}`);
  }

  // Deterministically sort edges
  const sortedEdges = [...view.edges].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
  );
  for (const edge of sortedEdges) {
    lines.push(`  ${renderMermaidEdge(edge)}`);
  }

  return lines.join("\n");
}

// ─── DOT Escaping ─────────────────────────────────────────────────────────────

function escapeDotString(text: string): string {
  if (!text) return "";
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function getDotShape(kind: string): string {
  switch (kind) {
    case "conditional":
      return "shape=diamond";
    case "loop":
      return "shape=hexagon";
    case "agent":
      return "shape=ellipse";
    case "workflow":
      return "shape=component";
    case "tool":
      return "shape=box, style=rounded";
    case "fan_out":
      return "shape=trapezium";
    case "join":
      return "shape=invtrapezium";
    default:
      return "shape=box";
  }
}

/**
 * Exports a WorkflowGraphView to a deterministic Graphviz DOT string with quoted IDs.
 */
export function workflowGraphToDot(view: WorkflowGraphView, options: DotExportOptions = {}): string {
  if (view.nodes.length > HARD_MAX_NODES) {
    throw new WorkflowDefinitionError(`Graph node count (${view.nodes.length}) exceeds maximum limit (${HARD_MAX_NODES})`);
  }

  const rankdir = options.rankdir ?? "TB";
  const graphName = escapeDotString(view.workflowId || "workflow");
  const lines: string[] = [`digraph "${graphName}" {`, `  rankdir=${rankdir};`, `  node [fontname="sans-serif"];`];

  // Deterministically sort nodes by id
  const sortedNodes = [...view.nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (const node of sortedNodes) {
    const quotedId = `"${escapeDotString(node.id)}"`;
    const label = escapeDotString(node.label);
    const shape = getDotShape(node.kind);
    lines.push(`  ${quotedId} [label="${label}", ${shape}];`);
  }

  // Deterministically sort edges
  const sortedEdges = [...view.edges].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
  );
  for (const edge of sortedEdges) {
    const fromQuoted = `"${escapeDotString(edge.from)}"`;
    const toQuoted = `"${escapeDotString(edge.to)}"`;
    if (edge.kind === "then") {
      lines.push(`  ${fromQuoted} -> ${toQuoted} [label="then"];`);
    } else if (edge.kind === "else") {
      lines.push(`  ${fromQuoted} -> ${toQuoted} [label="else"];`);
    } else {
      lines.push(`  ${fromQuoted} -> ${toQuoted};`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}
