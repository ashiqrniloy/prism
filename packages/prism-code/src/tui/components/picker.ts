import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core";

export interface UiPickerOption {
  readonly name: string;
  readonly description?: string;
  readonly value: string;
}

export class PickerComponent {
  readonly root: BoxRenderable;
  private readonly titleText: TextRenderable;
  private readonly itemsBox: BoxRenderable;
  private allOptions: readonly UiPickerOption[] = [];
  private filteredOptions: readonly UiPickerOption[] = [];
  private selectedIndex = 0;
  private baseTitle = "Select Option";
  private filterQuery = "";
  private activeResolver?: (option: UiPickerOption | undefined) => void;

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      flexDirection: "column",
      border: true,
      borderColor: "#00aaff",
      backgroundColor: "#181818",
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      marginBottom: 1,
      visible: false,
    });

    this.titleText = new TextRenderable(renderer, {
      content: "Select Option",
    });

    this.itemsBox = new BoxRenderable(renderer, {
      flexDirection: "column",
      marginTop: 1,
    });

    this.root.add(this.titleText);
    this.root.add(this.itemsBox);
  }

  get isVisible(): boolean {
    return this.root.visible;
  }

  get currentFilterQuery(): string {
    return this.filterQuery;
  }

  get currentFilteredCount(): number {
    return this.filteredOptions.length;
  }

  get selectedOption(): UiPickerOption | undefined {
    return this.filteredOptions[this.selectedIndex];
  }

  /**
   * Replace the option list without resolving the pending `show()` promise: the completion popup
   * drives filtering from the editor buffer and reads the selection through `selectedOption`.
   *
   * A live refresh must not silently discard the caller's filter or selection: the provider and
   * model pickers are re-optioned while their credential probes resolve, which used to reset the
   * list to unfiltered with index 0 while the title still advertised the search chip (Enter then
   * picked the first entry). The filter is re-applied and the selection is kept by value.
   */
  setOptions(options: readonly UiPickerOption[], title?: string): void {
    const selectedValue = this.filteredOptions[this.selectedIndex]?.value;
    this.allOptions = options;
    if (title !== undefined) this.baseTitle = title;
    this.applyFilter();
    const keep = selectedValue === undefined ? -1 : this.filteredOptions.findIndex((option) => option.value === selectedValue);
    this.selectedIndex = keep >= 0 ? keep : 0;
    if (keep >= 0) this.renderItems();
    this.root.visible = true;
  }

  show(title: string, options: readonly UiPickerOption[]): Promise<UiPickerOption | undefined> {
    this.baseTitle = title;
    this.filterQuery = "";
    this.allOptions = options;
    this.filteredOptions = options;
    this.selectedIndex = 0;
    this.updateTitle();
    this.renderItems();
    this.root.visible = true;

    return new Promise<UiPickerOption | undefined>((resolve) => {
      this.activeResolver = resolve;
    });
  }

  hide(): void {
    this.root.visible = false;
    this.filterQuery = "";
    const resolver = this.activeResolver;
    this.activeResolver = undefined;
    if (resolver) {
      resolver(undefined);
    }
  }

  selectCurrent(): void {
    const selected = this.filteredOptions[this.selectedIndex];
    this.root.visible = false;
    this.filterQuery = "";
    const resolver = this.activeResolver;
    this.activeResolver = undefined;
    if (resolver) {
      resolver(selected);
    }
  }

  moveUp(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.renderItems();
    }
  }

  moveDown(): void {
    if (this.selectedIndex < this.filteredOptions.length - 1) {
      this.selectedIndex++;
      this.renderItems();
    }
  }

  /**
   * Handles keyboard input for search filtering, navigation, selection, and cancellation.
   * Returns true if the key was handled.
   */
  handleKey(key: { name: string; sequence?: string; ctrl?: boolean; meta?: boolean }): boolean {
    if (!this.root.visible) return false;

    if (key.name === "escape") {
      this.hide();
      return true;
    }

    if (key.name === "return" || key.name === "enter") {
      this.selectCurrent();
      return true;
    }

    if (key.name === "up") {
      this.moveUp();
      return true;
    }

    if (key.name === "down") {
      this.moveDown();
      return true;
    }

    if (key.name === "backspace") {
      if (this.filterQuery.length > 0) {
        this.filterQuery = this.filterQuery.slice(0, -1);
        this.applyFilter();
      }
      return true;
    }

    // Printable character for in-memory filtering (never triggers network)
    const char = key.sequence ?? (key.name.length === 1 ? key.name : undefined);
    if (char && char.length === 1 && !key.ctrl && !key.meta && char >= " " && char <= "~") {
      this.filterQuery += char;
      this.applyFilter();
      return true;
    }

    return false;
  }

  private applyFilter(): void {
    if (!this.filterQuery) {
      this.filteredOptions = this.allOptions;
    } else {
      const q = this.filterQuery.toLowerCase();
      this.filteredOptions = this.allOptions.filter((opt) => {
        return (
          opt.name.toLowerCase().includes(q) ||
          opt.value.toLowerCase().includes(q) ||
          (opt.description ? opt.description.toLowerCase().includes(q) : false)
        );
      });
    }
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredOptions.length - 1));
    this.updateTitle();
    this.renderItems();
  }

  private updateTitle(): void {
    const searchPart = this.filterQuery ? ` [Search: "${this.filterQuery}"]` : "";
    this.titleText.content = `${this.baseTitle}${searchPart}`;
  }

  private renderItems(): void {
    // Clear existing
    for (const child of this.itemsBox.getChildren()) {
      this.itemsBox.remove(child);
      child.destroy();
    }

    if (this.filteredOptions.length === 0) {
      const emptyText = new TextRenderable(this.root.ctx, {
        content: "  (No matching options)",
      });
      this.itemsBox.add(emptyText);
      return;
    }

    const maxItems = 8;
    const startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(maxItems / 2), Math.max(0, this.filteredOptions.length - maxItems)),
    );
    const visibleItems = this.filteredOptions.slice(startIndex, startIndex + maxItems);

    for (let i = 0; i < visibleItems.length; i++) {
      const opt = visibleItems[i];
      if (!opt) continue;
      const isSelected = startIndex + i === this.selectedIndex;
      const prefix = isSelected ? "▶ " : "  ";
      const desc = opt.description ? ` - ${opt.description}` : "";
      const text = new TextRenderable(this.root.ctx, {
        content: `${prefix}${opt.name}${desc}`,
      });
      this.itemsBox.add(text);
    }
  }
}
