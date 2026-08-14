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
import { App, ItemView, MarkdownRenderer, MarkdownView, Notice, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { TutorSettings, ChatMessage, buildSystemPrompt, streamCompletion, buildNoteContextBlocks, extractNoteLinks } from "./ai";
import { buildGuideSystemPrompt, parseGuideResponse, GuideEntry, GuideMode, CognitiveMapSummary } from "./guide";
import { SearchHit } from "./search";
import { parkQuestion, takeParked, makeNodeTitle, buildNodeContent } from "./tutor";
import { NoteSuggest } from "./suggest";
import { splitCommittableParagraphs, attachCitationButtonsDOM, attachCodeCopyButtonsDOM, normalizeMath, buildGuideEntryBox, buildMsgActBar, buildWsTreeData, renderWsTreeNode, renderSearchResultRows, attachInternalLinkInterception } from "./viewlogic";
import { initSelectionFloat } from "./selfloat";
import { PromptModal, ConfirmModal, ClearModal, ScopeModal } from "./modals";
import { initMapPanDOM, renderMindMap, MapRenderHost } from "./maprender";
import {
  Conv, ConvMessage, ConvThread, freshConv, pushMessage, addThread, ancestry, activeThread,
  switchThread, pauseActive, removeMessage, orderedThreads,
  messagesForView, messageLineId, searchConversation, branchInstruction, finishAnswer,
  cognitiveMapSummary, serializeConv, resolveParentTitle,
} from "./conv";

export const VIEW_TYPE_TUTOR = "edge-tutor-view";

/** 插件接口（注入 view，避免循环依赖） */
export interface TutorPlugin {
  settings: TutorSettings;
  saveSettings: () => Promise<void>;
  readToc: () => Promise<string>;
  buildMapSummary: () => Promise<CognitiveMapSummary>;
  createNode: (n: CognitiveNodeLike, opts?: { updatePath?: string }) => Promise<TFile>;
  updateMoc: (workspace?: string) => Promise<void>;
  currentWorkspace: () => string;
  workspaceFolder: (workspace: string) => string;
  getAnchor: () => { sourcePath: string; quote: string } | null;
  getCurrentReadingAnchor: () => { sourcePath: string; quote: string } | null;
  loadConv: (workspace: string) => Promise<Conv>;
  saveConv: (conv: Conv) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (oldName: string, newName: string) => Promise<string | null>;
  discoverWorkspaces: () => Promise<string[]>;
  workspaceFolderExists: (workspace: string) => Promise<boolean>;
  workspaceNameForTextbook: (root: string) => string | null;
  ensureWorkspaceForTextbook: () => Promise<string | null>;
  exportWorkspace: (format: "markdown" | "json") => Promise<void>;
  rebuildConvFromNodes: (workspace?: string) => Promise<Conv | null>;
  deleteThreadsWithFiles: (workspace: string, threadIds: string[]) => Promise<number>;
  setNodeLocked: (workspace: string, title: string, locked: boolean) => Promise<boolean>;
  buildGlobalMapText: () => Promise<{ text: string; locked: string[]; total: number }>;
  semanticTextbookSearch: (query: string) => Promise<SearchHit>;
  /** 教材向量索引统计（注入 prompt 说明检索覆盖范围；索引未加载 → null） */
  readonly textbookIndexStats: { files: number; chunks: number } | null;
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
  /** 完整回答正文（导师回应区写入源） */
  response?: string;
  /** 掌握深度（随 frontmatter 持久化，重建不丢） */
  mastery?: "mastered" | "exploring" | "fresh";
  workspace?: string;
}

const DRAFT_SAVE_DELAY_MS = 800;
type ViewMode = "path" | "all" | "node";

export class TutorView extends ItemView {
  private plugin: TutorPlugin;
  private conv: Conv = freshConv("main");
  private busy = false;
  /** 当前回答/指引的中止控制器（点「⏹ 停止」时 abort） */
  private abortCtl: AbortController | null = null;
  private msgContainer!: HTMLElement;
  private mapContainer!: HTMLElement;
  private mapTitle!: HTMLElement;
  private currentBox!: HTMLElement;
  private statusBar!: HTMLElement;
  private parkContainer!: HTMLElement;
  private wsTrigger!: HTMLButtonElement; // 工作区切换按钮（树形弹层入口）
  private wsPop!: HTMLElement;           // 工作区树形弹层（挂 body，fixed 定位，避免面板裁剪）
  private wsPopOpen = false;
  /** 弹层外部点击/Esc 关闭（挂 document，onClose 移除） */
  private wsDocClickBound = (e: MouseEvent) => {
    if (!this.wsPop || !this.wsPopOpen) return;
    const t = e.target as Node;
    if (this.wsTrigger.contains(t) || this.wsPop.contains(t)) return;
    this.closeWsPopover();
  };
  private wsDocKeydownBound = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.closeWsPopover();
  };
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
  /**
   * 选中追问标记（与 pendingAnchor 解耦）：
   * 面板内选中（如选中回答里的文字）可能没有可解析的教材路径（pendingAnchor 为空），
   * 但选中原文仍必须随问题进 prompt，否则回答会与选中内容脱节。
   */
  private branchFromSelection = false;
  /** 已选中的方向导引入口，发送前允许用户改写 */
  private pendingGuide: GuideEntry | null = null;
  private branchClipboard: ConvThread[] = [];
  /** 剪贴板分支的来源工作区（粘贴后「删除源」用） */
  private branchClipboardWs = "";
  private selFloatCleanup: (() => void) | null = null;
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
  /** 上一次渲染的视图模式（切换时记住旧模式滚动位置） */
  private lastViewMode: ViewMode = "path";
  /** 宽屏切换 detach 标记：onClose 不把旧会话写回磁盘（避免覆盖新面板刚加载的 conv） */
  private detachingForMove = false;
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

    // 激活工作区恢复（设置页切教材联动/面板切换时持久化；不在列表时由
    // refreshWorkspaceSelect 兜底切到第一个可用工作区）
    if (this.plugin.settings.activeWorkspace) this.currentWorkspace = this.plugin.settings.activeWorkspace;
    // 教材-工作区绑定（新教材自动配工作区）：当前教材在注册表有对应工作区名，
    // 但激活工作区不在该教材容器下 → 建容器并切过去（教材先切/面板后开也成立）
    const textbookWs = this.plugin.workspaceNameForTextbook(this.plugin.settings.textbookRoot);
    if (textbookWs) {
      const isUnder = this.currentWorkspace === textbookWs || this.currentWorkspace.startsWith(textbookWs + "/");
      if (!isUnder) {
        await this.plugin.ensureWorkspaceForTextbook();
        this.currentWorkspace = textbookWs;
        this.plugin.settings.activeWorkspace = textbookWs;
        await this.plugin.saveSettings();
      }
    }
    header.createEl("div", {
      text: "选中教材文本 → 由此追问。珍贵推深，细节标记，绝不拉回。停止权在你。",
      cls: "edge-tutor-subtitle",
    });

    const wsRow = header.createEl("div", { cls: "edge-tutor-ws-row" });
    this.wsTrigger = wsRow.createEl("button", { cls: "edge-tutor-ws-trigger" });
    const wsNewBtn = wsRow.createEl("button", { text: "＋", cls: "edge-tutor-ws-btn", attr: { title: "新建工作区" } });
    const wsRenameBtn = wsRow.createEl("button", { text: "✎", cls: "edge-tutor-ws-btn", attr: { title: "重命名当前工作区" } });
    // 树形弹层：挂 body 用 fixed 定位（面板内部滚动/裁剪不影响），点击外部或 Esc 关闭
    this.wsPop = createDiv({ cls: "edge-tutor-ws-pop" });
    this.wsPop.hidden = true;
    document.body.appendChild(this.wsPop);
    document.addEventListener("click", this.wsDocClickBound);
    document.addEventListener("keydown", this.wsDocKeydownBound);
    this.wsTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleWsPopover();
    });
    await this.refreshWorkspaceSelect();

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
      // 新建后立即激活（原行为需手动下拉切换）+ 持久化
      await this.activateWorkspace(clean);
      if (this.currentWorkspace === clean) {
        this.plugin.settings.activeWorkspace = clean;
        await this.plugin.saveSettings();
      }
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
      const finalId = await this.plugin.renameWorkspace(cur, clean);
      if (!finalId) return; // 失败/同名 → 保持现状
      this.currentWorkspace = finalId;
      this.conv.workspace = finalId;
      await this.plugin.saveConv(this.conv);
      // 重命名的是激活工作区 → 同步持久化激活状态
      if (this.plugin.settings.activeWorkspace === cur) this.plugin.settings.activeWorkspace = finalId;
      await this.plugin.saveSettings();
      await this.refreshWorkspaceSelect();
      new Notice("已重命名为：" + finalId);
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

    // ===== 追问算子快捷行（问题展开范式：点击把追问模板填入输入框） =====
    const opRow = container.createEl("div", { cls: "edge-tutor-op-row" });
    const opTemplates: [string, string][] = [
      ["🔍 为什么", "为什么这里需要这个？它解决什么矛盾？"],
      ["🚧 边界", "如果把条件去掉/放宽会怎样？失效边界在哪？"],
      ["⚡ 反例", "能否构造一个反例打破这个结论？"],
      ["⬆ 一般化", "这是哪个更一般结构的特例？"],
      ["⬇ 特殊化", "这个规律在什么具体场景会变形/失效？"],
      ["🔮 下一堵墙", "解决它之后，下一个卡点可能是什么？"],
    ];
    for (const [label, tpl] of opTemplates) {
      const b = opRow.createEl("button", { text: label, cls: "edge-tutor-op-chip", attr: { title: tpl } });
      b.addEventListener("click", () => {
        const cur = this.inputEl.value;
        this.inputEl.value = (cur.trim() ? cur.trimEnd() + "\n" : "") + tpl;
        this.inputEl.focus();
        this.scheduleDraftSave();
      });
    }

    // ===== 输入区 =====
    const inputRow = container.createEl("div", { cls: "edge-tutor-input-row" });
    this.inputRowEl = inputRow;
    this.inputEl = inputRow.createEl("textarea", {
      cls: "edge-tutor-input",
      attr: { placeholder: "追问或提问…（Enter 发送，Shift+Enter 换行）", rows: "3" },
    });
    this.sendBtn = inputRow.createEl("button", { text: "发送", cls: "edge-tutor-send" });
    this.sendBtn.addEventListener("click", () => {
      if (this.busy && this.abortCtl) {
        // 生成中：点击 = 停止
        this.abortCtl.abort();
        this.setStatus("⏹ 正在停止…");
        return;
      }
      void this.sendFromInput();
    });

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
    // 宽屏切换的 detach 不写回旧会话（新面板已从磁盘加载更新后的 conv）
    if (!this.detachingForMove) await this.plugin.saveConv(this.conv);
    if (this.selFloatCleanup) this.selFloatCleanup();
    // 释放外部修改监听
    if (this.modifyRef) {
      this.app.vault.offref(this.modifyRef);
      this.modifyRef = null;
    }
    // 释放工作区树弹层
    document.removeEventListener("click", this.wsDocClickBound);
    document.removeEventListener("keydown", this.wsDocKeydownBound);
    if (this.wsPop) this.wsPop.remove();
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
    this.branchFromSelection = true;
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
    if (!this.pendingAnchor && !this.branchFromSelection) {
      this.chipsEl.style.display = "none";
      return;
    }
    const src = this.pendingAnchor ?? "";
    const file = src.split("/").pop() ?? src;
    const quote = (this.branchOrigin || "").replace(/\s+/g, " ").trim().slice(0, 30);
    const chip = this.chipsEl.createEl("button", {
      cls: "edge-tutor-context-chip",
      attr: { title: src ? "点击跳转到原文位置" : "面板内选中文字（无可跳转的教材路径）" },
    });
    const label = chip.createSpan({ text: `${src ? `📖 ${file}` : "📖 面板选中"}${quote ? `：${quote}` : ""}` });
    label.addClass("edge-tutor-chip-text");
    const x = chip.createEl("span", { text: "×", cls: "edge-tutor-chip-x", attr: { title: "移除引用（该消息将不带锚点发送）" } });
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      this.pendingAnchor = null;
      this.branchOrigin = "";
      this.branchFromSelection = false;
      this.inputEl.placeholder = "追问或提问…（Enter 发送，Shift+Enter 换行）";
      this.updateChips();
      this.setStatus("已移除引用来源");
    });
    chip.addEventListener("click", () => {
      if (src) void this.navigateToTextAnchor(src, this.branchOrigin || undefined);
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
    // 旧叶子 detach 前标记：onClose 不再把旧会话写回（避免覆盖新面板刚加载的 conv）；
    // 不 detach 旧叶子会留下第二个存活面板（双 watcher/双浮动按钮/并发写盘竞态）
    this.detachingForMove = true;
    try {
      if (inSidebar) {
        // 从侧栏移到主编辑区（tab = 独立标签页，全宽）
        const newLeaf = this.app.workspace.getLeaf("tab");
        await newLeaf.setViewState({ ...state, type: VIEW_TYPE_TUTOR, active: true });
        this.app.workspace.revealLeaf(newLeaf);
        await leaf.detach();
        this.setStatus("宽屏模式：面板已移到主编辑区。再次点 ⛶ 可回到侧栏。");
      } else {
        // 从主编辑区移回右侧边栏
        const newLeaf = this.app.workspace.getRightLeaf(false);
        if (!newLeaf) {
          this.detachingForMove = false;
          return;
        }
        await newLeaf.setViewState({ ...state, type: VIEW_TYPE_TUTOR, active: true });
        this.app.workspace.revealLeaf(newLeaf);
        await leaf.detach();
        this.setStatus("面板已回到右侧边栏。");
      }
    } catch (e) {
      // 失败恢复标记，面板保持原地
      this.detachingForMove = false;
      console.warn("[edge-tutor] 宽屏切换失败", (e as Error).message.slice(0, 100));
    }
  }

  /** ===== 渲染 ===== */

  private async renderAll() {
    // 消息区（按视图模式）
    // 模式切换时记住上一模式的滚动位置（此前 messageScroll 只读不写，记忆从未生效）
    if (this.lastViewMode !== this.viewMode) {
      this.messageScroll[this.lastViewMode] = this.msgContainer?.scrollTop ?? 0;
      this.lastViewMode = this.viewMode;
    }
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
    // 空态引导页（v0.10.0）：替换原来的伪消息气泡，第一印象更干净
    const hero = this.msgContainer.createEl("div", { cls: "edge-tutor-empty" });
    hero.createEl("div", { cls: "edge-tutor-empty-icon", text: "🌳" });
    hero.createEl("div", { cls: "edge-tutor-empty-title", text: "认知边缘导师" });
    hero.createEl("div", {
      cls: "edge-tutor-empty-sub",
      text: "在教材里选中一段文字 → 点「由此追问」，或直接在下方输入框提问。",
    });
    const tips = hero.createEl("ul", { cls: "edge-tutor-empty-tips" });
    for (const t of [
      "「为什么这里要构造辅助函数？」——追根",
      "「去掉这个边界条件会怎样？」——反例",
      "点 🧭 方向指引：让 AI 基于全书推荐下一堵值得撞的墙",
      "有暂时不想处理的疑问？点 📌 停车场",
      "你可以随时停，我不会拉你回来",
    ]) {
      tips.createEl("li", { text: t });
    }
  }

  /** ===== 锚点定位（Obsidian markdown 文本锚点，替代 Zotero PDF 框选） ===== */
  /**
   * 打开 markdown 文件并定位到引用文本。
   * Obsidian 适配：Zotero 是 PDF 页内框选定位，Obsidian 无此能力 →
   * 改为打开文件后搜索引用文本，滚动定位 + 临时高亮。
   * 支持行号优先定位（教材检索引用【📖 文件:行】）。
   */
  /**
   * 解析引用中的文件路径到 vault 相对路径。
   * 回答里 LLM 常把完整路径简写成文件名（如【📖 第1讲.md:698】），逐级兜底：
   * ① 原样（完整 vault 路径）② 教材根拼接 ③ basename 在教材目录内匹配 ④ 全局唯一匹配。
   */
  private resolveRefPath(file: string): string | null {
    if (!file) return null;
    const root = this.plugin.settings.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    for (const p of [file, root + "/" + file]) {
      if (this.app.vault.getAbstractFileByPath(p) instanceof TFile) return p;
    }
    const name = file.split("/").pop() ?? file;
    const md = this.app.vault.getMarkdownFiles();
    const inRoot = md.filter((f) => f.path.startsWith(root + "/") && f.name === name);
    if (inRoot.length === 1) return inRoot[0].path;
    const all = md.filter((f) => f.name === name);
    if (all.length === 1) return all[0].path;
    return null;
  }

  private async navigateToTextAnchor(sourcePath: string, quote?: string, line?: number) {
    let resolved = sourcePath;
    if (!(this.app.vault.getAbstractFileByPath(sourcePath) instanceof TFile)) {
      const r = this.resolveRefPath(sourcePath);
      if (!r) {
        new Notice("锚点文件不存在：" + sourcePath);
        return;
      }
      resolved = r;
    }
    const f = this.app.vault.getAbstractFileByPath(resolved);
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
      // 分叉意图覆盖此前的选中追问（选中来源不再生效）
      this.branchFromSelection = false;
      this.pendingAnchor = null;
      this.updateChips();
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

  /**
   * 发送输入框内容（每问一个问题 = 一个新线程 = 一个新结点）：
   * 所有提问一律 addThread（挂当前活跃线程下形成链式子分支），不再"继续当前线程"合并。
   * 保留：方向导引挂根（parentId = null，导引只是探索起点，避免污染链结构）。
   */
  private async sendFromInput() {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    this.inputEl.value = "";
    await this.clearDraft();

    // 结点视角父链：当前编辑器打开的文件若是某线程的沉淀结点（nodeFile 匹配），
    // 新问题挂到该线程下——「在结点里提问」接续该结点的讨论，而不是面板上次高亮的线程。
    // 面板获得焦点时 getActiveFile() 为空，退回最近活跃的 markdown leaf（同 getCurrentReadingAnchor）。
    const activeFile = this.app.workspace.getActiveFile();
    const markdownLeaves = this.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view)
      .filter((v): v is MarkdownView => v instanceof MarkdownView && !!v.file);
    const editorView =
      (activeFile && markdownLeaves.find((c) => c.file?.path === activeFile.path)) ?? markdownLeaves[0];
    const fileThread = editorView?.file
      ? this.conv.reading.threads.find((t) => !!t.nodeFile && t.nodeFile === editorView.file!.path) ?? null
      : null;
    const active = activeThread(this.conv);
    // 显式搁置（activeId=null，回主干）时尊重主干语义，不自动挂到打开的结点下
    const parentThread = active ? (fileThread ?? active) : null;
    // 由此追问来源（选中原文）优先于分支按钮的 branchOrigin。
    // 面板内选中（如选中回答里的文字）可能没有可解析的教材路径（pendingAnchor 为空），
    // 用 branchFromSelection 标记保证原文仍随问题进 prompt，否则回答与选中内容脱节。
    const isFromSelection = this.branchFromSelection || this.pendingAnchor !== null;
    const origin = this.branchOrigin || "";
    const originAnchor = isFromSelection ? this.pendingAnchor : undefined;
    const guide = this.pendingGuide;
    this.pendingAnchor = null;
    this.pendingGuide = null;
    this.branchNext = false;
    this.branchFromSelection = false;
    this.branchOrigin = "";
    this.updateChips();

    const t = addThread(this.conv, {
      question: text,
      parentId: guide ? null : (parentThread?.id ?? null),
      // 导引的教材锚点是说明文本，只有当前编辑器锚点才是可导航的 vault 路径。
      anchor: guide
        ? this.plugin.getAnchor()
        : isFromSelection
          ? { sourcePath: originAnchor ?? "", quote: origin.slice(0, 80) }
          : null,
      originExcerpt: guide
        ? guide.whyWorthExploring.slice(0, 200)
        : isFromSelection
          ? origin.slice(0, 200)
          : undefined,
    });
    const lineId = t.id;

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
    this.abortCtl = new AbortController();
    this.sendBtn.setText("⏹ 停止");
    this.sendBtn.disabled = false;
    this.sendBtn.addClass("edge-tutor-stop");

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
    const searchNote = await this.injectTextbookSearch(history, lastUser);
    // 每问一律新线程：lastUser.lineId === activeId 恒真，不能再拿它判 follow-up；
    // 链式追问（本问题线程有父线程）才算继续分支，新根问题不是。
    const lastUserThread = lastUser?.lineId
      ? this.conv.reading.threads.find((t) => t.id === lastUser.lineId)
      : null;
    const isFollowup = !!lastUserThread?.parentId;
    const branchInstr = branchInstruction(this.conv, isFollowup);
    // 上下文按分支过滤：只送新线程祖先链的消息（messagesForView "path" 口径），
    // 其他分支的讨论不进 prompt（此前全量历史导致回答接续无关结点的讨论）。
    const branchMessages = messagesForView(this.conv, "path");
    for (const m of branchMessages) {
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
    /** 按 \n\n 切分 pending：可提交的段落渲染为 Markdown，尾部未完整段落保留纯文本（纯逻辑在 viewlogic.ts，可单测） */
    const flushStreamRender = () => {
      lastRenderAt = Date.now();
      if (!pending) return;
      const { done, rest } = splitCommittableParagraphs(pending);
      if (done.length > 0) {
        pending = rest;
        for (const p of done) {
          const div = document.createElement("div");
          div.className = "edge-tutor-md";
          commitContainer.appendChild(div);
          void MarkdownRenderer.render(this.app, normalizeMath(p), div, this.plugin.settings.textbookRoot, this).then(() => this.postProcess(div));
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
        void MarkdownRenderer.render(this.app, normalizeMath(pending), div, this.plugin.settings.textbookRoot, this).then(() => this.postProcess(div));
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
        signal: this.abortCtl?.signal,
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
      // 自动沉淀：每问一结点（完整回答入正文；失败不打断对话，💾 可兜底）
      if (lastUser?.lineId) {
        try {
          await this.sedimentThread(lastUser.lineId, assistantMsg);
        } catch (e) {
          console.warn("[edge-tutor] 自动沉淀失败", e);
          this.setStatus("⚠️ 回答完成，但沉淀失败，可点 💾 重试");
        }
      }
      streamingEl.remove();
      this.renderAll();
    } catch (e) {
      if (this.abortCtl?.signal.aborted) {
        // 用户主动停止：保留已流出部分，不显示错误
        if (streamed) {
          persistPartial();
          const partial = getPartial();
          if (partial) partial.content = streamed + "\n\n⏹ 已停止生成";
          await this.plugin.saveConv(this.conv);
          this.renderAll();
        } else {
          streamingEl.remove();
        }
        this.setStatus("⏹ 已停止生成");
      } else if (streamed) {
        // 失败时保留已流出的部分回答（如果有），并追加错误提示
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
      this.abortCtl = null;
      this.sendBtn.removeClass("edge-tutor-stop");
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
   * 教材检索注入（respond / regenerate 共用）：检索结果只进本次请求的 system 上下文，
   * 不进 conv.messages、不显示。返回状态栏文案（"" = 开关关闭/未命中）。
   */
  private async injectTextbookSearch(history: ChatMessage[], userMsg: ConvMessage | null | undefined): Promise<string> {
    if (!userMsg || !this.plugin.settings.textbookSearchEnabled) return "";
    this.setStatus("🔍 正在教材检索（本地索引定位教材原文）…");
    const hit = await this.plugin.semanticTextbookSearch(userMsg.content);
    if (hit.found) {
      // 覆盖范围说明：让 LLM 知道检索覆盖全书（消除"只有这几条片段"的自我设限）；
      // 引用示例用完整 vault 相对路径（LLM 学样简写文件名曾导致跳转失败）
      const stats = this.plugin.textbookIndexStats;
      const cover = stats ? `（${stats.files} 个文件、${stats.chunks} 块）` : "";
      history.unshift({
        role: "system",
        content: [
          `【教材检索结果】已从教材${cover}检索到以下 ${hit.count} 处最相关原文（按相关度排序，行号可跳转核对）：`,
          hit.text,
          "",
          "回答规则：",
          "1. 引用教材内容时标注【📖 完整路径:行】，路径必须是 vault 相对路径（如【📖 learning/peizhi/learn/_materials/math/张宇基础30讲/chapters/第6讲.md:364】），禁止简写成文件名。",
          "2. 引用未覆盖的部分基于已有知识回答即可，不需要声明「教材未直接对应」。",
          "3. 不编造原文——引用的文字必须来自上面的教材引用。",
          "4. 当学生要求「多点实例/类似题目/类似的出题思想」时，从上面的引用中至少挑出 3 个以上不同讲次的实例，每个实例都附引用。",
        ].join("\n"),
      });
      return `（已检索 ${hit.count} 处教材原文）`;
    }
    // 未命中：注入说明，避免模型防御性表述（"我看不到教材"之类）
    history.unshift({
      role: "system",
      content:
        "【教材检索】本次未在教材中定位到与问题直接相关的原文（可能教材未覆盖该内容或表述差异）。请直接基于已有知识正常回答，不要声明「看不到教材/没有教材目录/只能基于截图分析」之类的话。",
    });
    return "";
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
    this.abortCtl = new AbortController();
    this.sendBtn.setText("⏹ 停止");
    this.sendBtn.disabled = false;
    this.sendBtn.addClass("edge-tutor-stop");
    this.setStatus("🔄 重新生成中…");

    // 历史：从开头到该 user 消息（含），分支语境注入
    const history: ChatMessage[] = [{ role: "system", content: buildSystemPrompt() }];
    // 同 respond：按线程 parentId 判 follow-up（一律新线程后 lineId === activeId 恒真）
    const userThread = userMsg.lineId ? this.conv.reading.threads.find((t) => t.id === userMsg.lineId) : null;
    const isFollowup = !!userThread?.parentId;
    const branchInstr = branchInstruction(this.conv, isFollowup, userThread?.id ?? null);
    // 同 respond：只送该线程祖先链的消息，其他分支讨论不进 prompt（无线程归属的旧消息保持原样全送）
    const branchIds = userThread ? new Set(ancestry(this.conv, userThread.id).map((t) => t.id)) : null;
    for (let i = 0; i <= uIdx; i++) {
      const m = this.conv.messages[i];
      if (branchIds && !(m.lineId && branchIds.has(m.lineId))) continue;
      if (m.role === "user") {
        const instr = i === uIdx && branchInstr ? `\n\n${branchInstr}` : "";
        history.push({ role: "user", content: m.content + instr });
      } else {
        history.push({ role: "assistant", content: m.content });
      }
    }
    // 与 respond 对齐：教材检索开关开启时同样注入检索上下文（此前重新生成会丢教材引用）
    const searchNote = await this.injectTextbookSearch(history, userMsg);

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
        signal: this.abortCtl?.signal,
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
      // 重新生成 → 同线程节点原位更新（nodeFile 幂等），不产生 -2 文件
      if (userMsg.lineId) {
        try {
          await this.sedimentThread(userMsg.lineId, target);
        } catch (e) {
          console.warn("[edge-tutor] 重新生成后沉淀失败", e);
        }
      }
      await this.plugin.saveConv(this.conv);
      this.renderAll();
      this.setStatus(`🔄 已重新生成${searchNote ? " " + searchNote : ""}`);
    } catch (e) {
      if (this.abortCtl?.signal.aborted) {
        if (streamed) {
          target.content = streamed + "\n\n⏹ 已停止生成";
          await this.plugin.saveConv(this.conv);
          this.renderAll();
        }
        this.setStatus("⏹ 已停止生成");
      } else if (streamed) {
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
      this.abortCtl = null;
      this.sendBtn.removeClass("edge-tutor-stop");
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
    this.abortCtl = new AbortController();
    this.sendBtn.setText("⏹ 停止");
    this.sendBtn.disabled = false;
    this.sendBtn.addClass("edge-tutor-stop");
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
        signal: this.abortCtl?.signal,
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
        // 收尾落盘：中途持久化（每 1500 字符）对短回答可能从未触发，
        // 必须把最终回答写进 conv——否则重启后只剩问题没有答案。
        // 保留 🧭 前缀：沉淀兜底按前缀排除，指引回答不会被误当节点答案。
        const finalText = `🧭 ${scopeLabel}内推荐的高价值入口（自由选择，可跳入）：\n\n${answer}`;
        const gp = guidePartial as ConvMessage | null;
        if (gp) gp.content = finalText;
        else pushMessage(this.conv, "assistant", finalText, { lineId: active?.id });
      }
      await this.plugin.saveConv(this.conv);
    } catch (e) {
      if (this.abortCtl?.signal.aborted) {
        this.replaceMessage(loadingMsg, { role: "assistant", content: "⏹ 方向指引已停止。" });
        this.setStatus("⏹ 已停止指引");
      } else {
        this.replaceMessage(loadingMsg, { role: "assistant", content: `⚠️ 方向指引失败：${(e as Error).message.slice(0, 150)}` });
      }
    } finally {
      this.busy = false;
      this.abortCtl = null;
      this.sendBtn.removeClass("edge-tutor-stop");
      this.sendBtn.setText("发送");
      this.sendBtn.disabled = false;
    }
  }

  /**
   * 沉淀一个线程为认知节点（每问一结点）。
   * - 幂等键 = 线程 nodeFile（持久化在 .conv.json）：已沉淀 → 原位更新；未沉淀 → 新建（同名自动 -2/-3）
   * - parentTitle 由 resolveParentTitle 解析（父线程已沉淀文件 → 线程标题 → 规范清洗标题）
   * - 内部指令消息（🧭 开头的方向指引）跳过。返回是否实际写入（💾/清屏计数用）。
   */
  private async sedimentThread(lineId: string | undefined, answerMsg?: ConvMessage | null): Promise<boolean> {
    if (!lineId) return false;
    const t = this.conv.reading.threads.find((x) => x.id === lineId);
    if (!t) return false;
    const question = t.rootQuestion || t.title || "";
    if (!question || question.startsWith("🧭")) return false;

    // 回答取参数；未提供时（💾 兜底/回答失败）回落到线程内最后一条非 agent、非 🧭 的 assistant 消息
    let answer = answerMsg?.content ?? "";
    if (!answerMsg) {
      const lastAssistant = [...this.conv.messages].reverse().find(
        (m) => m.role === "assistant" && !m.agent && !m.content.startsWith("🧭") && m.lineId === t.id
      );
      answer = lastAssistant?.content ?? "";
    }

    // 当前工作区已有节点文件标题集合（供 resolveParentTitle 命中真实存在的父文件）
    const existingTitles = new Set<string>();
    const dir = this.app.vault.getAbstractFileByPath(this.plugin.workspaceFolder(this.currentWorkspace));
    if (dir instanceof TFolder) {
      for (const child of dir.children) {
        if (!(child instanceof TFile) || !child.name.endsWith(".md")) continue;
        if (child.name.startsWith(".") || child.name === "认知边缘地图.md") continue;
        existingTitles.add(child.basename);
      }
    }

    const parentThread = t.parentId ? this.conv.reading.threads.find((x) => x.id === t.parentId) : null;
    const node: CognitiveNodeLike = {
      title: makeNodeTitle(question),
      content: "",
      parentTitle: resolveParentTitle(parentThread ?? undefined, existingTitles),
      // 无锚点线程不再用问题文本冒充教材引文（假引文坑）：quote 留空
      anchor: { sourcePath: t.anchor?.sourcePath ?? "", quote: t.anchor?.quote ?? "" },
      status: t.status,
      rootQuestion: question,
      summary: t.summary,
      response: answer,
      mastery: t.mastery,
      workspace: this.currentWorkspace,
    };
    const f = await this.plugin.createNode(node, { updatePath: t.nodeFile });
    const isNew = t.nodeFile !== f.path;
    t.nodeFile = f.path;
    await this.plugin.saveConv(this.conv);
    if (isNew) this.setStatus(`已自动沉淀：「${f.basename}」`);
    return true;
  }

  /** 手动沉淀当前活跃线程（自动沉淀失败时的 💾 兜底） */
  private async saveConversation() {
    const active = activeThread(this.conv);
    if (!active) {
      new Notice("没有活跃线程可沉淀");
      return;
    }
    await this.sedimentThread(active.id);
    new Notice("✅ 认知节点已沉淀");
  }

  /** 把单条回答沉淀为独立认知节点（v0.11.0；挂在所属线程节点之下，不改线程 nodeFile） */
  private async sedimentSingleMessage(m: ConvMessage): Promise<void> {
    const thread = m.lineId ? this.conv.reading.threads.find((t) => t.id === m.lineId) : null;
    const defaultTitle = makeNodeTitle(thread?.rootQuestion || thread?.title || "沉淀节点");
    const title = await new PromptModal(this.app, "沉淀这条回答", "节点标题（可改）", defaultTitle).openPrompt();
    if (title == null) return;

    // 当前工作区已有节点文件标题集合（供 resolveParentTitle 命中真实存在的父文件）
    const existingTitles = new Set<string>();
    const dir = this.app.vault.getAbstractFileByPath(this.plugin.workspaceFolder(this.currentWorkspace));
    if (dir instanceof TFolder) {
      for (const child of dir.children) {
        if (!(child instanceof TFile) || !child.name.endsWith(".md")) continue;
        if (child.name.startsWith(".") || child.name === "认知边缘地图.md") continue;
        existingTitles.add(child.basename);
      }
    }

    const node: CognitiveNodeLike = {
      title: makeNodeTitle(title),
      content: "",
      parentTitle: thread ? resolveParentTitle(thread, existingTitles) : undefined,
      anchor: { sourcePath: thread?.anchor?.sourcePath ?? m.anchor ?? "", quote: thread?.anchor?.quote ?? "" },
      status: thread?.status ?? "active",
      rootQuestion: title,
      summary: thread?.summary,
      response: m.content,
      mastery: thread?.mastery,
      workspace: this.currentWorkspace,
    };
    const f = await this.plugin.createNode(node);
    new Notice(`✅ 已沉淀节点：${f.basename}`);
    this.setStatus(`已沉淀「${f.basename}」（独立节点，可在导图/节点目录查看）`);
  }

  /** 沉淀全部线程（清屏前兜底）：根在前，保证 parentTitle 解析时父文件已存在 */
  private async sedimentAllThreads(): Promise<number> {
    let count = 0;
    for (const t of orderedThreads(this.conv)) {
      if (await this.sedimentThread(t.id)) count++;
    }
    return count;
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
      // 全工作区判定 → 全部线程沉淀（此前只沉淀活跃线程，其他未沉淀对话只剩 JSON 备份）
      const n = await this.sedimentAllThreads();
      await this.plugin.exportWorkspace("json");
      await this.doClear();
      new Notice(`已沉淀 ${n} 个线程后清屏`);
    };
    modal.open();
  }

  /** 是否有未沉淀的对话：最后一条消息时间 > 节点目录里最新文件时间 */
  private async hasUnsavedConversation(): Promise<boolean> {
    const lastMsg = this.conv.messages[this.conv.messages.length - 1];
    if (!lastMsg) return false;
    const folder = this.plugin.workspaceFolder(this.currentWorkspace).replace(/\/+$/, "");
    // 只比较工作区直接子节点：子工作区（嵌套目录）的文件、MOC、隐藏文件不参与判定
    const dir = this.app.vault.getAbstractFileByPath(folder);
    let latest = 0;
    if (dir instanceof TFolder) {
      for (const child of dir.children) {
        if (!(child instanceof TFile)) continue;
        if (child.name.startsWith(".") || child.name === "认知边缘地图.md") continue;
        const mtime = child.stat?.mtime ?? 0;
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
    renderSearchResultRows(this.searchResultsEl, hits, this.searchCursor, (i) => void this.navigateSearchHit(i));
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
        nodeFile: undefined, // 剥离源工作区 nodeFile（粘贴后是新线程，不指向源文件）
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

  /**
   * 激活指定工作区（面板下拉 / 设置页教材联动共用）。
   * 成功时持久化由调用方负责（下拉监听 / setTextbookRoot）；busy（回答生成中）拒绝切换。
   */
  async activateWorkspace(target: string): Promise<void> {
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
      await this.refreshWorkspaceSelect(); // 程序触发的切换也要让下拉选中态跟随
    } catch (e) {
      new Notice("切换工作区失败：" + (e as Error).message.slice(0, 80));
      await this.refreshWorkspaceSelect();
    }
  }

  /** 刷新工作区按钮标签 + 树形弹层内容（新建/改名/激活后调用） */
  private async refreshWorkspaceSelect() {
    const workspaces = await this.plugin.discoverWorkspaces();
    // 当前工作区不在列表（迁移/改名）→ 自动切到第一个可用工作区（onOpen 会加载它）。
    // 但目录仍存在（如切教材联动刚建的空容器，尚无节点）→ 保留，不切走
    if (workspaces.length > 0 && !workspaces.includes(this.currentWorkspace)) {
      const exists = await this.plugin.workspaceFolderExists(this.currentWorkspace);
      if (!exists) this.currentWorkspace = workspaces[0];
    }
    const label = this.currentWorkspace === "main" ? "默认工作区" : this.currentWorkspace.split("/").pop()!;
    this.wsTrigger.setText(`📁 ${label}`);
    this.rebuildWsTree(workspaces);
  }

  /** 选择工作区（树叶子 / 容器↗按钮）：激活 + 持久化 + 关弹层（原下拉 change 逻辑） */
  private async selectWorkspace(target: string) {
    if (target === this.currentWorkspace) {
      this.closeWsPopover();
      return;
    }
    await this.activateWorkspace(target);
    if (this.currentWorkspace === target) {
      this.plugin.settings.activeWorkspace = target;
      await this.plugin.saveSettings();
    }
    this.closeWsPopover();
  }

  private toggleWsPopover() {
    if (this.wsPopOpen) this.closeWsPopover();
    else void this.openWsPopover();
  }

  private async openWsPopover() {
    await this.refreshWorkspaceSelect(); // 打开前刷新（新建/改名后仍准）
    const r = this.wsTrigger.getBoundingClientRect();
    this.wsPop.style.left = `${r.left}px`;
    this.wsPop.style.top = `${r.bottom + 4}px`;
    this.wsPop.style.minWidth = `${Math.max(r.width, 220)}px`;
    this.wsPop.hidden = false;
    this.wsPopOpen = true;
  }

  private closeWsPopover() {
    if (!this.wsPopOpen) return;
    this.wsPop.hidden = true;
    this.wsPopOpen = false;
  }

  /** 重建树弹层内容；当前工作区的祖先目录自动展开（树构建/行渲染已迁至 viewlogic.ts） */
  private rebuildWsTree(workspaces: string[]) {
    this.wsPop.empty();
    this.wsPop.createEl("div", { text: "选择工作区", cls: "edge-tutor-ws-pop-header" });
    const curSegs = this.currentWorkspace.split("/").slice(0, -1); // 祖先目录名
    const expandSet = new Set(curSegs);
    const nodes = buildWsTreeData(workspaces);
    if (nodes.length === 0) {
      this.wsPop.createEl("div", { text: "（暂无工作区，点 ＋ 新建）", cls: "edge-tutor-ws-tree-empty" });
      return;
    }
    for (const n of nodes) {
      renderWsTreeNode(this.wsPop, n, 0, expandSet, {
        currentWs: () => this.currentWorkspace,
        onSelect: (id) => void this.selectWorkspace(id),
      });
    }
  }

  /** 导图平移/滚动（Zotero：拖空白平移 + wheel 横向滚动；实现已迁至 maprender.ts） */
  private initMapPan() {
    initMapPanDOM(this.mapContainer);
  }

  /** ===== 思维导图（Zotero renderWorkflow；实现已迁至 maprender.ts，C5 第三步） ===== */
  private async renderWorkflow() {
    await renderMindMap(this.mapHost(), this.conv);
  }

  /** maprender.ts 的宿主适配器（依赖注入，保持私有字段隔离） */
  private mapHost(): MapRenderHost {
    return {
      app: this.app,
      plugin: this.plugin,
      isBusy: () => this.busy,
      rerender: () => {
        void this.renderAll();
      },
      reloadConv: async () => {
        this.conv = await this.plugin.loadConv(this.currentWorkspace);
      },
      clearBranchIntent: () => {
        this.branchNext = false;
      },
      setStatus: (text) => this.setStatus(text),
      inputEl: this.inputEl,
      getWorkspace: () => this.currentWorkspace,
      getBranchClipboard: () => ({
        threads: this.branchClipboard,
        ws: this.branchClipboardWs,
        messages: this.branchClipboardMessages,
      }),
      setBranchClipboard: (c) => {
        this.branchClipboard = c.threads;
        this.branchClipboardWs = c.ws;
        this.branchClipboardMessages = c.messages;
      },
      getLastMapId: () => this.lastRenderedMapId,
      setLastMapId: (id) => {
        this.lastRenderedMapId = id;
      },
      mapContainer: this.mapContainer,
      mapTitle: this.mapTitle,
      scrollToBottom: () => this.scrollToBottom(),
    };
  }

  /** 选中文本浮动按钮（实现已迁至 selfloat.ts） */
  private initSelFloat() {
    this.selFloatCleanup = initSelectionFloat({
      app: this.app,
      contentEl: this.contentEl,
      inputRowEl: this.inputRowEl ?? null,
      registerInterval: (id) => this.registerInterval(id),
      isInPanel: () => this.isSelectionInPanel(),
      resolveAnchor: () => this.resolveSelectionAnchor(),
      onSelect: (text, anchorPath) => this.receiveSelection(text, anchorPath),
    });
  }

  /** 当前选中是否发生在面板内（消息区），而非外部编辑器 */
  private isSelectionInPanel(): boolean {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return false;
    return this.contentEl.contains(sel.getRangeAt(0).commonAncestorContainer);
  }

  /**
   * 面板内选中文字的锚点解析：选中位置之前最近的引用按钮（【📖 文件:行】）→ 所属消息线程的锚点。
   * 仅在面板内选中时调用；都找不到返回 null（原文仍会随问题发送，只是无可跳转路径）。
   */
  private resolveSelectionAnchor(): string | null {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const anchorNode = sel.anchorNode ?? node;
    const msgEl = (node instanceof Element ? node : node.parentElement)?.closest?.(".edge-tutor-msg") ?? null;
    if (!msgEl) return null;
    // 1) 选中位置之前最近的 📖 引用按钮（回答里引用的教材原文）
    let citePath: string | null = null;
    const walker = document.createTreeWalker(msgEl, NodeFilter.SHOW_ELEMENT);
    let cur: Node | null = walker.nextNode();
    while (cur) {
      const el = cur as HTMLElement;
      if (el.classList?.contains("edge-tutor-cite-btn")) {
        // PRECEDING 位：anchorNode 在按钮之前 → 按钮位于选中之后，停止扫描
        if (el.compareDocumentPosition(anchorNode) & Node.DOCUMENT_POSITION_PRECEDING) break;
        const m = /^📖\s*(.+):(\d+)$/.exec(el.textContent ?? "");
        if (m) citePath = m[1].trim();
      }
      cur = walker.nextNode();
    }
    if (citePath) return citePath;
    // 2) 所属消息线程的锚点（提问时带过的教材位置）
    const idxAttr = msgEl.getAttribute("data-msg-index");
    if (idxAttr !== null) {
      const msg = this.conv.messages[parseInt(idxAttr, 10)];
      const thread = msg?.lineId ? this.conv.reading.threads.find((t) => t.id === msg.lineId) : null;
      if (thread?.anchor?.sourcePath) return thread.anchor.sourcePath;
      if (msg?.anchor) return msg.anchor;
    }
    return null;
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
      fromSelection: this.branchFromSelection,
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
      this.branchFromSelection = draft.fromSelection ?? false;
      // 还原分支意图（Zotero restoreComposerDraft）
      if (draft.branchNext) {
        this.branchNext = true;
        this.branchOrigin = draft.branchOrigin || "";
        this.inputEl.placeholder = "输入新分支的起点…";
      } else if ((this.pendingAnchor || this.branchFromSelection) && this.branchOrigin) {
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
      // 单条回答沉淀（仅普通 AI 回答；导引/执行结果除外）
      onSediment:
        m.role === "assistant" && !m.agent && !m.content.trimStart().startsWith("🧭")
          ? () => void this.sedimentSingleMessage(m)
          : undefined,
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
    onSediment?: () => void;
  }): HTMLElement {
    const el = this.msgContainer.createEl("div", { cls: `edge-tutor-msg edge-tutor-${opts.role}` });
    if (opts.agent) el.classList.add("edge-tutor-msg-agent");
    if (typeof opts.messageIndex === "number") el.setAttribute("data-msg-index", String(opts.messageIndex));
    const content = el.createEl("div", { cls: "edge-tutor-msg-content" });
    if (opts.agent) content.createEl("div", { text: "🤖 执行结果", cls: "edge-tutor-agent-badge" });

    if (opts.guideEntries && opts.guideEntries.length > 0) {
      content.createEl("p", { text: opts.content });
      for (const e of opts.guideEntries) {
        content.appendChild(
          buildGuideEntryBox(e, {
            isBusy: () => this.busy,
            onStart: (entry) => {
              const g = entry as GuideEntry;
              this.pendingGuide = g;
              this.branchNext = false;
              this.branchOrigin = "";
              // 导引入口覆盖此前的选中追问（导引自带教材锚点）
              this.branchFromSelection = false;
              this.pendingAnchor = null;
              this.updateChips();
              this.inputEl.value = g.question || g.title;
              this.inputEl.placeholder = "可以改写这个问题，然后发送…";
              this.inputEl.focus();
            },
          }),
        );
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
        this.postProcess(mdEl);
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
        this.postProcess(mdEl);
      });
    }

    // 消息 hover 操作组（P0-2，仿节点 map-acts）：复制 / 编辑 / 重新生成 / 删除（构建逻辑在 viewlogic.ts）
    if (opts.onEdit || opts.onRegenerate || opts.onDelete) {
      const buttons: { label: string; tip: string; handler: () => void | Promise<void>; danger?: boolean }[] = [
        {
          label: "📋 复制", tip: "复制这条消息内容",
          handler: async () => {
            try {
              await navigator.clipboard.writeText(opts.content);
              new Notice("已复制到剪贴板");
            } catch (e) {
              console.error("复制消息失败", e);
              new Notice("复制失败，请手动选择复制");
            }
          },
        },
      ];
      if (opts.onSediment) {
        buttons.push({ label: "📝 沉淀", tip: "把这条回答沉淀为独立认知节点", handler: () => opts.onSediment!() });
      }
      if (opts.onEdit) {
        buttons.push({
          label: "✏️ 编辑", tip: "编辑这条消息",
          handler: () => {
            content.empty();
            opts.onEdit!(content, opts.content);
          },
        });
      }
      if (opts.onRegenerate) {
        buttons.push({
          label: "🔄 重新生成", tip: "重新生成这条回答（网络波动/回答不佳时使用）",
          handler: () => opts.onRegenerate!(),
        });
      }
      if (opts.onDelete) {
        buttons.push({ label: "🗑️ 删除", tip: "删除这条消息", handler: () => opts.onDelete!(), danger: true });
      }
      buildMsgActBar(el, buttons);
    }
    this.scrollToBottom();
    return el;
  }

  private replaceMessage(el: HTMLElement, msg: { role: "user" | "assistant"; content: string; guideEntries?: GuideEntry[] }) {
    el.remove();
    this.appendMessageRaw(msg);
  }

  /** 扫描回答中的引用标记【📖 文件:行】→ 可点击按钮（跳转教材行；DOM 逻辑在 viewlogic.ts） */
  private attachCitationButtons(container: HTMLElement) {
    attachCitationButtonsDOM(container, (ref) => void this.navigateToTextAnchor(ref.file, "", ref.line));
  }

  /** 代码块 hover 复制按钮（P2-5）：在 MarkdownRenderer.render 完成后调用；DOM 逻辑在 viewlogic.ts */
  private attachCodeCopyButtons(container: HTMLElement) {
    attachCodeCopyButtonsDOM(
      container,
      (msg) => new Notice(msg),
      (e) => console.error("复制代码失败", e),
    );
  }

  /** Markdown 渲染后处理：引用按钮 + 代码复制 + 面板内双链跳主区（避免面板被笔记覆盖） */
  private postProcess(mdEl: HTMLElement) {
    this.attachCitationButtons(mdEl);
    this.attachCodeCopyButtons(mdEl);
    attachInternalLinkInterception(mdEl, (path) => void this.app.workspace.openLinkText(path, "", false));
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
