/**
 * 面板通用弹窗（C5 分层第二步：从 view.ts 搬出，v0.10.2）
 * PromptModal 输入弹窗 / ConfirmModal 通用确认 / ClearModal 清屏确认 / ScopeModal 指引范围选择
 */
import { App, Modal } from "obsidian";
import type { GuideMode } from "./guide";

/** Obsidian 原生输入弹窗 */
export class PromptModal extends Modal {
  private resolve!: (value: string | null) => void;
  private placeholder: string;
  private initial: string;

  constructor(app: App, title: string, placeholder = "", initial = "") {
    super(app);
    this.placeholder = placeholder;
    this.initial = initial;
    this.titleEl.setText(title);
  }

  openPrompt(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const input = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: this.placeholder, value: this.initial },
    });
    input.addClass("edge-tutor-prompt-input");
    input.focus();
    input.select();

    const submit = () => {
      const v = input.value.trim();
      this.resolve(v || null);
      this.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") {
        this.resolve(null);
        this.close();
      }
    });
    const btnRow = contentEl.createEl("div", { cls: "edge-tutor-prompt-btns" });
    const okBtn = btnRow.createEl("button", { text: "确定", cls: "mod-cta" });
    okBtn.addEventListener("click", submit);
    const cancelBtn = btnRow.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => {
      this.resolve(null);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/** 确认弹窗（通用） */
export class ConfirmModal extends Modal {
  onConfirm: () => void = () => {};
  private text: string;
  private confirmText: string;

  constructor(app: App, title: string, text: string, confirmText = "确认清空") {
    super(app);
    this.text = text;
    this.confirmText = confirmText;
    this.titleEl.setText(title);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("div", { text: this.text, cls: "edge-tutor-scope-desc" });
    const row = contentEl.createEl("div", { cls: "edge-tutor-scope-btns" });
    const ok = row.createEl("button", { text: this.confirmText, cls: "edge-tutor-mini mod-cta" });
    ok.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
    const cancel = row.createEl("button", { text: "取消", cls: "edge-tutor-mini" });
    cancel.addEventListener("click", () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/** 清屏确认弹窗：检测未沉淀对话，提供「沉淀并清」「备份并清」「取消」 */
export class ClearModal extends Modal {
  onBackupAndClear: () => void = () => {};
  onSaveAndClear: () => void = () => {};
  private hasUnsaved: boolean;

  constructor(app: App, hasUnsaved: boolean) {
    super(app);
    this.hasUnsaved = hasUnsaved;
    this.titleEl.setText("清空当前对话？");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("div", {
      text: [
        "将删除当前工作区的全部对话记录和思维导图结构（.conv.json）。",
        "已沉淀的节点笔记（.md 文件）不受影响。",
        this.hasUnsaved ? "⚠️ 检测到最近的对话还没有沉淀为节点。" : "",
        "无论哪种方式，清空前都会自动导出 JSON 备份到 _exports/，可随时恢复。",
      ].filter(Boolean).join("\n"),
      cls: "edge-tutor-scope-desc",
    });
    const row = contentEl.createEl("div", { cls: "edge-tutor-scope-btns" });
    if (this.hasUnsaved) {
      const save = row.createEl("button", { text: "💾 先沉淀再清屏", cls: "edge-tutor-mini mod-cta" });
      save.addEventListener("click", () => {
        this.onSaveAndClear();
        this.close();
      });
    }
    const backup = row.createEl("button", { text: "备份并清屏", cls: "edge-tutor-mini" });
    backup.addEventListener("click", () => {
      this.onBackupAndClear();
      this.close();
    });
    const cancel = row.createEl("button", { text: "取消", cls: "edge-tutor-mini" });
    cancel.addEventListener("click", () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/** 方向指引范围 + 模式选择弹窗 */
export class ScopeModal extends Modal {
  private resolve!: (value: { scope: "whole" | "nearby"; mode: GuideMode } | null) => void;
  /** 模式选择（null=未选，提交时默认混合） */
  private pendingMode: GuideMode | null = null;

  openScope(): Promise<{ scope: "whole" | "nearby"; mode: GuideMode } | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    // Esc 关闭也要 resolve（此前只处理取消按钮 → openScope 的 promise 永久悬挂）
    this.scope.register([], "Escape", () => this.closeResolve(null));
    contentEl.createEl("h3", { text: "方向指引设置" });
    contentEl.createEl("div", {
      text: "先选模式（点击高亮），再选范围确定。不选模式则默认混合。",
      cls: "edge-tutor-scope-desc",
    });

    // 模式行（点击高亮记录，不提交）
    contentEl.createEl("h4", { text: "模式" });
    const modeRow = contentEl.createEl("div", { cls: "edge-tutor-scope-btns" });
    const mkModeBtn = (text: string, value: GuideMode) => {
      const b = modeRow.createEl("button", { text, cls: "edge-tutor-mini" });
      b.addEventListener("click", () => {
        this.pendingMode = value;
        modeRow.querySelectorAll("button").forEach((x) => x.removeClass("mod-cta"));
        b.addClass("mod-cta");
      });
      return b;
    };
    mkModeBtn("混合（深化+新域）", "mixed");
    mkModeBtn("🔻 深化当前链", "deepen");
    mkModeBtn("🆕 全书新域", "frontier");

    // 范围行（点击提交）
    contentEl.createEl("h4", { text: "范围" });
    const row = contentEl.createEl("div", { cls: "edge-tutor-scope-btns" });
    const whole = row.createEl("button", { text: "📖 全书范围", cls: "edge-tutor-mini mod-cta" });
    whole.addEventListener("click", () => this.pick("whole"));
    const nearby = row.createEl("button", { text: "📍 当前位置附近", cls: "edge-tutor-mini" });
    nearby.addEventListener("click", () => this.pick("nearby"));
    const cancel = row.createEl("button", { text: "取消", cls: "edge-tutor-mini" });
    cancel.addEventListener("click", () => this.closeResolve(null));
  }

  private pick(scope: "whole" | "nearby") {
    this.resolve({ scope, mode: this.pendingMode ?? "mixed" });
    this.close();
  }

  private closeResolve(v: { scope: "whole" | "nearby"; mode: GuideMode } | null) {
    this.resolve(v);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
