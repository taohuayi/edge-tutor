/**
 * 认知边缘导师 —— 右侧常驻对话面板（对齐 Zotero paper-reading-flow 交互）
 *
 * 架构（用户确认：内存会话为主，节点 md 为镜像）：
 *   - .conv.json 存完整会话（threads + messages + reading）＝ 运行态真源
 *   - 节点 .md = 沉淀镜像（saveConversation 时从会话同步导出）
 *   - 导图/消息从会话渲染，支持拖拽重组/活跃路径/视图模式
 *
 * 交互对齐 Zotero：
 *   - 当前思维链区：面包屑 + 当前问题 + 由原文引出 + 上次停在哪 + 分叉/搁置按钮
 *   - 视图模式：当前路径 / 全部 / 单节点
 *   - 消息来源栏 + 跟随追问（基于选中文字继续追问）
 *   - 导图节点拖拽重组（拖到节点=变子，拖空白=回主干）、活跃路径高亮、自动定位
 *   - 状态栏：操作反馈 / 草稿恢复提示
 */
import { App, ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { TutorSettings, ChatMessage, buildSystemPrompt, streamCompletion, buildNoteContextBlocks, extractNoteLinks } from "./ai";
import { buildGuideSystemPrompt, parseGuideResponse, GuideEntry, GuideMode, CognitiveMapSummary } from "./guide";
import { SearchHit } from "./search";
import { parkQuestion, takeParked, makeNodeTitle, buildNodeContent } from "./tutor";
import { mindMapLayout, layoutToCoordinates, buildEdgePath, MindMapThread } from "./canvas";
import { NoteSuggest } from "./suggest";
import {
  Conv, ConvMessage, ConvThread, freshConv, pushMessage, addThread, ancestry, activeThread,
  collectSubtree, reparentThread, switchThread, pauseActive, removeThread, removeMessage,
  messagesForView, messageLineId, searchConversation, branchInstruction, finishAnswer,
  cognitiveMapSummary, serializeConv,
} from "./conv";

export const VIEW_TYPE_TUTOR = "edge-tutor-view";

/** 插件接口（注入 view，避免循环依赖） */
export interface TutorPlugin {
  settings: TutorSettings;
  saveSettings: () => Promise<void>;
  readToc: () => Promise<string>;
  buildMapSummary: () => Promise<CognitiveMapSummary>;
  createNode: (n: CognitiveNodeLike) => Promise<TFile>;
  updateMoc: (workspace?: string) => Promise<void>;
  currentWorkspace: () => string;
  workspaceFolder: (workspace: string) => string;
  getAnchor: () => { sourcePath: string; quote: string } | null;
  getCurrentReadingAnchor: () => { sourcePath: string; quote: string } | null;
  loadConv: (workspace: string) => Promise<Conv>;
  saveConv: (conv: Conv) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (oldName: string, newName: string) => Promise<void>;
  discoverWorkspaces: () => Promise<string[]>;
  exportWorkspace: (format: "markdown" | "json") => Promise<void>;
  rebuildConvFromNodes: (workspace?: string) => Promise<Conv | null>;
  deleteThreadsWithFiles: (workspace: string, threadIds: string[]) => Promise<number>;
  setNodeLocked: (workspace: string, title: string, locked: boolean) => Promise<boolean>;
  buildGlobalMapText: () => Promise<{ text: string; locked: string[]; total: number }>;
  semanticTextbookSearch: (query: string) => Promise<SearchHit>;
  activateAgentView: () => Promise<void>;
  ensureOpenCodeServer: () => Promise<{ ok: boolean; message: string }>;
}

/** 兼容节点形状（view 传给 createNode 的最小结构） */
export interface CognitiveNodeLike {
  title: string;
  content: string;
  parentTitle?: string;
  anchor: { sourcePath: string; quote: string };
  status: "active" | "paused";
  rootQuestion?: string;
  summary?: string;
  workspace?: string;
}

const DRAFT_SAVE_DELAY_MS = 800;
type ViewMode = "path" | "all" | "node";

export class TutorView extends ItemView {
  private plugin: TutorPlugin;
  private conv: Conv = freshConv("main");
  private busy = false;
  private msgContainer!: HTMLElement;
  private mapContainer!: HTMLElement;
  private mapTitle!: HTMLElement;
  private currentBox!: HTMLElement;
  private statusBar!: HTMLElement;
  private parkContainer!: HTMLElement;
  private wsSelect!: HTMLSelectElement;
  private viewSelect!: HTMLSelectElement;
  currentWorkspace = "main";
  private viewMode: ViewMode = "path";
  private inputEl!: HTMLTextAreaElement;
  private inputRowEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private noteSuggest: NoteSuggest | null = null;
  private sendBtn!: HTMLButtonElement;
  private draftTimer: number | null = null;
  private branchNext = false;
  private branchOrigin = "";
  /** 待发送的原文锚点（由此追问选中，发送时使用） */
  private pendingAnchor: string | null = null;
  /** 已选中的方向导引入口，发送前允许用户改写 */
  private pendingGuide: GuideEntry | null = null;
  private branchClipboard: ConvThread[] = [];
  /** 剪贴板分支的来源工作区（粘贴后「删除源」用） */
  private branchClipboardWs = "";
  private selBtn: HTMLButtonElement | null = null;
  private searchEl!: HTMLInputElement;
  private searchResultsEl!: HTMLElement;
  private searchCountEl!: HTMLElement;
  private searchQuery = "";
  private searchHits: { lineId: string | null; messageIndex: number; role: string; excerpt: string; field: string }[] = [];
  private searchCursor = -1;
  /** 剪贴板是否包含消息 */
  private branchClipboardMessages: ConvMessage[] = [];
  /** 消息滚动位置（按视图模式记忆） */
  private messageScroll: Record<string, number> = {};
  /** 懒渲染窗口起点（按视图模式记忆，P2-6）：只渲染 [loadedStart, total) */
  private loadedStart: Record<string, number> = {};
  /** 上一帧活跃线程 id（用于导图自动定位） */
  private lastRenderedMapId: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TutorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TUTOR;
  }

  getDisplayText(): string {
    return "认知边缘导师";
  }

  getIcon(): string {
    return "compass";
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("edge-tutor-panel");

    const header = container.createEl("div", { cls: "edge-tutor-header" });
    header.createEl("div", { text: "🧭 认知边缘导师", cls: "edge-tutor-title" });
    header.createEl("div", {
      text: "选中教材文本 → 由此追问。珍贵推深，细节标记，绝不拉回。停止权在你。",
      cls: "edge-tutor-subtitle",
    });

    const wsRow = header.createEl("div", { cls: "edge-tutor-ws-row" });
    this.wsSelect = wsRow.createEl("select", { cls: "edge-tutor-ws-select" });
    const wsNewBtn = wsRow.createEl("button", { text: "＋", cls: "edge-tutor-ws-btn", attr: { title: "新建工作区" } });
    const wsRenameBtn = wsRow.createEl("button", { text: "✎", cls: "edge-tutor-ws-btn", attr: { title: "重命名当前工作区" } });
    await this.refreshWorkspaceSelect();

    this.wsSelect.addEventListener("change", async () => {
      const target = this.wsSelect.value;
      if (target === this.currentWorkspace) return;
      if (this.busy) {
        new Notice("回答生成中，暂不能切换工作区");
        await this.refreshWorkspaceSelect();
        return;
      }
      try {
        await this.plugin.saveConv(this.conv);
        this.currentWorkspace = target;
        this.conv = await this.ensureWorkspaceLoaded(target);
        this.lastRenderedMapId = null;
        // 清搜索状态
        this.searchQuery = "";
        this.searchHits = [];
        this.searchCursor = -1;
        if (this.searchEl) this.searchEl.value = "";
        await this.renderAll();
        await this.restoreDraft();
        this.setStatus("已切换到工作区：" + (target === "main" ? "默认" : target));
      } catch (e) {
        new Notice("切换工作区失败：" + (e as Error).message.slice(0, 80));
        await this.refreshWorkspaceSelect();
      }
    });

    wsNewBtn.addEventListener("click", async () => {
      const name = await new PromptModal(this.app, "新建思维链工作区", "主题名，如：中值定理").openPrompt();
      if (!name) return;
      const clean = name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
      if (!clean) {
        new Notice("工作区名称不能为空");
        return;
      }
      await this.plugin.createWorkspace(clean);
      await this.refreshWorkspaceSelect();
      new Notice("已创建新工作区：" + clean);
    });

    wsRenameBtn.addEventListener("click", async () => {
      const cur = this.currentWorkspace;
      if (cur === "main") {
        new Notice("默认工作区不能改名：请先新建一个工作区");
        return;
      }
      const name = await new PromptModal(this.app, "重命名工作区", "", cur).openPrompt();
      if (!name || name === cur) return;
      const clean = name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
      if (!clean) {
        new Notice("工作区名称不能为空");
        return;
      }
      await this.plugin.renameWorkspace(cur, clean);
      this.currentWorkspace = clean;
      this.conv.workspace = clean;
      await this.plugin.saveConv(this.conv);
      await this.refreshWorkspaceSelect();
      new Notice("已重命名为：" + clean);
    });

    // ===== 视图模式行 =====
    const viewRow = container.createEl("div", { cls: "edge-tutor-view-row" });
    viewRow.createEl("span", { text: "视图：", cls: "edge-tutor-view-label" });
    this.viewSelect = viewRow.createEl("select", { cls: "edge-tutor-view-select" });
    this.viewSelect.createEl("option", { value: "path", text: "当前路径" });
    this.viewSelect.createEl("option", { value: "all", text: "全部消息" });
    this.viewSelect.createEl("option", { value: "node", text: "单节点" });
    this.viewSelect.value = this.viewMode;
    this.viewSelect.addEventListener("change", () => {
      this.viewMode = this.viewSelect.value as ViewMode;
      this.renderAll();
    });

    // ===== 当前思维链区（Zotero: ui.current） =====
    this.currentBox = container.createEl("div", { cls: "edge-tutor-current" });
    this.currentBox.style.display = "none";

    // ===== 思维导图区 =====
    this.mapTitle = container.createEl("div", { cls: "edge-tutor-map-title" });
    this.mapTitle.style.display = "none";
    this.mapContainer = container.createEl("div", { cls: "edge-tutor-map" });
    this.mapContainer.style.display = "none";
    // 导图平移/滚动（Zotero：拖空白平移 + wheel 横向滚动）
    this.initMapPan();

    // ===== 消息区 =====
    this.msgContainer = container.createEl("div", { cls: "edge-tutor-messages" });

    // ===== 停车场 =====
    this.parkContainer = container.createEl("div", { cls: "edge-tutor-park" });
    this.parkContainer.style.display = "none";

    // ===== 工具行 =====
    const tools = container.createEl("div", { cls: "edge-tutor-tools" });
    // 打开独立执行面板（agent 任务与对话完全分离）
    const agentBtn = tools.createEl("button", { text: "🤖 执行面板", cls: "edge-tutor-btn edge-tutor-agent-open" });
    agentBtn.addEventListener("click", () => void this.plugin.activateAgentView());
    const ocBtn = tools.createEl("button", { text: "🔌 opencode", cls: "edge-tutor-btn edge-tutor-oc-btn", attr: { title: "检测 / 启动 opencode serve（执行面板后端）" } });
    ocBtn.addEventListener("click", async () => {
      if (this.busy) return;
      ocBtn.disabled = true;
      this.setStatus("检查 opencode serve…");
      const r = await this.plugin.ensureOpenCodeServer();
      ocBtn.disabled = false;
      this.setStatus(r.message);
      if (r.ok) {
        new Notice(r.message);
      } else {
        new Notice("⚠️ " + r.message);
      }
    });
    // 教材检索开关：打开时提问自动检索教材原文，结果注入问答模型（不污染对话流）
    const searchBtn = tools.createEl("button", {
      text: "🔍 教材检索",
      cls: "edge-tutor-btn edge-tutor-search-toggle" + (this.plugin.settings.textbookSearchEnabled ? " active" : ""),
      attr: { title: "开关：提问时自动检索教材原文注入问答模型（结果不进对话流）" },
    });
    searchBtn.addEventListener("click", async () => {
      this.plugin.settings.textbookSearchEnabled = !this.plugin.settings.textbookSearchEnabled;
      await this.plugin.saveSettings();
      searchBtn.classList.toggle("active", this.plugin.settings.textbookSearchEnabled);
      this.setStatus(
        this.plugin.settings.textbookSearchEnabled
          ? "🔍 教材检索已开启：提问时自动检索教材原文（结果仅提供给问答模型）"
          : "教材检索已关闭"
      );
    });
    const guideBtn = tools.createEl("button", { text: "🧭 方向指引", cls: "edge-tutor-btn" });
    guideBtn.addEventListener("click", () => this.requestGuide());
    const mapBtn = tools.createEl("button", { text: "🗺️ 导图", cls: "edge-tutor-btn" });
    mapBtn.addEventListener("click", async () => {
      const show = this.mapContainer.style.display === "none";
      this.mapContainer.style.display = show ? "block" : "none";
      this.mapTitle.style.display = show ? "block" : "none";
      if (show) await this.renderWorkflow();
    });
    const parkBtn = tools.createEl("button", { text: "📌 停车场", cls: "edge-tutor-btn" });
    parkBtn.addEventListener("click", async () => {
      // 输入框有内容 → 暂存到停车场；否则展开/收起停车场
      if (this.inputEl.value.trim()) {
        await this.parkInput();
        return;
      }
      const show = this.parkContainer.style.display === "none";
      this.parkContainer.style.display = show ? "block" : "none";
      if (show) await this.renderParkingLot();
    });
    const saveBtn = tools.createEl("button", { text: "💾 沉淀", cls: "edge-tutor-btn" });
    saveBtn.addEventListener("click", () => this.saveConversation());
    const wideBtn = tools.createEl("button", { text: "⛶", cls: "edge-tutor-btn", attr: { title: "宽屏模式（移动到主编辑区）" } });
    wideBtn.addEventListener("click", () => this.toggleWideMode());
    const clearBtn = tools.createEl("button", { text: "✖ 清屏", cls: "edge-tutor-btn", attr: { title: "清空当前对话" } });
    clearBtn.addEventListener("click", () => {
      void this.confirmClear();
    });

    // ===== 工具行 2：搜索 + 粘贴为根 + 导出（Zotero notebookTools） =====
    const tools2 = container.createEl("div", { cls: "edge-tutor-tools edge-tutor-tools2" });
    this.searchEl = tools2.createEl("input", {
      cls: "edge-tutor-search",
      attr: { placeholder: "搜索会话…（Enter 跳转）", type: "text" },
    });
    this.searchCountEl = tools2.createEl("span", { cls: "edge-tutor-search-count" });
    const pasteRootBtn = tools2.createEl("button", { text: "📌", cls: "edge-tutor-btn", attr: { title: "将剪贴板节点粘贴为根节点" } });
    pasteRootBtn.addEventListener("click", () => this.pasteAsRoot());
    const exportMdBt = tools2.createEl("button", { text: "MD", cls: "edge-tutor-btn", attr: { title: "导出当前工作区为 Markdown 笔记" } });
    exportMdBt.addEventListener("click", () => void this.plugin.exportWorkspace("markdown"));
    const exportJsonBt = tools2.createEl("button", { text: "JSON", cls: "edge-tutor-btn", attr: { title: "导出当前工作区为 JSON 备份" } });
    exportJsonBt.addEventListener("click", () => void this.plugin.exportWorkspace("json"));

    this.searchEl.addEventListener("input", () => {
      this.searchQuery = this.searchEl.value;
      this.searchHits = [];
      this.searchCursor = -1;
      this.renderSearchResults();
    });
    this.searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.updateSearch(this.searchEl.value);
        this.navigateSearchHit(this.searchCursor + (e.shiftKey ? -1 : 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.searchEl.value = "";
        this.updateSearch("");
      }
    });
    // 搜索结果列表
    this.searchResultsEl = container.createEl("div", { cls: "edge-tutor-search-results" });

    // ===== 上下文 chips（选中文本锚点提示，P0-1） =====
    this.chipsEl = container.createEl("div", { cls: "edge-tutor-context-chips" });
    this.chipsEl.style.display = "none";

    // ===== 输入区 =====
    const inputRow = container.createEl("div", { cls: "edge-tutor-input-row" });
    this.inputRowEl = inputRow;
    this.inputEl = inputRow.createEl("textarea", {
      cls: "edge-tutor-input",
      attr: { placeholder: "追问或提问…（Enter 发送，Shift+Enter 换行）", rows: "3" },
    });
    this.sendBtn = inputRow.createEl("button", { text: "发送", cls: "edge-tutor-send" });
    this.sendBtn.addEventListener("click", () => this.sendFromInput());

    this.inputEl.addEventListener("input", () => this.scheduleDraftSave());
    this.inputEl.addEventListener("keydown", (e) => {
      // @ 建议框打开时：Enter/方向键/Escape/Tab 交给建议框处理（P1-3），不触发发送
      if (this.noteSuggest && this.noteSuggest.isSuggestOpen()) {
        if (e.key === "Enter" || e.key === "Escape" || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab") {
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendFromInput();
      }
    });

    // @ 引用笔记（P1-3）：输入 @ 弹出 vault 笔记选择器，选中插入 [[笔记名]]
    this.noteSuggest = new NoteSuggest(this.app, this.inputEl, (file) => {
      new Notice(`已引用笔记：${file.basename}（随消息发送给 AI）`);
    });

    // ===== 状态栏 =====
    this.statusBar = container.createEl("div", { cls: "edge-tutor-status" });

    this.initSelFloat();

    // 注册 conv 外部修改监听（agent 改文件时面板自动同步）
    this.registerConvWatcher();

    // 加载当前工作区会话（currentWorkspace 可能已被 refreshWorkspaceSelect 自动切换到教材工作区）
    try {
      this.conv = await this.ensureWorkspaceLoaded(this.currentWorkspace);
    } catch (e) {
      this.conv = freshConv(this.currentWorkspace);
    }
    await this.restoreDraft();
    await this.renderAll();
    this.scrollToBottom();
  }

  /**
   * 统一加载逻辑（onOpen + 工作区切换共用）：
   * - conv 全空（0 消息 0 线程）且节点文件存在 → 从节点重建（清屏/新建/迁移语义，节点永存）
   * - threads=0 但 messages>0 → 用户主动删除/移动的结果，不重建，原样返回
   */
  private async ensureWorkspaceLoaded(ws: string): Promise<Conv> {
    const conv = await this.plugin.loadConv(ws);
    if (conv.messages.length === 0 && conv.reading.threads.length === 0) {
      const rebuilt = await this.plugin.rebuildConvFromNodes(ws);
      if (rebuilt) {
        await this.plugin.saveConv(rebuilt);
        this.setStatus(`已从 ${rebuilt.reading.threads.length} 个节点文件恢复认知地图`);
        return rebuilt;
      }
    }
    return conv;
  }

  /** 供命令调用：用外部重建的 conv 替换当前会话并刷新 */
  async reloadFromConv(conv: Conv) {
    this.conv = conv;
    this.currentWorkspace = conv.workspace || this.currentWorkspace;
    await this.plugin.saveConv(this.conv);
    this.lastRenderedMapId = null;
    await this.renderAll();
  }

  async onClose() {
    await this.flushDraft();
    await this.plugin.saveConv(this.conv);
    if (this.selBtn) this.selBtn.remove();
    // 释放外部修改监听
    if (this.modifyRef) {
      this.app.vault.offref(this.modifyRef);
      this.modifyRef = null;
    }
    this.contentEl.empty();
  }

  /** vault 修改监听引用（agent 外部改 conv 时同步面板） */
  private modifyRef: ReturnType<typeof this.app.vault.on> | null = null;
  /** 等待回答结束后再重载（busy 时不打断） */
  private pendingExternalReload = false;

  /** 注册 conv 外部修改监听：agent 等外部进程改 .conv.json 时面板自动同步。
   * 内容与内存一致 = 自身保存（跳过）；不一致 = 外部修改（重载）。 */
  private registerConvWatcher() {
    if (this.modifyRef) return;
    const ref = this.app.vault.on("modify", async (file) => {
      const folder = this.plugin.workspaceFolder(this.currentWorkspace).replace(/\/+$/, "");
      if (file.path !== `${folder}/.conv.json`) return;
      try {
        const disk = await this.app.vault.adapter.read(file.path);
        if (disk === serializeConv(this.conv)) return; // 自身保存
        if (this.busy) {
          this.pendingExternalReload = true;
          return;
        }
        const next = await this.plugin.loadConv(this.currentWorkspace);
        this.conv = next;
        this.lastRenderedMapId = null;
        await this.renderAll();
        this.setStatus("检测到会话文件被外部修改，已同步");
      } catch (e) {
        // 读取/解析失败忽略
      }
    });
    this.modifyRef = ref;
  }

  /**
   * 供 main.ts / 浮动按钮调用：选中文本 → 设为追问来源（branchOrigin）
   * 对齐 Zotero：选中后只聚焦输入框等用户提问，不立即发送。
   */
  receiveSelection(selection: string, sourcePath?: string) {
    // 存为"由这段文字引出"的来源（Zotero branchOrigin）
    this.branchOrigin = selection;
    this.branchNext = false;
    this.inputEl.value = "";
    this.inputEl.placeholder = "基于选中文字继续追问…";
    this.inputEl.focus();
    // 记录来源锚点供发送时使用
    this.pendingAnchor = sourcePath ?? null;
    // 若已有活跃线程，先切换过去保持上下文
    const active = activeThread(this.conv);
    if (active) {
      switchThread(this.conv, active.id);
    }
    this.setStatus("已选中原文，请输入你的问题");
    this.updateChips();
  }

  /**
   * 上下文 chips 渲染（P0-1A）：pendingAnchor 存在时在输入区上方显示
   * 「📖 文件名 + 引用前 30 字」chip，可点击跳转、× 移除（移除后该消息不带锚点发送）。
   */
  private updateChips() {
    if (!this.chipsEl) return;
    this.chipsEl.empty();
    if (!this.pendingAnchor) {
      this.chipsEl.style.display = "none";
      return;
    }
    const src = this.pendingAnchor;
    const file = src.split("/").pop() ?? src;
    const quote = (this.branchOrigin || "").replace(/\s+/g, " ").trim().slice(0, 30);
    const chip = this.chipsEl.createEl("button", { cls: "edge-tutor-context-chip", attr: { title: "点击跳转到原文位置" } });
    const label = chip.createSpan({ text: `📖 ${file}${quote ? `：${quote}` : ""}` });
    label.addClass("edge-tutor-chip-text");
    const x = chip.createEl("span", { text: "×", cls: "edge-tutor-chip-x", attr: { title: "移除引用（该消息将不带锚点发送）" } });
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      this.pendingAnchor = null;
      this.branchOrigin = "";
      this.inputEl.placeholder = "追问或提问…（Enter 发送，Shift+Enter 换行）";
      this.updateChips();
      this.setStatus("已移除引用来源");
    });
    chip.addEventListener("click", () => {
      if (this.pendingAnchor) void this.navigateToTextAnchor(this.pendingAnchor, this.branchOrigin || undefined);
    });
    this.chipsEl.style.display = "flex";
  }

  /**
   * 宽屏模式：把面板从右侧边栏移到主编辑区作为独立标签页（Obsidian 原生全宽）。
   * 再次点击返回右侧边栏。
   */
  private async toggleWideMode() {
    const leaf = this.leaf;
    const state = leaf.getViewState();
    // 保存当前会话（防止切换时丢失）
    await this.plugin.saveConv(this.conv);
    const root = leaf.getRoot();
    const inSidebar = root === this.app.workspace.leftSplit || root === this.app.workspace.rightSplit;
    if (inSidebar) {
      // 从侧栏移到主编辑区（tab = 独立标签页，全宽）
      const newLeaf = this.app.workspace.getLeaf("tab");
      await newLeaf.setViewState({ ...state, type: VIEW_TYPE_TUTOR, active: true });
      this.app.workspace.revealLeaf(newLeaf);
      this.setStatus("宽屏模式：面板已移到主编辑区。再次点 ⛶ 可回到侧栏。");
    } else {
      // 从主编辑区移回右侧边栏
      const newLeaf = this.app.workspace.getRightLeaf(false);
      if (!newLeaf) return;
      await newLeaf.setViewState({ ...state, type: VIEW_TYPE_TUTOR, active: true });
      this.app.workspace.revealLeaf(newLeaf);
    }
  }

  /** ===== 渲染 ===== */

  private async renderAll() {
    // 消息区（按视图模式）
    const prevScroll = this.messageScroll[this.viewMode];
    this.msgContainer.empty();
    const mode = this.viewMode;
    const msgs = messagesForView(this.conv, mode);
    if (msgs.length === 0) {
      this.appendWelcome();
    } else {
      // 懒渲染分页（P2-6）：消息 >100 条时只渲染最近 50 条，顶部留「加载更早消息」按钮
      const total = msgs.length;
      let start = 0;
      if (total > 100) {
        const saved = this.loadedStart[mode] ?? Math.max(0, total - 50);
        this.loadedStart[mode] = Math.min(saved, total - 50);
        start = this.loadedStart[mode]!;
      }
      if (start > 0) {
        const loadBtn = this.msgContainer.createEl("button", {
          text: `⬆ 加载更早消息（还有 ${start} 条）`,
          cls: "edge-tutor-load-more",
          attr: { title: "向前加载 50 条更早消息" },
        });
        loadBtn.addEventListener("click", () => {
          this.loadedStart[mode] = Math.max(0, start - 50);
          // 记住阅读位置：渲染后把「加载前窗口的第一条消息」滚回原位置
          const anchorMsg = msgs[start];
          void this.renderAll().then(() => {
            if (anchorMsg) this.scrollToMessageIndex(this.conv.messages.indexOf(anchorMsg));
          });
        });
      }
      let lastLineId: string | null = null;
      for (let i = start; i < total; i++) {
        const m = msgs[i];
        // 上下文分隔（Zotero: showContext —— 换线程时显示线程标题）
        const lineId = messageLineId(m);
        const showContext = mode !== "node" && lineId !== lastLineId;
        if (showContext) lastLineId = lineId;
        const thread = lineId ? this.conv.reading.threads.find((t) => t.id === lineId) : undefined;
        const globalIndex = this.conv.messages.indexOf(m);
        this.appendMessage(m, { showContext, thread, messageIndex: globalIndex });
      }
    }
    // 恢复滚动
    if (prevScroll !== undefined) {
      this.msgContainer.scrollTop = prevScroll;
    }

    // 当前思维链区
    this.renderCurrent();

    // 导图（仅由 🗺️ 按钮控制显示，不自动弹出；打开状态下有新线程则刷新）
    if (this.mapContainer.style.display !== "none") {
      if (this.conv.reading.threads.length > 0) {
        await this.renderWorkflow();
      } else {
        this.mapContainer.style.display = "none";
        this.mapTitle.style.display = "none";
      }
    }

    // 停车场
    if (this.conv.reading.parkingLot.length > 0) {
      this.parkContainer.style.display = "block";
      await this.renderParkingLot();
    } else {
      this.parkContainer.style.display = "none";
    }
  }

  private appendWelcome() {
    this.appendMessageRaw({
      role: "assistant",
      content:
        "我是你的认知边缘导师。\n\n**怎么用：**\n1. 在教材里选中一段文字 → 蓝色「由此追问」按钮\n2. 或直接在下面对话框提问\n\n**可以问我：**\n- 「为什么这里要构造辅助函数？」（追根）\n- 「这个定理的边界条件去掉会怎样？」（反例）\n- 点「🧭 方向指引」让 AI 基于全书推荐下一堵值得撞的墙\n- 有暂时不想处理的疑问？点「📌 停车场」\n\n记住：你随时可以停，我不会拉你回来。",
    });
  }

  /** ===== 锚点定位（Obsidian markdown 文本锚点，替代 Zotero PDF 框选） ===== */
  /**
   * 打开 markdown 文件并定位到引用文本。
   * Obsidian 适配：Zotero 是 PDF 页内框选定位，Obsidian 无此能力 →
   * 改为打开文件后搜索引用文本，滚动定位 + 临时高亮。
   * 支持行号优先定位（教材检索引用【📖 文件:行】）。
   */
  private async navigateToTextAnchor(sourcePath: string, quote?: string, line?: number) {
    const f = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(f instanceof TFile)) {
      new Notice("锚点文件不存在：" + sourcePath);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(f);
    // 给渲染一个 tick，等编辑器就绪
    await new Promise((r) => setTimeout(r, 120));
    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!editor) return;
    // 行号定位（教材检索引用）：直接跳行 + 选中该行高亮
    if (line && line > 0) {
      const target = Math.min(Math.max(0, line - 1), editor.lineCount() - 1);
      const from = { line: target, ch: 0 };
      const to = { line: target, ch: editor.getLine(target).length };
      editor.setSelection(from, to);
      editor.scrollIntoView({ from, to }, true);
      editor.focus();
      window.setTimeout(() => {
        try {
          const cur = editor.getCursor();
          editor.setSelection(cur, cur);
        } catch (e) { /* 忽略 */ }
      }, 2500);
      return;
    }
    if (!quote) return;
    // 归一化：去掉多余空白，匹配时也容错空白差异
    const norm = (s: string) => String(s).replace(/\s+/g, " ").trim();
    const needle = norm(quote).slice(0, 80);
    if (!needle) return;
    const doc = editor.getValue();
    const docNorm = norm(doc);
    const idx = docNorm.indexOf(needle);
    if (idx < 0) {
      new Notice("未能在文件中找到锚点文本");
      return;
    }
    // 映射归一化位置回原文位置：逐字符回退空白
    let rawPos = 0;
    let normPos = 0;
    let found = -1;
    const chars = doc;
    while (normPos <= idx && rawPos < chars.length) {
      if (chars[rawPos] === "\n" || chars[rawPos] === " " || chars[rawPos] === "\t" || chars[rawPos] === "\r") {
        rawPos++;
        continue;
      }
      if (normPos === idx) { found = rawPos; break; }
      normPos++;
      rawPos++;
    }
    if (found < 0) {
      // 兜底：直接在原文找（罕见情形）
      found = doc.indexOf(quote.slice(0, 60));
      if (found < 0) found = doc.search(needle.slice(0, 30));
    }
    if (found < 0) {
      new Notice("未能在文件中找到锚点文本");
      return;
    }
    const lineNo = editor.offsetToPos(found).line;
    // 选中目标行做临时高亮（Obsidian Editor.setSelection 原生支持）
    const from = { line: lineNo, ch: 0 };
    const to = { line: lineNo, ch: editor.getLine(lineNo).length };
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    editor.focus();
    window.setTimeout(() => {
      try {
        const cur = editor.getCursor();
        editor.setSelection(cur, cur);
      } catch (e) { /* 忽略 */ }
    }, 2500);
  }

  /** 当前思维链区（Zotero: ui.current） */
  private renderCurrent() {
    const cur = activeThread(this.conv);
    this.currentBox.empty();
    if (!cur) {
      this.currentBox.style.display = "none";
      return;
    }
    this.currentBox.style.display = "block";
    const path = ancestry(this.conv, cur.id);

    // 面包屑
    const crumb = this.currentBox.createEl("div", { cls: "edge-tutor-breadcrumb" });
    crumb.createSpan({ text: path.map((t) => t.title).join(" › ") });

    // 当前问题
    const title = this.currentBox.createEl("div", { cls: "edge-tutor-current-title" });
    title.createSpan({ text: "当前思维链" });
    const q = this.currentBox.createEl("div", { cls: "edge-tutor-current-q" });
    q.createSpan({ text: cur.lastQuestion || cur.rootQuestion || cur.title });

    // 由上一段文字引出（Zotero originExcerpt）
    if (cur.originExcerpt) {
      const origin = this.currentBox.createEl("div", { cls: "edge-tutor-origin" });
      origin.createEl("div", { text: "由上一段文字引出", cls: "edge-tutor-origin-label" });
      origin.createEl("div", { text: cur.originExcerpt, cls: "edge-tutor-origin-text" });
    }

    // 锚点跳转（Obsidian markdown 文本锚点：打开文件 + 定位高亮）
    if (cur.anchor?.sourcePath) {
      const anchorBtn = this.currentBox.createEl("button", { text: "📍 教材锚点", cls: "edge-tutor-anchor" });
      anchorBtn.setAttribute("title", "打开教材文件并定位到引用文本");
      anchorBtn.addEventListener("click", () => {
        void this.navigateToTextAnchor(cur.anchor!.sourcePath!, cur.anchor?.quote);
      });
    }

    // 上次停在哪（summary）
    if (cur.summary) {
      const a = this.currentBox.createEl("div", { cls: "edge-tutor-current-a" });
      a.createSpan({ text: "上次停在：" + cur.summary.slice(0, 120) });
    }

    // 操作：分叉 / 搁置
    const actions = this.currentBox.createEl("div", { cls: "edge-tutor-current-actions" });
    const branch = actions.createEl("button", {
      text: "从这里分叉", cls: "edge-tutor-mini",
      attr: { title: "下一条消息将建立独立分支，并继承当前思路的断点" },
    });
    branch.addEventListener("click", () => {
      if (this.busy) return;
      this.branchNext = true;
      this.branchOrigin = cur.summary || cur.rootQuestion || "";
      this.inputEl.value = "";
      this.inputEl.placeholder = "输入新分支的起点…";
      this.inputEl.focus();
    });
    const pause = actions.createEl("button", { text: "暂时搁置", cls: "edge-tutor-mini" });
    pause.addEventListener("click", () => {
      if (this.busy) return;
      pauseActive(this.conv);
      this.branchNext = false;
      this.inputEl.value = "";
      this.inputEl.placeholder = "输入一个新问题，或从思维地图恢复旧分支…";
      void this.plugin.saveConv(this.conv);
      this.renderAll();
      this.inputEl.focus();
    });
  }

  /** 发送输入框内容（对齐 Zotero：branchNext / branchOrigin 决定行为） */
  private async sendFromInput() {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    this.inputEl.value = "";
    await this.clearDraft();

    const active = activeThread(this.conv);
    let lineId: string | undefined;
    // 由此追问来源（选中原文）优先于分支按钮的 branchOrigin
    const isFromSelection = this.pendingAnchor !== null;
    const origin = this.branchOrigin || "";
    const originAnchor = isFromSelection ? this.pendingAnchor : undefined;
    const guide = this.pendingGuide;
    this.pendingAnchor = null;
    this.pendingGuide = null;
    this.updateChips();

    if (guide) {
      // 方向导引只是探索起点，选中后创建独立根线程，避免把推荐误变成课程路线。
      const t = addThread(this.conv, {
        question: text.slice(0, 60),
        parentId: null,
        // 导引的教材锚点是说明文本，只有当前编辑器锚点才是可导航的 vault 路径。
        anchor: this.plugin.getAnchor(),
        originExcerpt: guide.whyWorthExploring.slice(0, 200),
      });
      lineId = t.id;
    } else if (this.branchNext) {
      // 明确点「从这里分叉」：新建分支，挂在当前线程下（继承断点）
      const t = addThread(this.conv, {
        question: text.slice(0, 60),
        parentId: active?.id ?? null,
        anchor: this.plugin.getAnchor(),
        originExcerpt: isFromSelection ? origin.slice(0, 200) : undefined,
      });
      lineId = t.id;
      this.branchNext = false;
      this.branchOrigin = "";
    } else if (isFromSelection && origin) {
      // 由选中原文引出：新建线程，锚定到原文
      const t = addThread(this.conv, {
        question: text.slice(0, 60),
        parentId: null,
        anchor: { sourcePath: originAnchor ?? "", quote: origin.slice(0, 80) },
        originExcerpt: origin.slice(0, 200),
      });
      lineId = t.id;
      this.branchOrigin = "";
    } else if (active) {
      // 继续当前线程
      lineId = active.id;
    }

    // 消息内容：仅「由此追问」把原文附在问题前（AI 看到完整上下文）
    const content = isFromSelection && origin ? `【由这段原文引出】\n> ${origin}\n\n问题：${text}` : text;
    pushMessage(this.conv, "user", content, { anchor: originAnchor ?? undefined, lineId });
    this.inputEl.placeholder = "追问…";
    await this.plugin.saveConv(this.conv);
    this.renderAll();
    await this.respond();
  }

  /** AI 回答（流式，对齐 Zotero streaming） */
  private async respond() {
    if (this.busy) return;
    this.busy = true;
    this.sendBtn.setText("思考中…");
    this.sendBtn.disabled = true;

    const sysPrompt = buildSystemPrompt();
    const history: ChatMessage[] = [{ role: "system", content: sysPrompt }];
    const lastUser = [...this.conv.messages].reverse().find((m) => m.role === "user");
    // @ 引用笔记上下文（P1-3）：把问题里 [[笔记]] 的内容读进 system 块
    if (lastUser) {
      const links = extractNoteLinks(lastUser.content);
      if (links.length > 0) {
        const files = this.app.vault.getMarkdownFiles();
        const notes: { path: string; content: string }[] = [];
        for (const name of links) {
          const hit = files.find((f) => f.path === name || f.path === `${name}.md` || f.basename === name);
          if (!hit || notes.some((n) => n.path === hit.path)) continue;
          try {
            notes.push({ path: hit.path, content: await this.app.vault.cachedRead(hit) });
          } catch (e) {
            console.error("读取 @ 引用笔记失败", hit.path, e);
          }
        }
        if (notes.length > 0) {
          history.unshift({ role: "system", content: buildNoteContextBlocks(notes) });
        }
      }
    }
    // 教材检索（开关开启时）：检索结果注入 system 上下文，不进 conv.messages、不显示
    let searchNote = "";
    if (lastUser && this.plugin.settings.textbookSearchEnabled) {
      this.setStatus("🔍 正在教材检索（语义定位教材原文，约 15-45 秒）…");
      const hit = await this.plugin.semanticTextbookSearch(lastUser.content);
      if (hit.found) {
        history.unshift({
          role: "system",
          content: [
            "【教材检索结果】（由检索代理从教材原文定位，行号可跳转核对）",
            hit.text,
            "",
            "回答规则：",
            "1. 基于引用的教材原文回答，引用处标注【📖 文件:行】（如【📖 第6讲.md:364】）。",
            "2. 引用覆盖不到的部分，明确说「教材中未直接对应，以下是基于已有知识的推断」。",
            "3. 不编造原文——引用的文字必须来自上面的教材引用。",
          ].join("\n"),
        });
        searchNote = `（已检索 ${hit.count} 处教材原文）`;
      } else {
        // 未命中：注入说明，避免模型防御性表述（"我看不到教材"之类）
        history.unshift({
          role: "system",
          content:
            "【教材检索】本次未在教材中定位到与问题直接相关的原文（可能教材未覆盖该内容或表述差异）。请直接基于已有知识正常回答，不要声明「看不到教材/没有教材目录/只能基于截图分析」之类的话。",
        });
      }
    }
    const isFollowup = !!lastUser && !!lastUser.lineId && lastUser.lineId === this.conv.reading.activeId;
    const branchInstr = branchInstruction(this.conv, isFollowup);
    for (let i = 0; i < this.conv.messages.length; i++) {
      const m = this.conv.messages[i];
      if (m.role === "user") {
        const anchorPrefix = m.anchor ? `【教材锚点：${m.anchor}】\n` : "";
        // 只给当前这条用户消息注入分支语境（对齐 Zotero buildBackendPrompt）
        const isCurrent = m === lastUser;
        const instr = isCurrent && branchInstr ? `\n\n${branchInstr}` : "";
        history.push({ role: "user", content: anchorPrefix + m.content + instr });
      } else {
        history.push({ role: "assistant", content: m.content });
      }
    }

    // 流式段落增量渲染（P1-4）：
    // 已完整的段落按 Markdown 渐进渲染（标题/列表/代码块可见），未完成的尾段保持纯文本；
    // normalizeMath 只对完整段落做（半截 \( 会误伤，坑 8）；``` 围栏/公式未闭合的段落整段留待收尾。
    const streamingEl = this.appendMessageRaw({ role: "assistant", content: "" });
    const streamContentEl = streamingEl.querySelector(".edge-tutor-msg-content") as HTMLElement;
    const commitContainer = document.createElement("div");
    commitContainer.className = "edge-tutor-stream-committed";
    streamContentEl.appendChild(commitContainer);
    const streamTextEl = document.createElement("div");
    streamTextEl.className = "edge-tutor-stream-text";
    streamContentEl.appendChild(streamTextEl);
    let streamed = "";
    let pending = "";
    let lastRenderAt = 0;
    const followScroll = () => {
      const maxScroll = Math.max(0, this.msgContainer.scrollHeight - this.msgContainer.clientHeight);
      if (maxScroll - this.msgContainer.scrollTop <= 60) {
        this.msgContainer.scrollTop = this.msgContainer.scrollHeight;
      }
    };
    /** 段落是否可提交：``` 围栏成对且 \( \) \[ \] 各自闭合 */
    const paragraphReady = (t: string): boolean => {
      let fences = 0;
      for (const line of t.split("\n")) if (line.trimStart().startsWith("```")) fences++;
      if (fences % 2 !== 0) return false;
      return (
        (t.split("\\(").length - 1) === (t.split("\\)").length - 1) &&
        (t.split("\\[").length - 1) === (t.split("\\]").length - 1)
      );
    };
    /** 按 \n\n 切分 pending：可提交的段落渲染为 Markdown，尾部未完整段落保留纯文本 */
    const flushStreamRender = () => {
      lastRenderAt = Date.now();
      if (!pending) return;
      const parts = pending.split("\n\n");
      const done: string[] = [];
      let rest = "";
      for (let i = 0; i < parts.length; i++) {
        if (i < parts.length - 1 && paragraphReady(parts[i])) {
          done.push(parts[i]);
        } else {
          // 未闭合段落（含其后所有内容）整体保留：围栏/公式可能在跨段之后才闭合
          rest = parts.slice(i).join("\n\n");
          break;
        }
      }
      if (done.length > 0) {
        pending = rest;
        for (const p of done) {
          const div = document.createElement("div");
          div.className = "edge-tutor-md";
          commitContainer.appendChild(div);
          void MarkdownRenderer.render(this.app, normalizeMath(p), div, this.plugin.settings.textbookRoot, this).then(() => {
            this.attachCitationButtons(div);
            this.attachCodeCopyButtons(div);
          });
        }
      }
      streamTextEl.textContent = rest;
      followScroll();
    };
    /** 流式收尾：最后一段也渲染为 Markdown */
    const finalizeStreamRender = () => {
      if (pending) {
        const div = document.createElement("div");
        div.className = "edge-tutor-md";
        commitContainer.appendChild(div);
        void MarkdownRenderer.render(this.app, normalizeMath(pending), div, this.plugin.settings.textbookRoot, this).then(() => {
          this.attachCitationButtons(div);
          this.attachCodeCopyButtons(div);
        });
        pending = "";
        streamTextEl.textContent = "";
      }
    };
    // 流式中途保存：每 ~3s 或每 ~1.5KB 增量持久化一次部分回答，
    // 防止回答生成期间关闭 Obsidian / 插件崩溃导致整段丢失。
    let lastPersistAt = 0;
    let lastPersistLen = 0;
    let partialMsg: ConvMessage | null = null;
    const persistPartial = () => {
      if (streamed.length <= lastPersistLen) return;
      if (!partialMsg) {
        partialMsg = pushMessage(this.conv, "assistant", streamed, { lineId: lastUser?.lineId });
      } else {
        partialMsg.content = streamed;
      }
      lastPersistLen = streamed.length;
      lastPersistAt = Date.now();
      void this.plugin.saveConv(this.conv);
    };
    // 取 partialMsg 的当前值（绕开 TS 闭包控制流分析）
    const getPartial = (): ConvMessage | null => partialMsg;

    try {
      const answer = await streamCompletion(this.plugin.settings, history, {
        onDelta: (delta) => {
          streamed += delta;
          pending += delta;
          // 200ms 节流：完整段落渐进渲染为 Markdown，尾段保持纯文本
          if (Date.now() - lastRenderAt >= 200) flushStreamRender();
          else followScroll();
          const now = Date.now();
          if (streamed.length - lastPersistLen >= 1500 || (now - lastPersistAt >= 3000 && streamed.length > lastPersistLen)) {
            persistPartial();
          }
        },
      });
      // 收尾渲染最后一段
      finalizeStreamRender();
      // 回答归属到最后一个用户消息的线程：
      // 若流式中途已持久化过部分回答，直接更新该消息为完整回答（避免重复消息）
      const partial = getPartial();
      let assistantMsg: ConvMessage;
      if (partial) {
        partial.content = answer;
        assistantMsg = partial;
      } else {
        assistantMsg = pushMessage(this.conv, "assistant", answer, { lineId: lastUser?.lineId });
      }
      // 回答回显「基于 📖 …」：继承提问的锚点（P0-1B）
      if (lastUser?.anchor && !assistantMsg.anchor) assistantMsg.anchor = lastUser.anchor;
      await this.plugin.saveConv(this.conv);
      // 回答收尾（Zotero finishAnswer）：更新理解沉淀 + 最近追问
      if (lastUser) finishAnswer(this.conv, assistantMsg, lastUser.content);
      streamingEl.remove();
      this.renderAll();
    } catch (e) {
      // 失败时保留已流出的部分回答（如果有），并追加错误提示
      if (streamed) {
        const errMsg = `\n\n⚠️ 回答中断：${(e as Error).message.slice(0, 120)}`;
        persistPartial();
        const partial = getPartial();
        if (partial) partial.content = streamed + errMsg;
        await this.plugin.saveConv(this.conv);
        this.renderAll();
      } else {
        this.appendMessageRaw({
          role: "assistant",
          content: `⚠️ 调用失败：${(e as Error).message.slice(0, 150)}\n\n请检查设置中的 API Key 和网络。`,
        });
      }
    } finally {
      this.busy = false;
      this.sendBtn.setText("发送");
      this.sendBtn.disabled = false;
      if (searchNote) this.setStatus(`回答完成 ${searchNote}`);
      // 回答期间外部修改了 conv → 现在同步
      if (this.pendingExternalReload) {
        this.pendingExternalReload = false;
        try {
          const next = await this.plugin.loadConv(this.currentWorkspace);
          this.conv = next;
          await this.renderAll();
          this.setStatus("检测到会话文件被外部修改，已同步");
        } catch (e) {
          // 忽略
        }
      }
    }
    this.scrollToBottom();
  }

  /**
   * 重新生成某条 AI 回答（网络波动/回答不佳时使用）：
   * 用该回答对应的提问重建历史（提问及其之前），流式重新生成并替换原回答。
   */
  private async regenerate(target: ConvMessage) {
    if (this.busy) {
      new Notice("有回答生成中，请稍候");
      return;
    }
    const tIdx = this.conv.messages.indexOf(target);
    if (tIdx < 0) return;
    // 找该回答对应的最近一条 user 消息
    let uIdx = -1;
    for (let i = tIdx - 1; i >= 0; i--) {
      if (this.conv.messages[i].role === "user") {
        uIdx = i;
        break;
      }
    }
    if (uIdx < 0) {
      new Notice("找不到对应的提问");
      return;
    }
    const userMsg = this.conv.messages[uIdx];

    this.busy = true;
    this.sendBtn.setText("思考中…");
    this.sendBtn.disabled = true;
    this.setStatus("🔄 重新生成中…");

    // 历史：从开头到该 user 消息（含），分支语境注入
    const history: ChatMessage[] = [{ role: "system", content: buildSystemPrompt() }];
    const isFollowup = !!userMsg.lineId && userMsg.lineId === this.conv.reading.activeId;
    const branchInstr = branchInstruction(this.conv, isFollowup);
    for (let i = 0; i <= uIdx; i++) {
      const m = this.conv.messages[i];
      if (m.role === "user") {
        const instr = i === uIdx && branchInstr ? `\n\n${branchInstr}` : "";
        history.push({ role: "user", content: m.content + instr });
      } else {
        history.push({ role: "assistant", content: m.content });
      }
    }

    // 在原消息位置流式渲染
    const msgEl = this.msgContainer.querySelector(`[data-msg-index="${tIdx}"]`);
    const streamEl = msgEl ?? this.appendMessageRaw({ role: "assistant", content: "" });
    const contentEl = streamEl.querySelector(".edge-tutor-msg-content") as HTMLElement;
    contentEl.empty();
    const streamTextEl = document.createElement("div");
    streamTextEl.className = "edge-tutor-stream-text";
    contentEl.appendChild(streamTextEl);
    let streamed = "";

    try {
      const answer = await streamCompletion(this.plugin.settings, history, {
        onDelta: (delta) => {
          streamed += delta;
          streamTextEl.textContent = streamed;
          this.scrollToBottom();
        },
      });
      target.content = answer;
      delete target.verbatimContent;
      if (userMsg.anchor) target.anchor = userMsg.anchor;
      finishAnswer(this.conv, target, userMsg.content);
      await this.plugin.saveConv(this.conv);
      this.renderAll();
      this.setStatus("🔄 已重新生成");
    } catch (e) {
      if (streamed) {
        target.content = streamed + `\n\n⚠️ 回答中断：${(e as Error).message.slice(0, 120)}`;
        await this.plugin.saveConv(this.conv);
        this.renderAll();
        this.setStatus("⚠️ 回答中断，可再次重新生成");
      } else {
        this.renderAll();
        new Notice("重新生成失败：" + (e as Error).message.slice(0, 100));
      }
    } finally {
      this.busy = false;
      this.sendBtn.setText("发送");
      this.sendBtn.disabled = false;
    }
  }

  /** 方向指引 */
  /** 方向指引（范围 + 模式可选；感知认知链结构，节点是路标不是终点） */
  private async requestGuide() {
    if (this.busy) return;
    // 先选范围 + 模式
    const picked = await new ScopeModal(this.app).openScope();
    if (!picked) return;
    const { scope, mode } = picked;
    this.busy = true;
    const active = activeThread(this.conv);
    const scopeLabel = scope === "whole" ? "全书" : "当前位置附近";
    const modeLabel =
      mode === "deepen" ? "深化当前链" : mode === "frontier" ? "全书新域" : "混合";
    pushMessage(this.conv, "user", `🧭 请给我方向指引（范围：${scopeLabel}；模式：${modeLabel}）：推荐值得深入的高价值入口。`, { lineId: active?.id });
    await this.plugin.saveConv(this.conv);
    this.renderAll();
    // 流式占位气泡
    const loadingMsg = this.appendMessageRaw({ role: "assistant", content: "" });
    const streamTextEl = document.createElement("div");
    streamTextEl.className = "edge-tutor-stream-text";
    loadingMsg.querySelector(".edge-tutor-msg-content")!.appendChild(streamTextEl);
    let streamed = "";
    // 方向指引流式同样做节流中间保存（回答长，防中途关闭丢失）
    let guidePersistLen = 0;
    let guidePartial: ConvMessage | null = null;
    const persistGuide = () => {
      if (streamed.length <= guidePersistLen) return;
      if (!guidePartial) {
        guidePartial = pushMessage(this.conv, "assistant", streamed, { lineId: active?.id });
      } else {
        guidePartial.content = streamed;
      }
      guidePersistLen = streamed.length;
      void this.plugin.saveConv(this.conv);
    };

    try {
      const toc = await this.plugin.readToc();
      // 认知地图来源：whole 聚合所有工作区（完整图景）；nearby 用当前工作区（保持"附近"精度）
      let mapText: string;
      let locked: string[];
      if (scope === "whole") {
        const g = await this.plugin.buildGlobalMapText();
        mapText = g.text;
        locked = g.locked;
      } else {
        const map = cognitiveMapSummary(this.conv);
        mapText = map.summaryText;
        locked = map.locked;
      }
      // 面板打开后，Obsidian 的 active view 通常是本面板，因此单独寻找当前阅读页。
      const readingAnchor = this.plugin.getCurrentReadingAnchor() ?? null;
      const guideMessages: ChatMessage[] = [
        { role: "system", content: buildGuideSystemPrompt(scope, mode) },
        {
          role: "user",
          content: [
            "【教材总目录】",
            toc.slice(0, 6000),
            "",
            "【我的认知地图（节点树：缩进=层级，含摘要与状态；whole 模式含全部工作区）】",
            mapText,
            "",
            scope === "nearby" && readingAnchor
              ? [
                `【当前阅读位置】文件：${readingAnchor.sourcePath}`,
                readingAnchor.quote ? `当前段落/选中文本：${readingAnchor.quote}` : "",
              ].filter(Boolean).join("\n")
              : "",
            mode === "deepen" || mode === "mixed" ? `【当前工作区】${this.currentWorkspace === "main" ? "默认" : this.currentWorkspace}` : "",
            locked.length ? `【封顶链（🔒）】${locked.join(" / ")}` : "",
            "",
            scope === "nearby"
              ? "请在当前位置附近推荐 2-4 个值得深入的高价值入口。"
              : "请推荐 2-4 个全书范围内值得深入的高价值入口。",
          ].filter(Boolean).join("\n"),
        },
      ];
      const answer = await streamCompletion(this.plugin.settings, guideMessages, {
        onDelta: (delta) => {
          streamed += delta;
          streamTextEl.textContent = streamed;
          if (streamed.length - guidePersistLen >= 1500) {
            persistGuide();
          }
        },
      });
      const entries = parseGuideResponse(answer);
      if (entries.length === 0) {
        this.replaceMessage(loadingMsg, { role: "assistant", content: "⚠️ AI 没有返回有效入口。请重试。" });
      } else {
        this.replaceMessage(loadingMsg, {
          role: "assistant",
          content: `🧭 ${scopeLabel}内推荐的高价值入口（自由选择，可跳入）：`,
          guideEntries: entries,
        });
        // 同步更新 conv 里已持久化的部分回答（重开后可见最终文本而非原始 JSON）
        const gp = guidePartial as ConvMessage | null;
        if (gp) gp.content = answer;
      }
      await this.plugin.saveConv(this.conv);
    } catch (e) {
      this.replaceMessage(loadingMsg, { role: "assistant", content: `⚠️ 方向指引失败：${(e as Error).message.slice(0, 150)}` });
    } finally {
      this.busy = false;
    }
  }

  /** 沉淀当前对话为认知节点（从会话同步到 .md 镜像） */
  private async saveConversation() {
    const active = activeThread(this.conv);
    const lastUser = [...this.conv.messages].reverse().find((m) => m.role === "user");
    const lastAssistant = [...this.conv.messages].reverse().find((m) => m.role === "assistant");
    if (!lastUser) {
      new Notice("还没有对话可沉淀");
      return;
    }
    const title = makeNodeTitle(lastUser.content) || "认知节点";
    const node: CognitiveNodeLike = {
      title,
      content: buildNodeContent({
        title,
        content: "",
        parentTitle: active?.parentId
          ? (this.conv.reading.threads.find((t) => t.id === active!.parentId)?.title ?? undefined)
          : undefined,
        anchor: { sourcePath: lastUser.anchor ?? "", quote: lastUser.content.slice(0, 80) },
        status: active?.status === "paused" ? "paused" : "active",
        rootQuestion: lastUser.content,
        summary: lastAssistant?.content.slice(0, 200),
      }),
      anchor: { sourcePath: lastUser.anchor ?? "", quote: lastUser.content.slice(0, 80) },
      status: active?.status === "paused" ? "paused" : "active",
      rootQuestion: lastUser.content,
      summary: lastAssistant?.content.slice(0, 200),
      workspace: this.currentWorkspace,
    };
    await this.plugin.createNode(node);
    new Notice("✅ 认知节点已沉淀");
  }

  /** 清屏确认：检测未沉淀对话 → 自动备份 → 清空 */
  private async confirmClear() {
    const hasContent = this.conv.messages.length > 0 || this.conv.reading.threads.length > 0;
    if (!hasContent) {
      new Notice("当前对话已经是空的");
      return;
    }
    const hasUnsaved = await this.hasUnsavedConversation();
    const modal = new ClearModal(this.app, hasUnsaved);
    modal.onBackupAndClear = async () => {
      await this.plugin.exportWorkspace("json");
      await this.doClear();
    };
    modal.onSaveAndClear = async () => {
      await this.saveConversation();
      await this.plugin.exportWorkspace("json");
      await this.doClear();
    };
    modal.open();
  }

  /** 是否有未沉淀的对话：最后一条消息时间 > 节点目录里最新文件时间 */
  private async hasUnsavedConversation(): Promise<boolean> {
    const lastMsg = this.conv.messages[this.conv.messages.length - 1];
    if (!lastMsg) return false;
    const folder = this.plugin.workspaceFolder(this.currentWorkspace).replace(/\/+$/, "");
    const files = this.app.vault.getMarkdownFiles();
    let latest = 0;
    for (const f of files) {
      if (f.path === folder || f.path.startsWith(folder + "/")) {
        const mtime = f.stat?.mtime ?? 0;
        if (mtime > latest) latest = mtime;
      }
    }
    return lastMsg.ts > latest;
  }

  /** 真正执行清屏 */
  private async doClear() {
    this.conv.messages = [];
    this.conv.reading.threads = [];
    this.conv.reading.activeId = null;
    this.conv.reading.parkingLot = [];
    await this.plugin.saveConv(this.conv);
    this.renderAll();
    new Notice("已清空当前对话（节点文件未受影响，已自动备份）");
  }

  /** 暂存问题到停车场 */
  private async parkInput() {
    const text = this.inputEl.value.trim();
    if (!text) {
      new Notice("输入框为空，没有可暂存的问题");
      return;
    }
    const anchor = this.plugin.getAnchor();
    const active = activeThread(this.conv);
    const item = parkQuestion(text, { anchor: anchor?.sourcePath ?? null, parentId: active?.id ?? null });
    if (!item) return;
    this.conv.reading.parkingLot.push(item);
    await this.plugin.saveConv(this.conv);
    this.inputEl.value = "";
    await this.clearDraft();
    new Notice("📌 已暂存到问题停车场");
    this.parkContainer.style.display = "block";
    await this.renderParkingLot();
  }

  /** 渲染停车场（对齐 Zotero：提问按钮直接取出） */
  private async renderParkingLot() {
    this.parkContainer.empty();
    const list = this.conv.reading.parkingLot;
    if (list.length === 0) {
      this.parkContainer.createEl("div", { text: "（停车场为空）", cls: "edge-tutor-park-empty" });
      return;
    }
    this.parkContainer.createEl("div", { text: `📌 问题停车场（${list.length}）`, cls: "edge-tutor-park-title" });
    for (const it of list) {
      const row = this.parkContainer.createEl("div", { cls: "edge-tutor-park-row" });
      const tag = it.category === "branch" ? "分支" : "稍后";
      row.createEl("span", { text: `[${tag}] ${it.question}`, cls: "edge-tutor-park-question" });
      const takeBtn = row.createEl("button", { text: "提问", cls: "edge-tutor-mini" });
      takeBtn.addEventListener("click", async () => {
        const taken = takeParked(this.conv.reading.parkingLot, it.id);
        this.conv.reading.parkingLot = taken.list;
        await this.plugin.saveConv(this.conv);
        if (taken.item?.parentId) {
          switchThread(this.conv, taken.item.parentId);
        }
        this.inputEl.value = taken.item?.question ?? "";
        this.branchNext = !!taken.item?.parentId;
        this.renderAll();
        this.inputEl.focus();
      });
    }
  }

  /** ===== 会话搜索（Zotero searchConversation） ===== */
  private updateSearch(query: string) {
    this.searchQuery = String(query || "");
    this.searchHits = searchConversation(this.conv, this.searchQuery);
    this.searchCursor = -1;
    this.renderAll();
    this.renderSearchResults();
  }

  private async navigateSearchHit(index: number) {
    const hits = this.searchHits;
    if (!hits.length) return;
    if (index < 0) index = hits.length - 1;
    if (index >= hits.length) index = 0;
    const hit = hits[index];
    const lineId = hit.lineId;
    const lineExists = lineId && this.conv.reading.threads.some((t) => t.id === lineId);
    if (lineExists && lineId !== this.conv.reading.activeId) {
      if (this.busy) {
        this.setStatus("回答生成中，暂不切换到其他思维节点。");
        return;
      }
      switchThread(this.conv, lineId);
      void this.plugin.saveConv(this.conv);
    } else if (!lineExists && this.viewMode !== "all") {
      this.viewMode = "all";
      this.viewSelect.value = "all";
      void this.plugin.saveConv(this.conv);
    }
    this.searchCursor = index;
    // 滚动到命中消息（P2-6：目标可能不在懒渲染窗口内，先确保加载）
    if (hit.messageIndex >= 0) {
      const target = await this.ensureMessageLoaded(hit.messageIndex);
      if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    this.renderSearchResults();
  }

  private renderSearchResults() {
    if (!this.searchResultsEl || !this.searchCountEl) return;
    this.searchResultsEl.empty();
    const query = String(this.searchQuery || "").trim();
    if (!query) {
      this.searchCountEl.textContent = "";
      this.searchResultsEl.style.display = "none";
      return;
    }
    const hits = this.searchHits;
    this.searchCountEl.textContent = hits.length
      ? (this.searchCursor >= 0 ? this.searchCursor + 1 + "/" : "") + hits.length + " 处"
      : "无匹配";
    if (!hits.length) {
      this.searchResultsEl.style.display = "none";
      return;
    }
    hits.slice(0, 50).forEach((hit, i) => {
      const row = this.searchResultsEl.createEl("button", {
        cls: "edge-tutor-search-result" + (i === this.searchCursor ? " active" : ""),
      });
      const kind = row.createEl("span", { text: hit.role, cls: "edge-tutor-search-result-kind" });
      void kind;
      const excerpt = row.createEl("span", {
        text: (hit.lineId ? hit.lineId + " · " : "") + (hit.excerpt || ""),
        cls: "edge-tutor-search-result-text",
      });
      void excerpt;
      row.addEventListener("click", () => this.navigateSearchHit(i));
    });
    this.searchResultsEl.style.display = "block";
  }

  /** 粘贴为根（Zotero pasteRoot：不挂任何节点） */
  private async pasteAsRoot() {
    if (this.branchClipboard.length === 0) {
      this.setStatus("剪贴板为空：先在某个节点上点「复制」。");
      return;
    }
    const conv = this.conv;
    const idMap = new Map<string, string>();
    for (const src of this.branchClipboard) {
      const newId = "q" + (++conv.reading.sequence);
      idMap.set(src.id, newId);
      const isRootOfBranch = src.parentId === this.branchClipboard[0].id;
      const newParent = isRootOfBranch ? null : (idMap.get(src.parentId ?? "") ?? src.parentId);
      conv.reading.threads.push({
        ...src,
        id: newId,
        parentId: newParent,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    // 粘贴消息（复制分支带消息）
    if (this.branchClipboardMessages.length > 0) {
      const oldToNew = new Map<string, string>(idMap);
      for (const srcMsg of this.branchClipboardMessages) {
        const newLine = srcMsg.lineId ? oldToNew.get(srcMsg.lineId) ?? srcMsg.lineId : undefined;
        pushMessage(conv, srcMsg.role, srcMsg.content, { anchor: srcMsg.anchor, lineId: newLine });
      }
    }
    await this.plugin.saveConv(conv);
    this.renderAll();
    this.setStatus(`已粘贴 ${this.branchClipboard.length} 个节点为根${this.branchClipboardMessages.length ? `（含 ${this.branchClipboardMessages.length} 条消息）` : ""}`);
  }

  /** 刷新工作区下拉框 */
  private async refreshWorkspaceSelect() {
    const workspaces = await this.plugin.discoverWorkspaces();
    this.wsSelect.empty();
    // 显示优化：教材容器用 📘 前缀，子工作区缩进显示
    for (const ws of workspaces) {
      const text = ws === "main" ? "默认工作区" : ws.includes("/") ? `📘 ${ws}` : `📘 ${ws}`;
      const opt = this.wsSelect.createEl("option", { value: ws, text });
      if (ws === this.currentWorkspace) opt.setAttribute("selected", "selected");
    }
    // 当前工作区不在列表（迁移/改名）→ 自动切到第一个可用工作区（onOpen 会加载它）
    if (workspaces.length > 0 && !workspaces.includes(this.currentWorkspace)) {
      this.currentWorkspace = workspaces[0];
    }
  }

  /** 导图平移/滚动（Zotero：拖空白平移 + wheel 横向滚动） */
  private initMapPan() {
    const map = this.mapContainer;
    map.addEventListener("wheel", (event) => {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta) return;
      if (map.scrollWidth <= map.clientWidth) return;
      event.preventDefault();
      map.scrollLeft += delta;
    }, { passive: false });

    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    map.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("button")) return;
      if (target.closest(".edge-tutor-map-node")) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = map.scrollLeft;
      startTop = map.scrollTop;
      map.classList.add("dragging");
      event.preventDefault();
    });
    map.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      map.scrollLeft = startLeft - (event.clientX - startX);
      map.scrollTop = startTop - (event.clientY - startY);
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      map.classList.remove("dragging");
    };
    map.addEventListener("mouseup", stop);
    map.addEventListener("mouseleave", stop);
  }

  /** ===== 思维导图（Zotero renderWorkflow） ===== */
  private async renderWorkflow() {
    const conv = this.conv;
    const state = conv.reading;
    if (!conv || state.threads.length === 0) {
      this.mapContainer.style.display = "none";
      this.mapTitle.style.display = "none";
      return;
    }

    const threads: MindMapThread[] = state.threads.map((t) => ({
      id: t.id,
      title: t.title || t.rootQuestion,
      parentId: t.parentId,
      status: t.status,
    }));
    const layout = mindMapLayout(threads);
    const { positions, canvasWidth, canvasHeight } = layoutToCoordinates(layout);

    this.mapContainer.style.display = "block";
    this.mapContainer.empty();
    this.mapTitle.style.display = "block";
    this.mapTitle.textContent = `🧭 思维导图 · 纵向主干与分支（${state.threads.length} 个节点）`;

    const NODE_W = 150;
    const NODE_H = 48;
    const ns = "http://www.w3.org/2000/svg";

    // 画布层：全部用原生 DOM 创建，消除对 Obsidian 增强 API / max-content 的依赖
    const canvas = document.createElement("div");
    canvas.className = "edge-tutor-map-canvas";
    canvas.style.position = "relative";
    canvas.style.width = canvasWidth + "px";
    canvas.style.height = canvasHeight + "px";
    this.mapContainer.appendChild(canvas);

    const activePath = new Set(ancestry(conv, state.activeId).map((t) => t.id));

    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(canvasWidth));
    svg.setAttribute("height", String(canvasHeight));
    svg.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
    svg.setAttribute("class", "edge-tutor-map-links");
    for (const edge of layout.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", buildEdgePath(from.x, from.y, to.x, to.y, NODE_W, NODE_H));
      const active = activePath.has(edge.from) && activePath.has(edge.to);
      path.setAttribute("class", "edge-tutor-map-link" + (active ? " active" : ""));
      svg.appendChild(path);
    }
    canvas.appendChild(svg);

    for (const p of layout.nodes) {
      const point = positions.get(p.thread.id);
      if (!point) continue;
      const t = state.threads.find((x) => x.id === p.thread.id);
      if (!t) continue;
      const childrenCount = layout.edges.filter((e) => e.from === t.id).length;
      const cls = [
        "edge-tutor-map-node",
        p.column === 0 ? "root" : "",
        childrenCount > 1 ? "branch" : "",
        t.id === state.activeId ? "active" : "",
        t.status === "paused" ? "paused" : "",
        t.title && t.title !== t.rootQuestion ? "renamed" : "",
        t.mastery === "mastered" ? "mastered" : "",
      ].filter(Boolean).join(" ");
      const node = document.createElement("div");
      node.className = cls;
      node.setAttribute("data-thread-id", t.id);
      node.style.position = "absolute";
      node.style.left = point.x + "px";
      node.style.top = point.y + "px";
      node.style.width = NODE_W + "px";
      node.style.height = NODE_H + "px";
      node.setAttribute("aria-level", String(p.column + 1));
      node.setAttribute(
        "title",
        `原始问题：${t.rootQuestion || t.title || "—"}` +
          (t.anchor?.quote ? `\n锚定：${t.anchor.quote.slice(0, 60)}` : "") +
          (t.summary ? `\n\n摘要：${t.summary.slice(0, 100)}` : "") +
          "\n\n拖拽可调整层级：拖到另一节点上=变为其子节点，拖到空白=回到主干。"
      );
      const label = document.createElement("span");
      label.className = "edge-tutor-map-node-title";
      label.textContent = t.title || t.rootQuestion;
      node.appendChild(label);
      canvas.appendChild(node);

      // 操作按钮（Zotero act()）
      const actions = document.createElement("div");
      actions.className = "edge-tutor-map-acts";
      node.appendChild(actions);
      const act = (labelText: string, tip: string, handler: () => void | Promise<void>, danger = false) => {
        const b = document.createElement("button");
        b.textContent = labelText;
        b.className = "edge-tutor-map-act" + (danger ? " danger" : "");
        b.setAttribute("title", tip);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.busy) return;
          void handler();
        });
        actions.appendChild(b);
      };
      act("➕", "在此节点下插入一个新问题节点", async () => {
        const q = await new PromptModal(this.app, `新问题节点（挂在「${t.title || t.rootQuestion}」之下）`).openPrompt();
        if (q == null) return;
        addThread(conv, { question: q, parentId: t.id, anchor: this.plugin.getAnchor() });
        await this.plugin.saveConv(conv);
        this.renderAll();
        this.inputEl.placeholder = "向这个新问题提问…";
        this.inputEl.focus();
      });
      act("✏️", "改写标题（原始问题仍保留）", async () => {
        const v = await new PromptModal(this.app, "改写节点标题（原始问题不变）", "", t.title || t.rootQuestion).openPrompt();
        if (v == null || v === t.title) return;
        t.title = v;
        t.updatedAt = new Date().toISOString();
        await this.plugin.saveConv(conv);
        this.renderAll();
      });
      act("🔒", t.mastery === "mastered" ? "已封顶，点击取消" : "此链封顶（导引暂不深化此链，可随时取消）", async () => {
        t.mastery = t.mastery === "mastered" ? "exploring" : "mastered";
        t.updatedAt = new Date().toISOString();
        await this.plugin.saveConv(conv);
        // 持久化到节点 frontmatter（重建会话时恢复封顶状态）
        await this.plugin.setNodeLocked(this.currentWorkspace, t.title, t.mastery === "mastered");
        this.renderAll();
        this.setStatus(t.mastery === "mastered" ? `「${t.title}」已封顶（导引将聚焦其他链）` : `「${t.title}」已解除封顶`);
      });
      act("📋", "复制此节点及其全部分支", () => {
        const subtree = collectSubtree(conv, t.id);
        const ids = new Set(subtree.map((s) => s.id));
        this.branchClipboard = subtree;
        this.branchClipboardWs = this.currentWorkspace;
        this.branchClipboardMessages = conv.messages.filter((m) => m.lineId && ids.has(m.lineId));
        this.setStatus(`已复制 ${subtree.length} 个节点（含 ${this.branchClipboardMessages.length} 条消息），在任何节点上点「粘贴」可挂入`);
      });
      act("📌", "将剪贴板节点粘贴为此节点的子节点", async () => {
        if (this.branchClipboard.length === 0) {
          this.setStatus("剪贴板为空：先在某个节点上点「复制」。");
          return;
        }
        const idMap = new Map<string, string>();
        for (const src of this.branchClipboard) {
          const newId = "q" + (++conv.reading.sequence);
          idMap.set(src.id, newId);
          const isRootOfBranch = src.parentId === this.branchClipboard[0].id;
          const newParent = isRootOfBranch ? t.id : idMap.get(src.parentId ?? "") ?? src.parentId;
          conv.reading.threads.push({
            ...src,
            id: newId,
            parentId: newParent,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        // 粘贴消息（复制分支带消息）
        if (this.branchClipboardMessages.length > 0) {
          for (const srcMsg of this.branchClipboardMessages) {
            const newLine = srcMsg.lineId ? idMap.get(srcMsg.lineId) ?? srcMsg.lineId : undefined;
            pushMessage(conv, srcMsg.role, srcMsg.content, { anchor: srcMsg.anchor, lineId: newLine });
          }
        }
        await this.plugin.saveConv(conv);
        this.renderAll();
        this.setStatus(`已粘贴 ${this.branchClipboard.length} 个节点到「${t.title}」之下`);
        // 跨工作区移动：提示删除源工作区的节点
        const srcWs = this.branchClipboardWs;
        const srcIds = this.branchClipboard.map((s) => s.id);
        if (srcWs && srcWs !== this.currentWorkspace && srcIds.length > 0) {
          const srcTitles = this.branchClipboard.map((s) => s.title || s.rootQuestion).slice(0, 3).join("、");
          const modal = new ConfirmModal(this.app, "删除源工作区的节点？", [
            `已把分支粘贴到「${this.currentWorkspace}」。`,
            `是否同时删除「${srcWs}」中的 ${srcIds.length} 个源节点（${srcTitles}${this.branchClipboard.length > 3 ? "…" : ""}）？`,
            "删除会连带移除消息和节点文件（进回收站）。",
          ].join("\n"));
          modal.onConfirm = async () => {
            const n = await this.plugin.deleteThreadsWithFiles(srcWs, srcIds);
            new Notice(`已从「${srcWs}」删除 ${n} 个源节点`);
          };
          modal.open();
        }
      });
      act("📝", "改写摘要（理解沉淀）", async () => {
        const v = await new PromptModal(this.app, "改写摘要（理解沉淀）", "", t.summary || "").openPrompt();
        if (v == null) return;
        t.summary = v;
        t.updatedAt = new Date().toISOString();
        await this.plugin.saveConv(conv);
        this.renderAll();
      });
      act("🗑️", "删除此节点及其全部分支（含消息与节点文件，进回收站）", async () => {
        const subtree = collectSubtree(conv, t.id);
        const ids = subtree.map((s) => s.id);
        const modal = new ConfirmModal(
          this.app,
          "删除节点？",
          `删除「${t.title || t.rootQuestion}」及其 ${ids.length - 1} 个子分支？\n将同步删除消息与节点文件（进回收站可找回）。`,
          "确认删除"
        );
        modal.onConfirm = async () => {
          // 三处同步删除：线程 + 消息 + 节点文件（内部已保存 conv）
          await this.plugin.deleteThreadsWithFiles(this.currentWorkspace, ids);
          this.conv = await this.plugin.loadConv(this.currentWorkspace);
          this.renderAll();
          this.setStatus(`已删除 ${ids.length} 个节点（含消息与文件）`);
        };
        modal.open();
      });

      // 拖拽重组（Zotero：拖到节点=变子，拖空白=回主干）
      this.attachDrag(conv, node, t, point.x, point.y, canvas);

      // 点击 → 切换活跃线程
      node.addEventListener("click", (e) => {
        if (this.busy) return;
        if ((e.target as HTMLElement).closest(".edge-tutor-map-act")) return;
        if (t.id === state.activeId) return;
        switchThread(conv, t.id);
        this.branchNext = false;
        void this.plugin.saveConv(conv);
        this.renderAll();
        this.inputEl.placeholder = "继续这条思路…";
        this.inputEl.focus();
      });
    }

    // 自动定位活跃节点（Zotero mapLocate）
    const activePoint = positions.get(state.activeId ?? "");
    const mapLocate = !this.lastRenderedMapId || this.lastRenderedMapId !== state.activeId;
    if (activePoint && mapLocate) {
      this.mapContainer.scrollLeft = Math.max(0, activePoint.x - Math.max(0, (this.mapContainer.clientWidth - NODE_W) / 2));
      this.mapContainer.scrollTop = Math.max(0, activePoint.y - 54);
    }
    this.lastRenderedMapId = state.activeId;
    this.scrollToBottom();
  }

  /** 拖拽重组（Zotero pointerdown 移植） */
  private attachDrag(
    conv: Conv,
    node: HTMLElement,
    thread: ConvThread,
    origX: number,
    origY: number,
    canvas: HTMLElement
  ) {
    let drag: { startX: number; startY: number; origLeft: number; origTop: number; moved: boolean } | null = null;
    let suppressClick = false;

    node.addEventListener("pointerdown", (e) => {
      if (this.busy) return;
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".edge-tutor-map-act")) return;
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: origX,
        origTop: origY,
        moved: false,
      };

      const onMove = (ev: PointerEvent) => {
        if (!drag) return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) {
          drag.moved = true;
          node.classList.add("dragging");
        }
        if (!drag.moved) return;
        node.style.left = drag.origLeft + dx + "px";
        node.style.top = drag.origTop + dy + "px";
        canvas.querySelectorAll(".edge-tutor-map-node.drop-target").forEach((n) => n.classList.remove("drop-target"));
        const target = dropTargetAt(canvas, ev.clientX, ev.clientY);
        if (target && target.getAttribute("data-thread-id") !== thread.id) {
          target.classList.add("drop-target");
        }
      };
      const onUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (drag?.moved) suppressClick = true;
        const target = dropTargetAt(canvas, ev.clientX, ev.clientY);
        const targetId = target ? target.getAttribute("data-thread-id") : null;
        if (targetId && targetId !== thread.id) {
          if (reparentThread(conv, thread.id, targetId)) {
            void this.plugin.saveConv(conv);
            this.renderAll();
          }
        } else if (!targetId && thread.parentId) {
          if (reparentThread(conv, thread.id, null)) {
            void this.plugin.saveConv(conv);
            this.renderAll();
          }
        }
        drag = null;
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });

    node.addEventListener("click", (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      void e;
    });
  }

  /** 选中文本浮动按钮 */
  private initSelFloat() {
    const selBtn = document.createElement("button");
    selBtn.textContent = "由此追问";
    selBtn.style.cssText =
      "position:fixed;z-index:2147483647;background:#2563eb;color:#fff;border:none;" +
      "border-radius:8px;padding:4px 12px;font:12px/1.6 -apple-system,'Segoe UI','Microsoft YaHei UI',sans-serif;" +
      "cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);display:none;";
    document.body.appendChild(selBtn);
    this.selBtn = selBtn;

    const updateSelFloat = () => {
      try {
        const sel = document.getSelection();
        if (!sel || !sel.rangeCount) {
          selBtn.style.display = "none";
          return;
        }
        const txt = String(sel).trim();
        if (txt.length < 2) {
          selBtn.style.display = "none";
          return;
        }
        const rc = sel.getRangeAt(0).getBoundingClientRect();
        if (!rc || rc.width < 2 || rc.height < 2) {
          selBtn.style.display = "none";
          return;
        }
        selBtn.setAttribute("data-sel", txt);
        const x = rc.left + rc.width / 2 - 42;
        let y = rc.top - 34;
        if (y < 6) y = rc.bottom + 8;
        // 避让输入框：按钮若与输入区相交（会挡住点击）→ 不显示
        const btnRect = { left: Math.max(4, x), top: Math.max(4, y), width: 84, height: 28 };
        const inputRect = this.inputRowEl?.getBoundingClientRect();
        if (
          inputRect &&
          btnRect.left < inputRect.right &&
          btnRect.left + btnRect.width > inputRect.left &&
          btnRect.top < inputRect.bottom &&
          btnRect.top + btnRect.height > inputRect.top
        ) {
          selBtn.style.display = "none";
          return;
        }
        selBtn.style.left = btnRect.left + "px";
        selBtn.style.top = btnRect.top + "px";
        selBtn.style.display = "block";
      } catch (e) {
        selBtn.style.display = "none";
      }
    };

    selBtn.addEventListener("click", async () => {
      const txt = selBtn.getAttribute("data-sel") || "";
      if (!txt) return;
      document.getSelection()?.removeAllRanges();
      selBtn.style.display = "none";
      this.receiveSelection(txt, this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path);
    });

    document.addEventListener("selectionchange", updateSelFloat);
    this.registerInterval(window.setInterval(updateSelFloat, 500));
  }

  /** ===== 草稿 ===== */
  private scheduleDraftSave() {
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => {
      this.draftTimer = null;
      void this.flushDraft();
    }, DRAFT_SAVE_DELAY_MS);
  }

  private async flushDraft() {
    const text = this.inputEl?.value ?? "";
    if (!text.trim()) return;
    this.plugin.settings.draft = {
      text,
      timestamp: Date.now(),
      workspace: this.currentWorkspace,
      branchNext: this.branchNext,
      branchOrigin: this.branchOrigin,
      nextAnchor: this.pendingAnchor,
    };
    await this.plugin.saveSettings();
  }

  private async clearDraft() {
    this.plugin.settings.draft = null;
    await this.plugin.saveSettings();
  }

  private async restoreDraft() {
    const draft = this.plugin.settings.draft;
    if (draft && draft.text && draft.workspace === this.currentWorkspace) {
      this.inputEl.value = draft.text;
      this.pendingAnchor = draft.nextAnchor ?? null;
      // 还原分支意图（Zotero restoreComposerDraft）
      if (draft.branchNext) {
        this.branchNext = true;
        this.branchOrigin = draft.branchOrigin || "";
        this.inputEl.placeholder = "输入新分支的起点…";
      } else if (this.pendingAnchor && this.branchOrigin) {
        this.inputEl.placeholder = "基于选中文字继续追问…";
      } else {
        this.inputEl.placeholder = "继续这条思路…";
      }
      this.setStatus("已恢复未发送的草稿。");
      this.updateChips();
    }
  }

  private async saveConv() {
    await this.plugin.saveConv(this.conv);
  }

  private setStatus(text: string) {
    if (this.statusBar) this.statusBar.textContent = text;
  }

  /** ===== 消息渲染 ===== */

  private appendMessage(m: ConvMessage, ctx: { showContext: boolean; thread?: ConvThread; messageIndex: number }): HTMLElement {
    // 线程上下文分隔（Zotero showContext）
    if (ctx.showContext && ctx.thread) {
      const sep = this.msgContainer.createEl("div", { cls: "edge-tutor-thread-sep" });
      const label = sep.createEl("button", { text: ctx.thread.title || ctx.thread.rootQuestion, cls: "edge-tutor-thread-sep-btn" });
      label.addEventListener("click", () => {
        if (this.busy) return;
        switchThread(this.conv, ctx.thread!.id);
        void this.plugin.saveConv(this.conv);
        this.renderAll();
      });
    }
    return this.appendMessageRaw({
      role: m.role,
      content: m.content,
      anchor: m.anchor,
      anchorQuote: ctx.thread?.anchor?.quote,
      agent: m.agent,
      messageIndex: ctx.messageIndex,
      // 普通 AI 回答可重新生成（导引/执行结果除外）
      onRegenerate:
        m.role === "assistant" && !m.agent && !m.content.trimStart().startsWith("🧭")
          ? () => void this.regenerate(m)
          : undefined,
      onEdit: async (el, content) => {
        const editor = el.createEl("textarea", { cls: "edge-tutor-edit-area", attr: { rows: "6" } });
        editor.value = content;
        const bar = el.createEl("div", { cls: "edge-tutor-edit-bar" });
        const save = bar.createEl("button", { text: "保存", cls: "edge-tutor-mini" });
        const cancel = bar.createEl("button", { text: "取消", cls: "edge-tutor-mini" });
        save.addEventListener("click", async () => {
          if (!m.verbatimContent && m.content !== editor.value) m.verbatimContent = m.content;
          m.content = editor.value;
          await this.plugin.saveConv(this.conv);
          this.renderAll();
        });
        cancel.addEventListener("click", () => this.renderAll());
        editor.focus();
      },
      onDelete: () => {
        // 删除确认用 Modal（坑 1：原生 confirm 对话框会被 Obsidian 拦截）
        const modal = new ConfirmModal(this.app, "删除这条消息？", "将删除该条对话消息（已沉淀的节点笔记不受影响）。", "确认删除");
        modal.onConfirm = () => {
          removeMessage(this.conv, m);
          void this.plugin.saveConv(this.conv);
          this.renderAll();
          this.setStatus("已删除该条消息");
        };
        modal.open();
      },
    });
  }

  /** 消息渲染（含编辑按钮，无线程归属则纯展示） */
  private appendMessageRaw(opts: {
    role: "user" | "assistant";
    content: string;
    anchor?: string;
    anchorQuote?: string;
    guideEntries?: GuideEntry[];
    agent?: boolean;
    messageIndex?: number;
    onRegenerate?: () => void;
    onEdit?: (el: HTMLElement, content: string) => void;
    onDelete?: () => void;
  }): HTMLElement {
    const el = this.msgContainer.createEl("div", { cls: `edge-tutor-msg edge-tutor-${opts.role}` });
    if (opts.agent) el.classList.add("edge-tutor-msg-agent");
    if (typeof opts.messageIndex === "number") el.setAttribute("data-msg-index", String(opts.messageIndex));
    const content = el.createEl("div", { cls: "edge-tutor-msg-content" });
    if (opts.agent) content.createEl("div", { text: "🤖 执行结果", cls: "edge-tutor-agent-badge" });

    if (opts.guideEntries && opts.guideEntries.length > 0) {
      content.createEl("p", { text: opts.content });
      for (const e of opts.guideEntries) {
        const box = content.createEl("div", { cls: "edge-tutor-entry" });
        const heading = box.createEl("h5");
        const badge = heading.createSpan({
          text: e.type === "deepen" ? "🔻 深化" : "🆕 新域",
          cls: "edge-tutor-entry-badge" + (e.type === "deepen" ? " deepen" : ""),
        });
        heading.createSpan({ text: `${e.id} ${e.title}` });
        if (e.jiang) heading.createSpan({ text: ` · ${e.jiang}`, cls: "edge-tutor-entry-meta" });
        const rows: [string, string][] = [];
        if (e.type === "deepen" && e.anchorNode) rows.push(["锚定节点", `[[${e.anchorNode}]]`]);
        if (e.question) rows.push(["下一堵墙", e.question]);
        if (e.direction) rows.push(["延伸方向", e.direction]);
        if (e.whyWorthExploring) rows.push(["为什么值得追", e.whyWorthExploring]);
        if (e.entryPoint) rows.push(["自然切入口", e.entryPoint]);
        if (e.tensions.length) rows.push(["关键张力", e.tensions.join("；")]);
        if (e.connections.length) rows.push(["可连接", e.connections.join("；")]);
        if (e.possibleTrails.length) rows.push(["可能尾迹", e.possibleTrails.join("；")]);
        if (e.anchor) rows.push(["教材锚点", e.anchor]);
        for (const [k, v] of rows) {
          const line = box.createEl("p", { cls: "edge-tutor-entry-row" });
          line.createEl("strong", { text: `${k}：` });
          line.createSpan({ text: v });
        }
        const start = box.createEl("button", { text: "从这里开始探索", cls: "edge-tutor-entry-start" });
        start.addEventListener("click", () => {
          if (this.busy) return;
          this.pendingGuide = e;
          this.branchNext = false;
          this.branchOrigin = "";
          this.inputEl.value = e.question || e.title;
          this.inputEl.placeholder = "可以改写这个问题，然后发送…";
          this.inputEl.focus();
        });
      }
    } else if (opts.anchor) {
      // user 消息：大段引用原文（blockquote）；assistant 消息：底部「基于」小字回显（P0-1B）
      const src = opts.anchor;
      const quote = opts.anchorQuote;
      if (opts.role === "user") {
        const bq = content.createEl("blockquote", { text: `📖 ${src}` });
        bq.classList.add("edge-tutor-anchor-quote");
        bq.addEventListener("click", () => void this.navigateToTextAnchor(src, quote));
      }
      const mdEl = content.createEl("div", { cls: "edge-tutor-md" });
      void MarkdownRenderer.render(this.app, normalizeMath(opts.content), mdEl, this.plugin.settings.textbookRoot, this).then(() => {
        this.attachCitationButtons(mdEl);
        this.attachCodeCopyButtons(mdEl);
      });
      if (opts.role === "assistant") {
        const ctx = el.createEl("div", { cls: "edge-tutor-msg-ctx" });
        ctx
          .createEl("button", { text: `基于 📖 ${src}`, cls: "edge-tutor-msg-ctx-btn", attr: { title: "点击跳转到原文位置" } })
          .addEventListener("click", () => void this.navigateToTextAnchor(src, quote));
      }
    } else {
      const mdEl = content.createEl("div", { cls: "edge-tutor-md" });
      void MarkdownRenderer.render(this.app, normalizeMath(opts.content), mdEl, this.plugin.settings.textbookRoot, this).then(() => {
        this.attachCitationButtons(mdEl);
        this.attachCodeCopyButtons(mdEl);
      });
    }

    // 消息 hover 操作组（P0-2，仿节点 map-acts）：复制 / 编辑 / 重新生成 / 删除
    if (opts.onEdit || opts.onRegenerate || opts.onDelete) {
      const acts = el.createEl("div", { cls: "edge-tutor-msg-acts" });
      const actBtn = (label: string, tip: string, handler: () => void | Promise<void>, danger = false) => {
        const b = acts.createEl("button", {
          text: label,
          cls: "edge-tutor-msg-act" + (danger ? " danger" : ""),
          attr: { title: tip },
        });
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          void handler();
        });
        return b;
      };
      actBtn("📋 复制", "复制这条消息内容", async () => {
        try {
          await navigator.clipboard.writeText(opts.content);
          new Notice("已复制到剪贴板");
        } catch (e) {
          console.error("复制消息失败", e);
          new Notice("复制失败，请手动选择复制");
        }
      });
      if (opts.onEdit) {
        actBtn("✏️ 编辑", "编辑这条消息", () => {
          content.empty();
          opts.onEdit!(content, opts.content);
        });
      }
      if (opts.onRegenerate) {
        actBtn("🔄 重新生成", "重新生成这条回答（网络波动/回答不佳时使用）", () => opts.onRegenerate!());
      }
      if (opts.onDelete) {
        actBtn("🗑️ 删除", "删除这条消息", () => opts.onDelete!(), true);
      }
    }
    this.scrollToBottom();
    return el;
  }

  private replaceMessage(el: HTMLElement, msg: { role: "user" | "assistant"; content: string; guideEntries?: GuideEntry[] }) {
    el.remove();
    this.appendMessageRaw(msg);
  }

  /** 扫描回答中的引用标记【📖 文件:行】→ 可点击按钮（跳转教材行） */
  private attachCitationButtons(container: HTMLElement) {
    const re = /【📖\s*([^】]+?):(\d+)(?:-(\d+))?】/g;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const text = node.nodeValue ?? "";
      if (!text.includes("【📖")) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      let replaced = 0;
      while ((m = re.exec(text)) !== null) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const file = m[1].trim();
        const line = parseInt(m[2], 10);
        const btn = document.createElement("button");
        btn.className = "edge-tutor-cite-btn";
        btn.textContent = `📖 ${file}:${line}`;
        btn.addEventListener("click", () => void this.navigateToTextAnchor(file, "", line));
        frag.appendChild(btn);
        replaced++;
        last = m.index + m[0].length;
      }
      if (replaced > 0) {
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
      }
    }
  }

  /** 代码块 hover 复制按钮（P2-5）：在 MarkdownRenderer.render 完成后调用 */
  private attachCodeCopyButtons(container: HTMLElement) {
    for (const pre of Array.from(container.querySelectorAll("pre"))) {
      if (pre.querySelector(".edge-tutor-code-copy")) continue;
      const code = pre.querySelector("code");
      if (!code) continue;
      pre.classList.add("edge-tutor-code-block");
      const btn = document.createElement("button");
      btn.className = "edge-tutor-code-copy";
      btn.textContent = "📋";
      btn.setAttribute("title", "复制代码");
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(code.textContent ?? "");
          new Notice("已复制代码");
        } catch (err) {
          console.error("复制代码失败", err);
          new Notice("复制失败，请手动选择复制");
        }
      });
      pre.appendChild(btn);
    }
  }

  private scrollToBottom() {
    if (this.msgContainer) {
      this.msgContainer.scrollTop = this.msgContainer.scrollHeight;
    }
  }

  /** 滚动到指定消息（data-msg-index），保持其顶部贴合容器顶部（P2-6 懒渲染分页用） */
  private scrollToMessageIndex(index: number) {
    const el = this.msgContainer.querySelector(`[data-msg-index="${index}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cRect = this.msgContainer.getBoundingClientRect();
    this.msgContainer.scrollTop += rect.top - cRect.top;
  }

  /** 确保某条消息在渲染窗口内（P2-6）：不在则调整窗口并重渲染，返回消息元素 */
  private async ensureMessageLoaded(messageIndex: number): Promise<HTMLElement | null> {
    let el = this.msgContainer.querySelector(`[data-msg-index="${messageIndex}"]`) as HTMLElement | null;
    if (el) return el;
    const msgs = messagesForView(this.conv, this.viewMode);
    if (msgs.length > 100) {
      const pos = msgs.findIndex((m) => this.conv.messages.indexOf(m) === messageIndex);
      if (pos < 0) return null;
      this.loadedStart[this.viewMode] = Math.max(0, pos - 25);
    }
    await this.renderAll();
    return this.msgContainer.querySelector(`[data-msg-index="${messageIndex}"]`) as HTMLElement | null;
  }
}

/** 拖拽落点检测 */
function dropTargetAt(canvas: HTMLElement, clientX: number, clientY: number): HTMLElement | null {
  const els = Array.from(canvas.querySelectorAll(".edge-tutor-map-node"));
  for (const n of els) {
    const node = n as HTMLElement;
    if (node.classList.contains("dragging")) continue;
    const r = node.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      return node;
    }
  }
  return null;
}

/** 公式格式转换：\(...\) → $...$, \[...\] → $$...$$（Obsidian MathJax 兼容） */
export function normalizeMath(text: string): string {
  let out = text;
  out = out.replace(/\\\[[\s\S]*?\\\]/g, (m) => "$$" + m.slice(2, -2).trim() + "$$");
  out = out.replace(/\\\(([^\\]*?)\\\)/g, (m) => "$" + m.slice(2, -2).trim() + "$");
  out = out.replace(/\\\(/g, "$").replace(/\\\)/g, "$");
  out = out.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$");
  return out;
}

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

  openScope(): Promise<{ scope: "whole" | "nearby"; mode: GuideMode } | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
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

  /** 模式选择（null=未选，提交时默认混合） */
  private pendingMode: GuideMode | null = null;

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
