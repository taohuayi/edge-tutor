/**
 * 会话（conv）数据模型 —— 对齐 Zotero paper-reading-flow
 *
 * 架构（用户确认：内存会话为主，节点 md 为镜像）：
 *   - .conv.json 存完整会话（threads + messages + reading）＝ 运行态真源
 *   - 节点 .md 文件 = 沉淀镜像（saveConversation 时从会话同步导出）
 *   - 消息带 lineId（归属线程），支持按视图过滤
 */

import { CognitiveNode, ParkedQuestion, extractMentorResponse, makeNodeTitle } from "./tutor";

/** 会话消息（Zotero: messages[]，带 lineId 归属线程） */
export interface ConvMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 归属线程 id（Zotero lineId） */
  lineId?: string;
  /** 来源锚点（教材位置） */
  anchor?: string;
  /** 原始 AI 输出（编辑前） */
  verbatimContent?: string;
  /** 执行模式（agent）消息（对话/导引消息无此字段） */
  agent?: boolean;
  ts: number;
}

/** 思维链线程（Zotero: reading.threads[]） */
export interface ConvThread {
  id: string;
  title: string;
  rootQuestion: string;
  parentId: string | null;
  anchor: { sourcePath?: string; quote?: string } | null;
  summary: string;
  status: "active" | "paused";
  /** 触发问题的原文摘录（保留自提问时刻） */
  originExcerpt?: string;
  /** 最近一次追问（Zotero lastQuestion） */
  lastQuestion?: string;
  /** 掌握深度：已掌握 / 进行中 / 刚接触（用于方向导引跳过已掌握的） */
  mastery?: "mastered" | "exploring" | "fresh";
  /** 本线程沉淀的节点文件路径（幂等键：重复沉淀/重新生成时原位更新，不按标题查重） */
  nodeFile?: string;
  createdAt: string;
  updatedAt: string;
}

/** 完整会话（Zotero: conv） */
export interface Conv {
  workspace: string;
  messages: ConvMessage[];
  reading: {
    mode: "deep" | "quick";
    sequence: number;
    activeId: string | null;
    threads: ConvThread[];
    parkingLot: ParkedQuestion[];
  };
}

/** 创建空会话 */
export function freshConv(workspace: string): Conv {
  return {
    workspace,
    messages: [],
    reading: {
      mode: "deep",
      sequence: 0,
      activeId: null,
      threads: [],
      parkingLot: [],
    },
  };
}

/** 序列化（JSON 备份格式，含版本） */
export function serializeConv(conv: Conv): string {
  return JSON.stringify(
    {
      version: 5,
      kind: "edge-tutor-conv",
      workspace: conv.workspace,
      messages: conv.messages,
      reading: conv.reading,
    },
    null,
    2
  );
}

/** 反序列化（容错，兼容 v1-v4） */
export function parseConv(text: string): Conv | null {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return null;
    if (!Array.isArray(data.messages)) return null;
    const messages = data.messages.filter((m: ConvMessage) => m && typeof m.content === "string");

    // v1/v2/v4：reading.threads 存在；v3：reading 不存在，parkingLot 在顶层
    const reading = data.reading && typeof data.reading === "object" ? data.reading : {};
    const parking = Array.isArray(reading.parkingLot)
      ? reading.parkingLot
      : Array.isArray(data.parkingLot)
        ? data.parkingLot
        : [];

    const conv: Conv = {
      workspace: data.workspace || "main",
      messages,
      reading: {
        mode: reading.mode === "quick" ? "quick" : "deep",
        sequence: reading.sequence ?? 0,
        activeId: reading.activeId ?? null,
        threads: Array.isArray(reading.threads)
          ? reading.threads.filter((t: ConvThread) => t && t.id && (t.title || t.rootQuestion))
          : [],
        parkingLot: parking.filter((p: ParkedQuestion) => p && typeof p.question === "string"),
      },
    };
    return conv;
  } catch (e) {
    return null;
  }
}

/** 生成线程 id（q1, q2, ...） */
export function nextThreadId(conv: Conv): string {
  conv.reading.sequence += 1;
  return "q" + conv.reading.sequence;
}

/** 添加线程 */
export function addThread(
  conv: Conv,
  input: {
    question: string;
    parentId?: string | null;
    anchor?: { sourcePath?: string; quote?: string } | null;
    originExcerpt?: string;
  }
): ConvThread {
  const id = nextThreadId(conv);
  const thread: ConvThread = {
    id,
    title: input.question,
    rootQuestion: input.question,
    parentId: input.parentId ?? null,
    anchor: input.anchor ?? null,
    summary: "",
    status: "active",
    originExcerpt: input.originExcerpt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  conv.reading.threads.push(thread);
  conv.reading.activeId = id;
  return thread;
}

/** 找线程的祖先链（从当前到根） */
export function ancestry(conv: Conv, id: string | null): ConvThread[] {
  const byId = new Map(conv.reading.threads.map((t) => [t.id, t]));
  const chain: ConvThread[] = [];
  let cur = id;
  const guard = new Set<string>();
  while (cur && byId.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    const t = byId.get(cur)!;
    chain.unshift(t);
    cur = t.parentId;
  }
  return chain;
}

/** 获取活跃线程 */
export function activeThread(conv: Conv): ConvThread | null {
  if (!conv.reading.activeId) return null;
  return conv.reading.threads.find((t) => t.id === conv.reading.activeId) ?? null;
}

/** 线程的子孙（直接子） */
export function childrenOf(conv: Conv, id: string): ConvThread[] {
  return conv.reading.threads.filter((t) => t.parentId === id);
}

/** 有序线程（BFS：根在前，深度优先展开）—— 用于导出/大纲 */
export function orderedThreads(conv: Conv): ConvThread[] {
  const out: ConvThread[] = [];
  const byParent = new Map<string | null, ConvThread[]>();
  for (const t of conv.reading.threads) {
    const p = t.parentId;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(t);
  }
  const queue: (ConvThread | null)[] = [null];
  const seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    const kids = byParent.get(cur ? cur.id : null) ?? [];
    for (const k of kids) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k);
      queue.push(k);
    }
  }
  // 兜底：孤儿/环节点
  for (const t of conv.reading.threads) {
    if (!seen.has(t.id)) out.push(t);
  }
  return out;
}

/** 是否祖先关系（isDescendant 反向：a 是否 b 的祖先） */
export function isDescendant(conv: Conv, ancestorId: string, descendantId: string): boolean {
  const byId = new Map(conv.reading.threads.map((t) => [t.id, t]));
  let cur = byId.get(descendantId)?.parentId ?? null;
  const guard = new Set<string>();
  while (cur && byId.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    if (cur === ancestorId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

/** 重新挂父（拖拽重组）：把 threadId 挂到 newParentId 下；null = 回主干 */
export function reparentThread(conv: Conv, threadId: string, newParentId: string | null): boolean {
  const t = conv.reading.threads.find((x) => x.id === threadId);
  if (!t) return false;
  if (newParentId === threadId) return false;
  if (newParentId && isDescendant(conv, threadId, newParentId)) return false; // 不能挂到自己子孙下
  t.parentId = newParentId;
  t.updatedAt = new Date().toISOString();
  return true;
}

/** 切换活跃线程 */
export function switchThread(conv: Conv, id: string): boolean {
  if (!conv.reading.threads.some((t) => t.id === id)) return false;
  conv.reading.activeId = id;
  return true;
}

/** 暂停活跃线程（回主干） */
export function pauseActive(conv: Conv): void {
  const t = activeThread(conv);
  if (t) t.status = "paused";
  conv.reading.activeId = null;
}

/** 追加消息（带线程归属） */
export function pushMessage(
  conv: Conv,
  role: "user" | "assistant",
  content: string,
  opts: { anchor?: string; lineId?: string; agent?: boolean } = {}
): ConvMessage {
  const msg: ConvMessage = {
    // 加随机后缀：同毫秒连发（重建/粘贴批量 push）时 Date.now 基串会撞 id
    id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    role,
    content,
    anchor: opts.anchor,
    lineId: opts.lineId,
    agent: opts.agent,
    ts: Date.now(),
  };
  conv.messages.push(msg);
  return msg;
}

/** 删除一条消息（按引用匹配；返回是否找到并删除） */
export function removeMessage(conv: Conv, msg: ConvMessage): boolean {
  const idx = conv.messages.indexOf(msg);
  if (idx < 0) return false;
  conv.messages.splice(idx, 1);
  return true;
}

/**
 * 从节点列表构建会话（纯函数）：
 * 节点 .md 是单一数据源，会话为空时（清屏/迁移）用它恢复线程树与消息。
 * 节点按传入顺序编号 q1..qN；parentTitle 映射为 parentId；无 rootQuestion 的节点仍生成一条 user 消息（用标题）。
 *
 * parentTitle 三级匹配（防清屏断链，父结点被改名/agent 命名/旧数据原文引用时都能接上）：
 *   ① 精确：文件 basename（现行逻辑，覆盖绝大多数）
 *   ② 清洗：makeNodeTitle(n.rootQuestion || n.title) —— 覆盖父结点被 ✏️ 改名 / agent 命名
 *   ③ 原文：n.rootQuestion === parentTitle —— 兼容旧数据（旧 parentTitle 存的是父线程原始问题）
 * 全部失败才作根。
 */
export function buildConvFromNodes(nodes: CognitiveNode[], workspace: string): Conv {
  const conv = freshConv(workspace);
  const idByTitle = new Map<string, string>();
  const idByCleaned = new Map<string, string>();
  const idByRootQuestion = new Map<string, string>();
  // id 按节点顺序分配；同名节点不再互相覆盖（旧实现 idByTitle 后者覆盖前者，
  // 重名线程会共享同一 id → ancestry/childrenOf/activeThread 全乱）
  const ids = nodes.map((_, i) => "q" + (i + 1));
  nodes.forEach((n, i) => {
    if (!idByTitle.has(n.title)) idByTitle.set(n.title, ids[i]);
    const cleaned = makeNodeTitle(n.rootQuestion || n.title);
    if (cleaned && !idByCleaned.has(cleaned)) idByCleaned.set(cleaned, ids[i]);
    if (n.rootQuestion && !idByRootQuestion.has(n.rootQuestion)) idByRootQuestion.set(n.rootQuestion, ids[i]);
  });

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const id = ids[i];
    const parentId = n.parentTitle
      ? (idByTitle.get(n.parentTitle) ?? idByCleaned.get(n.parentTitle) ?? idByRootQuestion.get(n.parentTitle) ?? null)
      : null;
    const thread = addThread(conv, {
      question: n.rootQuestion || n.title,
      parentId,
      anchor: n.anchor,
      originExcerpt: n.originExcerpt,
    });
    // 覆写 addThread 默认值（节点是权威源）
    thread.id = id;
    thread.title = n.title;
    thread.rootQuestion = n.rootQuestion || n.title;
    thread.summary = n.summary || "";
    thread.status = n.status;
    thread.nodeFile = n.filePath;
    // 原文摘录/创建时间/掌握深度随 frontmatter 恢复（清屏重建不再丢「由原文引出」与状态）
    if (n.originExcerpt) thread.originExcerpt = n.originExcerpt;
    if (n.created) {
      const d = new Date(n.created);
      if (!Number.isNaN(d.getTime())) thread.createdAt = d.toISOString();
    }
    // 封顶标记持久化在节点 frontmatter → 重建时恢复
    if (n.locked || n.mastery === "mastered") thread.mastery = "mastered";
    else if (n.mastery) thread.mastery = n.mastery;
    pushMessage(conv, "user", n.rootQuestion || n.title, { lineId: id });
    const fullResponse = extractMentorResponse(n.content);
    if (fullResponse) pushMessage(conv, "assistant", fullResponse, { lineId: id });
    else if (n.summary) pushMessage(conv, "assistant", n.summary, { lineId: id });
  }
  conv.reading.activeId = conv.reading.threads[0]?.id ?? null;
  return conv;
}

/**
 * 解析子节点的 parentTitle（write 侧，沉淀时用）。
 * 候选按优先级：① 父线程已沉淀文件的 basename（最精确）→ ② 父线程当前标题（改名场景）
 * → ③ 规范清洗标题 makeNodeTitle(父 rootQuestion)（确定性，父结点未沉淀时未来可被接上）。
 * 返回命中"当前工作区已有节点文件标题"集合的第一个候选；全不命中默认返回 ③ 规范值。
 */
export function resolveParentTitle(
  parent: ConvThread | null | undefined,
  existingTitles: ReadonlySet<string>
): string | undefined {
  if (!parent) return undefined;
  const normalized = makeNodeTitle(parent.rootQuestion || parent.title);
  const candidates: (string | undefined)[] = [
    parent.nodeFile ? parent.nodeFile.split("/").pop()!.replace(/\.md$/, "") : undefined,
    parent.title,
    normalized,
  ];
  for (const c of candidates) {
    if (c && existingTitles.has(c)) return c;
  }
  return normalized || undefined;
}

/** 回答收尾（Zotero finishAnswer）：更新线程理解沉淀 + 最近追问 */
export function finishAnswer(conv: Conv, message: ConvMessage, question?: string): ConvThread | null {
  const lineId = message.lineId;
  const thread = (lineId && conv.reading.threads.find((t) => t.id === lineId)) || activeThread(conv);
  if (!thread) return null;
  thread.summary = String(message.content ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  thread.updatedAt = new Date().toISOString();
  if (question) thread.lastQuestion = question;
  return thread;
}

/** 收集线程子树（含自身） */
export function collectSubtree(conv: Conv, id: string): ConvThread[] {
  const out: ConvThread[] = [];
  const stack: ConvThread[] = [];
  const root = conv.reading.threads.find((t) => t.id === id);
  if (!root) return out;
  stack.push(root);
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const k of childrenOf(conv, cur.id)) stack.push(k);
  }
  return out;
}

/** 删除线程及其分支（消息保留在对话中） */
export function removeThread(conv: Conv, id: string): void {
  const subtree = collectSubtree(conv, id);
  const remove = new Set(subtree.map((t) => t.id));
  conv.reading.threads = conv.reading.threads.filter((t) => !remove.has(t.id));
  if (conv.reading.activeId && remove.has(conv.reading.activeId)) {
    conv.reading.activeId = conv.reading.threads.length ? conv.reading.threads[0].id : null;
  }
}

/** 消息归属的线程 id（Zotero messageLineId） */
export function messageLineId(msg: ConvMessage): string | null {
  return msg.lineId ?? null;
}

/** 分支祖先链描述（Zotero branchContext）—— 给 AI 的分支定位 */
export function branchContext(conv: Conv, id: string | null): string {
  const path = ancestry(conv, id);
  if (!path.length) return "";
  return path.map((thread, index) => {
    let line = (index ? "分支" : "根") + "：" + (thread.rootQuestion || thread.title);
    if (thread.originExcerpt) line += "\n由这段原文引出：" + thread.originExcerpt;
    if (thread.summary) line += "\n断点摘要：" + thread.summary;
    return line;
  }).join("\n\n");
}

/** 封顶标签（mastery：节点存在即已到达；mastered 表示用户主动暂停深化此链） */
export function masteryLabel(m?: "mastered" | "exploring" | "fresh"): string {
  if (m === "mastered") return "封顶";
  if (m === "exploring") return "进行中";
  return "刚接触";
}

/**
 * 认知地图摘要（结构化：缩进树 + 摘要 + 状态/封顶标记，供方向导引）。
 * 节点是路标不是终点 —— 导引看到的是链的结构与深度，而非"已掌握需回避"的名单。
 */
export function cognitiveMapSummary(conv: Conv): {
  locked: string[];
  active: string | null;
  activeAnchorPath: string | null;
  summaryText: string;
} {
  const threads = conv.reading.threads;
  const byParent = new Map<string | null, ConvThread[]>();
  for (const t of threads) {
    const key = t.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  const locked: string[] = [];
  const lines: string[] = [];

  const lineOf = (t: ConvThread): string => {
    const marks: string[] = [];
    if (t.mastery === "mastered") {
      marks.push("🔒 封顶");
      locked.push(t.title || t.rootQuestion || t.id);
    } else if (t.status === "paused") {
      marks.push("⏸️ 暂停");
    }
    const summary = t.summary ? `（摘要：${t.summary.replace(/\s+/g, " ").trim().slice(0, 80)}）` : "";
    return `${t.title || t.rootQuestion || t.id}${marks.length ? ` [${marks.join(" ")}]` : ""}${summary}`;
  };

  const walk = (parentKey: string | null, depth: number) => {
    const kids = byParent.get(parentKey) ?? [];
    for (const kid of kids) {
      lines.push(`${"  ".repeat(depth)}${depth === 0 ? "" : "└─ "}${lineOf(kid)}`);
      walk(kid.id, depth + 1);
    }
  };
  walk(null, 0);
  // 兜底：无父关系的孤立线程
  const placed = new Set<string>();
  byParent.forEach((kids) => kids.forEach((k) => placed.add(k.id)));
  for (const t of threads) {
    if (!placed.has(t.id) && t.parentId) {
      lines.push(`  └─ ${lineOf(t)}`);
    }
  }

  const active = activeThread(conv);
  return {
    locked: [...new Set(locked)],
    active: active ? (active.title || active.rootQuestion) : null,
    activeAnchorPath: active?.anchor?.sourcePath ?? null,
    summaryText: lines.length ? lines.join("\n") : "（尚无认知节点，全新探索）",
  };
}

/** 分支回复指令（Zotero responseInstruction）—— 告诉 AI 继续还是新开 */
export function responseInstruction(isFollowup: boolean): string {
  const base =
    "阅读模式：持续深度对话。请展示真实的探索过程，而不只是打磨后的最终结论。" +
    "回应反对意见，发展具体变体，连接更深的背景——但始终用清晰、说人话的中文，结构分明，不要堆砌含混术语。" +
    "保持这个分支与思维树中其他兄弟分支概念上分离。";
  return isFollowup
    ? base + " 请从这个分支已有的上下文和未解决问题继续。"
    : base + " 这是一个新分支；只把提供的祖先链当作定位参考。";
}

/** 分支语境 + 回复指令（合体，供 respond 注入 AI 用户消息）。branchId 缺省取当前活跃线程（重新生成时传被重生成的线程）。 */
export function branchInstruction(conv: Conv, isFollowup: boolean, branchId?: string | null): string {
  const parts: string[] = [];
  parts.push("---\n" + responseInstruction(isFollowup));
  const ctx = branchContext(conv, branchId ?? conv.reading.activeId);
  if (ctx) parts.push("[思维树祖先链（仅作定位，请待在活跃分支内）]\n" + ctx);
  return parts.join("\n\n");
}

/** 视图模式过滤消息（Zotero messagesForView） */
export function messagesForView(conv: Conv, mode: "path" | "all" | "node"): ConvMessage[] {
  if (mode === "all") return conv.messages.slice();
  if (mode === "path") {
    const ids = new Set(ancestry(conv, conv.reading.activeId).map((t) => t.id));
    return conv.messages.filter((m) => !!m.lineId && ids.has(m.lineId));
  }
  if (!conv.reading.activeId) return [];
  return conv.messages.filter((m) => m.lineId === conv.reading.activeId);
}

/** 搜索命中（Zotero SearchHit） */
export interface SearchHit {
  lineId: string | null;
  messageIndex: number;
  role: string;
  excerpt: string;
  field: string;
}

function compactLine(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 命中摘要（词周围 ±40 字符） */
function excerptAround(value: string, query: string): string {
  const v = String(value ?? "");
  const q = String(query ?? "").trim();
  const idx = v.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return v.slice(0, 60);
  const start = Math.max(0, idx - 40);
  const end = Math.min(v.length, idx + q.length + 40);
  return (start > 0 ? "…" : "") + v.slice(start, end) + (end < v.length ? "…" : "");
}

/** 会话搜索（Zotero searchConversation）：搜线程标题/原文摘录/消息内容 */
export function searchConversation(conv: Conv, query: string): SearchHit[] {
  const needle = compactLine(query);
  if (!conv || !needle) return [];
  const results: SearchHit[] = [];

  conv.reading.threads.forEach((thread) => {
    const titleNeedle = compactLine(thread.title || thread.rootQuestion);
    if (titleNeedle.includes(needle)) {
      results.push({
        lineId: thread.id,
        messageIndex: -1,
        role: "线程",
        excerpt: thread.title || thread.rootQuestion,
        field: "thread.title",
      });
    }
    if (thread.originExcerpt && compactLine(thread.originExcerpt).includes(needle)) {
      results.push({
        lineId: thread.id,
        messageIndex: -1,
        role: "原文",
        excerpt: excerptAround(thread.originExcerpt, needle),
        field: "thread.originExcerpt",
      });
    }
  });

  conv.messages.forEach((message, index) => {
    if (!message) return;
    const content = String(message.content ?? "");
    if (compactLine(content).includes(needle)) {
      results.push({
        lineId: messageLineId(message),
        messageIndex: index,
        role: message.role === "assistant" ? "回答" : "追问",
        excerpt: excerptAround(content, needle),
        field: "content",
      });
    }
    if (message.verbatimContent && compactLine(message.verbatimContent).includes(needle)) {
      results.push({
        lineId: messageLineId(message),
        messageIndex: index,
        role: "原文",
        excerpt: excerptAround(message.verbatimContent, needle),
        field: "verbatimContent",
      });
    }
  });

  return results;
}
