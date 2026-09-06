import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSearchResult,
  normalizeQuery,
  parseChapterIndex,
  normalizeTextForMatch,
  searchTextbookIndex,
  formatRefsText,
  parseRewriteOutput,
  chunkTextbook,
  rrfMerge,
  diverseTop,
  tokenizeText,
  buildBm25Index,
  bm25Search,
  parseQueryUnderstanding,
} from "./.build/search.cjs";

test("新格式：【文件】+【行号】+【原文】结构化解析", () => {
  const answer = [
    "【文件】References/chapter-06.md",
    "【行号】364-391",
    "【原文】定理 7(拉格朗日中值定理)。设 $f(x)$ 满足 ①在 $[a,b]$ 上连续…",
    "",
    "【文件】References/chapter-06.md",
    "【行号】420-425",
    "【原文】注 见到 $f(a)-f(b)$ 或 $f$ 与 $f'$ 的关系…",
  ].join("\n");
  const r = parseSearchResult(answer);
  assert.equal(r.found, true);
  assert.equal(r.count, 2);
  assert.equal(r.refs.length, 2);
  assert.equal(r.refs[0].file, "References/chapter-06.md");
  assert.equal(r.refs[0].startLine, 364);
  assert.equal(r.refs[0].endLine, 391);
  assert.ok(r.text.includes("【教材引用 #1】"));
  assert.ok(r.text.includes("行：364-391"));
});

test("旧格式兼容：路径带 :行号", () => {
  const answer = [
    "【文件路径】`learning/.../chapters/第6讲.md:364`",
    "原文片段：定理 7(拉格朗日中值定理)…",
  ].join("\n");
  const r = parseSearchResult(answer);
  assert.equal(r.found, true);
  assert.equal(r.refs[0].startLine, 364);
  assert.equal(r.refs[0].file, "learning/.../chapters/第6讲.md");
});

test("去重（同文件同行号只取一次）且最多 3 处", () => {
  const blocks = [];
  for (let i = 0; i < 5; i++) {
    blocks.push(`【文件】f${i}.md\n【行号】10-20\n【原文】内容 ${i} 的原文文本足够长`);
  }
  // 加一个重复项
  blocks.push(`【文件】f0.md\n【行号】10-20\n【原文】重复的原文文本足够长`);
  const r = parseSearchResult(blocks.join("\n"));
  assert.equal(r.count, 3);
  assert.equal(r.refs.length, 3);
});

test("未找到 → found:false", () => {
  assert.equal(parseSearchResult("未找到相关内容").found, false);
  assert.equal(parseSearchResult("没有找到").found, false);
  assert.equal(parseSearchResult("").found, false);
});

test("退化：无结构化分段整体作为一段", () => {
  const r = parseSearchResult("教材原文是这样说的：拉格朗日中值定理是微分学的核心定理之一。");
  assert.equal(r.found, true);
  assert.equal(r.count, 1);
});

test("结果截断到 3000 字符", () => {
  const long = "【文件】f.md\n【行号】1-2\n【原文】" + "甲".repeat(4000);
  const r = parseSearchResult(long);
  assert.ok(r.text.length <= 3000);
});

test("normalizeQuery：去语气词与标点", () => {
  assert.equal(normalizeQuery("为什么拉格朗日中值定理这么重要？"), "拉格朗日中值定理这么重要");
  assert.equal(normalizeQuery("帮我解释一下 拉格朗日 中值定理"), "拉格朗日中值定理");
  assert.equal(normalizeQuery("拉格朗日中值定理"), "拉格朗日中值定理");
});

test("parseChapterIndex：解析 toc.md 讲次地图", () => {
  const toc = [
    "# 教材目录（自动生成）",
    "",
    "## [[chapters/第10讲.md|第10讲]]",
    "  - 一元函数积分学的应用（一） ——几何应用",
    "## [[chapters/第11讲.md|第11讲 积分等式与不等式]]",
    "  - 用中值定理",
    "## [[chapters/第6讲.md|第6讲 中值定理]]",
  ].join("\n");
  const idx = parseChapterIndex(toc);
  assert.equal(idx.length, 3);
  assert.equal(idx[0].file, "chapters/第10讲.md");
  assert.equal(idx[0].title, "第10讲");
  assert.equal(idx[1].title, "第11讲 积分等式与不等式");
  assert.equal(idx[2].file, "chapters/第6讲.md");
});

test("normalizeTextForMatch：全角→半角、去空白、小写（OCR 容错）", () => {
  assert.equal(normalizeTextForMatch("ＡＢＣｄｅｆ１２３"), "abcdef123");
  assert.equal(normalizeTextForMatch("拉 格 朗 日"), "拉格朗日");
  assert.equal(normalizeTextForMatch("（连续）\n（可导）"), "(连续)(可导)");
  assert.equal(normalizeTextForMatch("Ｒ（Ｘ）＝Ｆ'（Ｘ）"), "r(x)=f'(x)");
});

/** 构造 TextbookIndex：行文本数组 → IndexedLine（norm 由 normalizeTextForMatch 生成，与 main.ts 构建逻辑一致） */
const mkIdx = (path, lines) => ({
  path,
  lines: lines.map((text) => ({ text, norm: normalizeTextForMatch(text) })),
});

test("searchTextbookIndex：整串命中 + 行号 1 起 + 上下文窗口", () => {
  const index = [
    mkIdx("chapters/第6讲.md", ["前文行", "定理 7(拉格朗日中值定理)。", "设 $f(x)$ 满足条件。", "结论成立。", "后文一", "后文二", "后文三"]),
  ];
  const r = searchTextbookIndex(index, "拉格朗日中值定理");
  assert.ok(r);
  assert.equal(r.found, true);
  assert.equal(r.refs[0].file, "chapters/第6讲.md");
  assert.equal(r.refs[0].startLine, 2); // 行号从 1 起
  assert.ok(r.refs[0].text.includes("前文行")); // 上下文含前一行
});

test("searchTextbookIndex：OCR 差异（空格/全角）也能命中", () => {
  const index = [mkIdx("f.md", ["拉格朗日　中值定理：连续且可导"])];
  const r = searchTextbookIndex(index, "拉格朗日 中值定理 连续");
  assert.ok(r && r.found);
});

test("searchTextbookIndex：长 query 截尾重试命中核心片段", () => {
  const index = [mkIdx("f.md", ["拉格朗日中值定理的条件是函数在闭区间上连续"])];
  const r = searchTextbookIndex(index, "为什么拉格朗日中值定理要求函数连续而不是可导？");
  assert.ok(r && r.found);
});

test("searchTextbookIndex：未命中 → found:false", () => {
  const index = [mkIdx("f.md", ["泰勒展开的内容与教材无关"])];
  const r = searchTextbookIndex(index, "矩阵的特征值怎么求");
  assert.ok(r);
  assert.equal(r.found, false);
});

test("searchTextbookIndex：maxHits 上限", () => {
  const index = [
    mkIdx("f1.md", ["关键词甲", "普通行", "普通行", "关键词甲", "关键词甲"]),
    mkIdx("f2.md", ["普通行", "关键词甲"]),
  ];
  const r = searchTextbookIndex(index, "关键词甲", 3);
  assert.ok(r && r.found);
  assert.equal(r.refs.length, 3);
});

test("searchTextbookIndex：短 query 返回 null（交给语义层）", () => {
  const index = [mkIdx("f.md", ["的的的的的"])];
  assert.equal(searchTextbookIndex(index, "的"), null);
  assert.equal(searchTextbookIndex(index, ""), null);
});

test("formatRefsText：编号文本 + 讲次标注 + 行号区间 + 5000 截断", () => {
  const text = formatRefsText([
    { file: "chapters/第6讲.md", startLine: 364, endLine: 391, text: "定理 7(拉格朗日中值定理)" },
    { file: "chapters/第6讲.md", startLine: 0, endLine: 0, text: "无行号退化" },
  ]);
  assert.ok(text.includes("【教材引用 #1｜第6讲】"));
  assert.ok(text.includes("行：364-391"));
  assert.ok(text.includes("位置：见原文"));
  const long = formatRefsText([{ file: "f.md", startLine: 1, endLine: 2, text: "甲".repeat(6000) }]);
  assert.ok(long.length <= 5000);
});

test("formatRefsText：最多 6 条且每条 400 字截断", () => {
  const refs = Array.from({ length: 10 }, (_, i) => ({
    file: `chapters/第${i + 1}讲.md`,
    startLine: 1,
    endLine: 2,
    text: "乙".repeat(600),
  }));
  const text = formatRefsText(refs);
  // 6 条 × 400 字原文 = 2400 + 头部信息，总长远小于 5000
  assert.ok(text.includes("【教材引用 #6｜第6讲】"));
  assert.ok(!text.includes("【教材引用 #7"));
  assert.ok(text.length < 5000);
});

test("diverseTop：同文件去重到 maxPerFile、跨文件保序、k 截断", () => {
  const refs = [
    { file: "chapters/第1讲.md", startLine: 1, endLine: 2, text: "a" },
    { file: "chapters/第1讲.md", startLine: 10, endLine: 12, text: "b" },
    { file: "chapters/第1讲.md", startLine: 20, endLine: 22, text: "c" },
    { file: "chapters/第2讲.md", startLine: 5, endLine: 6, text: "d" },
    { file: "chapters/第3讲.md", startLine: 8, endLine: 9, text: "e" },
  ];
  // 默认每文件 2 条：第1讲 保留前 2，第2/3讲各 1 → 共 4 条
  const top = diverseTop(refs, 6);
  assert.deepEqual(top.map((r) => r.startLine), [1, 10, 5, 8]);
  // k 截断：只取前 3 条
  const k3 = diverseTop(refs, 3);
  assert.deepEqual(k3.map((r) => r.startLine), [1, 10, 5]);
  // maxPerFile=1：每文件只留 1 条
  const one = diverseTop(refs, 6, 1);
  assert.deepEqual(one.map((r) => r.startLine), [1, 5, 8]);
  // 空输入
  assert.deepEqual(diverseTop([], 6), []);
});

test("parseRewriteOutput：标准格式解析", () => {
  const r = parseRewriteOutput(
    ["【关键词】拉格朗日中值定理;条件;连续", "【章节】第6讲", "【同义】可导;柯西中值定理"].join("\n")
  );
  assert.deepEqual(r.keywords, ["拉格朗日中值定理", "条件", "连续"]);
  assert.deepEqual(r.chapters, ["第6讲"]);
  assert.deepEqual(r.synonyms, ["可导", "柯西中值定理"]);
});

test("parseRewriteOutput：容错（无【】格式退化为整段关键词）", () => {
  const r = parseRewriteOutput("拉格朗日中值定理的条件");
  assert.ok(r.keywords.length >= 1);
  assert.equal(r.chapters.length, 0);
  const empty = parseRewriteOutput("");
  assert.deepEqual(empty.keywords, []);
});

test("chunkTextbook：标题开新块，块带行号区间", () => {
  const text = [
    "# 第6讲 中值定理",
    "正文一是关于定理的前提条件与结论的说明。",
    "## 6.1 拉格朗日中值定理",
    "定理内容：函数在闭区间连续、开区间可导，则存在一点使得导数等于割线斜率。",
    "## 6.2 例题",
    "例题内容：应用定理证明相关不等式关系成立。",
  ].join("\n");
  const chunks = chunkTextbook(text, "chapters/第6讲.md", 900, 135);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].file, "chapters/第6讲.md");
  assert.ok(chunks[0].text.startsWith("# 第6讲 中值定理"));
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[0].endLine, 2);
  assert.equal(chunks[1].startLine, 3);
  assert.equal(chunks[2].startLine, 5);
});

test("chunkTextbook：字符上限切块 + 尾部重叠", () => {
  const line = "这是一段足够长的正文内容。".repeat(20); // 每行 ~100 字，4 行
  const text = ["# 标题", line, line, line, line].join("\n");
  const chunks = chunkTextbook(text, "f.md", 250, 60);
  assert.ok(chunks.length >= 2);
  // 重叠：前一块末尾行会出现在后一块开头
  assert.ok(chunks[0].text.length <= 250 + 120);
  assert.equal(chunks[0].startLine, 1);
  assert.ok(chunks[1].startLine <= chunks[0].endLine);
});

test("chunkTextbook：空/过短文本不产生块", () => {
  assert.deepEqual(chunkTextbook("", "f.md"), []);
  assert.deepEqual(chunkTextbook("很短", "f.md"), []);
});

test("searchTextbookIndex：整串命中 exact=true，截尾命中 exact=false", () => {
  const index = [mkIdx("f.md", ["拉格朗日中值定理的条件是函数在闭区间上连续"])];
  const exact = searchTextbookIndex(index, "拉格朗日中值定理的条件");
  assert.ok(exact && exact.found && exact.exact === true);
  const truncated = searchTextbookIndex(index, "拉格朗日中值定理的条件什么情况下成立");
  assert.ok(truncated && truncated.found && truncated.exact === false);
});

test("rrfMerge：多路融合去重 + 排名倒数融合分", () => {
  const ref = (file, line) => ({ file, startLine: line, endLine: line, text: `内容${file}${line}` });
  const groupA = [ref("f1.md", 10), ref("f2.md", 20), ref("f3.md", 30)]; // 文本路（按序）
  const groupB = [ref("f2.md", 20), ref("f3.md", 30), ref("f4.md", 40)]; // 向量路（按序）
  const merged = rrfMerge([groupA, groupB], 60);
  assert.equal(merged.length, 4); // f2/f3 去重合并
  // 两路都排第 2 的 f2 融合分最高（1/61*2 > 1/61+1/62）
  assert.equal(merged[0].ref.file, "f2.md");
  // 单路候选靠后
  assert.equal(merged[3].ref.file, "f4.md");
  // 分数单调递减
  for (let i = 1; i < merged.length; i++) assert.ok(merged[i - 1].score >= merged[i].score);
});

test("rrfMerge：空路/无候选 → 空数组", () => {
  assert.deepEqual(rrfMerge([[], []]), []);
  assert.deepEqual(rrfMerge([]), []);
});

// ---- BM25 文本打分路（L1.5）----

test("tokenizeText：字母数字串 + CJK 单字 + CJK 2-gram", () => {
  const t = tokenizeText("f'(x)拉格朗日ε");
  assert.ok(t.includes("f'")); // 数学符号连体（撇号保留）
  assert.ok(t.includes("ε")); // 希腊字母按单字/串处理
  // CJK：4 单字 + 3 个 2-gram
  const cjk = t.filter((x) => /^[一-鿿]/.test(x));
  assert.equal(cjk.length, 4 + 3);
  assert.ok(cjk.includes("拉格"));
  assert.ok(cjk.includes("朗日"));
  assert.ok(cjk.includes("日"));
});

test("buildBm25Index：倒排 + 行长度统计", () => {
  const idx = [
    mkIdx("f.md", ["拉格朗日中值定理的条件是函数在闭区间上连续", "这里讲泰勒展开的内容"]),
  ];
  const b = buildBm25Index(idx);
  assert.ok(b.postings.has("定理"));
  assert.ok(b.postings.has("拉格"));
  assert.equal(b.nLines, 2);
  assert.equal(b.docLen.get("0:0"), tokenizeText("拉格朗日中值定理的条件是函数在闭区间上连续").length);
});

test("bm25Search：术语密集行分数高于稀疏行", () => {
  const idx = [
    mkIdx("f.md", [
      "拉格朗日中值定理：设函数在闭区间连续开区间可导，则存在一点使导数等于割线斜率。中值定理是微分学核心。",
      "这一行只是顺带提到一句中值定理相关话题但不展开任何细节内容。",
      "完全无关的内容：矩阵的特征值分解与对角化。",
    ]),
  ];
  const b = buildBm25Index(idx);
  const hits = bm25Search(idx, b, "拉格朗日中值定理", 5);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].ref.startLine, 1); // 术语密集行排第一
});

test("bm25Search：数学符号 token 命中（ε-N 定义）", () => {
  const idx = [
    mkIdx("f.md", [
      "定义 3 设数列 {x_n}，任给 ε>0，存在正整数 N，当 n>N 时有 |x_n-a|<ε，则称 a 为极限。",
      "极限的唯一性证明与保号性讨论。",
    ]),
  ];
  const b = buildBm25Index(idx);
  const hits = bm25Search(idx, b, "ε-N 语言定义数列极限", 5);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].ref.startLine, 1);
});

test("bm25Search：空 query / 无命中 → 空数组", () => {
  const idx = [mkIdx("f.md", ["普通内容行"])];
  const b = buildBm25Index(idx);
  assert.deepEqual(bm25Search(idx, b, ""), []);
  assert.deepEqual(bm25Search(idx, b, "量子色动力学"), []);
});

// ---- 查询理解（Query Understanding）----

const QU_JSON = JSON.stringify({
  concept: "拉格朗日中值定理",
  intent: "求理解",
  knowledge_need: "为什么要求函数连续而不是可导",
  related_terms: ["罗尔定理", "柯西中值定理", "可导"],
  chapters: ["第6讲"],
  queries: [
    "为什么拉格朗日中值定理要求函数连续",
    "拉格朗日中值定理的适用条件",
    "中值定理类题目的条件分析",
  ],
});

test("parseQueryUnderstanding：标准 JSON 完整解析", () => {
  const u = parseQueryUnderstanding(QU_JSON);
  assert.ok(u);
  assert.equal(u.concept, "拉格朗日中值定理");
  assert.equal(u.intent, "求理解");
  assert.equal(u.knowledgeNeed, "为什么要求函数连续而不是可导");
  assert.deepEqual(u.relatedTerms, ["罗尔定理", "柯西中值定理", "可导"]);
  assert.deepEqual(u.chapters, ["第6讲"]);
  assert.equal(u.queries.length, 3);
});

test("parseQueryUnderstanding：容错（```json 围栏 + 前后废话）", () => {
  const u = parseQueryUnderstanding(
    ["好的，我的分析如下：", "```json", QU_JSON, "```", "以上是结构化输出。"].join("\n")
  );
  assert.ok(u);
  assert.equal(u.concept, "拉格朗日中值定理");
});

test("parseQueryUnderstanding：无 queries 时用 concept/knowledge_need 兜底", () => {
  const u = parseQueryUnderstanding(
    JSON.stringify({ concept: "洛必达法则", knowledge_need: "什么时候可以用", related_terms: [], chapters: [] })
  );
  assert.ok(u);
  assert.equal(u.queries.length, 2);
  assert.ok(u.queries.includes("洛必达法则"));
});

test("parseQueryUnderstanding：queries 过短过滤 + 最多 3 个", () => {
  const u = parseQueryUnderstanding(
    JSON.stringify({ concept: "x", queries: ["短", "长的查询变体一", "长的查询变体二", "长的查询变体三", "长的查询变体四"] })
  );
  assert.ok(u);
  assert.equal(u.queries.length, 3);
});

test("parseQueryUnderstanding：完全非 JSON / 空 → null（降级旧路径）", () => {
  assert.equal(parseQueryUnderstanding(""), null);
  assert.equal(parseQueryUnderstanding("我不确定怎么回答"), null);
  assert.equal(parseQueryUnderstanding("```json\n{broken json"), null);
});

test("parseQueryUnderstanding：chapters 归一化（拼串标题 → 第N讲 token）", () => {
  const u = parseQueryUnderstanding(
    JSON.stringify({
      concept: "积分等式",
      knowledge_need: "积分等式与积分不等式的统一解题方法",
      related_terms: [],
      chapters: ["第10讲、第11讲 一元函数积分学的应用（二） ——积分等式与积分不等式"],
      queries: ["积分等式的统一骨架"],
    })
  );
  assert.ok(u);
  assert.deepEqual(u.chapters, ["第10讲", "第11讲"]);
  // 无 第N讲 的内容原样保留（非讲次教材兜底）
  const u2 = parseQueryUnderstanding(
    JSON.stringify({ concept: "x", related_terms: [], chapters: ["微分学"], queries: ["a查询变体一"] })
  );
  assert.ok(u2);
  assert.deepEqual(u2.chapters, ["微分学"]);
});
