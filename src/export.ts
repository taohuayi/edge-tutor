/**
 * 认知节点会话的导入 / 导出 —— 纯函数（无 obsidian API 依赖，可单测）
 *
 * 对标 Zotero PRF 的会话导出：
 *   - Markdown 笔记：标题 + 元数据（来源/导出时间/工作区）+ 每个节点分节
 *   - JSON 备份：版本 + 工作区 + 节点全字段（可完整还原）
 *
 * 三个函数：
 *   formatConversationMarkdown(nodes, opts) → string   Zotero PRF 风格中文 markdown
 *   toJSONBackup(nodes, meta)               → string   序列化 JSON 备份
 *   parseJSONBackup(text)                   → { nodes, meta }  容错解析（失败返回空数组）
 */

import { CognitiveNode, AnchorRef } from "./tutor";

/** 导出用节点视图：在 CognitiveNode 之上补充导师回应/追问原文（均可选） */
export interface ExportNode extends CognitiveNode {
  /** 追问原文（若未单独存储，回退到 rootQuestion / title） */
  question?: string;
  /** 导师回应正文（AI 价值识别回答） */
  mentorResponse?: string;
}

/** Markdown 导出选项 */
export interface ExportMarkdownOptions {
  /** 笔记标题（默认「认知边缘会话导出」） */
  title?: string;
  /** 来源（教材名 / 全书标识，可选） */
  source?: string;
  /** 工作区名（默认 main） */
  workspace?: string;
  /** 导出时间（默认当前时间；传入可保证可测试性） */
  exportedAt?: Date;
  /** 引用截断长度（默认 200） */
  quoteMaxLen?: number;
}

/** JSON 备份元数据 */
export interface BackupMeta {
  /** 工作区名 */
  workspace?: string;
  /** 来源标识 */
  source?: string;
  /** 备份时间（ISO 字符串，缺省用当前时间） */
  exportedAt?: string;
  /** 额外自定义字段 */
  [key: string]: unknown;
}

/** 备份结构版本 */
export const BACKUP_VERSION = 1;

/** 解析结果 */
export interface ParsedBackup {
  nodes: ExportNode[];
  meta: BackupMeta;
  /** 是否解析成功（失败时 nodes 为空、error 有值） */
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 状态图标（对齐 tutor.ts / canvas 约定） */
function statusIcon(status?: string): string {
  return status === "active" ? "🟢 追根中" : "⏸️ 已暂停";
}

/** 安全截断 + 省略号 */
function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** 单行化引用（去掉换行避免破坏 blockquote） */
function inlineQuote(quote: string, max: number): string {
  const flat = (quote || "").replace(/\r?\n+/g, " ").trim();
  return truncate(flat, max);
}

/** PDF 页锚点：用 sourcePath + quote（+ blockId 若有）拼成可跳转链接 */
function anchorLink(anchor: AnchorRef | undefined): string {
  if (!anchor || !anchor.sourcePath) return "（无锚点）";
  const blockSuffix = anchor.blockId ? `#^${anchor.blockId}` : "";
  return `[[${anchor.sourcePath}${blockSuffix}]]`;
}

// ---------------------------------------------------------------------------
// (1a) formatConvMarkdown —— 从会话导出树形大纲（对齐 Zotero formatConversationMarkdown）
// ---------------------------------------------------------------------------

import { Conv, ConvThread, ConvMessage, ancestry, orderedThreads, messageLineId } from "./conv";

/** 从会话导出完整思维链 Markdown（树形大纲 + 每条线程消息 + 未归属消息 + 停车场） */
export function formatConvMarkdown(
  conv: Conv,
  metadata: {
    title?: string;
    source?: string;
    workspace?: string;
    exportedAt?: Date;
  } = {}
): string {
  const title = metadata.title || "对话笔记";
  const source = metadata.source || "";
  const workspace = metadata.workspace || "main";
  const when = metadata.exportedAt instanceof Date ? metadata.exportedAt : new Date();
  const exportedAt = when.toISOString().replace("T", " ").slice(0, 19);

  const parts: string[] = [];
  parts.push(`# ${title}`);
  parts.push("");
  if (source) parts.push(`- **来源**：${source}`);
  parts.push(`- **工作区**：${workspace === "main" ? "默认" : workspace}`);
  parts.push(`- **导出时间**：${exportedAt}`);
  parts.push("");

  const threads = orderedThreads(conv);
  parts.push("## 思维链总览");
  parts.push("");
  if (!threads.length) {
    parts.push("暂无思维节点。");
  } else {
    for (const t of threads) parts.push(outlineLine(conv, t));
  }
  parts.push("");

  const assigned: Record<number, boolean> = {};
  threads.forEach((thread, index) => {
    appendThread(parts, conv, thread, index + 1);
    conv.messages.forEach((m, mi) => {
      if (m && messageLineId(m) === thread.id) assigned[mi] = true;
    });
  });

  appendUnassignedMessages(parts, conv, assigned);
  appendParkingLot(parts, conv);

  return parts.join("\n");
}

function treeDepth(conv: Conv, thread: ConvThread): number {
  return Math.max(0, ancestry(conv, thread.id).length - 1);
}

function outlineLine(conv: Conv, thread: ConvThread): string {
  const depth = treeDepth(conv, thread);
  const indent = "  ".repeat(depth);
  return `${indent}- [${thread.id}] ${thread.title || thread.rootQuestion || "未命名节点"}`;
}

function messageLabel(message: ConvMessage, counters: { user: number; assistant: number; other: number }): string {
  if (message.role === "user") {
    counters.user += 1;
    return "问题 " + counters.user;
  }
  if (message.role === "assistant") {
    counters.assistant += 1;
    return "回答 " + counters.assistant;
  }
  counters.other += 1;
  return "消息 " + counters.other;
}

function appendMessage(parts: string[], message: ConvMessage, counters: { user: number; assistant: number; other: number }): void {
  const label = messageLabel(message, counters);
  parts.push(`**${label}**`);
  parts.push("");
  parts.push(String(message.content ?? ""));
  parts.push("");
  if (message.verbatimContent && message.verbatimContent !== message.content) {
    parts.push(`**${label}的逐字原文**`);
    parts.push("");
    parts.push(String(message.verbatimContent));
    parts.push("");
  }
}

function appendThread(parts: string[], conv: Conv, thread: ConvThread, ordinal: number): void {
  const depth = treeDepth(conv, thread);
  const title = thread.title || thread.rootQuestion || "未命名思维节点";
  parts.push(`${"#".repeat(Math.min(6, depth + 2))} ${ordinal}. ${title}`);
  parts.push("");
  parts.push(`- **节点**：${thread.id}`);
  if (thread.status) parts.push(`- **状态**：${thread.status}`);
  if (thread.anchor?.sourcePath) parts.push(`- **教材**：${thread.anchor.sourcePath}`);
  if (thread.anchor?.quote) parts.push(`- **锚定**：${thread.anchor.quote.slice(0, 120)}`);
  parts.push("");
  if (thread.originExcerpt) {
    parts.push("**由上一段文字引出**");
    parts.push("");
    parts.push(markdownQuote(thread.originExcerpt));
    parts.push("");
  }
  const counters = { user: 0, assistant: 0, other: 0 };
  const messages = conv.messages.filter((m) => messageLineId(m) === thread.id);
  if (!messages.length && thread.rootQuestion) {
    parts.push("**节点问题**");
    parts.push("");
    parts.push(String(thread.rootQuestion));
    parts.push("");
  } else {
    messages.forEach((m) => appendMessage(parts, m, counters));
  }
}

function appendUnassignedMessages(parts: string[], conv: Conv, assigned: Record<number, boolean>): void {
  const unassigned = conv.messages.filter((_, index) => !assigned[index]);
  if (!unassigned.length) return;
  parts.push("## 未归入思维节点的消息");
  parts.push("");
  const counters = { user: 0, assistant: 0, other: 0 };
  unassigned.forEach((m) => appendMessage(parts, m, counters));
}

function appendParkingLot(parts: string[], conv: Conv): void {
  const parked = conv.reading.parkingLot || [];
  parts.push("## 问题停车场");
  parts.push("");
  if (!parked.length) {
    parts.push("暂无。");
    parts.push("");
    return;
  }
  parked.forEach((item, index) => {
    const kind = item.category === "branch" ? "分支" : "稍后";
    parts.push(`### ${index + 1}. ${kind}`);
    parts.push("");
    if (item.parentId) parts.push(`- **父节点**：${item.parentId}`);
    if (item.anchor) parts.push(`- **锚点**：${item.anchor}`);
    if (item.parentId || item.anchor) parts.push("");
    parts.push(String(item.question));
    parts.push("");
  });
}

function markdownQuote(value: string): string {
  return String(value ?? "").split(/\r?\n/).map((l) => "> " + l).join("\n");
}

// ---------------------------------------------------------------------------
// (1) formatConversationMarkdown
// ---------------------------------------------------------------------------

/**
 * 把认知节点列表格式化为 Zotero PRF 风格的中文 markdown 笔记。
 * 结构：标题行 + 元数据（来源/导出时间/工作区）+ 每个节点分节。
 */
export function formatConversationMarkdown(
  nodes: ExportNode[],
  opts: ExportMarkdownOptions = {},
): string {
  const list = Array.isArray(nodes) ? nodes : [];
  const title = opts.title || "认知边缘会话导出";
  const source = opts.source || "（未指定）";
  const workspace = opts.workspace || "main";
  const when = opts.exportedAt instanceof Date ? opts.exportedAt : new Date();
  const quoteMax = typeof opts.quoteMaxLen === "number" ? opts.quoteMaxLen : 200;
  const exportedAt = when.toISOString().replace("T", " ").slice(0, 19);

  const lines: string[] = [];
  // 标题行
  lines.push(`# ${title}`);
  lines.push("");
  // 元数据块
  lines.push(`- **来源**：${source}`);
  lines.push(`- **导出时间**：${exportedAt}`);
  lines.push(`- **工作区**：${workspace}`);
  lines.push(`- **节点数**：${list.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (list.length === 0) {
    lines.push("> （本次会话没有认知节点）");
    lines.push("");
    return lines.join("\n");
  }

  list.forEach((node, i) => {
    const idx = i + 1;
    const heading = node.title || `节点 ${idx}`;
    lines.push(`## ${idx}. ${heading}`);
    lines.push("");

    // 节点问题
    const question =
      node.question || node.rootQuestion || node.title || "（无记录）";
    lines.push(`**节点问题**：${question}`);
    lines.push("");

    // 状态
    lines.push(`**状态**：${statusIcon(node.status)}`);
    lines.push("");

    // PDF 页锚点（sourcePath + quote）
    lines.push("**PDF 页锚点**：");
    lines.push(`> 来源：${anchorLink(node.anchor)}`);
    if (node.anchor && node.anchor.quote) {
      lines.push(`> ${inlineQuote(node.anchor.quote, quoteMax)}`);
    }
    lines.push("");

    // 摘要（理解沉淀）
    if (node.summary) {
      lines.push(`**理解沉淀**：${node.summary}`);
      lines.push("");
    }

    // 导师回应
    lines.push("**导师回应（价值识别）**：");
    lines.push("");
    lines.push(node.mentorResponse ? node.mentorResponse : "（无回应）");
    lines.push("");

    // 父节点链接
    lines.push(
      `**父节点**：${node.parentTitle ? `[[${node.parentTitle}]]` : "（根节点）"}`,
    );
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// (2) toJSONBackup
// ---------------------------------------------------------------------------

/**
 * 把节点序列化为 JSON 备份（含版本、工作区、节点全字段）。
 * 结果为格式化的 JSON 字符串，可完整还原节点。
 */
export function toJSONBackup(
  nodes: ExportNode[],
  meta: BackupMeta = {},
): string {
  const list = Array.isArray(nodes) ? nodes : [];
  const payload = {
    version: BACKUP_VERSION,
    kind: "edge-tutor-backup",
    meta: {
      workspace: meta.workspace || "main",
      source: meta.source,
      exportedAt: meta.exportedAt || new Date().toISOString(),
      ...meta,
    },
    count: list.length,
    // 节点全字段（显式拷贝，保证结构稳定 + 顺序确定）
    nodes: list.map((n) => ({
      title: n.title,
      content: n.content,
      parentTitle: n.parentTitle,
      anchor: n.anchor
        ? {
            sourcePath: n.anchor.sourcePath,
            quote: n.anchor.quote,
            blockId: n.anchor.blockId,
          }
        : undefined,
      status: n.status,
      rootQuestion: n.rootQuestion,
      summary: n.summary,
      question: n.question,
      mentorResponse: n.mentorResponse,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// (3) parseJSONBackup
// ---------------------------------------------------------------------------

/**
 * 解析 JSON 备份并容错。
 * - 解析失败（非法 JSON / 结构不符）返回空 nodes，不抛错。
 * - 尽量从任意合理结构中抢救出节点数组。
 */
export function parseJSONBackup(text: string): ParsedBackup {
  const empty: ParsedBackup = { nodes: [], meta: {}, ok: false };
  if (typeof text !== "string" || !text.trim()) {
    return { ...empty, error: "空输入" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ...empty, error: "JSON 解析失败：" + (e instanceof Error ? e.message : String(e)) };
  }

  if (!raw || typeof raw !== "object") {
    return { ...empty, error: "顶层不是对象" };
  }

  const obj = raw as Record<string, unknown>;

  // 定位节点数组：优先 obj.nodes，其次 obj 本身是数组
  let rawNodes: unknown[] = [];
  if (Array.isArray(obj.nodes)) {
    rawNodes = obj.nodes as unknown[];
  } else if (Array.isArray(raw)) {
    rawNodes = raw as unknown[];
  }

  const nodes: ExportNode[] = [];
  for (const item of rawNodes) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const anchorSrc =
      it.anchor && typeof it.anchor === "object"
        ? (it.anchor as Record<string, unknown>)
        : {};
    const anchor: AnchorRef = {
      sourcePath: typeof anchorSrc.sourcePath === "string" ? anchorSrc.sourcePath : "",
      quote: typeof anchorSrc.quote === "string" ? anchorSrc.quote : "",
      blockId: typeof anchorSrc.blockId === "string" ? anchorSrc.blockId : undefined,
    };
    const status = it.status === "active" || it.status === "paused" ? it.status : "paused";
    nodes.push({
      title: typeof it.title === "string" ? it.title : "",
      content: typeof it.content === "string" ? it.content : "",
      parentTitle: typeof it.parentTitle === "string" ? it.parentTitle : undefined,
      anchor,
      status: status as "active" | "paused",
      rootQuestion: typeof it.rootQuestion === "string" ? it.rootQuestion : undefined,
      summary: typeof it.summary === "string" ? it.summary : undefined,
      question: typeof it.question === "string" ? it.question : undefined,
      mentorResponse: typeof it.mentorResponse === "string" ? it.mentorResponse : undefined,
    });
  }

  const metaSrc =
    obj.meta && typeof obj.meta === "object"
      ? (obj.meta as Record<string, unknown>)
      : {};
  const meta: BackupMeta = { ...metaSrc };

  return { nodes, meta, ok: true };
}
