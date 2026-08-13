/**
 * 认知地图数据层（L4）—— 统一读写认知节点文件
 *
 * 单一数据源（SSOT）：
 *   - 每个认知节点 = 一个 .md 文件（frontmatter 是机器可读状态）
 *   - 线程树 = 从节点文件按 parent 关系重建
 *   - 工作区 = 节点目录下的一级子文件夹（main = 节点目录根）
 *   - 另有一个只读补充源：_wiki/concepts/ 下的概念活页（真实学习产物，只读展示）
 */

import { App, TFile, TFolder } from "obsidian";
import { CognitiveNode, parseNodeFromContent } from "./tutor";

/** 一个可供地图/面板展示的线程源节点（含来源标记） */
export interface ThreadNode {
  title: string;
  content: string;
  parentTitle?: string;
  status: "active" | "paused";
  anchor: { sourcePath: string; quote: string };
  rootQuestion?: string;
  summary?: string;
  /** 来源：writable=可写节点目录 / readonly=只读补充源 */
  source: "writable" | "readonly";
}

export interface ReadOnlySource {
  name: string;
  path: string;
}

/** 默认只读补充源（_wiki 下符合归位合同的跨学科概念活页） */
export const DEFAULT_READONLY_SOURCES: ReadOnlySource[] = [
  { name: "概念活页", path: "learning/peizhi/learn/_wiki/concepts" },
];

/** 递归展开文件夹下的 .md 文件 */
async function collectMdFiles(app: App, folder: TFolder, acc: TFile[]): Promise<void> {
  for (const child of folder.children) {
    if (child instanceof TFile && child.name.endsWith(".md")) {
      acc.push(child);
    } else if (child instanceof TFolder) {
      await collectMdFiles(app, child, acc);
    }
  }
}

/**
 * 列出某个工作区的认知节点（线程源）。
 * writable：节点目录下的 .md（递归，排除 MOC 与隐藏文件）。
 */
export async function listNodes(
  app: App,
  workspacePath: string,
  excludeName?: string
): Promise<CognitiveNode[]> {
  const folder = app.vault.getAbstractFileByPath(workspacePath);
  const nodes: CognitiveNode[] = [];
  if (!(folder instanceof TFolder)) return nodes;
  const files: TFile[] = [];
  await collectMdFiles(app, folder, files);
  for (const f of files) {
    if (excludeName && f.name === excludeName) continue;
    if (f.name.startsWith(".")) continue;
    if (f.name === "认知边缘地图.md") continue;
    const content = await app.vault.cachedRead(f);
    const node = parseNodeFromContent(f.basename, content, f.path);
    node.filePath = f.path;
    nodes.push(node);
  }
  return nodes;
}

/** 列出只读补充源的节点（concepts 等） */
export async function listReadonlyNodes(
  app: App,
  sources: ReadOnlySource[]
): Promise<ThreadNode[]> {
  const out: ThreadNode[] = [];
  for (const s of sources) {
    const folder = app.vault.getAbstractFileByPath(s.path);
    if (!(folder instanceof TFolder)) continue;
    const files: TFile[] = [];
    await collectMdFiles(app, folder, files);
    for (const f of files) {
      if (f.name.startsWith(".")) continue;
      const content = await app.vault.cachedRead(f);
      const node = parseNodeFromContent(f.basename, content, f.path);
      out.push({
        title: node.title,
        content,
        parentTitle: node.parentTitle,
        status: node.status,
        anchor: node.anchor,
        rootQuestion: node.rootQuestion,
        summary: node.summary,
        source: "readonly",
      });
    }
  }
  return out;
}

/** 认知地图摘要（供 AI 方向指引参考） */
export async function buildMapSummary(
  app: App,
  workspacePath: string,
  nodes: CognitiveNode[]
): Promise<{ total: number; nodeTitles: string[]; activeNodes: string[] }> {
  void app;
  return {
    total: nodes.length,
    nodeTitles: nodes.map((n) => n.title),
    activeNodes: nodes.filter((n) => n.status === "active").map((n) => n.title),
  };
}

/** 工作区 → 节点目录路径 */
export function workspaceFolderPath(nodeFolder: string, workspace: string): string {
  return workspace && workspace !== "main" ? `${nodeFolder}/${workspace}` : nodeFolder;
}

/** 某个工作区的 conv 文件路径 */
export function convPath(nodeFolder: string, workspace: string): string {
  return `${workspaceFolderPath(nodeFolder, workspace)}/.conv.json`;
}

/** 节点文件路径（冲突自动加序号） */
export function uniqueNodePath(
  app: App,
  folder: string,
  title: string
): string {
  let path = `${folder}/${title}.md`;
  let i = 2;
  while (app.vault.getAbstractFileByPath(path) instanceof TFile) {
    path = `${folder}/${title}-${i}.md`;
    i++;
  }
  return path;
}
