/**
 * 认知边缘导师（Edge Tutor）插件入口 —— 重写版
 *
 * 架构（对齐 docs/认知边缘驱动学习系统_骨架设计.md）：
 *   L1 交互界面 → 面板 ItemView（view.ts / agentview.ts）+ 命令/设置（本文件）
 *   L2 追根陪练 → ai.ts + guide.ts
 *   L3 入口生成 → guide.ts（基于全书推荐）
 *   L4 认知地图 → conv.ts（会话模型）+ tutor.ts（节点模型）+ data.ts（节点文件读写）
 *
 * 单一数据源（SSOT）：.conv.json 是运行态真源（messages + threads + parkingLot），
 * 节点 .md 是沉淀镜像（frontmatter 机器可读，会话为空时从节点重建）。
 *
 * 关键修复（对比旧版）：
 *   - 不再维护两套消息/两棵树：会话一份（.conv.json），节点一份（.md 镜像）
 *   - currentWorkspace() 不再写死 "main"，导出/沉淀基于真实工作区
 *   - 首次启动做旧 .conv.json 迁移（一次性，导入后标记）
 */
import { App, FileSystemAdapter, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, TutorSettings, PRESET_PROVIDERS, agentConfig, chatCompletion, ChatMessage, resolveEmbeddingApiKey, resolveProviderKey, readEnv } from "./ai";
import { buildVaultExecutor, AgentStep, AgentResult, runAgent } from "./agent";
import { runOpenCodeTask, OpenCodeConfig, OpenCodeResult } from "./opencode";
import { buildMocContent, buildNodeContent, CognitiveNode, makeNodeTitle, parseNodeFromContent } from "./tutor";
import {
  parseSearchResult,
  normalizeQuery,
  extractQuestionPart,
  SearchRef,
  SearchHit,
  parseBooksYaml,
  TextbookEntry,
  parseChapterIndex,
  normalizeTextForMatch,
  searchTextbookIndex,
  TextbookIndex,
  formatRefsText,
  RewriteOutput,
  parseRewriteOutput,
  parseQueryUnderstanding,
  chunkTextbook,
  SearchChunk,
  rrfMerge,
  diverseTop,
  buildBm25Index,
  bm25Search,
  Bm25Index,
} from "./search";
import {
  VectorIndex,
  VectorIndexFile,
  VectorHit,
  encodeVecs,
  decodeVecs,
  cosine,
  topKVectors,
  loadEmbedder,
  loadReranker,
  loadRemoteEmbedder,
  loadRemoteReranker,
  MODEL_ID,
  Embedder,
  Reranker,
} from "./vector";
import { CognitiveMapSummary } from "./guide";
import { Conv, freshConv, parseConv, serializeConv, buildConvFromNodes, cognitiveMapSummary } from "./conv";
import { formatConvMarkdown, parseJSONBackup } from "./export";
import {
  listNodes,
  buildMapSummary,
  workspaceFolderPath,
  convPath,
  uniqueNodePath,
} from "./data";

import { TutorView, VIEW_TYPE_TUTOR } from "./view";

/** 条件 rerank 触发阈值（向量置信分；< 此值或两路分歧才重排，保守值可调） */
const RERANK_TRIGGER_SCORE = 0.35;

/** 设置页教材下拉的"手动输入路径"哨兵选项值 */
const CUSTOM_ROOT = "__custom__";
import { AgentConv, AgentView, freshAgentConv, VIEW_TYPE_AGENT } from "./agentview";

export default class EdgeTutorPlugin extends Plugin {
  settings: TutorSettings = DEFAULT_SETTINGS;

  /** 远程 embedding 实例缓存（冒烟验证通过后复用；本地路径由 loadEmbedder 内部缓存） */
  private remoteEmbedder: Embedder | null = null;
  /** 远程实例对应的配置指纹（baseUrl|model|dim；变更即失效重建，设置面板改模型后自动生效） */
  private remoteEmbedderKey = "";

  async onload() {
    await this.loadSettings();
    await this.runMigration();

    this.registerView(VIEW_TYPE_TUTOR, (leaf: WorkspaceLeaf) => new TutorView(leaf, this));
    this.registerView(VIEW_TYPE_AGENT, (leaf: WorkspaceLeaf) => new AgentView(leaf, this));

    this.addCommand({
      id: "open-tutor-panel",
      name: "🧭 打开认知边缘导师面板",
      callback: () => { this.activateView(); },
    });

    this.addCommand({
      id: "open-agent-panel",
      name: "🤖 打开执行面板（agent）",
      callback: () => { this.activateAgentView(); },
    });

    this.addCommand({
      id: "rebuild-conv-from-nodes",
      name: "从节点文件重建会话（当前工作区）",
      callback: async () => {
        const rebuilt = await this.rebuildConvFromNodes();
        if (rebuilt) {
          new Notice(`已从 ${rebuilt.reading.threads.length} 个节点重建会话`);
          const view = this.getTutorView();
          if (view) await view.reloadFromConv(rebuilt);
        } else {
          new Notice("当前工作区没有节点文件可重建");
        }
      },
    });

    this.addCommand({
      id: "ask-from-selection",
      name: "由此追问（选中教材文本 → 面板）",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const selection = view?.editor?.getSelection?.() ?? "";
        if (!selection) return false;
        if (!checking) this.askFromSelection(selection, view?.file?.path);
        return true;
      },
    });

    this.addCommand({
      id: "open-cognitive-map",
      name: "打开认知边缘地图（MOC）",
      callback: async () => { await this.openMoc(); },
    });

    this.addCommand({
      id: "export-workspace-md",
      name: "📤 导出当前工作区为 Markdown 笔记",
      callback: async () => { await this.exportWorkspace("markdown"); },
    });
    this.addCommand({
      id: "export-workspace-json",
      name: "📦 导出当前工作区为 JSON 备份",
      callback: async () => { await this.exportWorkspace("json"); },
    });
    this.addCommand({
      id: "import-workspace-json",
      name: "📥 导入 JSON 备份（恢复认知节点）",
      callback: async () => { await this.importWorkspaceJson(); },
    });

    this.addRibbonIcon("compass", "🧭 认知边缘导师", () => { this.activateView(); });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selection = editor.getSelection();
        if (selection) {
          menu.addItem((item) => {
            item
              .setTitle("🔍 由此追问（认知边缘导师）")
              .setIcon("help")
              .onClick(async () => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                await this.askFromSelection(selection, view?.file?.path);
              });
          });
        }
      })
    );

    // 教材索引失效：教材文件变更/增删 → 下次检索时重建（重建 <1s，不做增量）
    const invalidateTextIndex = (file: TFile) => {
      if (file.path.startsWith(this.settings.textbookRoot)) this.textIndex = null;
    };
    this.registerEvent(this.app.vault.on("modify", invalidateTextIndex));
    this.registerEvent(this.app.vault.on("delete", invalidateTextIndex));
    this.registerEvent(this.app.vault.on("create", invalidateTextIndex));

    // 教材向量索引状态栏（常驻显示：待启动/构建中 N/M/就绪/已加载/不可用，一目了然）
    this.vectorStatusEl = this.addStatusBarItem();
    this.updateVectorStatus("🧠 向量：待启动");

    this.addCommand({
      id: "rebuild-textbook-vector-index",
      name: "🧠 重建教材向量索引",
      callback: async () => {
        const root = this.settings.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
        const active = await this.loadActiveEmbedder();
        if (active) void this.buildVectorIndex(root, active);
      },
    });

    // 教材向量索引后台预热（首次：下载模型+构建；已有落盘：加载）。不阻塞启动与回答
    window.setTimeout(() => {
      void this.ensureVectorIndex();
    }, 3000);

    this.addSettingTab(new EdgeTutorSettingTab(this.app, this));

    // 教材注册表预热（books.yaml；设置页下拉数据源）
    void this.refreshTextbookRegistry();
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TUTOR);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_AGENT);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** 教材注册表缓存（books.yaml 解析；设置页教材下拉的数据源，失败为空数组 → 降级手动输入） */
  textbookRegistry: TextbookEntry[] = [];

  /** Refresh the optional, vault-local textbook registry. Missing registry falls back to manual paths. */
  async refreshTextbookRegistry(): Promise<void> {
    try {
      const raw = await this.app.vault.adapter.read(".edge-tutor/books.yaml");
      this.textbookRegistry = parseBooksYaml(raw);
    } catch (e) {
      console.warn("[edge-tutor] books.yaml 读取失败，教材下拉降级为手动输入", (e as Error).message.slice(0, 100));
      this.textbookRegistry = [];
    }
  }

  /** 切换教材根目录（设置页下拉/手动输入共用）：写设置 + 失效教材缓存 + 教材-工作区联动 */
  async setTextbookRoot(root: string): Promise<void> {
    const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized || normalized === this.settings.textbookRoot) return;
    this.settings.textbookRoot = normalized;
    // 教材变更 → 内存缓存强制失效：textIndex/vecIndex 自带 root 校验会自动跟随，
    // 但 searchCache 与 chapterIndex 无 root 键，必须手动清（防止旧教材结果串到新教材）
    this.searchCache.clear();
    this.chapterIndex = null;
    this.textIndex = null;
    this.bm25Idx = null;
    this.vecIndex = null;
    this.vecIndexRoot = "";
    // 教材-工作区联动：切到同名教材工作区（无则自动建为教材容器），激活状态持久化
    // A reference collection can act as a workspace container with nested topics.
    const wsName = this.workspaceNameForTextbook(normalized);
    if (wsName) {
      const workspaces = await this.discoverWorkspaces();
      if (!workspaces.includes(wsName)) {
        await this.ensureFolder(this.workspaceFolderPathOf(wsName));
      }
      this.settings.activeWorkspace = wsName;
    }
    await this.saveSettings();
    if (wsName) {
      const view = this.getTutorView();
      if (view && view.currentWorkspace !== wsName) await view.activateWorkspace(wsName);
    }
    new Notice(`📚 教材已切换：${normalized}`);
  }

  /** 教材 root → 教材工作区名（books.yaml 的 name 字段；自定义路径不在注册表 → null 不联动） */
  workspaceNameForTextbook(root: string): string | null {
    const b = this.textbookRegistry.find((x) => x.root === root);
    if (!b || !b.name) return null;
    const clean = b.name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
    return clean || null;
  }

  /** 教材-工作区绑定（onOpen 兜底）：当前教材在注册表有对应工作区名 → 确保容器存在 */
  async ensureWorkspaceForTextbook(): Promise<string | null> {
    const wsName = this.workspaceNameForTextbook(this.settings.textbookRoot);
    if (!wsName) return null;
    await this.ensureFolder(this.workspaceFolderPathOf(wsName));
    return wsName;
  }

  /** ===== 迁移：旧 .conv.json 的线程 → 节点 .md（一次性） ===== */
  async runMigration() {
    if (this.settings.migrated) return;
    try {
      let migratedAny = false;
      const workspaces = await this.discoverWorkspaces();
      for (const ws of workspaces) {
        const path = convPath(this.settings.nodeFolder, ws);
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile)) continue;
        const parsed = parseConv(await this.app.vault.cachedRead(f));
        if (!parsed) continue;
        // 旧版把线程存在 reading.threads[]；把它们迁成节点 .md
        const legacy = (parsed as any).reading?.threads;
        if (Array.isArray(legacy) && legacy.length > 0) {
          await this.ensureFolder(this.workspaceFolderPathOf(ws));
          const folder = this.workspaceFolderPathOf(ws);
          for (const t of legacy) {
            if (!t || typeof t.title !== "string") continue;
            const node: CognitiveNode = {
              title: makeNodeTitle(t.title),
              content: "",
              parentTitle: undefined,
              anchor: { sourcePath: t.anchor?.sourcePath ?? "", quote: t.anchor?.quote ?? "" },
              status: t.status === "paused" ? "paused" : "active",
              rootQuestion: t.rootQuestion || t.title,
              summary: t.summary,
            };
            node.content = buildNodeContent(node);
            const pathN = uniqueNodePath(this.app, folder, node.title);
            await this.app.vault.create(pathN, node.content);
          }
          migratedAny = true;
        }
      }
      if (migratedAny) {
        new Notice("已从旧版会话迁移认知线程到节点文件");
      }
      this.settings.migrated = true;
      await this.saveSettings();
    } catch (e) {
      console.warn("edge-tutor 迁移失败（跳过）", e);
    }
  }

  /** 激活右侧面板 */
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TUTOR);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("无法打开右侧面板");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_TUTOR, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** 获取面板实例 */
  getTutorView(): TutorView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TUTOR);
    return (leaves[0]?.view as TutorView) ?? null;
  }

  /** 激活执行面板 */
  async activateAgentView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("无法打开执行面板");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_AGENT, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** 选中文本 → 发送到面板 */
  async askFromSelection(selection: string, sourcePath?: string) {
    await this.activateView();
    const view = this.getTutorView();
    if (!view) {
      new Notice("面板未就绪，请重试");
      return;
    }
    view.receiveSelection(selection, sourcePath);
  }

  /** 当前工作区（面板视图可能缓存；这里以面板为准） */
  currentWorkspace(): string {
    const view = this.getTutorView();
    return view ? view.currentWorkspace : "main";
  }

  /** 获取当前编辑文件的锚点 */
  getAnchor(): { sourcePath: string; quote: string } | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return null;
    return {
      sourcePath: view.file.path,
      quote: view.editor.getSelection() || "",
    };
  }

  /** 获取当前正在阅读的教材位置；面板成为 active view 时仍能找到最近的教材页。 */
  getCurrentReadingAnchor(): { sourcePath: string; quote: string } | null {
    const root = this.settings.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const activeFile = this.app.workspace.getActiveFile();
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const candidates = leaves
      .map((leaf) => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView && !!view.file)
      .filter((view) => {
        const path = view.file!.path.replace(/\\/g, "/");
        return path === root || path.startsWith(root + "/");
      });
    const view = (activeFile && candidates.find((candidate) => candidate.file?.path === activeFile.path))
      ?? candidates[0];
    if (!view?.file) return null;

    const selection = view.editor.getSelection().trim();
    const cursor = view.editor.getCursor();
    const line = view.editor.getLine(cursor.line).trim();
    return {
      sourcePath: view.file.path,
      quote: (selection || line).slice(0, 240),
    };
  }

  /** 工作区节点目录路径 */
  workspaceFolderPathOf(workspace: string): string {
    return workspaceFolderPath(this.settings.nodeFolder, workspace);
  }

  /** 工作区目录是否存在（空容器也算——教材联动刚建、尚无节点时也要保留激活态） */
  async workspaceFolderExists(workspace: string): Promise<boolean> {
    if (workspace === "main") return true;
    try {
      return await this.app.vault.adapter.exists(this.workspaceFolderPathOf(workspace));
    } catch {
      return false;
    }
  }

  /** 特殊目录：不作为工作区/教材容器（concepts/t-maps/images 是资源与跨教材活页；_exports 是备份树） */
  private static readonly SPECIAL_FOLDERS = new Set(["concepts", "t-maps", "images", "_exports"]);

  /**
   * 发现所有工作区（两级）：
   *   - 教材容器（一级目录含子文件夹或直接节点）→ 教材根 = 教材名（main 角色），子文件夹 = 教材名/子工作区名
   *   - 普通工作区（无子文件夹的一级目录）→ 工作区名
   *   - 节点目录根的直接节点 → main
   */
  async discoverWorkspaces(): Promise<string[]> {
    const root = this.app.vault.getAbstractFileByPath(this.settings.nodeFolder);
    const ws: string[] = [];
    if (!(root instanceof TFolder)) return ws;

    // 节点目录根直接有节点 → main
    const rootHasNodes = root.children.some(
      (c) => c instanceof TFile && c.name.endsWith(".md") && !c.name.startsWith(".") && c.name !== "认知边缘地图.md"
    );
    if (rootHasNodes) ws.push("main");

    for (const child of root.children) {
      if (!(child instanceof TFolder)) continue;
      if (EdgeTutorPlugin.SPECIAL_FOLDERS.has(child.name)) continue;

      const subFolders = child.children.filter((c): c is TFolder => c instanceof TFolder);
      const directNodes = child.children.some(
        (c) => c instanceof TFile && c.name.endsWith(".md") && !c.name.startsWith(".") && c.name !== "认知边缘地图.md"
      );

      if (subFolders.length > 0 || directNodes) {
        // 教材容器：教材根（main 角色）+ 教材下各子工作区
        ws.push(child.name);
        for (const sub of subFolders) {
          if (sub.name === "images") continue;
          ws.push(`${child.name}/${sub.name}`);
        }
      }
    }
    return [...new Set(ws)];
  }

  /**
   * 教材根绝对路径（opencode 检索指令用）。
   * 不依赖 opencode serve 的工作目录（实测 cwd 可能落在任意目录，相对路径会解析失败导致代理全盘递归扫描）；
   * 非本地文件系统（移动端等）退回相对路径。
   */
  private textbookRootAbs(): string {
    const root = this.settings.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return (adapter.getBasePath() + "/" + root).replace(/\\/g, "/");
    }
    return root;
  }

  /** 读取教材总目录内容 */
  async readToc(): Promise<string> {
    // 新结构（ingest_book.py 规范）：toc.md 在教材根
    const tocCandidates = [
      `${this.settings.textbookRoot}/toc.md`,
      `${this.settings.textbookRoot}/考研数学30讲_总目录.md`,
    ];
    for (const tocPath of tocCandidates) {
      const f = this.app.vault.getAbstractFileByPath(tocPath);
      if (f instanceof TFile) {
        return await this.app.vault.cachedRead(f);
      }
    }
    const root = this.app.vault.getAbstractFileByPath(this.settings.textbookRoot);
    if (root instanceof TFolder) {
      return root.children
        .filter((c) => c instanceof TFile && c.name.endsWith(".md"))
        .map((c) => `- [[${(c as TFile).basename}]]`)
        .join("\n");
    }
    return "（无法读取教材目录）";
  }

  /** 认知地图摘要（供方向指引） */
  async buildMapSummary(): Promise<CognitiveMapSummary> {
    const ws = this.currentWorkspace();
    const nodes = await listNodes(this.app, this.workspaceFolderPathOf(ws));
    const summary = await buildMapSummary(this.app, this.workspaceFolderPathOf(ws), nodes);
    return summary;
  }

  /** 列出某工作区节点（供 MOC 更新） */
  async listNodes(workspace?: string): Promise<CognitiveNode[]> {
    const ws = workspace ?? this.currentWorkspace();
    return listNodes(this.app, this.workspaceFolderPathOf(ws));
  }

  /**
   * 创建认知节点笔记（每问一结点：一律新建，同名自动 -2/-3，不合并）。
   * opts.updatePath：同线程重复沉淀/重新生成时原位更新该文件（幂等键是线程的 nodeFile，不是标题——
   * 一字不差的重复提问是不同线程，绝不能按标题查重互相覆盖）。
   */
  async createNode(node: CognitiveNode, opts?: { updatePath?: string }): Promise<TFile> {
    const ws = node.workspace ?? this.currentWorkspace();
    const folder = this.workspaceFolderPathOf(ws);
    await this.ensureFolder(folder);
    const content = node.content || buildNodeContent(node);
    if (opts?.updatePath) {
      const up = opts.updatePath.replace(/\\/g, "/");
      // ① 完整 vault 路径直接命中（现行语义）
      let target: TFile | null = null;
      if (up.startsWith(folder + "/")) {
        const f = this.app.vault.getAbstractFileByPath(up);
        if (f instanceof TFile) target = f;
      }
      // ② 历史/修复脚本写的相对路径、或工作区搬移后的旧前缀：按 basename 在当前工作区目录找回。
      //    （幂等键是线程 nodeFile——失效时绝不能另建 -2 重复节点，必须回到原文件）
      if (!target) {
        const base = up.split("/").pop() ?? "";
        const dir = this.app.vault.getAbstractFileByPath(folder);
        if (base && dir instanceof TFolder) {
          target = dir.children.find((c): c is TFile => c instanceof TFile && c.name === base) ?? null;
        }
      }
      if (target) {
        await this.app.vault.modify(target, content);
        await this.updateMoc(ws);
        return target;
      }
    }
    const path = uniqueNodePath(this.app, folder, node.title);
    const f = await this.app.vault.create(path, content);
    await this.updateMoc(ws);
    return f;
  }

  /** 更新认知地图 MOC（按工作区；只收工作区直接节点，不递归子工作区） */
  async updateMoc(workspace?: string) {
    const ws = workspace ?? this.currentWorkspace();
    const folder = this.workspaceFolderPathOf(ws);
    await this.ensureFolder(folder);
    const mocPath = `${folder}/认知边缘地图.md`;
    const folderObj = this.app.vault.getAbstractFileByPath(folder);
    const nodes: CognitiveNode[] = [];
    if (folderObj instanceof TFolder) {
      for (const f of folderObj.children) {
        if (!(f instanceof TFile) || !f.name.endsWith(".md")) continue;
        if (f.name.startsWith(".") || f.name === "认知边缘地图.md") continue;
        const content = await this.app.vault.cachedRead(f);
        nodes.push(parseNodeFromContent(f.basename, content, f.path));
      }
    }
    const content = buildMocContent(nodes);
    const existing = this.app.vault.getAbstractFileByPath(mocPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(mocPath, content);
    }
  }

  /** 打开 MOC */
  private async openMoc() {
    const ws = this.currentWorkspace();
    const folder = this.workspaceFolderPathOf(ws);
    const mocPath = `${folder}/认知边缘地图.md`;
    const f = this.app.vault.getAbstractFileByPath(mocPath);
    if (f instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(f);
    } else {
      new Notice("认知地图还不存在 —— 先在面板里沉淀对话");
    }
  }

  /** 新建工作区（子文件夹；当前在教材下则归入该教材容器，教材根也归入教材） */
  async createWorkspace(name: string): Promise<void> {
    const clean = name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
    if (!clean) return;
    const cur = this.currentWorkspace();
    const slash = cur.indexOf("/");
    // 教材根（无 / 且非 main）→ 新工作区建到教材下；子工作区 → 沿用其教材前缀
    const bookPrefix = slash > 0 ? cur.slice(0, slash + 1) : cur !== "main" ? cur + "/" : "";
    await this.ensureFolder(this.workspaceFolderPathOf(bookPrefix + clean));
  }

  /**
   * 重命名工作区（移动文件夹）。
   * Nested workspaces preserve their collection prefix, for example Calculus/limits → Calculus/derivatives.
   * 不再挪到根级。返回最终工作区 id（失败/同名返回 null，调用方保持现状）。
   */
  async renameWorkspace(oldName: string, newName: string): Promise<string | null> {
    const clean = newName.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
    if (!clean || clean === oldName) return null;
    const slash = oldName.indexOf("/");
    const finalId = slash > 0 ? oldName.slice(0, slash + 1) + clean : clean;
    const oldPath = this.workspaceFolderPathOf(oldName);
    const newPath = this.workspaceFolderPathOf(finalId);
    const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
    if (oldFolder instanceof TFolder) {
      try {
        await this.app.vault.rename(oldFolder, newPath);
        // 工作区搬移后 conv 里线程 nodeFile 指向旧路径 → 同步改写，保住幂等键
        //（否则重新生成/💾 会因 updatePath 失效另建 -2 重复节点）
        try {
          const conv = await this.loadConv(finalId);
          let changed = false;
          for (const t of conv.reading.threads) {
            const nf = t.nodeFile?.replace(/\\/g, "/");
            if (nf && nf.startsWith(oldPath + "/")) {
              t.nodeFile = newPath + nf.slice(oldPath.length);
              changed = true;
            }
          }
          if (changed) await this.saveConv(conv);
        } catch (e) {
          console.warn("[edge-tutor] renameWorkspace 更新 nodeFile 失败", (e as Error).message.slice(0, 100));
        }
        return finalId;
      } catch (e) {
        new Notice("重命名失败：" + (e as Error).message.slice(0, 80));
        return null;
      }
    }
    new Notice("重命名失败：找不到工作区目录");
    return null;
  }

  /**
   * 三处同步删除：线程 + 消息 + 节点文件（回收站）。
   * 供导图「🗑️ 删除」与「粘贴后删除源」使用。
   */
  async deleteThreadsWithFiles(workspace: string, threadIds: string[]): Promise<number> {
    const ids = new Set(threadIds);
    if (ids.size === 0) return 0;
    const conv = await this.loadConv(workspace);
    let deleted = 0;

    // 1. 收集目标线程后删除线程与消息
    const threads = conv.reading.threads.filter((t) => ids.has(t.id));
    for (const t of threads) {
      conv.reading.threads = conv.reading.threads.filter((x) => x.id !== t.id);
      deleted++;
    }
    // 2. 删除归属消息（lineId 命中），孤儿消息（无线程）保留
    conv.messages = conv.messages.filter((m) => !(m.lineId && ids.has(m.lineId)));
    // 3. 重置 activeId
    if (conv.reading.activeId && ids.has(conv.reading.activeId)) {
      conv.reading.activeId = conv.reading.threads.length ? conv.reading.threads[0].id : null;
    }
    await this.saveConv(conv);

    // 4. 删除节点文件（进回收站）。定位顺序：
    //    ① 线程 nodeFile（幂等键，最可靠——✏️ 改名/长标题截断都不影响）
    //    ② 按标题/清洗标题精确拼路径；③ 遍历工作区直接节点按 title/rootQuestion 兜底。
    const folder = this.workspaceFolderPathOf(workspace);
    const dir = this.app.vault.getAbstractFileByPath(folder);
    for (const t of threads) {
      const title = t.title || t.rootQuestion || "";
      let f: TFile | null = null;
      const cands: string[] = [];
      const nf = t.nodeFile?.replace(/\\/g, "/");
      if (nf) {
        cands.push(nf);
        const base = nf.split("/").pop() ?? "";
        if (base) cands.push(`${folder}/${base}`);
      }
      if (title) {
        cands.push(`${folder}/${title}.md`);
        cands.push(`${folder}/${makeNodeTitle(title)}.md`);
      }
      for (const p of cands) {
        if (!p || p.endsWith("/.md")) continue;
        const hit = this.app.vault.getAbstractFileByPath(p);
        if (hit instanceof TFile) {
          f = hit;
          break;
        }
      }
      if (!f && dir instanceof TFolder) {
        for (const child of dir.children) {
          if (!(child instanceof TFile) || !child.name.endsWith(".md")) continue;
          if (child.name.startsWith(".") || child.name === "认知边缘地图.md") continue;
          try {
            const content = await this.app.vault.cachedRead(child);
            const node = parseNodeFromContent(child.basename, content, child.path);
            if (node.title === title || node.rootQuestion === title) {
              f = child;
              break;
            }
          } catch (e) {
            // 单个文件解析失败跳过，不影响其他文件
          }
        }
      }
      if (f instanceof TFile) {
        try {
          await this.app.vault.trash(f, true);
        } catch (e) {
          console.warn("[edge-tutor] 节点文件删除失败", title, e);
        }
      } else {
        console.warn("[edge-tutor] 未定位到节点文件（可能已手动删除）", title || t.id);
      }
    }
    return deleted;
  }

  /** 加载工作区会话（conv）—— 用 adapter 直接读，避免 Obsidian 隐藏文件索引问题 */
  async loadConv(workspace: string): Promise<Conv> {
    const path = convPath(this.settings.nodeFolder, workspace);
    try {
      // adapter.exists 不依赖 Obsidian 文件索引，隐藏文件也能读
      const exists = await this.app.vault.adapter.exists(path);
      if (exists) {
        const text = await this.app.vault.adapter.read(path);
        const parsed = parseConv(text);
        if (parsed) return parsed;
        // 主文件损坏 → 尝试 .bak 恢复
        console.warn("[edge-tutor] loadConv 解析失败，尝试 .bak 恢复", path);
      }
    } catch (e) {
      console.warn("[edge-tutor] loadConv 失败", path, e);
    }
    try {
      const backupPath = path + ".bak";
      if (await this.app.vault.adapter.exists(backupPath)) {
        const text = await this.app.vault.adapter.read(backupPath);
        const parsed = parseConv(text);
        if (parsed) {
          console.warn("[edge-tutor] loadConv 已从 .bak 恢复", path);
          return parsed;
        }
      }
    } catch (e) {
      console.warn("[edge-tutor] loadConv .bak 也失败", e);
    }
    return freshConv(workspace);
  }

  /** 保存工作区会话（conv）—— 用 adapter 直接写，隐藏文件也能写 */
  async saveConv(conv: Conv): Promise<void> {
    const folder = this.workspaceFolderPathOf(conv.workspace);
    await this.ensureFolder(folder);
    const path = convPath(this.settings.nodeFolder, conv.workspace);
    const content = serializeConv(conv);
    try {
      // 崩溃保险：写入前把上次内容备份为 .bak（配合中间保存，最坏只丢一次增量）
      const backupPath = path + ".bak";
      try {
        if (await this.app.vault.adapter.exists(path)) {
          const prev = await this.app.vault.adapter.read(path);
          await this.app.vault.adapter.write(backupPath, prev);
        }
      } catch (be) {
        // 备份失败不阻塞主保存
      }
      await this.app.vault.adapter.write(path, content);
    } catch (e) {
      // 兼容：adapter 失败则退回 vault API
      console.warn("[edge-tutor] saveConv adapter 失败，退回 vault API", e);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(path, content);
      }
    }
  }

  /** 导出当前工作区（markdown 树形大纲 / JSON 完整会话） */
  async exportWorkspace(format: "markdown" | "json") {
    const ws = this.currentWorkspace();
    const conv = await this.loadConv(ws);
    const hasContent = conv.messages.length > 0 || conv.reading.threads.length > 0;
    if (!hasContent) {
      new Notice("当前工作区没有会话可导出");
      return;
    }
    const exportFolder = `${this.settings.nodeFolder}/_exports`;
    await this.ensureFolder(exportFolder);
    const stamp = new Date().toISOString().slice(0, 10);
    // A workspace name can contain collection prefixes; replace / in export file names.
    const safeWs = ws.replace(/[/\\]/g, "_");
    if (format === "markdown") {
      const md = formatConvMarkdown(conv, {
        title: `认知边缘会话导出（${ws === "main" ? "默认" : ws}）`,
        source: "Edge Tutor",
        workspace: ws,
      });
      const path = `${exportFolder}/认知边缘导出_${safeWs}_${stamp}.md`;
      await this.writeUnique(exportFolder, path, md);
      new Notice("📤 Markdown 笔记已导出：" + path);
    } else {
      // JSON：完整会话（v4），可无损还原线程+消息+停车场
      const json = serializeConv(conv);
      const path = `${exportFolder}/认知边缘备份_${safeWs}_${stamp}.json`;
      await this.writeUnique(exportFolder, path, json);
      new Notice("📦 JSON 备份已导出：" + path);
    }
  }

  /** 导入 JSON 备份（恢复认知节点） */
  async importWorkspaceJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        const { nodes, meta } = parseJSONBackup(text);
        if (nodes.length === 0) {
          new Notice("备份解析失败或没有节点");
          return;
        }
        const targetWs = meta?.workspace && meta.workspace !== "main" ? meta.workspace : "main";
        const folder = this.workspaceFolderPathOf(targetWs);
        await this.ensureFolder(folder);
        let count = 0;
        for (const n of nodes) {
          const path = uniqueNodePath(this.app, folder, n.title);
          await this.app.vault.create(path, n.content || buildNodeContent(n));
          count++;
        }
        await this.updateMoc(targetWs);
        new Notice(`📥 已导入 ${count} 个认知节点到工作区「${targetWs}」`);
      } catch (e) {
        new Notice("导入失败：" + (e as Error).message.slice(0, 100));
      }
    };
    input.click();
  }

  /** 写入文件（冲突自动加序号） */
  private async writeUnique(folder: string, path: string, content: string) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!(existing instanceof TFile)) {
      await this.app.vault.create(path, content);
      return;
    }
    const dot = path.lastIndexOf(".");
    const base = dot > 0 ? path.slice(0, dot) : path;
    const ext = dot > 0 ? path.slice(dot) : "";
    const stamp = Date.now().toString(36);
    await this.app.vault.create(`${base}_${stamp}${ext}`, content);
  }

  /** 递归确保文件夹存在 */
  private async ensureFolder(path: string) {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!(this.app.vault.getAbstractFileByPath(cur) instanceof TFolder)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch (e) {
          // 已存在则忽略
        }
      }
    }
  }

  /** 工作区目录（供 view 用） */
  workspaceFolder(workspace: string): string {
    return this.workspaceFolderPathOf(workspace);
  }

  /** 递归确保文件夹存在（公开，供 view 用） */
  async ensureFolderPublic(path: string) {
    await this.ensureFolder(path);
  }

  /** 执行面板 agent 记录文件路径（vault 内，隐藏文件） */
  private agentConvPath(): string {
    return `${this.settings.nodeFolder.replace(/\/+$/, "")}/.agent-conv.json`;
  }

  /** 加载执行面板记录 */
  async loadAgentConv(): Promise<AgentConv> {
    const path = this.agentConvPath();
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const text = await this.app.vault.adapter.read(path);
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.tasks)) {
          return { workspace: parsed.workspace || "main", tasks: parsed.tasks };
        }
      }
    } catch (e) {
      console.warn("[edge-tutor] loadAgentConv 失败", e);
    }
    return freshAgentConv();
  }

  /** 保存执行面板记录（同步当前认知工作区，供恢复时定位沉淀落点） */
  async saveAgentConv(conv: AgentConv): Promise<void> {
    const path = this.agentConvPath();
    try {
      conv.workspace = this.currentWorkspace() || conv.workspace;
      await this.ensureFolder(this.settings.nodeFolder);
      await this.app.vault.adapter.write(path, JSON.stringify(conv, null, 2));
    } catch (e) {
      console.warn("[edge-tutor] saveAgentConv 失败", e);
    }
  }

  /**
   * 从节点文件重建会话（conv）：
   * 节点 .md 是单一数据源，会话为空时（清屏/迁移）用它恢复线程树与消息。
   * 只读当前工作区的直接节点（不递归子工作区）。
   */
  async rebuildConvFromNodes(workspace?: string): Promise<Conv | null> {
    const ws = workspace ?? this.currentWorkspace();
    const folder = this.app.vault.getAbstractFileByPath(this.workspaceFolderPathOf(ws));
    if (!(folder instanceof TFolder)) return null;

    // 直接子文件（排除 MOC 与隐藏文件；子工作区文件夹不属于本工作区）
    const files = folder.children.filter(
      (f): f is TFile =>
        f instanceof TFile &&
        f.name.endsWith(".md") &&
        !f.name.startsWith(".") &&
        f.name !== "认知边缘地图.md"
    );
    if (files.length === 0) return null;

    const nodes: CognitiveNode[] = [];
    for (const f of files) {
      const content = await this.app.vault.cachedRead(f);
      const node = parseNodeFromContent(f.basename, content, f.path);
      node.filePath = f.path;
      nodes.push(node);
    }
    return buildConvFromNodes(nodes, ws);
  }

  /**
   * 设置节点封顶标记（🔒）：同步写入节点 frontmatter（持久化，重建会话时恢复）。
   * 标题 ≠ 文件 basename（✏️ 改名 / 长问题截断 / agent 命名）时逐级兜底定位节点文件；
   * 定位失败仅返回 false（不强制）。
   */
  async setNodeLocked(workspace: string, title: string, locked: boolean): Promise<boolean> {
    const folder = this.workspaceFolderPathOf(workspace);
    // ① 精确 basename ② 遍历直接节点按 title/rootQuestion 匹配 ③ 节点标题等于 basename
    let f: TFile | null = null;
    const direct = this.app.vault.getAbstractFileByPath(`${folder}/${title}.md`);
    if (direct instanceof TFile) f = direct;
    const dir = this.app.vault.getAbstractFileByPath(folder);
    if (!f && dir instanceof TFolder) {
      for (const child of dir.children) {
        if (!(child instanceof TFile) || !child.name.endsWith(".md")) continue;
        if (child.name.startsWith(".") || child.name === "认知边缘地图.md") continue;
        try {
          const content = await this.app.vault.cachedRead(child);
          const node = parseNodeFromContent(child.basename, content, child.path);
          if (node.title === title || node.rootQuestion === title) {
            f = child;
            break;
          }
        } catch (e) {
          // 单个文件解析失败跳过
        }
      }
    }
    if (!(f instanceof TFile)) return false;
    try {
      const content = await this.app.vault.read(f);
      const hasLocked = /^locked:\s*true/m.test(content);
      if (hasLocked === locked) return true;
      let next: string;
      if (locked) {
        // 在 frontmatter 结尾（--- 前）插入；mastery 双写（重建会话时由 mastery: mastered 恢复封顶）
        next = content.replace(/^---\n([\s\S]*?)\n---/, (_m, body: string) => `---\n${body}${body.trimEnd().endsWith("\n") ? "" : "\n"}locked: true\nmastery: mastered\n---`);
      } else {
        // 解锁：移除 locked 行，mastery 从 mastered 落回 exploring（保持进行中状态）
        next = content.replace(/^locked:\s*true\n/m, "");
        next = next.replace(/^mastery:\s*mastered\n/m, "mastery: exploring\n");
      }
      if (next === content) return false;
      await this.app.vault.modify(f, next);
      return true;
    } catch (e) {
      console.warn("[edge-tutor] setNodeLocked 失败", title, e);
      return false;
    }
  }

  /**
   * 聚合所有工作区的认知地图树文本（供 whole 范围导引）。
   * 每工作区一段（标注工作区名），空工作区跳过，locked 合并。
   */
  async buildGlobalMapText(): Promise<{ text: string; locked: string[]; total: number }> {
    const workspaces = await this.discoverWorkspaces();
    const parts: string[] = [];
    const locked = new Set<string>();
    let total = 0;
    for (const ws of workspaces) {
      const conv = await this.loadConv(ws);
      const summary = cognitiveMapSummary(conv);
      if (!summary.summaryText || summary.summaryText.includes("尚无认知节点")) continue;
      const label = ws === "main" ? "默认工作区" : ws;
      parts.push(`【工作区：${label}】\n${summary.summaryText}`);
      summary.locked.forEach((l) => locked.add(l));
      total += conv.reading.threads.length;
    }
    return {
      text: parts.join("\n\n") || "（尚无认知节点，全新探索）",
      locked: [...locked],
      total,
    };
  }

  /**
   * 执行模式（Agent）：在 vault 内执行用户指令。
   * 通道独立于对话（对话走反代免费号，agent 走支持 tool_calls 的通道）。
   * - opencode：委托本机 opencode serve（完整 agent，bash/网络/文件全能力，轮数不受限）
   * - openai：直连官方 API，自建工具循环（vault 内 6 个工具）
   */
  async runAgentTask(
    input: string,
    opts: { onStep?: (step: AgentStep) => void; signal?: AbortSignal } = {}
  ): Promise<AgentResult> {
    const s = this.settings;
    // 当前认知工作区（agent 沉淀节点/操作文件的落点语义）
    const wsLabel = this.currentWorkspace();
    const wsHint = `当前认知工作区：${wsLabel === "main" ? "默认（认知边缘根目录）" : wsLabel}。沉淀认知节点请使用该工作区；删除/移动 vault 文件前必须报告计划。`;

    if (s.agentChannel === "opencode") {
      const result = await runOpenCodeTask(
        {
          base: s.opencodeBase || "http://127.0.0.1:10999",
          provider: s.opencodeProvider || "opencode-go",
          model: s.opencodeModel || "deepseek-v4-flash",
        } as OpenCodeConfig,
        input,
        {
          signal: opts.signal,
          system: `${wsHint}\n\n禁止删除 vault 内任何文件或文件夹（包括节点 .md、.conv.json、.obsidian 配置、隐藏文件）。修改或创建文件前，先读取目标现状。`,
          onStep: (step) => {
            opts.onStep?.({
              turn: step.turn,
              call: { id: "", name: step.call.name, arguments: step.call.arguments },
              result: step.result,
            });
          },
        }
      );
      return {
        ok: result.ok,
        answer: result.answer,
        toolsUsed: [...new Set(result.steps.map((st) => st.call.name))],
        turns: result.steps.length ? result.steps[result.steps.length - 1].turn : 1,
      };
    }

    // openai 直连通道：自建工具循环
    const cfg = agentConfig(this.settings);
    if (!cfg.apiKey) {
      throw new Error(
        `执行模式未配置 API Key：请在设置中填写（环境变量 ${s.agentApiKeyEnv || "DEEPSEEK_API_KEY"} 优先）`
      );
    }
    const executor = buildVaultExecutor(this.app, {
      currentWorkspace: () => this.currentWorkspace(),
      listNodes: (ws) => this.listNodes(ws),
      createNode: (node) => this.createNode(node),
      updateMoc: (ws) => this.updateMoc(ws),
    });
    return runAgent(cfg, input, executor, { ...opts, maxTurns: s.agentMaxTurns || 30, wsHint });
  }

  /**
   * 确保 opencode serve 在运行：检测 → 未运行则后台启动 → 等待就绪。
   * 供面板「🔌 opencode」按钮调用。
   */
  async ensureOpenCodeServer(): Promise<{ ok: boolean; message: string }> {
    const base = (this.settings.opencodeBase || "http://127.0.0.1:10999").replace(/\/+$/, "");
    if (await this.pingOpenCode(base)) {
      return { ok: true, message: `opencode serve 已在运行（${base}）` };
    }

    // 未运行 → 后台启动（detached：Obsidian 关闭后 serve 继续存活）
    let port = 10999;
    try {
      port = parseInt(new URL(base).port, 10) || 10999;
    } catch (e) {
      // 地址解析失败用默认端口
    }
    try {
      const { spawn } = (globalThis as any).require("child_process");
      const child = spawn("opencode", ["serve", "--port", String(port), "--cors", "app://obsidian.md"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: true,
      });
      child.unref();
    } catch (e) {
      return { ok: false, message: `启动 opencode 失败：${(e as Error).message.slice(0, 120)}` };
    }

    // 等待就绪（最多 ~15s）
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await this.pingOpenCode(base)) {
        return { ok: true, message: "已启动 opencode serve（后台运行，端口 " + port + "）" };
      }
    }
    return { ok: false, message: "已发起启动，但 serve 未响应。请确认 opencode 命令在 PATH 中" };
  }

  /** 探测 opencode serve 健康端点 */
  private async pingOpenCode(base: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(base + "/global/health", { signal: controller.signal });
      clearTimeout(timer);
      return resp.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * 教材检索（语义版）：委托 opencode 在教材目录定位原文，结构化引用返回。
   * - 会话级缓存（query 归一化 + LRU 10 条）：同主题追问 <1s
   * - opencode 全量语义检索（20s 超时），失败/超时降级本地 grep
   * - 结果只提供给问答模型（respond 注入 system），不落盘、不显示
   */
  private searchCache = new Map<string, { hit: SearchHit; ts: number }>();
  /** BM25 倒排缓存（与 textIndex 绑定，索引重建时失效） */
  private bm25Idx: Bm25Index | null = null;
  /** 章节地图缓存（toc.md → 讲次标题列表） */
  private chapterIndex: { file: string; title: string }[] | null = null;
  /** 教材行索引缓存（懒构建；教材文件变更/root 变更即失效） */
  private textIndex: TextbookIndex[] | null = null;
  private textIndexRoot = "";
  /** 教材向量索引（懒构建/加载落盘；root 变更即失效重建） */
  private vecIndex: VectorIndex | null = null;
  private vecIndexRoot = "";
  private vecBuilding = false;
  /** 向量索引状态栏元素（加载/构建/就绪常驻显示） */
  private vectorStatusEl: HTMLElement | null = null;

  /** 更新状态栏向量索引状态（简短文本，Obsidian 底部状态栏） */
  private updateVectorStatus(text: string): void {
    if (this.vectorStatusEl) this.vectorStatusEl.setText(text);
  }

  /** 读取/缓存章节地图（教材 toc.md 解析） */
  private async getChapterIndex(): Promise<{ file: string; title: string }[]> {
    if (this.chapterIndex && this.chapterIndex.length > 0) return this.chapterIndex;
    try {
      const toc = await this.readToc();
      this.chapterIndex = parseChapterIndex(toc);
    } catch (e) {
      this.chapterIndex = [];
    }
    return this.chapterIndex ?? [];
  }

  /**
   * 懒构建教材行索引（仅 root 下 md，含 OCR 归一化）。
   * 13MB → 内存行数组，构建 <1s；root 变更/教材文件变更即失效重建。
   */
  private async ensureTextbookIndex(): Promise<TextbookIndex[]> {
    const root = this.settings.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    if (this.textIndex && this.textIndexRoot === root) return this.textIndex;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(root + "/") && f.name !== "toc.md");
    const index: TextbookIndex[] = [];
    for (const f of files) {
      try {
        const text = await this.app.vault.cachedRead(f);
        index.push({
          path: f.path,
          lines: text.split("\n").map((t) => ({ text: t, norm: normalizeTextForMatch(t) })),
        });
      } catch (e) {
        // 单文件读取失败跳过，不阻断整个索引
        console.warn("[edge-tutor] 教材索引跳过文件", f.path, (e as Error).message.slice(0, 100));
      }
    }
    this.textIndex = index;
    this.textIndexRoot = root;
    this.bm25Idx = null; // BM25 倒排随行索引失效
    return index;
  }

  /** 教材检索路径日志（cache | index | opencode | grep），验证/排障用 */
  private logSearchPath(tag: string, ms: number, hit: boolean): void {
    console.info(`[edge-tutor] 教材检索: ${tag}, ${ms}ms, ${hit ? "命中" : "未命中"}`);
  }

  /**
   * LLM 查询理解 + 章节路由：一步非流式调用（≤2s 超时，失败返回 null）把口语问题
   * 转为结构化理解（concept/intent/knowledge_need/related_terms/chapters/3 个查询变体）——
   * Handles differently worded and cross-chapter questions through the configured chat channel.
   * JSON 输出优先；解析失败降级旧【关键词】格式解析（行为不变）。
   */
  private async rewriteQuery(rawQ: string): Promise<RewriteOutput | null> {
    const t0 = Date.now();
    try {
      const chapters = await this.getChapterIndex();
      const chapterList =
        chapters.length > 0 ? chapters.map((c) => c.title).join("、") : "（无章节地图）";
      const prompt = [
        "把下面的学生问题改写成结构化检索输入，只输出一个 JSON 对象（不要 markdown 围栏、不要解释）。",
        "",
        "【教材章节列表】",
        chapterList,
        "",
        'JSON 格式：{ "concept": "核心概念名（教材确切术语，如\\"拉格朗日中值定理\\"）",',
        '  "intent": "求理解 | 找例题 | 找定义 | 找反例 | 求证明 | 其他",',
        '  "knowledge_need": "问句中隐含的检索目标（一句话，用教材语言，如\\"拉格朗日中值定理的适用条件\\"）",',
        '  "related_terms": ["同义/等价表述或强相关概念 2-3 个"],',
        '  "chapters": ["最可能涉及的讲次标题（从上面的列表选 1-2 个，不确定则空数组）"],',
        '  "queries": [',
        '    "原始问题的检索表述",',
        '    "教材语言表述（术语化，如\\"拉格朗日中值定理的适用条件\\"）",',
        '    "概念扩展表述（换个角度描述同一问题）"',
        "  ]",
        "}",
        "",
        `【学生问题】${rawQ}`,
      ].join("\n");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const answer = await chatCompletion(
          this.settings,
          [
            { role: "system", content: "你是教材检索查询理解器，只输出规定 JSON，不要解释。" },
            { role: "user", content: prompt },
          ] as ChatMessage[],
          { signal: controller.signal, maxTokens: 500 }
        );
        // 结构化 JSON 优先：keywords = concept + knowledge_need + related_terms（进 L1 子串路）
        const u = parseQueryUnderstanding(answer);
        if (u) {
          const out: RewriteOutput = {
            keywords: [u.concept, u.knowledgeNeed.slice(0, 20), ...u.relatedTerms]
              .map((k) => k.trim())
              .filter((k) => k.length >= 2)
              .slice(0, 6),
            chapters: u.chapters,
            synonyms: u.relatedTerms,
            queries: u.queries,
          };
          console.info(`[edge-tutor] 查询理解 ${Date.now() - t0}ms`, JSON.stringify(u).slice(0, 300));
          return out;
        }
        // 降级旧路径：LLM 按旧格式输出时行为不变（单查询向量）
        const r = parseRewriteOutput(answer);
        if (r.keywords.length > 0 || r.chapters.length > 0 || r.synonyms.length > 0) {
          console.info(`[edge-tutor] 查询改写（旧格式降级）${Date.now() - t0}ms`, JSON.stringify(r).slice(0, 200));
          return r;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.warn("[edge-tutor] 查询改写失败，跳过", (e as Error).message.slice(0, 100));
    }
    return null;
  }

  async semanticTextbookSearch(query: string): Promise<SearchHit> {
    const s = this.settings;
    const root = s.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const rawQ = String(query ?? "").trim().slice(0, 200);
    if (!rawQ) return { found: false, text: "", count: 0, refs: [] };

    // L0：会话级缓存（query 归一化）。key 只取问题本体——选中原文追问时消息带
    // 【由这段原文引出】前缀+原文，整串归一化会把问题挤出 40 字符 key，
    // 同一段原文的不同问题互相撞缓存只真检索一次（修复，回归测试见
    // test/retrieval-cache-key.test.mjs）；rawQFull 不走 200 截断，
    // 原文再长也不影响 key。
    const rawQFull = String(query ?? "").trim();
    const qKey = normalizeQuery(extractQuestionPart(rawQFull));
    if (qKey) {
      const cached = this.searchCache.get(qKey);
      if (cached) {
        // LRU 刷新
        this.searchCache.delete(qKey);
        this.searchCache.set(qKey, cached);
        return cached.hit;
      }
    }

    const t0 = Date.now();
    let hit: SearchHit = { found: false, text: "", count: 0, refs: [] };

    // L1+L2：本地归一化行索引（毫秒级，OCR 容错；无条件先查）。
    // 查询改写与首轮索引并行发起：rawQ 整串命中（exact ≥2）即快路径返回，
    // 否则收集文本路候选（改写关键词/同义补查）进混合召回
    let rewrite: RewriteOutput | null = null;
    const rewriteP = this.rewriteQuery(rawQ);
    const aRefs: SearchRef[] = [];
    const bm25Refs: SearchRef[] = [];
    const kwRefs: SearchRef[] = []; // 改写关键词补查：只扩充 rerank 候选池，不进 RRF 主路
    let aExact = false;
    try {
      const index = await this.ensureTextbookIndex();
      if (index) {
        const r0 = searchTextbookIndex(index, rawQ, 6);
        if (r0 && r0.found) {
          aRefs.push(...r0.refs);
          aExact = r0.exact;
        }
        // L1.5 BM25 词频路：子串命中无分数，术语密集行靠词频打分补召回，独立进 RRF
        try {
          if (!this.bm25Idx) this.bm25Idx = buildBm25Index(index);
          bm25Refs.push(...bm25Search(index, this.bm25Idx, rawQ, 20).map((r) => r.ref));
        } catch (e) {
          console.warn("[edge-tutor] BM25 检索失败，跳过本路", (e as Error).message.slice(0, 100));
        }
        if (!aExact) {
          rewrite = await rewriteP; // 整串未命中才等改写（<0.5s，失败返回 null）
          if (rewrite) {
            // 关键词补查进候选池而非 RRF：宽泛术语（"积分不等式"）常命中讲次总览块，
            // 与向量路"多路共识"后会把 rawQ 截尾命中的精确行挤出融合前列（实测 9 条行级劣化）
            for (const q of [...rewrite.keywords, ...rewrite.synonyms]) {
              const rr = searchTextbookIndex(index, q, 6);
              if (rr && rr.found) kwRefs.push(...rr.refs);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[edge-tutor] 本地索引检索失败", (e as Error).message.slice(0, 120));
    }

    // 快路径：整串命中 ≥2 处 → 直接返回（归一化匹配已确认，省向量推理）
    if (aExact && aRefs.length >= 2) {
      const top = diverseTop(aRefs, 6, 2);
      hit = { found: true, text: formatRefsText(top), count: top.length, refs: top };
      this.logSearchPath("index", Date.now() - t0, true);
      return this.cacheSearchHit(qKey, hit);
    }

    // L3 向量召回 + L4 RRF 融合 + L5 条件 rerank（混合语义路径；任一失败静默降级）
    const chapters = rewrite?.chapters ?? [];
    // 阶段 2 多路向量：主路 = 原始问题（相似度主排序，与用户表述最匹配）；
    // 变体 = JSON 理解的 3 个查询（教材语言/概念扩展），只扩充召回不参与排序。
    // 注意：不能用关键词拼接查询——实测 bge 编码被 30+ 字关键词带偏，
    // 正确例题行的相似度排名被稀释出 top20（base 纯原问排第 1）。
    const vecQueries = [rawQ];
    for (const q of rewrite?.queries ?? []) {
      if (q && !vecQueries.includes(q)) vecQueries.push(q);
    }
    const vecHits = await this.vectorRecall(vecQueries, chapters);
    // L4 RRF 融合三路：子串（强命中）/ BM25（词频分）/ 向量（语义）
    const merged = rrfMerge([aRefs, bm25Refs, vecHits]);
    if (merged.length > 0) {
      const vecTopScore = vecHits[0]?.score ?? 0;
      const aTopFile = aRefs[0]?.file;
      const vecTopFile = vecHits[0]?.file;
      const agreement = !!aTopFile && !!vecTopFile && aTopFile === vecTopFile;
      // 条件 rerank：整串未命中 且（向量置信不足 或 两路分歧）→ 交叉编码器重排 top-40；
      // reranker 不可用 → 直接用融合分排序（RRF 免标定，低分不硬上）
      const needRerank = !aExact && !(vecTopScore >= RERANK_TRIGGER_SCORE && agreement);
      let ranked = merged;
      if (needRerank) {
        const reranker = await this.loadRerankerForSearch();
        if (reranker) {
          // 候选池 = 融合结果 + BM25 强符号命中 + 改写关键词补查（仅低置信时扩充；
          // 交叉编码器把关：无区分度的宽泛命中被压下去，符号/题号/精确术语命中被抬上来）
          const pool =
            bm25Refs.length > 0 || kwRefs.length > 0
              ? rrfMerge([merged.map((m) => m.ref), bm25Refs, kwRefs])
              : merged;
          const top40 = pool.slice(0, 40);
          try {
            const scores = await reranker.rerank(rawQ, top40.map((m) => m.ref.text));
            ranked = top40
              .map((m, i) => ({ ref: m.ref, score: scores[i] ?? 0 }))
              .sort((x, y) => y.score - x.score);
            // 保底注入：reranker 的"最相关段落"配对会把对话追问/变式类的锚点段压出 top10
            // （评测：78 条生效子集上文件级 98.7%→94.9%、MRR 0.789→0.690），而这两路是
            // RRF 排序的主体（off-off 基线 99% 就靠它们）——强信号必须保住（阶段 2 kwRefs
            // 教训同构）。保底对象：aRefs 子串精确命中（≤2）+ 向量路 top2（≤2，去重后 ≤4），
            // 其余槽位仍按 rerank 排序（精排收益保留在注入内容上）。
            const keptRefs = aRefs
              .filter((a) => ranked.some((m) => m.ref.file === a.file && a.startLine >= m.ref.startLine && a.startLine <= m.ref.endLine))
              .slice(0, 2);
            const keepSources: SearchRef[] = [...keptRefs, ...vecHits.slice(0, 2)];
            // keptItems 提升到 if 外：console.info 在 keepSources 为空时也会引用它
            //（块级 const 越界 → ReferenceError 被 catch 吞掉并误报"rerank 不可用"）
            const keptKeys = new Set<string>();
            const keptItems: { ref: SearchRef; score: number }[] = [];
            if (keepSources.length > 0) {
              // 保底条目 → 其对应的候选块 key（ranked 里的条目是块，aRefs 是行级命中，
              // 去重必须用块的 key，否则 key 对不上）
              for (const a of keepSources) {
                const m = ranked.find((x) => x.ref.file === a.file && a.startLine >= x.ref.startLine && a.startLine <= x.ref.endLine);
                if (!m) continue;
                const key = `${m.ref.file}:${m.ref.startLine}`;
                if (keptKeys.has(key)) continue;
                keptKeys.add(key);
                keptItems.push({ ref: m.ref, score: 1.01 });
              }
              if (keptItems.length > 0) {
                ranked = [...keptItems, ...ranked.filter((m) => !keptKeys.has(`${m.ref.file}:${m.ref.startLine}`))];
              }
            }
            console.info(`[edge-tutor] 条件 rerank：${top40.length} 候选 → top${Math.min(ranked.length, 6)}${keptItems.length > 0 ? `（保底 ${keptItems.length} 条子串精确命中）` : ""}`);
          } catch (e) {
            // 降级链已在 loadRerankerForSearch 内处理（远程 → 本地 bge → 抛错到这）：
            // 到此说明全部 reranker 不可用，用融合分排序（RRF 免标定）
            console.warn("[edge-tutor] rerank 不可用，用融合分排序", String((e as Error)?.message ?? e).slice(0, 150));
          }
        }
      }
      // 先重排后多样性裁剪：同文件最多 2 条，保证"多点实例"覆盖不同讲次
      const top = diverseTop(ranked.map((m) => m.ref), 6, 2);
      hit = { found: true, text: formatRefsText(top), count: top.length, refs: top };
      this.logSearchPath(aRefs.length > 0 ? "hybrid" : "vector", Date.now() - t0, true);
      return this.cacheSearchHit(qKey, hit);
    }
    console.info(`[edge-tutor] 混合检索无候选（文本路 ${aRefs.length} 处 / 向量 top1=${vecHits[0]?.score.toFixed(3) ?? "-"}），交给 agent`);

    // L2：opencode 语义检索（25s 硬超时；指令含 vault 绝对路径，不依赖 serve 的 cwd）
    if (s.agentChannel === "opencode") {
      try {
        const chapters = await this.getChapterIndex();
        const chapterMap =
          chapters.length > 0
            ? chapters.map((c) => `- ${c.file}：${c.title}`).join("\n")
            : "（无法读取章节地图，请自行浏览目录）";
        const absRoot = this.textbookRootAbs();
        const chapterHint =
          rewrite && rewrite.chapters.length > 0 ? `优先检查以下讲次：${rewrite.chapters.join("、")}。` : "";
        const instruction = [
          `在教材目录 "${absRoot}"（绝对路径，可直接 read/grep）下查找与「${rawQ}」最相关的教材原文，定位到具体的行。`,
          "",
          "【章节地图】（教材讲次结构，用于判断去哪里找）",
          chapterMap,
          "",
          "要求：",
          `1. ${chapterHint}先根据章节地图判断最相关的 1-2 个讲次 → 用 read/grep 在该文件中定位原文。`,
          "2. 若目标讲次中没有，再检查相邻讲次；仍找不到就只输出：未找到",
          "3. 输出格式（严格遵守，只输出 1-3 处，每处一个块）：",
          "【文件】vault 相对路径（相对 vault 根，不是绝对路径，不含行号），形如 References/chapter-06.md",
          "【行号】起行-止行",
          "【原文】该区间原文，150-300 字，保留原表述",
        ].join("\n");
        const result = await runOpenCodeTask(
          {
            base: s.opencodeBase || "http://127.0.0.1:10999",
            provider: s.opencodeProvider || "opencode-go",
            model: s.opencodeModel || "deepseek-v4-flash",
          } as OpenCodeConfig,
          instruction,
          { maxWaitMs: 25_000 }
        );
        hit = parseSearchResult(result.answer);
        this.logSearchPath("opencode", Date.now() - t0, hit.found);
      } catch (e) {
        console.warn("[edge-tutor] opencode 检索失败，降级 grep", (e as Error).message.slice(0, 120));
        hit = { found: false, text: "", count: 0, refs: [] };
      }
    }

    // L3：降级/兜底：本地 grep（文本定位）
    if (!hit.found) {
      hit = await this.searchTextbookLocal(rawQ, root);
      this.logSearchPath("grep", Date.now() - t0, hit.found);
    }
    return this.cacheSearchHit(qKey, hit);
  }

  /** 写检索缓存（无论是否命中，防重复检索）并返回 */
  private cacheSearchHit(qKey: string, hit: SearchHit): SearchHit {
    if (qKey) {
      if (this.searchCache.size >= 10) {
        const oldest = this.searchCache.keys().next().value;
        if (oldest !== undefined) this.searchCache.delete(oldest);
      }
      this.searchCache.set(qKey, { hit, ts: Date.now() });
    }
    return hit;
  }

  // ===== 向量检索（transformers.js 本地 embedding；懒构建 + 落盘；失败即禁用） =====

  /** 教材向量索引统计（注入 prompt 用；索引未加载/不可用 → null） */
  get textbookIndexStats(): { files: number; chunks: number } | null {
    if (!this.vecIndex || this.vecIndex.chunks.length === 0) return null;
    const files = new Set(this.vecIndex.chunks.map((c) => c.file)).size;
    return { files, chunks: this.vecIndex.chunks.length };
  }

  /** 插件数据目录（vault 外绝对路径；模型缓存/向量索引落盘处） */
  private vecPluginDir(): string {
    const base = this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : "";
    return `${base}/.obsidian/plugins/edge-tutor`.replace(/\\/g, "/");
  }

  /**
   * 向量索引文件（绝对路径，按教材 root 分文件：search-vectors-<sha256(root) 前 12 位>.json）。
   * 多教材各自持久，切换教材秒级加载、互不覆盖；旧版单文件 search-vectors.json
   * 由 migrateLegacyVectorIndex 一次性 rename 迁移。
   * 注意不能用 vault.adapter.read/write——adapter 只认 vault 相对路径，传绝对路径会被
   * basePath 再拼一次（vault 根重复）。models/（模型缓存）同理在 vault 外，统一走 fs。
   */
  private vectorIndexPath(root: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require("crypto");
    const h = crypto.createHash("sha256").update(root).digest("hex").slice(0, 12);
    return `${this.vecPluginDir()}/search-vectors-${h}.json`;
  }

  /** 旧版单文件索引路径（迁移源） */
  private legacyVectorIndexPath(): string {
    return `${this.vecPluginDir()}/search-vectors.json`;
  }

  /** 旧版单文件索引 → 分文件迁移：新路径不存在且旧文件 root 匹配 → rename（保住已建索引，免重建） */
  private async migrateLegacyVectorIndex(root: string): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("fs");
      const legacy = this.legacyVectorIndexPath();
      if (!fs.existsSync(legacy) || fs.existsSync(this.vectorIndexPath(root))) return;
      const f = JSON.parse(fs.readFileSync(legacy, "utf8")) as VectorIndexFile;
      if (f.root !== root) return;
      fs.renameSync(legacy, this.vectorIndexPath(root));
      console.info("[edge-tutor] 旧版向量索引已迁移", legacy, "→", this.vectorIndexPath(root));
    } catch (e) {
      console.warn("[edge-tutor] 向量索引迁移跳过", (e as Error).message.slice(0, 100));
    }
  }

  private async readVectorIndexFile(root: string): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("fs");
      return fs.readFileSync(this.vectorIndexPath(root), "utf8");
    } catch {
      return null;
    }
  }

  private async writeVectorIndexFile(root: string, content: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    await fs.promises.writeFile(this.vectorIndexPath(root), content);
  }

  private vectorModelsDir(): string {
    return `${this.vecPluginDir()}/models`;
  }

  /** 懒构建/加载向量索引（失败返回 null，向量层静默禁用） */
  private async ensureVectorIndex(): Promise<VectorIndex | null> {
    const root = this.settings.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    if (this.vecIndex && this.vecIndexRoot === root) return this.vecIndex;
    if (this.vecBuilding) return null; // 构建中不并发
    // 先解析实际可用的 embedder（含远程冒烟），模型 id 以实际生效者为准——
    // 远程配置但不可用时会降级本地，索引校验/落盘必须与真实生成向量的模型一致，
    // 否则会出现"远程索引 + 本地查询"的维度/空间错配。
    const active = await this.loadActiveEmbedder();
    if (!active) {
      this.updateVectorStatus("🧠 向量：不可用（embedding 模型加载失败）");
      return null;
    }
    const loaded = await this.loadVectorIndexFile(root, active.modelId);
    if (loaded) {
      this.vecIndex = loaded;
      this.vecIndexRoot = root;
      return loaded;
    }
    return this.buildVectorIndex(root, active);
  }

  private async loadVectorIndexFile(root: string, expectedModelId: string): Promise<VectorIndex | null> {
    try {
      await this.migrateLegacyVectorIndex(root); // 旧单文件 → 分文件（一次性，root 匹配才迁）
      const raw = await this.readVectorIndexFile(root);
      if (raw === null) return null;
      const f = JSON.parse(raw) as VectorIndexFile;
      if (f.version !== 1 || f.root !== root || f.model !== expectedModelId || !Array.isArray(f.chunks)) {
        return null;
      }
      this.updateVectorStatus(`🧠 向量：已加载 ${f.chunks.length} 块（${f.model}）`);
      return { chunks: f.chunks, vecs: decodeVecs(f.vecsB64, f.dim), model: f.model, root: f.root, dim: f.dim };
    } catch (e) {
      return null;
    }
  }

  /**
   * 按设置加载当前生效的 embedder：
   * - embeddingProvider=dashscope 且 key 有效 → 远程（冒烟 1 条验证，失败自动降级本地）
   * - 否则 → 本地 bge-small（transformers.js，wasm 随插件分发）
   * 返回实际 embedder + 其模型 id（降级时是 MODEL_ID，与索引校验/落盘一致）。
   */
  private async loadActiveEmbedder(): Promise<{ embedder: Embedder; modelId: string } | null> {
    if (this.settings.embeddingProvider === "dashscope" && resolveEmbeddingApiKey(this.settings)) {
      const wantKey = `${this.settings.embeddingApiBase}|${this.settings.embeddingModel || "text-embedding-v4"}|${this.settings.embeddingDim}`;
      if (!this.remoteEmbedder || this.remoteEmbedderKey !== wantKey) {
        this.remoteEmbedder = null;
        try {
          const remote = loadRemoteEmbedder({
            apiKey: resolveEmbeddingApiKey(this.settings),
            baseUrl: this.settings.embeddingApiBase,
            model: this.settings.embeddingModel || "text-embedding-v4",
            dim: this.settings.embeddingDim,
          });
          // 冒烟验证：1 条 query 请求确认 key/端点可用；失败抛错 → 降级本地
          await remote.embed(["连接测试"], { query: true });
          this.remoteEmbedder = remote;
          this.remoteEmbedderKey = wantKey;
        } catch (e) {
          console.warn("[edge-tutor] 远程 embedding 不可用，回退本地 bge-small", (e as Error).message.slice(0, 120));
          this.remoteEmbedder = null;
        }
      }
      if (this.remoteEmbedder) {
        return { embedder: this.remoteEmbedder, modelId: this.settings.embeddingModel || "text-embedding-v4" };
      }
    }
    const embedder = await loadEmbedder(this.vectorModelsDir(), `${this.vecPluginDir()}/lib`);
    if (!embedder) return null;
    return { embedder, modelId: MODEL_ID };
  }

  private async buildVectorIndex(
    root: string,
    active: { embedder: Embedder; modelId: string }
  ): Promise<VectorIndex | null> {
    this.vecBuilding = true;
    try {
      new Notice("🧠 构建教材向量索引（首次需下载模型，约几分钟，可后台进行，期间不影响使用）…");
      this.updateVectorStatus("🧠 向量：构建中（首次需下载模型）…");
      const files = this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.startsWith(root + "/") && f.name !== "toc.md");
      const chunks: SearchChunk[] = [];
      for (const f of files) {
        try {
          const text = await this.app.vault.cachedRead(f);
          chunks.push(...chunkTextbook(text, f.path));
        } catch (e) {
          // 单文件失败跳过
        }
      }
      if (chunks.length === 0) {
        this.updateVectorStatus("🧠 向量：不可用（教材目录无内容）");
        return null;
      }
      const { embedder } = active;
      const vecs: number[][] = [];
      const BATCH = 16;
      const total = chunks.length;
      for (let i = 0; i < total; i += BATCH) {
        // 文档侧编码（无 query 标记）；远程模型按批次内部再分 10 条/请求
        const part = await embedder.embed(chunks.slice(i, i + BATCH).map((c) => c.text));
        vecs.push(...part);
        if (i % 160 === 0 || i + BATCH >= total) {
          const done = Math.min(i + BATCH, total);
          console.info(`[edge-tutor] 向量索引构建 ${done}/${total}（${active.modelId}）`);
          this.updateVectorStatus(`🧠 向量：构建中 ${done}/${total}`);
        }
      }
      const index: VectorIndex = { chunks, vecs, model: active.modelId, root, dim: vecs[0]?.length ?? 0 };
      try {
        const payload: VectorIndexFile = {
          version: 1,
          root,
          model: index.model,
          chunks,
          vecsB64: encodeVecs(vecs),
          dim: index.dim,
        };
        await this.writeVectorIndexFile(root, JSON.stringify(payload));
      } catch (e) {
        console.warn("[edge-tutor] 向量索引落盘失败", (e as Error).message.slice(0, 100));
      }
      this.vecIndex = index;
      this.vecIndexRoot = root;
      this.updateVectorStatus(`🧠 向量：就绪 ${chunks.length} 块`);
      new Notice(`🧠 教材向量索引完成：${chunks.length} 块`);
      return index;
    } catch (e) {
      this.updateVectorStatus("🧠 向量：不可用（构建失败，详见 Console）");
      console.warn("[edge-tutor] 向量索引构建失败，向量检索禁用", (e as Error).message.slice(0, 120));
      return null;
    } finally {
      this.vecBuilding = false;
    }
  }

  /**
   * 向量召回 top-k（可选章节 scope；多查询变体只做召回扩充）。
   * 排序 = 原始查询（qs[0]，关键词增强原问）的相似度降序——它与用户问题最匹配；
   * 变体查询（教材语言/概念扩展）的 top-20 中不在主路里的块按相似度附加在尾部（扩充候选池，
   * 供 rerank 交叉编码器把关）。实测 max-score 合并与 RRF 融合都会让语义扩展变体的
   * "总览块幻觉"（讲次开头）挤掉原始例题查询的精确命中——变体只扩充、不参与排序。
   * 单查询时行为与旧版完全一致；任何失败返回空数组，调用方静默跳过。
   */
  private async vectorRecall(queries: string[], chapters: string[]): Promise<VectorHit[]> {
    const t0 = Date.now();
    try {
      const index = await this.ensureVectorIndex();
      if (!index || index.vecs.length === 0) return [];
      const active = await this.loadActiveEmbedder();
      if (!active) return [];
      const qs = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
      if (qs.length === 0) return [];
      // query 侧编码（query 标记 → 本地拼 BGE 前缀 / 远程加 text_type=query+instruct；批量一次调用）
      const qvs = await active.embedder.embed(qs, { query: true });
      const scopeFilter = (ranked: { idx: number; score: number }[]) => {
        if (chapters.length === 0) return ranked;
        const scoped = ranked.filter((c) => chapters.some((ch) => index.chunks[c.idx].file.includes(ch)));
        return scoped.length > 0 ? scoped : ranked; // 过滤后非空才替换
      };
      const hit = (c: { idx: number; score: number }): VectorHit => {
        const ch = index.chunks[c.idx];
        return { file: ch.file, startLine: ch.startLine, endLine: ch.endLine, text: ch.text, score: c.score };
      };
      const hits: VectorHit[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < qvs.length; i++) {
        const qv = qvs[i];
        if (!qv || qv.length === 0) continue;
        const ranked = scopeFilter(topKVectors(qv, index.vecs, 20)).slice(0, 20);
        for (const c of ranked) {
          const key = `${index.chunks[c.idx].file}:${index.chunks[c.idx].startLine}`;
          if (seen.has(key)) continue; // 主路优先，变体路去重
          seen.add(key);
          hits.push(hit(c));
        }
        if (hits.length >= 20) break; // 已满 20 停止后续变体路
      }
      const top = hits.slice(0, 20);
      console.info(`[edge-tutor] 向量召回 ${Date.now() - t0}ms ${qs.length}路 top=${top.length}`);
      return top;
    } catch (e) {
      console.warn("[edge-tutor] 向量检索失败", (e as Error).message.slice(0, 100));
      return [];
    }
  }

  /**
   * 检索 reranker 解析（降级链：远程 qwen3-rerank → 本地 bge-reranker → null=融合分排序）。
   * rerankProvider=dashscope 且有 key（复用 embeddingApiKey，环境变量优先）→ 远程 API；
   * 远程调用失败时包装层降级本地 bge（已缓存则即时）。默认 local 零行为变化。
   */
  private async loadRerankerForSearch(): Promise<Reranker | null> {
    const s = this.settings;
    const key = resolveEmbeddingApiKey(s).trim();
    if (s.rerankProvider === "dashscope" && key) {
      try {
        const baseUrl = s.rerankApiBase || DEFAULT_SETTINGS.rerankApiBase;
        const model = s.rerankModel || DEFAULT_SETTINGS.rerankModel;
        const remote = loadRemoteReranker({ apiKey: key, baseUrl, model });
        console.info(`[edge-tutor] rerank 来源：远程 ${model}（${baseUrl}）`);
        return {
          rerank: async (query, texts) => {
            try {
              return await remote.rerank(query, texts);
            } catch (e) {
              // 远程失败（网络/key/额度）→ 降级本地 bge-reranker；本地也失败则抛错
              // 给调用方 → 融合分排序
              console.warn("[edge-tutor] 远程 rerank 失败，降级本地 bge-reranker", String((e as Error)?.message ?? e).slice(0, 150));
              const local = await loadReranker(this.vectorModelsDir(), `${this.vecPluginDir()}/lib`);
              if (!local) throw e;
              return local.rerank(query, texts);
            }
          },
        };
      } catch (e) {
        console.warn("[edge-tutor] 远程 reranker 装配失败，降级本地 bge-reranker", String((e as Error)?.message ?? e).slice(0, 150));
      }
    }
    return loadReranker(this.vectorModelsDir(), `${this.vecPluginDir()}/lib`);
  }

  /** 插件内 grep 检索（降级兜底）：遍历教材 md，关键词命中返回上下文片段 */
  private async searchTextbookLocal(query: string, root: string): Promise<SearchHit> {
    const q = normalizeTextForMatch(query);
    const hits: SearchRef[] = [];
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(root + "/") || f.path === root);
    for (const f of files) {
      if (hits.length >= 3) break;
      const text = await this.app.vault.cachedRead(f);
      const lower = normalizeTextForMatch(text);
      if (!q || !lower.includes(q)) continue;
      const lines = text.split("\n");
      const idx = lower.indexOf(q);
      const startLine = text.slice(0, idx).split("\n").length;
      const snippet = lines
        .slice(Math.max(0, startLine - 2), startLine + 6)
        .join("\n")
        .trim();
      hits.push({ file: f.path, startLine, endLine: startLine + 6, text: snippet });
    }
    if (hits.length === 0) return { found: false, text: "", count: 0, refs: [] };
    const text = hits
      .map((h, i) => `【教材引用 #${i + 1}】文件：${h.file} 行：${h.startLine}${h.endLine > h.startLine ? `-${h.endLine}` : ""}\n原文：${h.text.slice(0, 300)}`)
      .join("\n\n");
    return { found: true, text: text.slice(0, 3000), count: hits.length, refs: hits };
  }
}

/** 设置页 */
class EdgeTutorSettingTab extends PluginSettingTab {
  private plugin: EdgeTutorPlugin;
  /** 教材下拉是否处于"手动输入路径"展开态（display 重绘时保持） */
  private customRootEditing = false;

  constructor(app: App, plugin: EdgeTutorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h3", { text: "🤖 执行模式（Agent）通道" });
    containerEl.createEl("p", {
      text: "对话模式走下方 Provider（反代免费号即可）；执行模式走这条通道（必须支持 function calling，如 DeepSeek 官方 API）。两条通道独立配置。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Agent 通道")
      .setDesc("opencode（本机 serve，完整 agent：bash/网络/文件全能力，轮数不受限，推荐）；openai（直连 API，自建 vault 工具循环，轮数=下方设置）。")
      .addDropdown((dropdown) => {
        dropdown.addOption("opencode", "opencode（本机 serve）");
        dropdown.addOption("openai", "OpenAI 兼容直连");
        dropdown.setValue(this.plugin.settings.agentChannel || "opencode");
        dropdown.onChange(async (v) => {
          this.plugin.settings.agentChannel = v as "opencode" | "openai";
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (this.plugin.settings.agentChannel === "opencode") {
      new Setting(containerEl)
        .setName("opencode serve 地址")
        .setDesc("需先启动：opencode serve --port 10999")
        .addText((text) =>
          text.setValue(this.plugin.settings.opencodeBase || "http://127.0.0.1:10999").onChange(async (v) => {
            this.plugin.settings.opencodeBase = v.trim() || "http://127.0.0.1:10999";
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Provider / 模型")
        .setDesc("opencode 配置中的 provider 与模型 id，如 opencode-go / deepseek-v4-flash")
        .addText((text) =>
          text.setValue(this.plugin.settings.opencodeProvider || "opencode-go").onChange(async (v) => {
            this.plugin.settings.opencodeProvider = v.trim() || "opencode-go";
            await this.plugin.saveSettings();
          })
        )
        .addText((text) =>
          text.setValue(this.plugin.settings.opencodeModel || "deepseek-v4-flash").onChange(async (v) => {
            this.plugin.settings.opencodeModel = v.trim() || "deepseek-v4-flash";
            await this.plugin.saveSettings();
          })
        );
    } else {
      new Setting(containerEl)
        .setName("Agent API 地址")
        .setDesc("OpenAI 兼容端点（需支持 tool_calls）。默认 OpenAI API；也可填入兼容服务。")
        .addText((text) =>
          text.setValue(this.plugin.settings.agentApiBase || "https://api.openai.com/v1").onChange(async (v) => {
            this.plugin.settings.agentApiBase = v.trim() || "https://api.openai.com/v1";
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Agent API Key 环境变量名")
        .setDesc("从环境变量读取密钥（优先于下面明文）。")
        .addText((text) =>
          text.setValue(this.plugin.settings.agentApiKeyEnv || "EDGE_TUTOR_AGENT_API_KEY").onChange(async (v) => {
            this.plugin.settings.agentApiKeyEnv = v.trim() || "EDGE_TUTOR_AGENT_API_KEY";
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Agent API Key（明文）")
        .setDesc("环境变量读不到时使用；仅存本地 data.json。")
        .addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("sk-...")
            .setValue(this.plugin.settings.agentApiKey || "")
            .onChange(async (v) => {
              this.plugin.settings.agentApiKey = v.trim();
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("Agent 模型")
        .setDesc("支持 function calling 的模型。")
        .addText((text) =>
          text.setValue(this.plugin.settings.agentModel || "gpt-4.1-mini").onChange(async (v) => {
            this.plugin.settings.agentModel = v.trim() || "gpt-4.1-mini";
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("最大轮数")
        .setDesc("自建工具循环的最大轮数（默认 30）。")
        .addText((text) =>
          text.setPlaceholder("30")
            .setValue(String(this.plugin.settings.agentMaxTurns ?? 30))
            .onChange(async (v) => {
              const n = parseInt(v, 10);
              this.plugin.settings.agentMaxTurns = Number.isFinite(n) && n > 0 ? n : 30;
              await this.plugin.saveSettings();
            })
        );
    }

    containerEl.createEl("h3", { text: "💬 对话（价值识别器）通道" });

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("选择 API 提供商。预设不再内置明文密钥：切换后自动填充地址与模型，密钥从环境变量 EDGE_TUTOR_KEY_<ID> 读取（见下方密钥状态），也可手动填写。")
      .addDropdown((dropdown) => {
        for (const p of PRESET_PROVIDERS) {
          dropdown.addOption(p.id, p.name);
        }
        const cur = this.plugin.settings.activeProvider || "deepseek";
        dropdown.setValue(cur);
        dropdown.onChange(async (v) => {
          const p = PRESET_PROVIDERS.find((x) => x.id === v);
          if (p) {
            this.plugin.settings.activeProvider = p.id;
            this.plugin.settings.apiBase = p.apiBase;
            this.plugin.settings.apiKey = p.apiKey;
            // 默认选该 provider 的第一个模型
            this.plugin.settings.model = p.models[0] || this.plugin.settings.model;
            await this.plugin.saveSettings();
            this.display(); // 刷新设置页（模型下拉跟着变）
          }
        });
      });

    new Setting(containerEl)
      .setName("模型")
      .setDesc("当前 Provider 的可用模型。")
      .addDropdown((dropdown) => {
        const provider = PRESET_PROVIDERS.find((p) => p.id === this.plugin.settings.activeProvider);
        const models = provider?.models?.length ? provider.models : [this.plugin.settings.model];
        const all = new Set([...models, this.plugin.settings.model]);
        for (const m of all) {
          dropdown.addOption(m, m);
        }
        dropdown.setValue(this.plugin.settings.model);
        dropdown.onChange(async (v) => {
          this.plugin.settings.model = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("API 地址")
      .setDesc("OpenAI 兼容端点（切换 Provider 自动填充，可手动改）")
      .addText((text) =>
        text.setValue(this.plugin.settings.apiBase).onChange(async (v) => {
          this.plugin.settings.apiBase = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("当前 Provider 的密钥（仅存本地 data.json）。预设不内置明文 key；也可从环境变量 EDGE_TUTOR_KEY_<ID> 读取。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim();
            await this.plugin.saveSettings();
          });
      });

    (() => {
      const activeProvider =
        PRESET_PROVIDERS.find((p) => p.id === this.plugin.settings.activeProvider) ??
        PRESET_PROVIDERS[0];
      const keySource = (() => {
        if (this.plugin.settings.apiKey && this.plugin.settings.apiKey.trim()) {
          return "🔑 设置中的显式密钥（data.json）";
        }
        if (activeProvider.keyEnv && readEnv(activeProvider.keyEnv)) {
          return "🌍 环境变量 " + activeProvider.keyEnv;
        }
        const g = this.plugin.settings.apiKeyEnv || "EDGE_TUTOR_API_KEY";
        if (readEnv(g)) {
          return "🌍 全局环境变量 " + g;
        }
        return "⚠️ 未配置密钥";
      })();

      new Setting(containerEl)
        .setName("密钥状态")
        .setDesc(
          "当前 Provider（" +
            activeProvider.name +
            "）：" +
            keySource +
            "。环境变量为空的 Provider，切换后需在本机设置对应环境变量或在上方手动填写。",
        )
        .addButton((btn) =>
          btn.setButtonText("测试连接").onClick(async () => {
            btn.setButtonText("测试中…");
            btn.setDisabled(true);
            const ctrl = new AbortController();
            const timer = window.setTimeout(() => ctrl.abort(), 15000);
            try {
              await chatCompletion(
                this.plugin.settings,
                [{ role: "user", content: "ping" }],
                { maxTokens: 4, signal: ctrl.signal },
              );
              new Notice("✅ 连接成功：" + activeProvider.name);
            } catch (e) {
              new Notice(
                "❌ 连接失败：" + (e instanceof Error ? e.message.slice(0, 200) : String(e)),
                8000,
              );
            } finally {
              window.clearTimeout(timer);
              btn.setButtonText("测试连接");
              btn.setDisabled(false);
            }
          }),
        );
    })();

    new Setting(containerEl)
      .setName("回答长度（max_tokens）")
      .setDesc("回答最大 token 数。越大回答越长（默认 4096）。")
      .addText((text) =>
        text.setPlaceholder("4096")
          .setValue(String(this.plugin.settings.maxTokens ?? 4096))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.maxTokens = Number.isFinite(n) && n > 0 ? n : 4096;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("发散度（temperature）")
      .setDesc("0-2，越高回答越发散、越有创造性（默认 0.8）。")
      .addText((text) =>
        text.setPlaceholder("0.8")
          .setValue(String(this.plugin.settings.temperature ?? 0.8))
          .onChange(async (v) => {
            const n = parseFloat(v);
            this.plugin.settings.temperature = Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : 0.8;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("认知节点目录")
      .setDesc("vault 内相对路径，认知节点和地图放这里（学习产物归位：_wiki/ 下）")
      .addText((text) =>
        text.setValue(this.plugin.settings.nodeFolder).onChange(async (v) => {
          this.plugin.settings.nodeFolder = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("教材根目录")
      .setDesc("多教材支持：下拉从 books.yaml 注册表读取，切换后检索/锚点/索引自动跟随。选“✏️ 手动输入路径…”可填任意自定义路径（不写回注册表）。")
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
        const known = new Set<string>();
        for (const b of this.plugin.textbookRegistry) {
          if (!b.root) continue;
          known.add(b.root);
          dropdown.addOption(b.root, b.name);
        }
        if (current && !known.has(current)) {
          dropdown.addOption(current, `📌 当前路径（未注册）：${current.slice(-40)}`);
        }
        dropdown.addOption(CUSTOM_ROOT, "✏️ 手动输入路径…");
        dropdown.setValue(known.has(current) ? current : current || CUSTOM_ROOT);
        dropdown.onChange(async (v) => {
          if (v === CUSTOM_ROOT) {
            this.customRootEditing = true;
            this.display(); // 展开手动输入框
            return;
          }
          this.customRootEditing = false;
          await this.plugin.setTextbookRoot(v);
        });
      });
    if (this.customRootEditing) {
      new Setting(containerEl)
        .setName("自定义教材根目录")
        .setDesc("vault 内相对路径（不会写回 books.yaml 注册表）")
        .addText((text) =>
          text.setValue(this.plugin.settings.textbookRoot).onChange(async (v) => {
            if (v.trim()) await this.plugin.setTextbookRoot(v);
          })
        );
    }
    // 注册表首读兜底：onload 预热可能未完成/失败，设置页打开时补读一次后重绘下拉
    if (this.plugin.textbookRegistry.length === 0) {
      void this.plugin.refreshTextbookRegistry().then(() => {
        if (this.plugin.textbookRegistry.length > 0) this.display();
      });
    }

    containerEl.createEl("h3", { text: "🔍 教材向量检索（embedding）" });
    new Setting(containerEl)
      .setName("向量模型来源")
      .setDesc("本地 bge-small-zh（默认，离线可用）；阿里百炼 text-embedding-v4（中文检索最强档，API 批处理构建更快，教材内容将发送至阿里云；新用户 100 万 tokens 免费额度内即可完成全量构建）。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", "本地 bge-small-zh（离线）")
          .addOption("dashscope", "阿里百炼 text-embedding-v4（推荐）")
          .setValue(this.plugin.settings.embeddingProvider)
          .onChange(async (v) => {
            this.plugin.settings.embeddingProvider = v as "local" | "dashscope";
            await this.plugin.saveSettings();
            this.display(); // 刷新设置页（远程配置项随开关显隐）
          })
      );

    if (this.plugin.settings.embeddingProvider === "dashscope") {
      new Setting(containerEl)
        .setName("Embedding API Key")
        .setDesc("阿里云百炼密钥（留空自动回退本地 bge-small；环境变量 EDGE_TUTOR_EMBEDDING_API_KEY 优先）。")
        .addText((text) => {
          text.setValue(this.plugin.settings.embeddingApiKey);
          text.inputEl.type = "password";
          text.onChange(async (v) => {
            this.plugin.settings.embeddingApiKey = v.trim();
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("API 地址（base URL）")
        .setDesc("OpenAI 兼容端点（不含 /embeddings）。默认阿里官方公共域名；专属工作区填 https://ws-xxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
        .addText((text) =>
          text.setValue(this.plugin.settings.embeddingApiBase).onChange(async (v) => {
            this.plugin.settings.embeddingApiBase = v.trim();
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("模型")
        .setDesc("text-embedding-v4（最新，Qwen3-Embedding 系列）/ text-embedding-v3。切换后索引自动失效，下次检索时重建。")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("text-embedding-v4", "text-embedding-v4（推荐）")
            .addOption("text-embedding-v3", "text-embedding-v3")
            .setValue(this.plugin.settings.embeddingModel)
            .onChange(async (v) => {
              this.plugin.settings.embeddingModel = v;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("向量维度")
        .setDesc("text-embedding-v4 支持 2048/1536/1024/768/512/256/128/64；维度越高存储越大，1024 为质量/体积平衡推荐值。")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("2048", "2048")
            .addOption("1536", "1536")
            .addOption("1024", "1024（推荐）")
            .addOption("768", "768")
            .addOption("512", "512")
            .setValue(String(this.plugin.settings.embeddingDim))
            .onChange(async (v) => {
              this.plugin.settings.embeddingDim = parseInt(v, 10);
              await this.plugin.saveSettings();
            })
        );
    }

    containerEl.createEl("h3", { text: "🎯 检索重排（rerank）" });
    new Setting(containerEl)
      .setName("重排模型来源")
      .setDesc("本地 bge-reranker-v2-m3（默认，离线可用）；阿里百炼 qwen3-rerank（Qwen3-Reranker-8B，重排质量最高档，教材段落将发送至阿里云，¥0.5/百万 tokens，每次提问仅对 top-40 候选打分，用量极小）。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", "本地 bge-reranker（离线）")
          .addOption("dashscope", "阿里百炼 qwen3-rerank（推荐）")
          .setValue(this.plugin.settings.rerankProvider)
          .onChange(async (v) => {
            this.plugin.settings.rerankProvider = v as "local" | "dashscope";
            await this.plugin.saveSettings();
            this.display(); // 刷新设置页（远程配置项随开关显隐）
          })
      );

    if (this.plugin.settings.rerankProvider === "dashscope") {
      new Setting(containerEl)
        .setName("API 地址（base URL）")
        .setDesc("OpenAI 兼容端点（不含 /reranks；注意是 compatible-api 路径，与 embedding 的 compatible-mode 不同）。默认阿里官方公共域名；专属工作区填 https://ws-xxx.cn-beijing.maas.aliyuncs.com/compatible-api/v1")
        .addText((text) =>
          text.setValue(this.plugin.settings.rerankApiBase).onChange(async (v) => {
            this.plugin.settings.rerankApiBase = v.trim();
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("模型")
        .setDesc("qwen3-rerank（Qwen3-Reranker-8B，OpenAI 兼容 reranks 端点）。")
        .addText((text) =>
          text.setValue(this.plugin.settings.rerankModel).onChange(async (v) => {
            this.plugin.settings.rerankModel = v.trim();
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("API Key")
        .setDesc("复用上方 Embedding API Key（同一百炼账号；环境变量 EDGE_TUTOR_EMBEDDING_API_KEY 优先）。")
        .addText((text) => {
          text.setValue(this.plugin.settings.embeddingApiKey);
          text.inputEl.type = "password";
          text.setPlaceholder("复用 Embedding API Key，无需重复填写");
          text.onChange(async (v) => {
            this.plugin.settings.embeddingApiKey = v.trim();
            await this.plugin.saveSettings();
          });
        });
    }
  }
}
