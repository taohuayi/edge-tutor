import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSearchResult, normalizeQuery, parseChapterIndex } from "./.build/search.cjs";

test("新格式：【文件】+【行号】+【原文】结构化解析", () => {
  const answer = [
    "【文件】learning/peizhi/learn/_materials/math/张宇基础30讲/chapters/第6讲.md",
    "【行号】364-391",
    "【原文】定理 7(拉格朗日中值定理)。设 $f(x)$ 满足 ①在 $[a,b]$ 上连续…",
    "",
    "【文件】learning/peizhi/learn/_materials/math/张宇基础30讲/chapters/第6讲.md",
    "【行号】420-425",
    "【原文】注 见到 $f(a)-f(b)$ 或 $f$ 与 $f'$ 的关系…",
  ].join("\n");
  const r = parseSearchResult(answer);
  assert.equal(r.found, true);
  assert.equal(r.count, 2);
  assert.equal(r.refs.length, 2);
  assert.equal(r.refs[0].file, "learning/peizhi/learn/_materials/math/张宇基础30讲/chapters/第6讲.md");
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
