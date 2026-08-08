/**
 * 方向指引（入口生成）—— 发现值得深入的认知探针
 * 设计：寻找张力、连接、反常与边界，不规划能力路线
 *   - 输入：教材总目录 + 认知地图（已追过的根）+ 用户当前状态
 *   - 输出：2-4 个值得继续追的问题入口（不空降、不线性、绝不拉回）
 */

import { ChatMessage, TutorSettings, buildSystemPrompt, chatCompletion } from "./ai";

/** 认知地图摘要（供 AI 参考） */
export interface CognitiveMapSummary {
  /** 已沉淀节点标题列表 */
  nodeTitles: string[];
  /** 节点总数 */
  total: number;
  /** 当前 active 的节点（未追完的根） */
  activeNodes: string[];
}

/** 方向指引请求 */
export interface GuideRequest {
  /** 教材总目录内容（markdown） */
  tocContent: string;
  /** 认知地图摘要 */
  cognitiveMap: CognitiveMapSummary;
  /** 用户当前在读的文件（可选） */
  currentFile?: string;
  /** 用户主动补充的状态（可选） */
  userNote?: string;
}

/** 方向指引结果 */
export interface GuideEntry {
  /** 入口编号 */
  id: string;
  /** 对应讲次（若教材中能确认） */
  jiang: string;
  /** 入口标题 */
  title: string;
  /** 值得追问的核心问题或张力 */
  question: string;
  /** 为什么现在值得深入 */
  whyWorthExploring: string;
  /** 最自然的切入口 */
  entryPoint: string;
  /** 这个方向里的关键张力 */
  tensions: string[];
  /** 能连接的已有概念或节点 */
  connections: string[];
  /** 可能自然生长出的后续问题 */
  possibleTrails: string[];
  /** 教材锚点（文件+位置） */
  anchor: string;
  /** 入口类型：deepen=深化已有链（基于节点继续挖）；frontier=全书新域 */
  type: "deepen" | "frontier";
  /** 深化入口的锚定节点标题（frontier 无此字段） */
  anchorNode?: string;
  /** 延伸方向（主题级，供用户自行挑选；question 是可直接开聊的具体问题） */
  direction?: string;
}

/** 导引范围 */
export type GuideScope = "whole" | "nearby";

/** 导引模式：混合（默认）/ 深化当前链 / 全书新域 */
export type GuideMode = "mixed" | "deepen" | "frontier";

/** 构建方向指引的系统提示词（范围 + 模式 + 节点即路标） */
export function buildGuideSystemPrompt(scope: GuideScope = "whole", mode: GuideMode = "mixed"): string {
  const scopeRule =
    scope === "whole"
      ? "范围：全书。从整本教材中挑选高价值入口，不被学生当前所在讲次困住。"
      : "范围：当前所在位置附近（当前活跃线程锚定的教材章节，以及与之紧密相关的前后几讲/同主题章节）。在局部范围内推荐最值得深入的入口，不跳到全书远处。";
  const modeRule =
    mode === "deepen"
      ? "模式：深化当前认知链。只推荐基于学生已有节点继续深入的入口（边界检验、反例、统一抽象、跨链连接、更深的数学结构）。不推荐全新主题。"
      : mode === "frontier"
        ? "模式：全书新域。只推荐学生认知地图中尚未触及的高价值区域，不推荐基于已有节点的深化入口。"
        : "模式：混合。大约一半是深化已有认知链的入口（边界/反例/统一/连接/更深的数学结构），一半是全书尚未触及的新域入口。";
  return [
    "你是「认知边缘导师」的方向指引模块 —— 为自由探索发现下一堵值得撞的墙。",
    "",
    "核心原则：",
    "1. " + scopeRule,
    "2. " + modeRule,
    "3. 入口必须可跳入：每个入口独立成立，不要求学生先完成前面的内容。",
    "4. 珍贵总是少数：只推荐真正有认知张力的方向（结构连接/反常现象/结论边界/统一解释/未决问题）。",
    "5. 绝不拉回：不因章节边界或超纲阻止学生深入，反而推荐那些能追根到更深原理的入口。",
    "6. 节点是路标不是终点：学生的认知节点不是'已掌握应回避'的区域，而是继续深入的最佳起点。已走过的链优先找下一层：",
    "   - 边界检验：节点的结论在什么条件下失效？",
    "   - 反例：构造一个打破直觉的例子。",
    "   - 统一抽象：节点与其它概念是否共享更深的数学结构？",
    "   - 跨链连接：不同链之间有哪些结构相似性？",
    "   - 更深处：节点背后还有哪一层数学？",
    "7. 封顶链（标记 🔒）：学生主动暂停该链，不重复其已讲内容，只允许从边界/反例的新角度轻触，推荐重点放在未封顶链和其他新域。",
    "8. 你不是课程规划器、能力评估器或训练计划生成器，不要承诺学完达到什么水平，也不要安排复测或学习步骤。",
    "9. 每个入口必须有明确的概念或教材锚点；不确定的教材证据要标注未确认。",
    "",
    "输出格式（严格 JSON）：",
    '{ "entries": [',
    '  { "type": "deepen", "anchorNode": "锚定节点标题（须来自【我的认知地图】，不能自造）",',
    '    "id": "A1", "jiang": "第6讲", "title": "入口标题",',
    '    "question": "具体的下一堵墙（可直接开聊的问题）", "whyWorthExploring": "为什么现在值得深入",',
    '    "entryPoint": "最自然的切入口", "tensions": ["关键张力"],',
    '    "connections": ["可连接的概念"], "possibleTrails": ["可能的后续问题"],',
    '    "direction": "延伸方向（主题级，与 question 互补）", "anchor": "教材锚点" }',
    ']}',
    "",
    "type 只允许 deepen（深化已有链，必须带 anchorNode）或 frontier（全书新域，不带 anchorNode）。",
    "只输出 JSON，不要其他文字。2-4 个入口。每个入口必须彼此明显不同。",
  ].join("\n");
}

/** 解析 AI 返回的 JSON（容错处理） */
export function parseGuideResponse(text: string): GuideEntry[] {
  const parseEntry = (e: Record<string, unknown>, i: number): GuideEntry => {
    const type = e.type === "deepen" || e.type === "frontier" ? e.type : "frontier";
    return {
      id: typeof e.id === "string" ? e.id : `E${i + 1}`,
      jiang: typeof e.jiang === "string" ? e.jiang : "",
      title: typeof e.title === "string" ? e.title : "（未命名入口）",
      question: typeof e.question === "string" ? e.question : typeof e.problem === "string" ? e.problem : typeof e.title === "string" ? e.title : "",
      whyWorthExploring: typeof e.whyWorthExploring === "string" ? e.whyWorthExploring : typeof e.valueType === "string" ? e.valueType : "",
      entryPoint: typeof e.entryPoint === "string" ? e.entryPoint : "",
      tensions: Array.isArray(e.tensions) ? e.tensions.filter((x): x is string => typeof x === "string") : [],
      connections: Array.isArray(e.connections) ? e.connections.filter((x): x is string => typeof x === "string") : [],
      possibleTrails: Array.isArray(e.possibleTrails) ? e.possibleTrails.filter((x): x is string => typeof x === "string") : [],
      anchor: typeof e.anchor === "string" ? e.anchor : "",
      type,
      anchorNode: typeof e.anchorNode === "string" ? e.anchorNode : undefined,
      direction: typeof e.direction === "string" ? e.direction : undefined,
    };
  };
  const textEntries = (lines: string[], offset = 0): GuideEntry[] =>
    lines.map((l, i) => ({
      id: `E${offset + i + 1}`,
      jiang: "",
      title: l.trim().slice(0, 50),
      question: l.trim().slice(0, 120),
      whyWorthExploring: "",
      entryPoint: "",
      tensions: [],
      connections: [],
      possibleTrails: [],
      anchor: "",
      type: "frontier",
    }));
  // 提取 JSON 块（可能被 ``` 包裹）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const lines = text.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("|"));
    if (lines.length === 0) return [];
    return textEntries(lines);
  }
  try {
    const data = JSON.parse(jsonMatch[0]);
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    return entries.map((e: Record<string, unknown>, i: number) => parseEntry(e, i));
  } catch (e) {
    // JSON 解析失败时，退化为文本分行
    const lines = text.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("|"));
    if (lines.length === 0) return [];
    return textEntries(lines);
  }
}

/** 执行方向指引请求（范围 + 模式 + 结构化认知地图） */
export async function requestGuide(
  settings: TutorSettings,
  req: {
    tocContent: string;
    /** 结构化认知地图文本（缩进树，含摘要/状态/封顶标记） */
    mapStructureText: string;
    /** 封顶链标题（🔒，导引只轻触不重复） */
    locked: string[];
    scope: GuideScope;
    mode: GuideMode;
    currentAnchorPath?: string | null;
    activeThread?: string | null;
    userNote?: string;
  },
): Promise<GuideEntry[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildGuideSystemPrompt(req.scope, req.mode) },
    {
      role: "user",
      content: [
        "【教材总目录】",
        req.tocContent.slice(0, 6000),
        "",
        "【我的认知地图（节点树：缩进=层级，含摘要与状态）】",
        req.mapStructureText,
        "",
        req.scope === "nearby" && req.currentAnchorPath
          ? `【当前锚定教材位置】${req.currentAnchorPath}`
          : "",
        req.activeThread ? `【当前活跃线程】${req.activeThread}` : "",
        req.locked.length ? `【封顶链（🔒）】${req.locked.join(" / ")}：学生主动暂停这些链，不重复其已讲内容，只允许从边界/反例轻触。` : "",
        req.userNote ? `【我的状态/偏好】${req.userNote}` : "",
        "",
        req.scope === "nearby"
          ? "请在当前位置附近推荐 2-4 个值得深入的高价值入口。"
          : "请推荐 2-4 个全书范围内值得深入的高价值入口。",
      ].filter(Boolean).join("\n"),
    },
  ];
  const answer = await chatCompletion(settings, messages);
  return parseGuideResponse(answer);
}

/** 把入口渲染成 markdown（供展示/沉淀） */
export function renderGuideMarkdown(entries: GuideEntry[]): string {
  const lines: string[] = [];
  lines.push("## 🧭 方向指引（认知边缘推荐入口）");
  lines.push("");
  lines.push("> 自由选择，可跳入，不按顺序。停止权在你。");
  lines.push("");
  for (const e of entries) {
    const badge = e.type === "deepen" ? "🔻 深化" : "🆕 新域";
    const anchor = e.type === "deepen" && e.anchorNode ? `（锚定 [[${e.anchorNode}]]）` : "";
    lines.push(`### ${badge} ${e.id} ${e.title}${anchor}`);
    lines.push("");
    if (e.jiang) lines.push(`**讲次**：${e.jiang}`);
    if (e.question) lines.push(`**下一堵墙**：${e.question}`);
    if (e.direction) lines.push(`**延伸方向**：${e.direction}`);
    if (e.whyWorthExploring) lines.push(`**为什么值得追**：${e.whyWorthExploring}`);
    if (e.entryPoint) lines.push(`**自然切入口**：${e.entryPoint}`);
    if (e.tensions.length) lines.push(`**关键张力**：${e.tensions.join("；")}`);
    if (e.connections.length) lines.push(`**可连接**：${e.connections.join("；")}`);
    if (e.possibleTrails.length) lines.push(`**可能尾迹**：${e.possibleTrails.join("；")}`);
    if (e.anchor) lines.push(`**教材锚点**：${e.anchor}`);
    lines.push("");
  }
  return lines.join("\n");
}
