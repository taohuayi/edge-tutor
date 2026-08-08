/**
 * 教材检索 —— 纯函数层（无 obsidian API 依赖，可单测）
 *
 * 检索代理（opencode）输出 → 结构化引用（文件 + 行区间 + 原文）。
 * 结果只提供给问答模型（对话 respond 注入 system），不落盘、不显示。
 */

/** 一处教材引用（结构化，可跳转定位） */
export interface SearchRef {
  /** vault 相对路径 */
  file: string;
  /** 起始行（1 起；缺失为 0 = 仅文本定位） */
  startLine: number;
  /** 结束行（缺失 = startLine） */
  endLine: number;
  /** 原文片段 */
  text: string;
}

export interface SearchHit {
  found: boolean;
  /** 注入问答模型的编号引用文本 */
  text: string;
  /** 命中引用数 */
  count: number;
  /** 结构化引用（渲染/跳转用） */
  refs: SearchRef[];
}

/** 解析教材 toc.md → 章节地图（讲次标题列表，供检索指令聚焦搜索） */
export function parseChapterIndex(tocText: string): { file: string; title: string }[] {
  const out: { file: string; title: string }[] = [];
  const re = /##\s*\[\[chapters\/([^\]|]+\.md)\|([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tocText ?? "")) !== null) {
    const file = "chapters/" + m[1].trim();
    const title = m[2].trim();
    if (m[1].trim() && title) out.push({ file, title });
  }
  return out;
}

/** 归一化检索 query：去语气词/标点/空白，取核心片段（缓存命中与粗筛用） */
export function normalizeQuery(query: string): string {
  const q = String(query ?? "")
    .replace(/[，。！？、；：""''（）《》【】\s]+/g, "")
    .replace(/^(为什么|为啥|如何|怎么|怎样|是否|能不能|可以|什么是|啥是|帮我|我想|请问|那|这个|就|请|解释一下|讲讲|介绍一下|详细|具体|深入|继续|然后)/g, "")
    .replace(/^(为什么|为啥|如何|怎么|怎样|是否|能不能|可以|什么是|啥是|帮我|我想|请问|那|这个|就|请|解释一下|讲讲|介绍一下|详细|具体|深入|继续|然后)+/g, "")
    .trim();
  return q.slice(0, 40);
}

/** 解析 opencode 检索输出（容错，兼容多种格式）
 * 期望格式（agent 输出可能略有差异）：
 *   【文件】learning/.../第6讲.md
 *   【行号】364-391
 *   【原文】定理 7(拉格朗日中值定理)。设 $f(x)$ …
 * 或旧格式：【文件路径】`...`\n原文片段：…
 */
export function parseSearchResult(answer: string): SearchHit {
  const a = String(answer ?? "").trim();
  if (!a || /^(未找到|没有找到|无|未发现|无法)/.test(a)) {
    return { found: false, text: "", count: 0, refs: [] };
  }

  const refs: SearchRef[] = [];

  // 新格式：按【文件】…【行号】…【原文】分段
  const newRe = /【文件】\s*`?([^`\n]+)`?[\s\S]*?【行号】\s*([0-9]+)\s*(?:-|—|～|~|至)\s*([0-9]+)[\s\S]*?【原文】\s*([\s\S]*?)(?=【文件】|$)/g;
  let m: RegExpExecArray | null;
  while ((m = newRe.exec(a)) !== null) {
    const file = m[1].trim();
    const s = parseInt(m[2], 10);
    const e = parseInt(m[3], 10);
    const text = m[4].trim();
    if (!file || !text || !Number.isFinite(s)) continue;
    refs.push({ file, startLine: s, endLine: e >= s ? e : s, text });
  }

  // 旧格式回退：按【文件路径】分割（行号在路径后缀 :364 或文本内）
  if (refs.length === 0) {
    const oldRe = /【文件路径】\s*`?([^`\n]+)`?([\s\S]*?)(?=【文件路径】|$)/g;
    while ((m = oldRe.exec(a)) !== null) {
      const raw = m[1].trim();
      let body = m[2].trim().replace(/^(原文片段|原文|摘录|内容|结果)[：:]\s*/, "").replace(/^「|」$/g, "").trim();
      // 提取行号：路径 :364 或路径:364-391 或正文里的（第X讲.md:364-391）
      let s = 0;
      let e = 0;
      const lineMatch = raw.match(/:([0-9]+)\s*(?:-|—|～|~|至)\s*([0-9]+)$/) || raw.match(/:([0-9]+)$/);
      if (lineMatch) {
        s = parseInt(lineMatch[1], 10);
        e = lineMatch[2] ? parseInt(lineMatch[2], 10) : s;
      } else {
        const bodyLine = body.match(/(?:第[^:：\n]+|[^:：\n]+\.md)[:：]([0-9]+)\s*(?:-|—|～|~|至)\s*([0-9]+)/);
        if (bodyLine) {
          s = parseInt(bodyLine[1], 10);
          e = parseInt(bodyLine[2], 10);
          body = body.replace(/（.*?）|\(.*?\)/g, "").trim();
        }
      }
      const file = raw.replace(/:\d+(-\d+)?$/, "");
      if (!file || !body || body.length < 10) continue;
      refs.push({ file, startLine: s, endLine: e >= s ? e : s, text: body });
    }
  }

  if (refs.length === 0) {
    // 退化：整体作为一段
    const body = a.replace(/^(好的|可以|已找到|相关内容如下|以下是)[：:。\s]*/, "").trim();
    if (body.length < 20) return { found: false, text: "", count: 0, refs: [] };
    return { found: true, text: body.slice(0, 3000), count: 1, refs: [{ file: "", startLine: 0, endLine: 0, text: body.slice(0, 3000) }] };
  }

  // 去重（文件+行区间相同）并取最多 3 处
  const seen = new Set<string>();
  const top: SearchRef[] = [];
  for (const r of refs) {
    const key = `${r.file}:${r.startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    top.push(r);
    if (top.length >= 3) break;
  }

  const text = top
    .map((r, i) => {
      const loc = r.startLine > 0 ? `行：${r.startLine}${r.endLine > r.startLine ? `-${r.endLine}` : ""}` : "位置：见原文";
      return `【教材引用 #${i + 1}】文件：${r.file} ${loc}\n原文：${r.text.slice(0, 300)}`;
    })
    .join("\n\n");

  return { found: true, text: text.slice(0, 3000), count: top.length, refs: top };
}
