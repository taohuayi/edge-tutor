/**
 * 认知节点模型 + 构建 —— 纯函数（无 obsidian API 依赖）
 *
 * 单一数据源（SSOT）决策：
 *   每个认知节点 = 一个 .md 文件（frontmatter: status/anchor/parent/summary）
 *   线程树 = 从节点文件按 parent 关系重建，不再维护第二份 .conv.json 树。
 */

export interface AnchorRef {
  sourcePath: string;
  quote: string;
  blockId?: string;
}

export interface CognitiveNode {
  title: string;
  content: string;
  parentTitle?: string;
  anchor: AnchorRef;
  status: "active" | "paused";
  rootQuestion?: string;
  summary?: string;
  /** 完整回答正文（导师回应区写入源；不写时回落到 summary 截断） */
  response?: string;
  /** 结点文件路径（read 侧注入 / write 侧 createNode 回填，供线程 nodeFile 幂等恢复） */
  filePath?: string;
  /** 此链封顶（🔒）：导引不深化此链。持久化在节点 frontmatter，重建会话时恢复 */
  locked?: boolean;
  /** 掌握深度（mastered=封顶同义；exploring/fresh 也持久化，重建不丢） */
  mastery?: "mastered" | "exploring" | "fresh";
  /** 触发问题的原文摘录（持久化，重建后「由上一段文字引出」不丢） */
  originExcerpt?: string;
  /** 节点创建日期（YYYY-MM-DD，重建时恢复线程 createdAt） */
  created?: string;
  /** 写入目标工作区（可空，默认当前工作区） */
  workspace?: string;
}

/**
 * 从问题生成安全的节点文件名（Obsidian 文件名规则）。
 * 标题 = 问题原文清洗版：只替换 Windows 非法文件名字符与换行，保留全角标点（？：，等），上限 maxLen。
 * 不剥疑问词、不截断——保证"每问一个结点"语义下不同问题天然不同名。
 */
export function makeNodeTitle(question: string, maxLen = 50): string {
  const clean = String(question ?? "")
    .replace(/[\r\n\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, maxLen);
  if (!clean) return "认知节点_" + Date.now().toString(36);
  return clean;
}

/** 生成认知节点笔记内容（frontmatter 是唯一机器可读状态） */
export function buildNodeContent(node: CognitiveNode): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: 认知节点");
  lines.push("status: " + node.status);
  lines.push("created: " + new Date().toISOString().slice(0, 10));
  // 引文/路径里的 ASCII 双引号会打断 YAML 值（此前 anchor 未转义）→ 统一转单引号
  lines.push('anchor: "' + node.anchor.quote.slice(0, 80).replace(/"/g, "'") + '"');
  if (node.anchor.sourcePath) lines.push('anchorPath: "' + node.anchor.sourcePath.replace(/"/g, "'") + '"');
  if (node.parentTitle) lines.push('parent: "[[' + node.parentTitle + ']]"');
  if (node.summary) lines.push('summary: "' + node.summary.replace(/"/g, "'").slice(0, 120) + '"');
  if (node.originExcerpt) lines.push('originExcerpt: "' + node.originExcerpt.replace(/"/g, "'").replace(/\r?\n/g, " ").slice(0, 200) + '"');
  if (node.mastery && node.mastery !== "fresh") lines.push("mastery: " + node.mastery);
  if (node.locked) lines.push("locked: true");
  lines.push("---");
  lines.push("");
  lines.push("# " + node.title);
  lines.push("");
  lines.push("## 📖 教材锚点");
  lines.push("");
  if (node.anchor.sourcePath) {
    const blockSuffix = node.anchor.blockId ? `#^${node.anchor.blockId}` : "";
    lines.push(`> 来源：[[${node.anchor.sourcePath}${blockSuffix}]]`);
  }
  if (node.anchor.quote) {
    lines.push(`> ${node.anchor.quote.slice(0, 120)}${node.anchor.quote.length > 120 ? "…" : ""}`);
  }
  lines.push("");
  lines.push("## 🔍 追问");
  lines.push("");
  lines.push(node.rootQuestion ? node.rootQuestion.slice(0, 500) : "（这里是你的问题）");
  lines.push("");
  lines.push("## 💡 导师回应（价值识别）");
  lines.push("");
  lines.push(node.response ?? node.summary ?? "（AI 回答将在此展开 —— 珍贵/细节判断 + 推深方向）");
  lines.push("");
  lines.push("## 🔗 原理链");
  lines.push("");
  lines.push("- 父节点：" + (node.parentTitle ? `[[${node.parentTitle}]]` : "（无）"));
  lines.push("- 子节点：（待追根）");
  lines.push("");
  return lines.join("\n");
}

/** 提取导师回应区完整正文（不截断，供重建会话/复制分支使用）。在模板区（🔗/📖/🔍）前截断；正文内部的 Markdown 标题、--- 分隔线均不影响。 */
export function extractMentorResponse(content: string): string {
  if (!content) return "";
  const m = content.match(/## 💡 导师回应[^\n]*\n([\s\S]*?)(?=\n## 🔗 原理链|\n## 📖 教材锚点|\n## 🔍 追问|$)/);
  return m?.[1]?.trim() ?? "";
}

/** 从节点文件内容解析元数据（容错） */
export function parseNodeFromContent(title: string, content: string, sourcePath: string): CognitiveNode {
  const status = content.includes("status: paused") ? "paused" : "active";
  const parentMatch = content.match(/parent:\s*"\[\[([^\]]+)\]\]"/);
  const anchorMatch = content.match(/^anchor:\s*"([^"]*)"/m);
  const summaryMatch = content.match(/^summary:\s*"([^"]*)"/m);
  const anchorPathMatch = content.match(/^anchorPath:\s*"([^"]*)"/m);
  const lockedMatch = content.match(/^locked:\s*true/m);
  const masteryMatch = content.match(/^mastery:\s*(mastered|exploring|fresh)/m);
  const originExcerptMatch = content.match(/^originExcerpt:\s*"([^"]*)"/m);
  const createdMatch = content.match(/^created:\s*"?(\d{4}-\d{2}-\d{2})"?/m);

  // 追问区（## 🔍 追问 之后，到下一个 ## 之前）；占位符/空内容不视为真实问题（防误捕获）
  let rootQuestion: string | undefined;
  const qMatch = content.match(/## 🔍 追问\s*\n([\s\S]*?)\n## /);
  if (qMatch?.[1]) {
    const q = qMatch[1].trim();
    if (q && q !== "（这里是你的问题）") rootQuestion = q.slice(0, 300);
  }

  // 导师回应区：优先完整提取（模板区前截断，正文内部标题不截断）
  let summary: string | undefined;
  const full = extractMentorResponse(content);
  if (full) summary = full.slice(0, 300);

  const mastery = masteryMatch?.[1] as "mastered" | "exploring" | "fresh" | undefined;
  return {
    title,
    content,
    parentTitle: parentMatch?.[1] ?? undefined,
    anchor: {
      sourcePath: anchorPathMatch?.[1] ?? sourcePath,
      quote: anchorMatch?.[1] ?? "",
    },
    status: status as "active" | "paused",
    rootQuestion,
    summary: summaryMatch?.[1] ?? summary,
    // locked 真源是 locked 行；mastery: mastered 视为封顶（setNodeLocked 双写，老数据兼容）
    locked: !!lockedMatch || mastery === "mastered",
    mastery,
    originExcerpt: originExcerptMatch?.[1] || undefined,
    created: createdMatch?.[1] || undefined,
  };
}

/** 生成认知地图 MOC 内容 */
export function buildMocContent(nodes: CognitiveNode[]): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: 认知地图");
  lines.push("updated: " + new Date().toISOString().slice(0, 10));
  lines.push("---");
  lines.push("");
  lines.push("# 🗺️ 认知边缘地图");
  lines.push("");
  lines.push("> 原理链总览：每条链 = 从教材例题追根到抽象原理的轨迹");
  lines.push("");
  for (const n of nodes) {
    const statusIcon = n.status === "active" ? "🟢" : "⏸️";
    lines.push(`- ${statusIcon} [[${n.title}]] — ${n.anchor.quote.slice(0, 40)}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** ===== 问题停车场（Zotero PRF 移植） ===== */

export interface ParkedQuestion {
  id: string;
  question: string;
  category: "branch" | "later";
  parentId: string | null;
  anchor: string | null;
  createdAt: string;
}

export function parkQuestion(
  question: string,
  opts: { category?: "branch" | "later"; parentId?: string | null; anchor?: string | null } = {},
): ParkedQuestion | null {
  const text = String(question || "").trim();
  if (!text) return null;
  return {
    id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    question: text,
    category: opts.category === "branch" ? "branch" : "later",
    parentId: opts.parentId ?? null,
    anchor: opts.anchor ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function takeParked(list: ParkedQuestion[], id: string): { list: ParkedQuestion[]; item: ParkedQuestion | null } {
  const index = list.findIndex((it) => it.id === id);
  if (index < 0) return { list, item: null };
  const item = list[index];
  return { list: list.filter((_, i) => i !== index), item };
}

export function removeParked(list: ParkedQuestion[], id: string): ParkedQuestion[] {
  return list.filter((it) => it.id !== id);
}

export function renderParkingLot(list: ParkedQuestion[]): string {
  if (list.length === 0) return "（停车场为空）";
  const lines: string[] = ["## 问题停车场", ""];
  for (const it of list) {
    const cat = it.category === "branch" ? "分支" : "稍后";
    const anchor = it.anchor ? `（${it.anchor.slice(0, 40)}）` : "";
    lines.push(`- [${cat}] ${it.question} ${anchor}`);
  }
  return lines.join("\n");
}
