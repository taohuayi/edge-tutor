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
import { DEFAULT_SETTINGS, TutorSettings, PRESET_PROVIDERS } from "./ai";
import { buildMocContent, buildNodeContent, CognitiveNode } from "./tutor";
import { CognitiveMapSummary } from "./guide";
import { Conv, freshConv, parseConv, serializeConv } from "./conv";
import { formatConvMarkdown, parseJSONBackup } from "./export";
import {
  listNodes,
  buildMapSummary,
  workspaceFolderPath,
  convPath,
  uniqueNodePath,
} from "./data";

import { PromptModal, TutorView, VIEW_TYPE_TUTOR } from "./view";

export default class EdgeTutorPlugin extends Plugin {
  settings: TutorSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    await this.runMigration();

    this.registerView(VIEW_TYPE_TUTOR, (leaf: WorkspaceLeaf) => new TutorView(leaf, this));

    this.addCommand({
      id: "open-tutor-panel",
      name: "🧭 打开认知边缘导师面板",
      callback: () => { this.activateView(); },
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

  /** 发现所有工作区（节点目录一级子文件夹） */
  async discoverWorkspaces(): Promise<string[]> {
    const root = this.app.vault.getAbstractFileByPath(this.settings.nodeFolder);
    const ws: string[] = ["main"];
    if (root instanceof TFolder) {
      for (const child of root.children) {
        if (child instanceof TFolder) ws.push(child.name);
      }
    }
    return ws;
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

  /** 更新认知地图 MOC（按工作区） */
  async updateMoc(workspace?: string) {
    const ws = workspace ?? this.currentWorkspace();
    const folder = this.workspaceFolderPathOf(ws);
    await this.ensureFolder(folder);
    const mocPath = `${folder}/认知边缘地图.md`;
    const nodes = await listNodes(this.app, folder);
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

  /** 新建工作区（子文件夹） */
  async createWorkspace(name: string): Promise<void> {
    const clean = name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
    if (!clean) return;
    await this.ensureFolder(this.workspaceFolderPathOf(clean));
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
    if (format === "markdown") {
      const md = formatConvMarkdown(conv, {
        title: `认知边缘会话导出（${ws === "main" ? "默认" : ws}）`,
        source: "张宇基础30讲",
        workspace: ws,
      });
      const path = `${exportFolder}/认知边缘导出_${ws}_${stamp}.md`;
      await this.writeUnique(exportFolder, path, md);
      new Notice("📤 Markdown 笔记已导出：" + path);
    } else {
      // JSON：完整会话（v4），可无损还原线程+消息+停车场
      const json = serializeConv(conv);
      const path = `${exportFolder}/认知边缘备份_${ws}_${stamp}.json`;
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
