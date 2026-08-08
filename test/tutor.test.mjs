import { test } from "node:test";
import assert from "node:assert/strict";
import { makeNodeTitle, buildNodeContent, parseNodeFromContent, extractMentorResponse } from "./.build/tutor.cjs";

test("makeNodeTitle：去问句前缀与标点", () => {
  assert.equal(makeNodeTitle("为什么这里要构造辅助函数？"), "这里要构造辅助函数");
  assert.equal(makeNodeTitle("如何求极限"), "求极限");
  assert.equal(makeNodeTitle("什么是隐函数"), "隐函数");
  assert.ok(makeNodeTitle("？？？").startsWith("认知节点"));
});

test("makeNodeTitle：长度截断", () => {
  const long = makeNodeTitle("这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的提问啊");
  assert.ok(long.length <= 28);
});

test("buildNodeContent → parseNodeFromContent roundtrip：全字段", () => {
  const node = {
    title: "核空间：变换看不到的方向",
    content: "",
    parentTitle: "反射算子 R 的特征空间",
    anchor: { sourcePath: "PDF p.11", quote: "核空间定义" },
    status: "paused",
    rootQuestion: "核空间为什么抽象",
    summary: "核空间描述一一对应性丢失的原因",
  };
  const md = buildNodeContent(node);
  const parsed = parseNodeFromContent("核空间：变换看不到的方向", md, "认知边缘/核空间.md");
  assert.equal(parsed.title, "核空间：变换看不到的方向");
  assert.equal(parsed.status, "paused");
  assert.equal(parsed.parentTitle, "反射算子 R 的特征空间");
  assert.equal(parsed.anchor.sourcePath, "PDF p.11");
  assert.equal(parsed.anchor.quote, "核空间定义");
  assert.ok(parsed.rootQuestion.includes("核空间为什么抽象"));
  assert.ok(parsed.summary.includes("一一对应性丢失"));
});

test("locked 封顶标记：buildNodeContent → parseNodeFromContent roundtrip", () => {
  const md = buildNodeContent({
    title: "封顶节点",
    content: "",
    anchor: { sourcePath: "", quote: "" },
    status: "active",
    locked: true,
  });
  const parsed = parseNodeFromContent("封顶节点", md, "x.md");
  assert.equal(parsed.locked, true);
  // 未设置 locked → false
  const md2 = buildNodeContent({ title: "普通", content: "", anchor: { sourcePath: "", quote: "" }, status: "active" });
  assert.equal(parseNodeFromContent("普通", md2, "x.md").locked, false);
});

test("parseNodeFromContent：缺字段容错", () => {
  const parsed = parseNodeFromContent("裸标题", "# 裸标题\n\n只有正文", "x.md");
  assert.equal(parsed.status, "active");
  assert.equal(parsed.parentTitle, undefined);
  assert.equal(parsed.anchor.sourcePath, "x.md");
});

test("buildNodeContent：frontmatter 可被正则解析", () => {
  const md = buildNodeContent({
    title: "T",
    content: "",
    anchor: { sourcePath: "", quote: "含\"引号\"的引文" },
    status: "active",
  });
  // quote 中引号被截断，但结构保持
  assert.ok(md.includes('anchor: "'));
  assert.ok(md.includes("# T"));
});

test("extractMentorResponse：正文内部 Markdown 标题不截断", () => {
  const content = [
    "---", "type: 认知节点", "status: active", "---", "",
    "# 直和分解：对称性如何切分空间", "",
    "## 📖 教材锚点", "",
    "## 🔍 追问", "",
    "函数空间=偶函数⊕奇函数", "",
    "## 💡 导师回应（价值识别）", "",
    "我先确认书里的语境。这里有一段较长的分析内容用于验证提取是否完整，不会被内部标题打断。", "",
    "# 一、对称性如何分解空间", "",
    "这是核心思想的第一节内容，包含投影、特征空间等概念的展开讨论。", "",
    "## 二、投影算子的视角", "",
    "第二节内容，继续深入探讨对称性与直和分解之间的联系。", "",
    "## 三、特征空间的意义", "",
    "第三节内容，把前面的分析连接到核空间与商空间。", "",
    "## 🔗 原理链", "",
    "- 父节点：[[奇偶分解：反射下的两大响应]]", "",
  ].join("\n");
  const full = extractMentorResponse(content);
  // 完整提取到 🔗 原理链 前，内部标题保留
  assert.ok(full.includes("我先确认书里的语境"));
  assert.ok(full.includes("# 一、对称性如何分解空间"));
  assert.ok(full.includes("投影算子的视角"));
  assert.ok(full.length > 100);
  assert.ok(!full.includes("原理链"));
});

test("parseNodeFromContent：导师回应区内部标题不截断摘要", () => {
  const content = [
    "---", "type: 认知节点", "status: paused", "",
    'parent: "[[父节点]]"', 'anchor: "引文"', 'anchorPath: "PDF p.11"', "---", "",
    "# 标题", "",
    "## 🔍 追问", "",
    "追问内容", "",
    "## 💡 导师回应（价值识别）", "",
    "开头段落。", "",
    "# 内部标题", "",
    "内部段落。", "",
    "## 🔗 原理链", "",
    "- 父节点：[[父节点]]", "",
  ].join("\n");
  const parsed = parseNodeFromContent("标题", content, "x.md");
  // summary 截断自完整提取（前 300 字符），应包含"开头段落"而非只有一行
  assert.ok(parsed.summary.includes("开头段落"));
  assert.equal(parsed.status, "paused");
  assert.equal(parsed.parentTitle, "父节点");
  assert.equal(parsed.anchor.sourcePath, "PDF p.11");
});
