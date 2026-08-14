/**
 * 执行模式独立面板（AgentView）
 *
 * 与对话面板完全分离：任务指令、步骤日志、结果都存在独立的 .agent-conv.json，
 * 不进入对话消息流（价值识别器的讨论保持纯净）。
 *
 * 交互：
 *   - 输入框输入指令 → 执行（委托 opencode，SSE 实时步骤 + 计时器 + 停止）
 *   - 历史任务卡片：时间 + 指令 + 步骤日志 + 结果（Markdown）
 */
import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf } from "obsidian";
import { AgentStep, AgentResult } from "./agent";

export const VIEW_TYPE_AGENT = "edge-tutor-agent-view";

/** 一次任务记录 */
export interface AgentTaskRecord {
  id: string;
  ts: number;
  input: string;
  /** 执行中（未落盘，仅内存） */
  running?: boolean;
  status: "done" | "error" | "stopped";
  steps: { turn: number; name: string; args: string; result: string }[];
  answer: string;
  error?: string;
}

/** agent 会话存储（vault 内 .agent-conv.json） */
export interface AgentConv {
  workspace: string;
  tasks: AgentTaskRecord[];
}

export function freshAgentConv(): AgentConv {
  return { workspace: "main", tasks: [] };
}

/** 插件接口（main.ts 注入） */
export interface AgentPlugin {
  loadAgentConv: () => Promise<AgentConv>;
  saveAgentConv: (conv: AgentConv) => Promise<void>;
  runAgentTask: (input: string, opts: { onStep?: (step: AgentStep) => void; signal?: AbortSignal }) => Promise<AgentResult>;
  currentWorkspace: () => string;
}

export class AgentView extends ItemView {
  private plugin: AgentPlugin;
  private conv: AgentConv = freshAgentConv();
  private busy = false;
  private msgContainer!: HTMLElement;
  private statusBar!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private abort: AbortController | null = null;
  /** 当前进行中任务的日志容器（实时追加步骤） */
  private pendingLogEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AgentPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_AGENT;
  }

  getDisplayText(): string {
    return "🤖 执行面板";
  }

  getIcon(): string {
    return "terminal";
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("edge-tutor-panel");

    const header = container.createEl("div", { cls: "edge-tutor-header" });
    header.createEl("div", { text: "🤖 执行面板（agent）", cls: "edge-tutor-title" });
    header.createEl("div", {
      text: "输入指令，agent 在 vault 内执行。记录独立存储，不进入对话。",
      cls: "edge-tutor-subtitle",
    });

    // 任务区
    this.msgContainer = container.createEl("div", { cls: "edge-tutor-messages" });

    // 输入区
    const inputRow = container.createEl("div", { cls: "edge-tutor-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "edge-tutor-input",
      attr: { placeholder: "指令：agent 执行（如：整理某目录、生成索引、沉淀节点）…（Enter 执行，Shift+Enter 换行）", rows: "3" },
    });
    this.sendBtn = inputRow.createEl("button", { text: "执行", cls: "edge-tutor-send" });
    this.sendBtn.addEventListener("click", () => {
      if (this.busy && this.abort) {
        this.abort.abort();
        return;
      }
      void this.runTask();
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendBtn.click();
      }
    });

    // 清空按钮行
    const tools = container.createEl("div", { cls: "edge-tutor-tools" });
    const clearBtn = tools.createEl("button", { text: "🗑 清空执行记录", cls: "edge-tutor-btn" });
    clearBtn.addEventListener("click", () => {
      this.conv.tasks = [];
      void this.plugin.saveAgentConv(this.conv);
      this.renderAll();
      new Notice("已清空执行记录");
    });

    // 状态栏
    this.statusBar = container.createEl("div", { cls: "edge-tutor-status" });
    const ws = this.plugin.currentWorkspace();
    this.statusBar.setText(
      ws && ws !== "main" ? `当前认知工作区：${ws}（agent 沉淀节点将写入该工作区）` : "当前认知工作区：默认（认知边缘根目录）"
    );

    try {
      this.conv = await this.plugin.loadAgentConv();
      // 崩溃/关闭遗留的 running 任务 → 标记为中断，不显示"执行中"假状态
      let marked = false;
      for (const t of this.conv.tasks) {
        if (t.running) {
          t.running = false;
          t.status = "stopped";
          t.error = undefined;
          marked = true;
        }
      }
      if (marked) {
        await this.plugin.saveAgentConv(this.conv);
      }
    } catch (e) {
      this.conv = freshAgentConv();
    }
    this.renderAll();
  }

  async onClose() {
    await this.plugin.saveAgentConv(this.conv);
    this.contentEl.empty();
  }

  /** ===== 渲染 ===== */
  private renderAll() {
    this.msgContainer.empty();
    if (this.conv.tasks.length === 0) {
      const hero = this.msgContainer.createEl("div", { cls: "edge-tutor-empty" });
      hero.createEl("div", { cls: "edge-tutor-empty-icon", text: "🤖" });
      hero.createEl("div", { cls: "edge-tutor-empty-title", text: "执行面板" });
      hero.createEl("div", {
        cls: "edge-tutor-empty-sub",
        text: "输入指令，agent 在 vault 内执行（记录独立存储，不进入对话）。",
      });
      const tips = hero.createEl("ul", { cls: "edge-tutor-empty-tips" });
      for (const t of [
        "把当前工作区的对话整理成认知节点并挂到地图",
        "扫描某目录下所有 md 文件生成 MOC 索引",
        "搜索包含「xxx」的笔记并汇总",
      ]) {
        tips.createEl("li", { text: t });
      }
      return;
    }
    // 最新在上
    for (const task of [...this.conv.tasks].reverse()) {
      this.renderTask(task);
    }
  }

  private renderTask(task: AgentTaskRecord) {
    const el = this.msgContainer.createEl("div", { cls: "edge-tutor-msg edge-tutor-assistant edge-tutor-msg-agent" });
    el.setAttribute("data-task-id", task.id);
    const content = el.createEl("div", { cls: "edge-tutor-msg-content" });

    const head = content.createEl("div", { cls: "edge-tutor-agent-task-head" });
    const time = new Date(task.ts).toLocaleString("zh-CN", { hour12: false });
    head.createEl("span", { text: `🤖 ${time}`, cls: "edge-tutor-agent-badge" });
    head.createEl("span", {
      text:
        task.running ? " ⏳ 执行中" :
        task.status === "done" ? " ✅ 完成" :
        task.status === "error" ? " ⚠️ 失败" :
        task.status === "stopped" ? " ⏹ 已停止" : "",
      cls: "edge-tutor-agent-badge edge-tutor-task-status st-" + task.status + (task.running ? " running" : ""),
    });

    content.createEl("div", { text: task.input, cls: "edge-tutor-agent-task-input" });

    // 日志容器无条件创建（空任务也可实时追加步骤）
    const log = content.createEl("div", { cls: "edge-tutor-agent-log" });
    if (task.steps.length === 0 && task.running) {
      log.createEl("div", { text: "⏳ 正在分析任务…", cls: "edge-tutor-agent-log-line" });
    }
    for (const st of task.steps) {
      const args = st.args.length > 100 ? st.args.slice(0, 100) + "…" : st.args;
      log.createEl("div", { text: `第${st.turn}轮 → ${st.name}(${args})`, cls: "edge-tutor-agent-log-line edge-tutor-agent-log-call" });
      const summary = st.result.split("\n").filter(Boolean).slice(0, 3).join(" ");
      log.createEl("div", { text: `   ↳ ${summary.slice(0, 140)}`, cls: "edge-tutor-agent-log-line edge-tutor-agent-log-result" });
    }

    if (task.status === "error" && task.error) {
      content.createEl("div", { text: `⚠️ ${task.error}`, cls: "edge-tutor-agent-task-error" });
    } else if (task.answer) {
      const mdEl = content.createEl("div", { cls: "edge-tutor-md" });
      void MarkdownRenderer.render(this.app, task.answer, mdEl, "", this);
    }

    this.scrollToBottom();
  }

  /** 执行任务 */
  private async runTask() {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    this.inputEl.value = "";
    this.busy = true;
    this.sendBtn.setText("停止");
    this.sendBtn.disabled = false;
    this.abort = new AbortController();
    const signal = this.abort.signal;

    // 内存中的进行中任务（未落盘，防止刷新丢）
    const task: AgentTaskRecord = {
      id: "t" + Date.now().toString(36),
      ts: Date.now(),
      input: text,
      running: true,
      status: "done",
      steps: [],
      answer: "",
    };
    this.conv.tasks.push(task);
    // 立即落盘（running 状态），Obsidian 崩溃/关闭后任务记录不丢
    await this.plugin.saveAgentConv(this.conv);
    this.renderAll();
    this.setStatus("⏳ 执行中…");
    // 定位刚渲染的任务卡片日志容器，步骤实时追加
    const taskEl = this.msgContainer.querySelector(`[data-task-id="${task.id}"] .edge-tutor-agent-log`);
    this.pendingLogEl = taskEl instanceof HTMLElement ? taskEl : null;
    const appendStepLog = (name: string, args: string, result: string) => {
      if (!this.pendingLogEl) return;
      const a = args.length > 100 ? args.slice(0, 100) + "…" : args;
      this.pendingLogEl.createEl("div", { text: `第${task.steps.length}轮 → ${name}(${a})`, cls: "edge-tutor-agent-log-line edge-tutor-agent-log-call" });
      const summary = result.split("\n").filter(Boolean).slice(0, 3).join(" ");
      this.pendingLogEl.createEl("div", { text: `   ↳ ${summary.slice(0, 140)}`, cls: "edge-tutor-agent-log-line edge-tutor-agent-log-result" });
      this.scrollToBottom();
    };

    const t0 = Date.now();
    const timer = setInterval(() => {
      this.setStatus(`⏳ 运行中 ${Math.floor((Date.now() - t0) / 1000)}s…（步骤 ${task.steps.length} 个）`);
    }, 1000);

    try {
      const result = await this.plugin.runAgentTask(text, {
        signal,
        onStep: (step) => {
          const raw = typeof step.call.arguments === "string" ? step.call.arguments : JSON.stringify(step.call.arguments);
          task.steps.push({ turn: step.turn, name: step.call.name, args: raw, result: step.result });
          appendStepLog(step.call.name, raw, step.result);
          // 每步落盘：执行中崩溃也能保住已完成步骤
          void this.plugin.saveAgentConv(this.conv);
        },
      });
      task.answer = result.answer;
      task.status = "done";
      task.running = false;
      await this.plugin.saveAgentConv(this.conv);
      this.renderAll();
      this.setStatus(`完成（${result.turns} 轮，工具：${result.toolsUsed.length ? result.toolsUsed.join("、") : "无"}）`);
    } catch (e) {
      task.running = false;
      if (signal.aborted) {
        task.status = "stopped";
        task.error = undefined;
        task.answer = "⏹ 已停止执行。";
      } else {
        task.status = "error";
        task.error = (e as Error).message.slice(0, 250);
      }
      await this.plugin.saveAgentConv(this.conv);
      this.renderAll();
      this.setStatus(task.status === "stopped" ? "已停止" : "执行失败");
    } finally {
      clearInterval(timer);
      this.pendingLogEl = null;
      this.abort = null;
      this.busy = false;
      this.sendBtn.setText("执行");
      this.sendBtn.disabled = false;
    }
  }

  private setStatus(text: string) {
    this.statusBar.setText(text);
  }

  private scrollToBottom() {
    if (this.msgContainer) {
      this.msgContainer.scrollTop = this.msgContainer.scrollHeight;
    }
  }
}
