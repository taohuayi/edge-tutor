/**
 * 检索评测 runner（阶段 0 起，逐阶段扩展）
 *
 * 在 Node 中复刻 Edge Tutor 的检索管线（与 src/main.ts 的 L1→L5 对照），
 * 对 testdata/retrieval/queries.jsonl 跑评测，输出：
 *   - testdata/retrieval/candidates/<id>.jsonl：每 query 的 top-10 候选（管线最终排序）
 *   - testdata/retrieval/results/<tag>.json：per-query 明细 + 汇总指标
 *   - 控制台报告：文件级 Recall@10 / MRR / 行级 Recall@10
 *
 * 管线配置（--rewrite / --rerank），评测必须标注配置，对比才公平：
 *   --rewrite off|old|new    off=无改写；old=旧【关键词】格式；new=结构化 JSON（阶段 2）
 *   --rerank  off|local|api  off=RRF 排序；local=本地 bge-reranker；api=qwen3-rerank（阶段 3）
 *
 * embedding 由索引文件的 model 字段决定：bge → 本地 transformers.js（models/ + lib/ 缓存）；
 * text-embedding-v4 → 远程 API（key 取 EDGE_TUTOR_EMBEDDING_API_KEY，与插件一致）。
 *
 * --rerank api 走百炼 qwen3-rerank：key 取 EDGE_TUTOR_EMBEDDING_API_KEY（或 data.json
 * embeddingApiKey）；baseUrl/model 可由 data.json 的 rerankApiBase/rerankModel 覆盖
 * （对应设置面板；默认 compatible-api/v1 + qwen3-rerank）。
 *
 * --rewrite old|new 走真实 LLM（与 main.ts 同 prompt 结构）：
 *   key 取 DEEPSEEK_API_KEY（无则回退 EDGE_TUTOR_API_KEY / data.json apiKey），
 *   base 取 DEEPSEEK_API_BASE（默认 https://api.deepseek.com/v1），model 取 DEEPSEEK_MODEL；
 *   改写结果缓存到 testdata/retrieval/rewrites/<id>-<mode>.json，重跑不重复计费。
 *
 * 用法：
 *   node scripts/retrieval-eval/eval.mjs --limit 5            # 试跑
 *   node scripts/retrieval-eval/eval.mjs                      # 全量（base：off/off）
 *   node scripts/retrieval-eval/eval.mjs --rewrite new        # 阶段 2：JSON 理解 + 多路向量
 *   node scripts/retrieval-eval/eval.mjs --rewrite new --rerank api
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..", "..");
const VAULT_ROOT = path.resolve(PLUGIN_ROOT, "..", "..", "..");
const DATA_DIR = path.join(PLUGIN_ROOT, "testdata", "retrieval");
const VEC_FILE = path.join(PLUGIN_ROOT, "search-vectors.json");

import {
  normalizeTextForMatch,
  normalizeQuery,
  searchTextbookIndex,
  rrfMerge,
  diverseTop,
  buildBm25Index,
  bm25Search,
  parseRewriteOutput,
  parseQueryUnderstanding,
  parseChapterIndex,
} from "../../test/.build/search.cjs";
import {
  decodeVecs,
  topKVectors,
  loadEmbedder,
  loadRemoteEmbedder,
  loadReranker,
  loadRemoteReranker,
} from "../../test/.build/vector.cjs";

const RERANK_TRIGGER_SCORE = 0.35; // 与 main.ts:68 一致

/* ===== LLM 查询理解（--rewrite old|new）：复刻 main.ts rewriteQuery 的 prompt 结构 =====
 * key：DEEPSEEK_API_KEY > EDGE_TUTOR_API_KEY > data.json apiKey
 * 结果缓存 testdata/retrieval/rewrites/<id>-<mode>.json：重跑不重复调用、对比稳定。
 */

let chatCfg = null;
function resolveChatCfg() {
  if (chatCfg) return chatCfg;
  let apiKey = process.env.DEEPSEEK_API_KEY || process.env.EDGE_TUTOR_API_KEY || "";
  let apiBase = process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1";
  let model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  if (!apiKey) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "data.json"), "utf8"));
      apiKey = d.apiKey || "";
      if (d.apiBase) apiBase = d.apiBase;
      if (d.model) model = d.model;
    } catch {}
  }
  chatCfg = { apiKey, apiBase, model };
  return chatCfg;
}

async function chatOnce(messages, maxTokens) {
  const { apiKey, apiBase, model } = resolveChatCfg();
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY（或 data.json apiKey）");
  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens }),
  });
  if (!resp.ok) throw new Error(`chat 失败 ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("chat 返回空内容");
  return content;
}

/** 教材讲次标题（toc.md；与 main.ts getChapterIndex 同构，供 LLM 章节路由） */
function chapterTitles(vec) {
  try {
    const tocPath = path.join(VAULT_ROOT, vec.root.replace(/\\/g, "/"), "toc.md");
    if (fs.existsSync(tocPath)) {
      return parseChapterIndex(fs.readFileSync(tocPath, "utf8")).map((c) => c.title);
    }
  } catch {}
  return [];
}

/**
 * 查询理解：rawQ → { keywords, chapters, synonyms, queries? }（失败返回 null，调用方降级 off）。
 * mode=old：旧【关键词】格式 prompt + parseRewriteOutput（单查询，模拟阶段 1 前行为）
 * mode=new：JSON 理解 prompt + parseQueryUnderstanding（3 个查询变体多路向量）
 */
async function rewriteViaLLM(rawQ, mode, vec) {
  const cacheDir = path.join(DATA_DIR, "rewrites");
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `${qIdOf(rawQ)}-${mode}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {}
  }
  const chapters = chapterTitles(vec);
  const chapterList = chapters.length > 0 ? chapters.join("、") : "（无章节地图）";
  let prompt;
  if (mode === "new") {
    prompt = [
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
  } else {
    prompt = [
      "把下面的学生问题改写成适合检索教材的输入。",
      "",
      "【教材章节列表】",
      chapterList,
      "",
      "输出格式（严格遵守，每行一个字段）：",
      "【关键词】2-4 个检索关键词，分号分隔，用教材里可能出现的确切术语（如定理名、概念名）",
      "【章节】1-2 个最可能涉及的讲次标题（从上面的列表里选），分号分隔；不确定则本行留空",
      "【同义】2-3 个同义/等价表述或强相关概念，分号分隔",
      "",
      `【学生问题】${rawQ}`,
    ].join("\n");
  }
  const answer = await chatOnce(
    [
      { role: "system", content: mode === "new" ? "你是教材检索查询理解器，只输出规定 JSON，不要解释。" : "你是教材检索查询改写器，只输出规定格式，不要解释。" },
      { role: "user", content: prompt },
    ],
    mode === "new" ? 500 : 300
  );
  let out = null;
  if (mode === "new") {
    const u = parseQueryUnderstanding(answer);
    if (u) {
      out = {
        keywords: [u.concept, u.knowledgeNeed.slice(0, 20), ...u.relatedTerms]
          .map((k) => k.trim())
          .filter((k) => k.length >= 2)
          .slice(0, 6),
        chapters: u.chapters,
        synonyms: u.relatedTerms,
        queries: u.queries,
      };
    } else {
      out = parseRewriteOutput(answer); // JSON 失败 → 旧格式兜底（与 main.ts 一致）
    }
  } else {
    out = parseRewriteOutput(answer);
  }
  if (out && (out.keywords.length > 0 || out.chapters.length > 0)) {
    fs.writeFileSync(cacheFile, JSON.stringify(out), "utf8");
    return out;
  }
  return null;
}

/** query → 缓存文件 id（规范化摘要，防路径非法） */
function qIdOf(rawQ) {
  const n = normalizeQuery(rawQ).slice(0, 24).replace(/[\\/:*?"<>|]/g, "_");
  return n || `q${Math.abs([...rawQ].reduce((s, c) => (s + c.charCodeAt(0)) % 10000, 7))}`;
}

/* ===== 参数 ===== */

const args = process.argv.slice(2);
const pick = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};
const rewrite = pick("--rewrite", "off");
const rerankMode = pick("--rerank", "off");
const useBm25 = args.includes("--no-bm25") ? false : true; // 默认开（与线上一致）；--no-bm25 对比关闭
const limit = Number(pick("--limit", "0")) || Infinity;
const onlyReport = args.includes("--report");
const tag = `${rewrite}-${rerankMode}${useBm25 ? "-bm25" : ""}`;

/* ===== 教材行索引（与 main.ts getTextbookIndex 同构） ===== */

function buildLineIndex(rootAbs, rootRel) {
  const files = [];
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".") || ent.name === "images") continue;
      const p = path.join(dir, ent.name);
      const r = path.join(rel, ent.name).replace(/\\/g, "/");
      if (ent.isDirectory()) walk(p, r);
      else if (ent.name.endsWith(".md") && ent.name !== "toc.md") files.push([p, r]); // 与 main.ts 一致排除 toc
    }
  };
  walk(rootAbs, rootRel);
  files.sort((a, b) => a[1].localeCompare(b[1], "zh"));
  return files.map(([abs, rel]) => ({
    path: rel,
    lines: fs
      .readFileSync(abs, "utf8")
      .split(/\r?\n/)
      .map((text) => ({ text, norm: normalizeTextForMatch(text) })),
  }));
}

/* ===== 向量索引 + embedder ===== */

function loadVectorIndex() {
  const raw = JSON.parse(fs.readFileSync(VEC_FILE, "utf8"));
  return {
    root: raw.root,
    model: raw.model,
    dim: raw.dim,
    chunks: raw.chunks,
    vecs: decodeVecs(raw.vecsB64, raw.dim),
  };
}

async function resolveEmbedder(vec) {
  if (vec.model.includes("bge")) {
    const e = await loadEmbedder(path.join(PLUGIN_ROOT, "models"), path.join(PLUGIN_ROOT, "lib"));
    if (!e) throw new Error("本地 bge embedder 加载失败（索引 model=" + vec.model + "）");
    return e;
  }
  // 远程（text-embedding-v4）：key 环境变量优先，否则 data.json 设置
  let key = process.env.EDGE_TUTOR_EMBEDDING_API_KEY || "";
  if (!key) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "data.json"), "utf8"));
      key = d.embeddingApiKey || "";
    } catch {}
  }
  if (!key) throw new Error("索引是远程模型但缺少 EDGE_TUTOR_EMBEDDING_API_KEY");
  return loadRemoteEmbedder({
    apiKey: key,
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: vec.model,
    dim: vec.dim,
  });
}

/* ===== expected 解析：锚点 → 文件 + 行号 ===== */

function locateAnchor(lineIndex, anchorPath, anchor) {
  const file = anchorPath.replace(/\\/g, "/");
  const entry = lineIndex.find((f) => f.path === file || f.path.endsWith(file.split("/").slice(-3).join("/")));
  if (!entry) return { file, line: null };
  const norm = (t) => normalizeTextForMatch(t);
  const searchLine = (probe) => {
    if (!probe) return null;
    for (let i = 0; i < entry.lines.length; i++) {
      if (entry.lines[i].norm.includes(probe)) return i + 1;
    }
    return null;
  };
  // 1) 题号匹配：锚点多为「例 N.M …」（frontmatter YAML 转义会丢 \l \r 等反斜杠，
  //    LaTeX 原文对不上，但题号归一化后无歧义）
  const no = /例\s*\d+(?:\.\d+)+/.exec(anchor);
  if (no) {
    const hit = searchLine(norm(no[0]));
    if (hit) return { file, line: hit };
  }
  // 2) 最长 CJK 连续片段兜底（公式剥离后仍保真的中文）
  const cjk = [...anchor.matchAll(/[一-鿿]{4,}/g)].map((m) => m[0]).sort((a, b) => b.length - a.length);
  for (const seg of cjk) {
    const hit = searchLine(norm(seg));
    if (hit) return { file, line: hit };
  }
  // 3) 归一化全文匹配（LaTeX 一致的场景）
  const full = searchLine(norm(anchor).slice(0, 24));
  return { file, line: full };
}

function resolveExpected(q, lineIndex) {
  if (q.kind === "example") {
    return { file: q.anchorPath.replace(/\\/g, "/"), startLine: q.expectedLines[0], endLine: q.expectedLines[1] };
  }
  // node：anchorPath 是完整教材路径；anchor 是原文 → 定位行
  const anchorPath = q.anchorPath || (q.source.includes("chapters") ? q.source : "");
  if (anchorPath) {
    const loc = locateAnchor(lineIndex, anchorPath, q.anchor || "");
    return { file: loc.file, startLine: loc.line ?? 0, endLine: loc.line ?? 0 };
  }
  return null;
}

/* ===== 命中判定（两级） ===== */

function fileKey(p) {
  return p.replace(/\\/g, "/").split("/").slice(-3).join("/");
}
function isFileHit(ref, exp) {
  if (!exp) return false;
  const r = fileKey(ref.file);
  const e = fileKey(exp.file);
  return r === e || r.endsWith(e) || e.endsWith(r);
}
function isLineHit(ref, exp) {
  if (!isFileHit(ref, exp) || !exp.startLine) return false;
  // 行区间重叠：ref [start,end] 与 exp [start,end] 有交集（±2 行容错）
  const rs = ref.startLine - 2, re = ref.endLine + 2;
  return rs <= exp.endLine && re >= exp.startLine;
}

/* ===== 管线（复刻 main.ts L1→L5） ===== */

function pipelineBase(q, ctx) {
  // L1 子串：整串命中，未命中截尾重试（与 main.ts 的 searchTextbookIndex 调用一致）
  const r = searchTextbookIndex(ctx.lineIndex, q.query, 6);
  const aRefs = r?.refs ?? [];
  // L3 向量：query 编码（query 标记）→ top-20
  // L4 RRF 融合
  const merged = rrfMerge([aRefs, ctx.vecHits], 60);
  return { aRefs, aExact: !!r?.exact, merged };
}

async function vectorRecall(ctx, queries, chapters) {
  if (!ctx.embedder) return [];
  const qs = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  if (qs.length === 0) return [];
  const qvs = await ctx.embedder.embed(qs, { query: true });
  // 多查询：排序 = 原始查询（qs[0]）相似度降序，变体路只扩充未出现块（与 main.ts 一致）
  const scopeFilter = (ranked) => {
    if (chapters.length === 0) return ranked;
    const filtered = ranked.filter((c) => chapters.some((ch) => ctx.vec.chunks[c.idx].file.includes(ch)));
    return filtered.length > 0 ? filtered : ranked;
  };
  const hits = [];
  const seen = new Set();
  for (const qv of qvs) {
    if (!qv || qv.length === 0) continue;
    for (const { idx, score } of scopeFilter(topKVectors(qv, ctx.vec.vecs, 20)).slice(0, 20)) {
      const ch = ctx.vec.chunks[idx];
      const key = `${ch.file}:${ch.startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ file: ch.file, startLine: ch.startLine, endLine: ch.endLine, text: ch.text, score });
    }
    if (hits.length >= 20) break;
  }
  return hits.slice(0, 20);
}

async function runPipeline(q, ctx) {
  let qText = q.query;
  let chapters = [];
  let keywords = null;
  let queries = null; // 查询理解变体（new 模式；old/off = 单查询）

  if (rewrite === "old" || rewrite === "new") {
    const rw = await rewriteViaLLM(q.query, rewrite, ctx.vec);
    if (rw) {
      keywords = rw.keywords;
      chapters = rw.chapters;
      queries = rw.queries ?? null;
    }
  }

  // L1 子串：整串命中（exact 标记），未命中截尾重试（与 main.ts searchTextbookIndex 调用一致）
  const r0 = searchTextbookIndex(ctx.lineIndex, qText, 6);
  const aRefs = [...(r0?.refs ?? [])];
  const aExact = !!r0?.exact;
  // 改写关键词/相关术语补查（main.ts：整串未命中才等改写；进 rerank 候选池而非 RRF 主路）
  let kwRefs = [];
  if (!aExact && keywords) {
    for (const k of keywords) {
      const rr = searchTextbookIndex(ctx.lineIndex, k, 6);
      if (rr && rr.found) kwRefs.push(...rr.refs);
    }
  }
  // L1.5 BM25 路（与 main.ts 一致：rawQ 词频打分 top-20）
  let bm25Refs = [];
  if (useBm25) {
    if (!ctx.bm25) ctx.bm25 = buildBm25Index(ctx.lineIndex);
    bm25Refs = bm25Search(ctx.lineIndex, ctx.bm25, qText, 20).map((r) => r.ref);
  }
  // 多路向量：主路 = 原始问题（相似度主排序）+ 查询理解变体扩充（main.ts 同序）
  const vecQueries = [qText];
  for (const qv of queries ?? []) {
    if (qv && !vecQueries.includes(qv)) vecQueries.push(qv);
  }
  const vecHits = await vectorRecall(ctx, vecQueries, chapters);
  // 融合主两路（子串+向量）；BM25 不进 RRF（无区分度候选会挤掉语义前列，实测劣化），
  // 只在 rerank 候选池扩充时参与（交叉编码器把关）
  const merged = rrfMerge([aRefs, vecHits], 60);
  let ranked = merged;

  if (rerankMode !== "off" && ctx.reranker && merged.length > 0) {
    // 复刻 main.ts 条件触发：整串未命中 且（向量置信 <0.35 或两路分歧）
    const vecTopScore = vecHits[0]?.score ?? 0;
    const agreement = !!aRefs[0] && !!vecHits[0] && aRefs[0].file === vecHits[0].file;
    const needRerank = !aExact && !(vecTopScore >= RERANK_TRIGGER_SCORE && agreement);
    if (needRerank) {
      const pool =
        useBm25 && (bm25Refs.length > 0 || kwRefs.length > 0)
          ? rrfMerge([merged.map((m) => m.ref), bm25Refs, kwRefs], 60)
          : merged;
      const top40 = pool.slice(0, 40);
      try {
        const scores = await ctx.reranker.rerank(q.query, top40.map((m) => m.ref.text));
        ranked = top40
          .map((m, i) => ({ ...m, score: scores[i] })) // rerank 分主导排序（相对值即可）
          .sort((a, b) => b.score - a.score);
        // 保底注入（与 main.ts 一致）：aRefs 子串精确命中（≤2）+ 向量路 top2 无论 rerank
        // 打分如何保留在注入列表前部——阶段 3 实测 reranker 语义配对会把锚点段压出 top10
        const keptRefs = aRefs
          .filter((a) => ranked.some((m) => m.ref.file === a.file && a.startLine >= m.ref.startLine && a.startLine <= m.ref.endLine))
          .slice(0, 2);
        const keepSources = [...keptRefs, ...vecHits.slice(0, 2)];
        if (keepSources.length > 0) {
          const keptKeys = new Set();
          const keptItems = [];
          for (const a of keepSources) {
            const m = ranked.find((x) => x.ref.file === a.file && a.startLine >= x.ref.startLine && a.startLine <= x.ref.endLine);
            if (!m) continue;
            const key = `${m.ref.file}:${m.ref.startLine}`;
            if (keptKeys.has(key)) continue;
            keptKeys.add(key);
            keptItems.push({ ...m, score: 1.01 });
          }
          if (keptItems.length > 0) {
            ranked = [...keptItems, ...ranked.filter((m) => !keptKeys.has(`${m.ref.file}:${m.ref.startLine}`))];
          }
        }
      } catch (e) {
        // 远程失败/降级链全断：保持融合分排序（与 main.ts 一致），单条失败不中断整轮
        console.warn(`[eval] ${q.id} rerank 失败，用融合分排序：`, String(e?.message ?? e).slice(0, 120));
      }
    }
  }
  return { aRefs, vecHits, rw: { chapters, queries: vecQueries }, ranked: diverseTop(ranked.map((m) => m.ref), 10, 3) };
}

/* ===== 标注口径：node 脱节检测（修正坏标注，两模式同等适用） =====
 * 认知边缘 node 的 expected 锚点是"节点生成对话引用的教材位置"（对话起点例题），
 * 与标题 query 常语义脱节（如"三大题型的统一骨架"锚点却是例1.3 求反函数）。
 * 脱节 node 的文件级判定放宽为：锚点文件 OR 改写章节路由的目标讲文件
 * （路由错 → 目标讲文件不中 → 仍然 miss，惩罚成立；off 模式无路由退化为锚点判定），
 * 行级不判（锚点行对语义答案无意义，从行级分母剔除）。
 * 无锚点（expected null）的 node 是坏标注，从全部分母剔除。
 */
function isRelaxedNode(q, expected) {
  if (q.kind !== "node") return false;
  if (!expected) return true; // 无锚点坏标注
  const anchorClean = String(q.anchor || "").replace(/\$[^$\n]*\$/g, " ").replace(/\\[a-zA-Z]+(\[[^\]]*\])?/g, " ");
  const qChars = new Set(String(q.query).replace(/[的了吗呢是这让那这为何自在么都并就一很也]/g, ""));
  const shared = [...new Set([...anchorClean])].filter((c) => qChars.has(c)).length;
  return shared <= 3; // 实词交集 ≤3 字 → 语义脱节
}

/* ===== 标注文件生成 ===== */

function genAnnotationFile(q, expected, candidates, relaxed = false) {
  const lines = [
    `# ${q.id}｜${q.query.slice(0, 60)}`,
    "",
    `- 来源：${q.source}（${q.kind}）`,
    `- 期望命中：${expected ? `${expected.file}${expected.startLine ? ":" + expected.startLine : ""}` : "（未知）"}`,
    q.kind === "node" ? `- 锚点：${(q.anchor || "").slice(0, 100)}` : "",
    relaxed ? "- ⚠️ 脱节 node：文件级判定放宽（锚点文件 OR 改写目标讲），行级不判" : "",
    "",
    "## 候选（管线 top-10）",
    ...candidates.map((c, i) => `1. [${i + 1}] ${c.file}:${c.startLine}-${c.endLine} — ${c.text.replace(/\s+/g, " ").slice(0, 80)}`),
    "",
    "## 人工判定",
    "- [ ] 以上期望命中是否合理？如有误，修正后写在此处：",
    "- [ ] 候选里是否有更该命中的位置被漏掉？",
  ].filter(Boolean);
  fs.writeFileSync(path.join(DATA_DIR, "annotations", `${q.id}.md`), lines.join("\n") + "\n", "utf8");
}

/* ===== 主流程 ===== */

async function main() {
  const queries = fs
    .readFileSync(path.join(DATA_DIR, "queries.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .slice(0, limit);

  const vec = loadVectorIndex();
  const lineIndex = buildLineIndex(
    path.join(VAULT_ROOT, vec.root),
    vec.root.replace(/\\/g, "/")
  );
  console.log(`[eval] 索引：model=${vec.model} dim=${vec.dim} chunks=${vec.chunks.length} 教材行数=${lineIndex.reduce((s, f) => s + f.lines.length, 0)}`);
  console.log(`[eval] 管线：rewrite=${rewrite} rerank=${rerankMode} queries=${queries.length} tag=${tag}`);

  if (onlyReport) return report(vec);

  const ctx = { lineIndex, vec };
  ctx.embedder = await resolveEmbedder(vec);
  console.log(`[eval] embedder 就绪：${vec.model.includes("bge") ? "本地 bge-small" : "远程"}`);
  if (rerankMode === "api") {
    // 远程 qwen3-rerank：key 与 embedding 同源（环境变量优先，否则 data.json 设置）；
    // baseUrl/model 可从 data.json 覆盖（对应设置面板 rerankApiBase/rerankModel）
    let key = process.env.EDGE_TUTOR_EMBEDDING_API_KEY || "";
    let baseUrl = "https://dashscope.aliyuncs.com/compatible-api/v1";
    let model = "qwen3-rerank";
    try {
      const d = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "data.json"), "utf8"));
      if (!key) key = d.embeddingApiKey || "";
      if (d.rerankApiBase) baseUrl = d.rerankApiBase;
      if (d.rerankModel) model = d.rerankModel;
    } catch {}
    if (!key) throw new Error("--rerank api 需要 EDGE_TUTOR_EMBEDDING_API_KEY（或 data.json embeddingApiKey）");
    ctx.reranker = loadRemoteReranker({ apiKey: key, baseUrl, model });
    console.log(`[eval] reranker 就绪：远程 ${model}（${baseUrl}）`);
  } else if (rerankMode !== "off") {
    ctx.reranker = await loadReranker(path.join(PLUGIN_ROOT, "models"), path.join(PLUGIN_ROOT, "lib"));
    if (!ctx.reranker) console.warn("[eval] reranker 加载失败，跳过重排");
  }

  // 全量向量召回可复用：base 管线每 query 只嵌 1 次（rewrite=off 时），预取会省重复加载——
  // 但 old/new 改写会改 qText，预取只对 off 有效；这里按需调用。

  const results = [];
  let i = 0;
  for (const q of queries) {
    i++;
    const t0 = Date.now();
    const { ranked, rw } = await runPipeline(q, ctx);
    const expected = resolveExpected(q, lineIndex);
    // 口径修正：脱节 node 文件级 = 锚点文件 OR 改写目标讲文件；行级不判；无锚点坏标注剔除
    const relaxed = isRelaxedNode(q, expected);
    const hitChapters = relaxed && rw?.chapters?.length ? rw.chapters : [];
    const judgedFile = !(relaxed && !expected);
    const judgedLine = !relaxed && !!expected?.startLine;
    const fileHit = (c) =>
      isFileHit(c, expected) || hitChapters.some((ch) => fileKey(c.file).includes(ch));
    const fileRank = judgedFile ? ranked.findIndex((c) => fileHit(c)) + 1 : 0;
    const lineRank = judgedLine ? ranked.findIndex((c) => isLineHit(c, expected)) + 1 : 0;
    results.push({ id: q.id, query: q.query.slice(0, 60), kind: q.kind, expected, relaxed, judgedFile, judgedLine, fileRank, lineRank, top: ranked });
    // 候选落盘
    fs.mkdirSync(path.join(DATA_DIR, "candidates"), { recursive: true });
    fs.writeFileSync(
      path.join(DATA_DIR, "candidates", `${q.id}.jsonl`),
      ranked.map((c) => JSON.stringify({ file: c.file, startLine: c.startLine, endLine: c.endLine, text: c.text.slice(0, 200) })).join("\n"),
      "utf8"
    );
    if (process.env.DEBUG_EVAL) console.log(`[${i}/${queries.length}] ${q.id} fileRank=${fileRank} lineRank=${lineRank} (${Date.now() - t0}ms)`);
  }

  fs.mkdirSync(path.join(DATA_DIR, "results"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "annotations"), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "results", `${tag}.json`), JSON.stringify({ rewrite, rerankMode, model: vec.model, results }, null, 2), "utf8");
  report(vec);
  // 标注文件
  for (const q of queries) {
    const r = results.find((x) => x.id === q.id);
    genAnnotationFile(q, r.expected, r.top, r.relaxed);
  }
  console.log(`[eval] 候选/标注已生成 → candidates/、annotations/（人工抽查后修 expected）`);
}

function report() {
  const file = path.join(DATA_DIR, "results", `${tag}.json`);
  if (!fs.existsSync(file)) return console.error(`[eval] 无结果文件 ${file}，先跑评测`);
  const { results, rewrite: rw, rerankMode: rr, model } = JSON.parse(fs.readFileSync(file, "utf8"));
  const n = results.length;
  const fN = results.filter((r) => r.judgedFile).length;
  const lN = results.filter((r) => r.judgedLine).length;
  const relaxed = results.filter((r) => r.relaxed).length;
  const fileRecall = results.filter((r) => r.judgedFile && r.fileRank > 0).length / fN;
  const lineRecall = results.filter((r) => r.judgedLine && r.lineRank > 0).length / lN;
  const mrr = results.reduce((s, r) => s + (r.judgedFile && r.fileRank > 0 ? 1 / r.fileRank : 0), 0) / fN;
  console.log(`\n===== 评测报告（${rw}/${rr}，model=${model}，n=${n}，脱节放宽 ${relaxed}）=====`);
  console.log(`文件级 Recall@10：${(fileRecall * 100).toFixed(1)}%（分母 ${fN}）`);
  console.log(`行级 Recall@10：${(lineRecall * 100).toFixed(1)}%（分母 ${lN}）`);
  console.log(`MRR@10：${mrr.toFixed(3)}（分母 ${fN}）`);
  const misses = results.filter((r) => r.judgedFile && !r.fileRank).slice(0, 10);
  if (misses.length) {
    console.log(`未命中样例（前 10/${results.filter((r) => r.judgedFile && !r.fileRank).length}）：`);
    for (const m of misses) console.log(`  [${m.id}] ${m.query} → 期望 ${m.expected?.file?.split("/").slice(-2).join("/")}`);
  }
  return { fileRecall, lineRecall, mrr };
}

main().catch((e) => {
  console.error("[eval] 失败：", e);
  process.exit(1);
});
