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
}

/** 导引范围 */
export type GuideScope = "whole" | "nearby";

/** 构建方向指引的系统提示词（范围 + 掌握感知） */
export function buildGuideSystemPrompt(scope: GuideScope = "whole"): string {
  const scopeRule =
    scope === "whole"
      ? "范围：全书。从整本教材中挑选高价值入口，不被学生当前所在讲次困住。"
      : "范围：当前所在位置附近（当前活跃线程锚定的教材章节，以及与之紧密相关的前后几讲/同主题章节）。在局部范围内推荐最值得深入的入口，不跳到全书远处。";
  return [
    "你是「认知边缘导师」的方向指引模块 —— 为自由探索发现下一堵值得撞的墙。",
    "",
    "核心原则：",
    "1. " + scopeRule,
    "2. 入口必须可跳入：每个入口独立成立，不要求学生先完成前面的内容。",
    "3. 珍贵总是少数：只推荐真正有认知张力的方向（结构连接/反常现象/结论边界/统一解释/未决问题）。",
    "4. 绝不拉回：不因章节边界或超纲阻止学生深入，反而推荐那些能追根到更深原理的入口。",
    "5. 基于学生认知地图：参考已有节点，但不要把掌握度当作是否推荐的硬过滤；已熟悉的主题可以从边界、反常或跨主题连接切入。",
    "6. 你不是课程规划器、能力评估器或训练计划生成器，不要承诺学完达到什么水平，也不要安排复测或学习步骤。",
    "7. 每个入口必须有明确的概念或教材锚点；不确定的教材证据要标注未确认。",
    "",
    "输出格式（严格 JSON）：",
    '{ "entries": [',
    '  { "id": "A1", "jiang": "第6讲", "title": "入口标题",',
    '    "question": "值得追问的核心问题", "whyWorthExploring": "为什么现在值得深入",',
    '    "entryPoint": "最自然的切入口", "tensions": ["关键张力"],',
    '    "connections": ["可连接的概念"], "possibleTrails": ["可能的后续问题"],',
    '    "anchor": "教材锚点" }',
    ']}',
    "",
    "只输出 JSON，不要其他文字。2-4 个入口。每个入口必须彼此明显不同。",
  ].join("\n");
}

/** 解析 AI 返回的 JSON（容错处理） */
export function parseGuideResponse(text: string): GuideEntry[] {
  // 提取 JSON 块（可能被 ``` 包裹）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // 无 JSON：退化为文本分行（或空）
    const lines = text.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("|"));
    if (lines.length === 0) return [];
    return lines.map((l, i) => ({
      id: `E${i + 1}`,
      jiang: "",
      title: l.trim().slice(0, 50),
      question: l.trim().slice(0, 120),
      whyWorthExploring: "",
      entryPoint: "",
      tensions: [],
      connections: [],
      possibleTrails: [],
      anchor: "",
    }));
  }
  try {
    const data = JSON.parse(jsonMatch[0]);
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    return entries.map((e: Record<string, unknown>, i: number) => ({
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
    }));
  } catch (e) {
    // JSON 解析失败时，退化为文本分行
    const lines = text.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("|"));
    if (lines.length === 0) return [];
    return lines.map((l, i) => ({
      id: `E${i + 1}`,
      jiang: "",
      title: l.trim().slice(0, 50),
      question: l.trim().slice(0, 120),
      whyWorthExploring: "",
      entryPoint: "",
      tensions: [],
      connections: [],
      possibleTrails: [],
      anchor: "",
    }));
  }
}

/** 执行方向指引请求（范围 + 掌握感知 + 用户补充） */
export async function requestGuide(
  settings: TutorSettings,
  req: {
    tocContent: string;
    mapSummaryText: string;
    mastered: string[];
    scope: GuideScope;
    currentAnchorPath?: string | null;
    activeThread?: string | null;
    userNote?: string;
  },
): Promise<GuideEntry[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildGuideSystemPrompt(req.scope) },
    {
      role: "user",
      content: [
        "【教材总目录】",
        req.tocContent.slice(0, 6000),
        "",
        "【我的认知地图（含掌握深度）】",
        req.mapSummaryText,
        "",
        req.scope === "nearby" && req.currentAnchorPath
          ? `【当前锚定教材位置】${req.currentAnchorPath}`
          : "",
        req.activeThread ? `【当前活跃线程】${req.activeThread}` : "",
        req.mastered.length ? `【已掌握，勿重复推荐】${req.mastered.join(" / ")}` : "",
        req.userNote ? `【我的状态/偏好】${req.userNote}` : "",
        "",
        req.scope === "nearby"
          ? "请在当前位置附近推荐 3-5 个值得深入的高价值入口。"
          : "请推荐 3-5 个全书范围内值得深入的高价值入口。",
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
    lines.push(`### ${e.id} ${e.title}`);
    lines.push("");
    if (e.jiang) lines.push(`**讲次**：${e.jiang}`);
    if (e.question) lines.push(`**核心问题**：${e.question}`);
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
