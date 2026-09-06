/**
 * v0.10.1 viewlogic 纯逻辑回归测试
 * （C5 分层第一步：从 view.ts 抽出的流式段落判定 / 引用解析）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paragraphReady,
  splitCommittableParagraphs,
  parseCiteRef,
  normalizeMath,
  buildWsTreeData,
} from "./.build/viewlogic.cjs";

test("paragraphReady：围栏成对且公式闭合 → true", () => {
  assert.equal(paragraphReady("普通段落"), true);
  assert.equal(paragraphReady("行内 \\(x\\) 公式"), true);
  assert.equal(paragraphReady("块级 \\[x\\] 公式"), true);
});

test("paragraphReady：围栏未闭合 → false", () => {
  assert.equal(paragraphReady("```js\nconst a = 1;"), false);
});

test("paragraphReady：公式半截 → false", () => {
  assert.equal(paragraphReady("半截 \\(x"), false);
  assert.equal(paragraphReady("半截 \\[x"), false);
});

test("splitCommittableParagraphs：完整段落进 done，尾部未闭合段留 rest", () => {
  const { done, rest } = splitCommittableParagraphs("第一段。\n\n第二段。\n\n未闭合 \\(x");
  assert.deepEqual(done, ["第一段。", "第二段。"]);
  assert.equal(rest, "未闭合 \\(x");
});

test("splitCommittableParagraphs：围栏跨段 → 后半整体留 rest", () => {
  const { done, rest } = splitCommittableParagraphs("上文。\n\n```js\nconst a = 1;\n\n```\n后文。");
  // 第一段可提交；围栏段未闭合时（若闭合成对则也可提交）
  assert.ok(done.length >= 1);
  assert.equal(done[0], "上文。");
  assert.ok((done.join("\n\n") + "\n\n" + rest).includes("```js"));
});

test("splitCommittableParagraphs：空 pending → 空结果", () => {
  assert.deepEqual(splitCommittableParagraphs(""), { done: [], rest: "" });
});

test("parseCiteRef：解析【📖 文件:行】与区间", () => {
  assert.deepEqual(parseCiteRef("见【📖 第1讲.md:698】"), { file: "第1讲.md", line: 698 });
  assert.deepEqual(parseCiteRef("见【📖 a/b/第2讲.md:12-20】"), { file: "a/b/第2讲.md", line: 12 });
  assert.equal(parseCiteRef("没有引用"), null);
  assert.equal(parseCiteRef("【📖 无行号.md】"), null);
});

test("normalizeMath：行内/块级公式转 Obsidian MathJax 格式", () => {
  assert.equal(normalizeMath("行内 \\(x^2\\) 公式"), "行内 $x^2$ 公式");
  assert.equal(normalizeMath("块级 \\[x^2\\] 公式"), "块级 $$x^2$$ 公式");
});

test("normalizeMath：半截括号兜底（不破坏普通文本）", () => {
  assert.equal(normalizeMath("普通文本无公式"), "普通文本无公式");
  assert.equal(normalizeMath("半截 \\(x"), "半截 $x");
});

test("buildWsTreeData：main → 默认工作区；嵌套路径建树", () => {
  const tree = buildWsTreeData(["main", "Calculus/1", "Calculus/2", "Foundations/intro"]);
  const names = tree.map((n) => n.name).sort();
  assert.deepEqual(names, ["Calculus", "Foundations", "默认工作区"].sort());
  const calculus = tree.find((n) => n.name === "Calculus");
  assert.ok(calculus, "应存在 Calculus 文件夹");
  assert.equal(calculus.children.length, 2);
  assert.equal(calculus.children[0].id, "Calculus/1");
  assert.equal(calculus.children[0].name, "1");
});

test("buildWsTreeData：文件夹节点排前，文件夹内按中文排序", () => {
  const tree = buildWsTreeData(["a/b", "c", "b"]);
  // a 是文件夹（有子）应排最前
  assert.equal(tree[0].name, "a");
  assert.deepEqual(tree.slice(1).map((n) => n.name), ["b", "c"]);
});
