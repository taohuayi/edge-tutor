/**
 * 输入区 @ 引用笔记（P1-3）
 * 基于 Obsidian 内置 AbstractInputSuggest（零依赖）：
 * 运行时构造函数已绑定 input/focus→onInputChange、blur→close、mousedown 防选中丢失，
 * open() 自动定位到输入框并跟随滚动。这里覆写 textarea 取值与 @ 触发逻辑。
 * 注意：Obsidian 运行时 getValue 用 instanceOf(HTMLInputElement) 判断取值，
 * textarea 会走错分支，因此必须覆写 getValue/setValue。
 */
import { AbstractInputSuggest, App, TFile } from "obsidian";
import { atToken } from "./ai";

export class NoteSuggest extends AbstractInputSuggest<TFile> {
  private textarea: HTMLTextAreaElement;
  private onChoose: (file: TFile) => void;
  /** 当前查询（renderSuggestion 高亮命中片段用） */
  private currentQuery = "";

  constructor(app: App, textarea: HTMLTextAreaElement, onChoose: (file: TFile) => void) {
    super(app, textarea as unknown as HTMLInputElement);
    this.textarea = textarea;
    this.onChoose = onChoose;
    this.limit = 20;
  }

  getValue(): string {
    return this.textarea.value;
  }

  setValue(value: string): void {
    this.textarea.value = value;
  }

  /** @ 触发：光标前有 @token 且能匹配到笔记才弹列表，否则关闭 */
  protected onInputChange(): void {
    const hit = atToken(this.textarea.value, this.textarea.selectionStart ?? this.textarea.value.length);
    if (!hit) {
      this.close();
      return;
    }
    const items = this.getSuggestions(hit.token);
    if (items.length > 0) {
      (this as unknown as { showSuggestions(items: TFile[]): void }).showSuggestions(items);
    } else {
      this.close();
    }
  }

  protected getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    this.currentQuery = q;
    // 命中排序：标题命中优先于路径命中，再按标题中文排序（更符合直觉）
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => !q || f.basename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      .sort((a, b) => {
        const ab = a.basename.toLowerCase().includes(q) ? 0 : 1;
        const bb = b.basename.toLowerCase().includes(q) ? 0 : 1;
        if (ab !== bb) return ab - bb;
        return a.basename.localeCompare(b.basename, "zh");
      });
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.empty();
    const title = el.createDiv({ cls: "suggestion-title" });
    const q = this.currentQuery;
    const idx = q ? file.basename.toLowerCase().indexOf(q) : -1;
    if (idx >= 0) {
      // 高亮标题中的命中片段（<mark>）
      title.appendText(file.basename.slice(0, idx));
      title.createEl("mark", { text: file.basename.slice(idx, idx + q.length) });
      title.appendText(file.basename.slice(idx + q.length));
    } else {
      title.setText(file.basename);
    }
    const folder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
    if (folder) el.createDiv({ cls: "suggestion-note", text: folder });
  }

  selectSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent): void {
    const cursor = this.textarea.selectionStart ?? this.textarea.value.length;
    const hit = atToken(this.textarea.value, cursor);
    if (hit) {
      this.textarea.setRangeText(`[[${file.basename}]]`, hit.start, cursor, "end");
      this.textarea.focus();
    }
    this.onChoose(file);
    this.close();
  }

  /** 建议框是否打开（keydown 守卫用；isOpen 未在类型中暴露） */
  isSuggestOpen(): boolean {
    return !!(this as unknown as { isOpen?: boolean }).isOpen;
  }
}
