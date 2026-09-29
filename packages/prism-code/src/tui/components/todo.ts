import type { TodoItem, TodoStatus } from "@arnilo/prism-coding-tools/agent";
import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core";

const STATUS_GLYPHS: Readonly<Record<TodoStatus, string>> = {
  pending: " ",
  in_progress: "~",
  completed: "x",
  cancelled: "-",
};

/** One-line live todo card; empty string when there is no list (nothing to render). */
export function formatTodoPanel(todos: readonly TodoItem[], width = 80): string {
  if (todos.length === 0) return "";
  const open = todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress").length;
  const header = `Todos (${open} open / ${todos.length}):`;
  const items = todos.map((todo) => `[${STATUS_GLYPHS[todo.status]}] ${todo.content}`).join(" · ");
  const line = `${header} ${items}`;
  return line.length <= width ? line : `${line.slice(0, Math.max(0, width - 1))}…`;
}

export class TodoPanelComponent {
  readonly root: BoxRenderable;
  private readonly text: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      flexDirection: "column",
      height: 1,
      paddingLeft: 1,
      paddingRight: 1,
      visible: false,
    });
    this.text = new TextRenderable(renderer, { content: "" });
    this.root.add(this.text);
  }

  update(todos: readonly TodoItem[] | undefined, width = 80): void {
    const line = todos ? formatTodoPanel(todos, width) : "";
    this.text.content = line;
    this.root.visible = line.length > 0;
  }
}
