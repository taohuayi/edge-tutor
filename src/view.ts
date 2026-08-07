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
import { TutorSettings, ChatMessage, buildSystemPrompt, streamCompletion } from "./ai";
import { buildGuideSystemPrompt, parseGuideResponse, GuideEntry, CognitiveMapSummary } from "./guide";
import { parkQuestion, takeParked, makeNodeTitle, buildNodeContent } from "./tutor";
import { mindMapLayout, layoutToCoordinates, buildEdgePath, MindMapThread } from "./canvas";
import {
  Conv, ConvMessage, ConvThread, freshConv, pushMessage, addThread, ancestry, activeThread,
  collectSubtree, reparentThread, switchThread, pauseActive, removeThread,
  messagesForView, messageLineId, searchConversation, branchInstruction, finishAnswer,
  cognitiveMapSummary,
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
  private sendBtn!: HTMLButtonElement;
  private draftTimer: number | null = null;
  private branchNext = false;
  private branchOrigin = "";
  /** 待发送的原文锚点（由此追问选中，发送时使用） */
  private pendingAnchor: string | null = null;
  /** 已选中的方向导引入口，发送前允许用户改写 */
  private pendingGuide: GuideEntry | null = null;
  private branchClipboard: ConvThread[] = [];
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
        this.conv = await this.plugin.loadConv(target);
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
      this.conv.messages = [];
      this.conv.reading.threads = [];
      this.conv.reading.activeId = null;
      this.conv.reading.parkingLot = [];
      void this.plugin.saveConv(this.conv);
      this.renderAll();
      new Notice("已清空当前对话");
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

    // ===== 输入区 =====
    const inputRow = container.createEl("div", { cls: "edge-tutor-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "edge-tutor-input",
      attr: { placeholder: "追问或提问…（Enter 发送，Shift+Enter 换行）", rows: "3" },
    });
    this.sendBtn = inputRow.createEl("button", { text: "发送", cls: "edge-tutor-send" });
    this.sendBtn.addEventListener("click", () => this.sendFromInput());

    this.inputEl.addEventListener("input", () => this.scheduleDraftSave());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendFromInput();
      }
    });

    // ===== 状态栏 =====
    this.statusBar = container.createEl("div", { cls: "edge-tutor-status" });

    this.initSelFloat();

    // 加载当前工作区会话
    try {
      this.conv = await this.plugin.loadConv("main");
    } catch (e) {
      this.conv = freshConv("main");
    }
    await this.restoreDraft();
    await this.renderAll();
    this.scrollToBottom();
  }

  async onClose() {
    await this.flushDraft();
    await this.plugin.saveConv(this.conv);
    if (this.selBtn) this.selBtn.remove();
    this.contentEl.empty();
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
    const msgs = messagesForView(this.conv, this.viewMode);
    if (msgs.length === 0) {
      this.appendWelcome();
    } else {
      let lastLineId: string | null = null;
      for (const m of msgs) {
        // 上下文分隔（Zotero: showContext —— 换线程时显示线程标题）
        const lineId = messageLineId(m);
        const showContext = this.viewMode !== "node" && lineId !== lastLineId;
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

    // 导图（有线程自动显示，对齐 Zotero）
    if (this.conv.reading.threads.length > 0 && this.mapContainer.style.display === "none") {
      this.mapContainer.style.display = "block";
      this.mapTitle.style.display = "block";
    }
    if (this.mapContainer.style.display !== "none" && this.conv.reading.threads.length > 0) {
      await this.renderWorkflow();
    } else {
      this.mapContainer.style.display = "none";
      this.mapTitle.style.display = "none";
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
   */
  private async navigateToTextAnchor(sourcePath: string, quote?: string) {
    const f = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(f instanceof TFile)) {
      new Notice("锚点文件不存在：" + sourcePath);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(f);
    if (!quote) return;
    // 给渲染一个 tick，等编辑器就绪
    await new Promise((r) => setTimeout(r, 120));
    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!editor) return;
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

    // 流式渲染：消息区先显示占位气泡，逐字更新纯文本（流畅），完成后 Markdown 渲染
    const streamingEl = this.appendMessageRaw({ role: "assistant", content: "" });
    const streamTextEl = document.createElement("div");
    streamTextEl.className = "edge-tutor-stream-text";
    streamingEl.querySelector(".edge-tutor-msg-content")!.appendChild(streamTextEl);
    let streamed = "";
    const followScroll = () => {
      const maxScroll = Math.max(0, this.msgContainer.scrollHeight - this.msgContainer.clientHeight);
      if (maxScroll - this.msgContainer.scrollTop <= 60) {
        this.msgContainer.scrollTop = this.msgContainer.scrollHeight;
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
          // 流式期间用纯文本（快、流畅）；含公式时转 $ 让最终渲染正确
          streamTextEl.textContent = streamed;
          followScroll();
          const now = Date.now();
          if (streamed.length - lastPersistLen >= 1500 || (now - lastPersistAt >= 3000 && streamed.length > lastPersistLen)) {
            persistPartial();
          }
        },
      });
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
    }
    this.scrollToBottom();
  }

  /** 方向指引 */
  /** 方向指引（范围可选：全书 / 当前位置附近；感知掌握深度） */
  private async requestGuide() {
    if (this.busy) return;
    // 先选范围
    const scope = await new ScopeModal(this.app).openScope();
    if (!scope) return;
    this.busy = true;
    const active = activeThread(this.conv);
    const scopeLabel = scope === "whole" ? "全书" : "当前位置附近";
    pushMessage(this.conv, "user", `🧭 请给我方向指引（范围：${scopeLabel}）：推荐值得深入的高价值入口。`, { lineId: active?.id });
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
      // 掌握感知的认知地图摘要
      const map = cognitiveMapSummary(this.conv);
      // 面板打开后，Obsidian 的 active view 通常是本面板，因此单独寻找当前阅读页。
      const readingAnchor = this.plugin.getCurrentReadingAnchor() ?? (map.activeAnchorPath
        ? { sourcePath: map.activeAnchorPath, quote: "" }
        : null);
      const guideMessages: ChatMessage[] = [
        { role: "system", content: buildGuideSystemPrompt(scope) },
        {
          role: "user",
          content: [
            "【教材总目录】",
            toc.slice(0, 6000),
            "",
            "【我的认知地图（含掌握深度）】",
            map.summaryText,
            "",
            scope === "nearby" && readingAnchor
              ? [
                `【当前阅读位置】文件：${readingAnchor.sourcePath}`,
                readingAnchor.quote ? `当前段落/选中文本：${readingAnchor.quote}` : "",
              ].filter(Boolean).join("\n")
              : "",
            map.active ? `【当前活跃线程】${map.active}` : "",
            map.mastered.length ? `【已掌握，勿重复推荐】${map.mastered.join(" / ")}` : "",
            "",
            scope === "nearby"
              ? "请在当前位置附近推荐 3-5 个值得深入的高价值入口。"
              : "请推荐 3-5 个全书范围内值得深入的高价值入口。",
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

  private navigateSearchHit(index: number) {
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
    // 滚动到命中消息
    if (hit.messageIndex >= 0) {
      const target = this.msgContainer.querySelector(`[data-msg-index="${hit.messageIndex}"]`);
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
  private async refreshWorkspaceSelect() {    const workspaces = await this.plugin.discoverWorkspaces();
    this.wsSelect.empty();
    for (const ws of workspaces) {
      const opt = this.wsSelect.createEl("option", {
        value: ws,
        text: ws === "main" ? "默认工作区" : ws,
      });
      if (ws === this.currentWorkspace) opt.setAttribute("selected", "selected");
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
      act("✓", t.mastery === "mastered" ? "已标记掌握，点击取消" : "标记为「已掌握」（方向导引将不再推荐）", async () => {
        t.mastery = t.mastery === "mastered" ? "exploring" : "mastered";
        t.updatedAt = new Date().toISOString();
        await this.plugin.saveConv(conv);
        this.renderAll();
        this.setStatus(t.mastery === "mastered" ? `「${t.title}」已标记为已掌握` : `「${t.title}」已取消掌握标记`);
      });
      act("📋", "复制此节点及其全部分支", () => {
        const subtree = collectSubtree(conv, t.id);
        const ids = new Set(subtree.map((s) => s.id));
        this.branchClipboard = subtree;
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
      });
      act("📝", "改写摘要（理解沉淀）", async () => {
        const v = await new PromptModal(this.app, "改写摘要（理解沉淀）", "", t.summary || "").openPrompt();
        if (v == null) return;
        t.summary = v;
        t.updatedAt = new Date().toISOString();
        await this.plugin.saveConv(conv);
        this.renderAll();
      });
      act("🗑️", "删除此节点及其全部分支（消息仍保留）", async () => {
        const n = 1 + layout.edges.filter((e) => e.from === t.id).length;
        if (!window.confirm(`删除「${t.title || t.rootQuestion}」及其 ${n} 个子分支？\n删除后消息仍保留在对话记录中。`)) return;
        removeThread(conv, t.id);
        await this.plugin.saveConv(conv);
        this.renderAll();
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
        selBtn.style.left = Math.max(4, x) + "px";
        selBtn.style.top = Math.max(4, y) + "px";
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
      messageIndex: ctx.messageIndex,
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
    });
  }

  /** 消息渲染（含编辑按钮，无线程归属则纯展示） */
  private appendMessageRaw(opts: {
    role: "user" | "assistant";
    content: string;
    anchor?: string;
    anchorQuote?: string;
    guideEntries?: GuideEntry[];
    messageIndex?: number;
    onEdit?: (el: HTMLElement, content: string) => void;
  }): HTMLElement {
    const el = this.msgContainer.createEl("div", { cls: `edge-tutor-msg edge-tutor-${opts.role}` });
    if (typeof opts.messageIndex === "number") el.setAttribute("data-msg-index", String(opts.messageIndex));
    const content = el.createEl("div", { cls: "edge-tutor-msg-content" });

    if (opts.guideEntries && opts.guideEntries.length > 0) {
      content.createEl("p", { text: opts.content });
      for (const e of opts.guideEntries) {
        const box = content.createEl("div", { cls: "edge-tutor-entry" });
        const heading = box.createEl("h5", { text: `${e.id} ${e.title}` });
        if (e.jiang) heading.createSpan({ text: ` · ${e.jiang}`, cls: "edge-tutor-entry-meta" });
        const rows: [string, string][] = [];
        if (e.question) rows.push(["核心问题", e.question]);
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
      const bq = content.createEl("blockquote", { text: `📖 ${opts.anchor}` });
      bq.classList.add("edge-tutor-anchor-quote");
      const src = opts.anchor;
      const quote = opts.anchorQuote;
      bq.addEventListener("click", () => void this.navigateToTextAnchor(src, quote));
      const mdEl = content.createEl("div", { cls: "edge-tutor-md" });
      void MarkdownRenderer.render(this.app, normalizeMath(opts.content), mdEl, this.plugin.settings.textbookRoot, this);
    } else {
      const mdEl = content.createEl("div", { cls: "edge-tutor-md" });
      void MarkdownRenderer.render(this.app, normalizeMath(opts.content), mdEl, this.plugin.settings.textbookRoot, this);
    }

    // 编辑按钮（Zotero onEditMessage）
    if (opts.onEdit) {
      const editBtn = content.createEl("button", { text: "✏️ 编辑", cls: "edge-tutor-edit-btn" });
      editBtn.addEventListener("click", () => {
        content.empty();
        opts.onEdit!(content, opts.content);
      });
    }
    this.scrollToBottom();
    return el;
  }

  private replaceMessage(el: HTMLElement, msg: { role: "user" | "assistant"; content: string; guideEntries?: GuideEntry[] }) {
    el.remove();
    this.appendMessageRaw(msg);
  }

  private scrollToBottom() {
    if (this.msgContainer) {
      this.msgContainer.scrollTop = this.msgContainer.scrollHeight;
    }
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

/** 方向指引范围选择弹窗 */
export class ScopeModal extends Modal {
  private resolve!: (value: "whole" | "nearby" | null) => void;

  openScope(): Promise<"whole" | "nearby" | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "方向指引范围" });
    contentEl.createEl("div", {
      text: "想在哪个范围内推荐值得深入的高价值入口？",
      cls: "edge-tutor-scope-desc",
    });

    const row = contentEl.createEl("div", { cls: "edge-tutor-scope-btns" });
    const whole = row.createEl("button", { text: "全书范围", cls: "edge-tutor-mini" });
    whole.addEventListener("click", () => {
      this.resolve("whole");
      this.close();
    });
    const nearby = row.createEl("button", { text: "当前位置附近", cls: "edge-tutor-mini mod-cta" });
    nearby.addEventListener("click", () => {
      this.resolve("nearby");
      this.close();
    });
    const cancel = row.createEl("button", { text: "取消", cls: "edge-tutor-mini" });
    cancel.addEventListener("click", () => {
      this.resolve(null);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
