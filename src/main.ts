/**
 * 认知边缘导师（Edge Tutor）插件入口 —— 重写版
 *
 * 架构（对齐 docs/认知边缘驱动学习系统_骨架设计.md）：
 *   L1 交互界面 → 面板 ItemView（view.ts）+ 命令/设置（本文件）
 *   L2 追根陪练 → ai.ts + guide.ts
 *   L3 入口生成 → guide.ts（基于全书推荐）
 *   L4 认知地图 → data.ts（单一数据源：节点 .md 文件）
 *
 * 关键修复（对比旧版）：
 *   - 不再维护两套消息/两棵树：节点文件是线程的唯一真源
 *   - currentWorkspace() 不再写死 "main"，导出/沉淀基于真实工作区
 *   - 首次启动做旧 .conv.json 迁移（一次性，导入后标记）
 */
import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, TutorSettings, PRESET_PROVIDERS, agentConfig } from "./ai";
import { buildVaultExecutor, AgentStep, AgentResult, runAgent } from "./agent";
import { runOpenCodeTask, OpenCodeConfig, OpenCodeResult } from "./opencode";
import { buildMocContent, buildNodeContent, CognitiveNode, parseNodeFromContent } from "./tutor";
import { parseSearchResult, normalizeQuery, SearchRef, SearchHit, parseChapterIndex } from "./search";
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

import { PromptModal, TutorView, VIEW_TYPE_TUTOR } from "./view";
import { AgentConv, AgentView, freshAgentConv, VIEW_TYPE_AGENT } from "./agentview";

export default class EdgeTutorPlugin extends Plugin {
  settings: TutorSettings = DEFAULT_SETTINGS;

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

    this.addSettingTab(new EdgeTutorSettingTab(this.app, this));
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TUTOR);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
              title: t.title,
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

  /** 特殊目录：不作为工作区/教材容器（concepts/t-maps/images 是资源与跨教材活页） */
  private static readonly SPECIAL_FOLDERS = new Set(["concepts", "t-maps", "images"]);

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

  /** 创建认知节点笔记（冲突自动加序号） */
  async createNode(node: CognitiveNode): Promise<TFile> {
    const ws = node.workspace ?? this.currentWorkspace();
    const folder = this.workspaceFolderPathOf(ws);
    await this.ensureFolder(folder);
    const path = uniqueNodePath(this.app, folder, node.title);
    const content = node.content || buildNodeContent(node);
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

  /** 重命名工作区（移动文件夹） */
  async renameWorkspace(oldName: string, newName: string): Promise<void> {
    const oldPath = this.workspaceFolderPathOf(oldName);
    const newPath = this.workspaceFolderPathOf(newName);
    const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
    if (oldFolder instanceof TFolder) {
      try {
        await this.app.vault.rename(oldFolder, newPath);
      } catch (e) {
        new Notice("重命名失败：" + (e as Error).message.slice(0, 80));
      }
    }
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

    // 1. 收集线程标题（用于定位节点文件）后删除线程与消息
    const titles: string[] = [];
    const threads = conv.reading.threads.filter((t) => ids.has(t.id));
    for (const t of threads) {
      titles.push(t.title || t.rootQuestion || "");
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

    // 4. 删除节点文件（按标题匹配，进回收站）
    const folder = this.workspaceFolderPathOf(workspace);
    for (const title of titles) {
      if (!title) continue;
      const f = this.app.vault.getAbstractFileByPath(`${folder}/${title}.md`);
      if (f instanceof TFile) {
        try {
          await this.app.vault.trash(f, true);
        } catch (e) {
          console.warn("[edge-tutor] 节点文件删除失败", title, e);
        }
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
    const exportFolder = "learning/peizhi/learn/_wiki/认知边缘/_exports";
    await this.ensureFolder(exportFolder);
    const stamp = new Date().toISOString().slice(0, 10);
    // 工作区名可能含教材前缀（如 张宇基础30讲/函数的变化）→ 文件名里 / 替换为 _
    const safeWs = ws.replace(/[/\\]/g, "_");
    if (format === "markdown") {
      const md = formatConvMarkdown(conv, {
        title: `认知边缘会话导出（${ws === "main" ? "默认" : ws}）`,
        source: "张宇基础30讲",
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

  /** 保存执行面板记录 */
  async saveAgentConv(conv: AgentConv): Promise<void> {
    const path = this.agentConvPath();
    try {
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
      nodes.push(parseNodeFromContent(f.basename, content, f.path));
    }
    return buildConvFromNodes(nodes, ws);
  }

  /**
   * 设置节点封顶标记（🔒）：同步写入节点 frontmatter（持久化，重建会话时恢复）。
   * 节点文件不存在时仅返回 false（不强制）。
   */
  async setNodeLocked(workspace: string, title: string, locked: boolean): Promise<boolean> {
    const folder = this.workspaceFolderPathOf(workspace);
    const f = this.app.vault.getAbstractFileByPath(`${folder}/${title}.md`);
    if (!(f instanceof TFile)) return false;
    try {
      const content = await this.app.vault.read(f);
      const hasLocked = /^locked:\s*true/m.test(content);
      if (hasLocked === locked) return true;
      let next: string;
      if (locked) {
        // 在 frontmatter 结尾（--- 前）插入
        next = content.replace(/^---\n([\s\S]*?)\n---/, (_m, body: string) => `---\n${body}${body.trimEnd().endsWith("\n") ? "" : "\n"}locked: true\n---`);
      } else {
        next = content.replace(/^locked:\s*true\n/m, "");
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
          provider: s.opencodeProvider || "deepseek",
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
  /** 章节地图缓存（toc.md → 讲次标题列表） */
  private chapterIndex: { file: string; title: string }[] | null = null;

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

  async semanticTextbookSearch(query: string): Promise<SearchHit> {
    const s = this.settings;
    const root = s.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const rawQ = String(query ?? "").trim().slice(0, 200);
    if (!rawQ) return { found: false, text: "", count: 0, refs: [] };

    // L0：会话级缓存（query 归一化）
    const qKey = normalizeQuery(rawQ);
    if (qKey) {
      const cached = this.searchCache.get(qKey);
      if (cached) {
        // LRU 刷新
        this.searchCache.delete(qKey);
        this.searchCache.set(qKey, cached);
        return cached.hit;
      }
    }

    let hit: SearchHit = { found: false, text: "", count: 0, refs: [] };

    // 1. opencode 全量语义检索（50s 超时：语义定位 + 行号需多轮读文件，实测 15-45s）
    if (s.agentChannel === "opencode") {
      try {
        const chapters = await this.getChapterIndex();
        const chapterMap =
          chapters.length > 0
            ? chapters.map((c) => `- ${c.file}：${c.title}`).join("\n")
            : "（无法读取章节地图，请自行浏览目录）";
        const instruction = [
          `在教材目录 "${root}" 下查找与「${rawQ}」最相关的教材原文，定位到具体的行。`,
          "",
          "【章节地图】（教材讲次结构，用于判断去哪里找）",
          chapterMap,
          "",
          "要求：",
          "1. 先根据章节地图判断最相关的 1-2 个讲次 → 用 read/grep 在该文件中定位原文。",
          "2. 若目标讲次中没有，再检查相邻讲次；仍找不到就只输出：未找到",
          "3. 输出格式（严格遵守，只输出 1-3 处，每处一个块）：",
          "【文件】vault 相对路径（不含行号）",
          "【行号】起行-止行",
          "【原文】该区间原文，150-300 字，保留原表述",
        ].join("\n");
        const result = await runOpenCodeTask(
          {
            base: s.opencodeBase || "http://127.0.0.1:10999",
            provider: s.opencodeProvider || "deepseek",
            model: s.opencodeModel || "deepseek-v4-flash",
          } as OpenCodeConfig,
          instruction,
          { maxWaitMs: 50_000 }
        );
        hit = parseSearchResult(result.answer);
      } catch (e) {
        console.warn("[edge-tutor] opencode 检索失败，降级 grep", (e as Error).message.slice(0, 120));
        hit = { found: false, text: "", count: 0, refs: [] };
      }
    }

    // 2. 降级/兜底：本地 grep（文本定位）
    if (!hit.found) {
      hit = await this.searchTextbookLocal(rawQ, root);
    }

    // 缓存（无论是否命中，防重复检索）
    if (qKey) {
      if (this.searchCache.size >= 10) {
        const oldest = this.searchCache.keys().next().value;
        if (oldest !== undefined) this.searchCache.delete(oldest);
      }
      this.searchCache.set(qKey, { hit, ts: Date.now() });
    }
    return hit;
  }

  /** 插件内 grep 检索（降级兜底）：遍历教材 md，关键词命中返回上下文片段 */
  private async searchTextbookLocal(query: string, root: string): Promise<SearchHit> {
    const q = normalizeQuery(query).toLowerCase();
    const hits: SearchRef[] = [];
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(root + "/") || f.path === root);
    for (const f of files) {
      if (hits.length >= 3) break;
      const text = await this.app.vault.cachedRead(f);
      const lower = text.toLowerCase();
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
        .setDesc("opencode 配置中的 provider 与模型 id，如 deepseek / deepseek-v4-flash")
        .addText((text) =>
          text.setValue(this.plugin.settings.opencodeProvider || "deepseek").onChange(async (v) => {
            this.plugin.settings.opencodeProvider = v.trim() || "deepseek";
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
        .setDesc("OpenAI 兼容端点（需支持 tool_calls）。")
        .addText((text) =>
          text.setValue(this.plugin.settings.agentApiBase || "https://api.deepseek.com/v1").onChange(async (v) => {
            this.plugin.settings.agentApiBase = v.trim() || "https://api.deepseek.com/v1";
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Agent API Key 环境变量名")
        .setDesc("从环境变量读取密钥（优先于下面明文）。")
        .addText((text) =>
          text.setValue(this.plugin.settings.agentApiKeyEnv || "DEEPSEEK_API_KEY").onChange(async (v) => {
            this.plugin.settings.agentApiKeyEnv = v.trim() || "DEEPSEEK_API_KEY";
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
        .setDesc("支持 function calling 的模型（默认 deepseek-chat）。")
        .addText((text) =>
          text.setValue(this.plugin.settings.agentModel || "deepseek-chat").onChange(async (v) => {
            this.plugin.settings.agentModel = v.trim() || "deepseek-chat";
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
      .setDesc("选择 API 提供商（预设：DeepSeek 官方 / Tokeness-Claude / Tokeness-GPT / Zhuomatech）。切换后自动填充地址、密钥与模型。")
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
      .setDesc("当前 Provider 的密钥（切换 Provider 自动填充，可手动改；仅存本地 data.json）")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim();
            await this.plugin.saveSettings();
          });
      });

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
      .setDesc("教材 md 所在目录（用于锚点定位）")
      .addText((text) =>
        text.setValue(this.plugin.settings.textbookRoot).onChange(async (v) => {
          this.plugin.settings.textbookRoot = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
