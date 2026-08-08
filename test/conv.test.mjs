import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshConv, addThread, pushMessage, serializeConv, parseConv,
  messagesForView, ancestry, buildConvFromNodes, cognitiveMapSummary, removeMessage,
} from "./.build/conv.cjs";

test("freshConv：空会话结构", () => {
  const conv = freshConv("main");
  assert.equal(conv.workspace, "main");
  assert.deepEqual(conv.messages, []);
  assert.equal(conv.reading.threads.length, 0);
  assert.equal(conv.reading.activeId, null);
});

test("addThread：id 递增 + activeId 更新 + parentId", () => {
  const conv = freshConv("main");
  const t1 = addThread(conv, { question: "q1" });
  const t2 = addThread(conv, { question: "q2", parentId: t1.id });
  assert.equal(t1.id, "q1");
  assert.equal(t2.id, "q2");
  assert.equal(conv.reading.activeId, "q2");
  assert.equal(t2.parentId, "q1");
});

test("serializeConv → parseConv roundtrip：字段完整", () => {
  const conv = freshConv("ws1");
  const t = addThread(conv, { question: "为什么", anchor: { sourcePath: "a.md", quote: "原文" } });
  pushMessage(conv, "user", "为什么", { lineId: t.id });
  pushMessage(conv, "assistant", "因为", { lineId: t.id, agent: true });
  const parsed = parseConv(serializeConv(conv));
  assert.ok(parsed);
  assert.equal(parsed.workspace, "ws1");
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.reading.threads.length, 1);
  assert.equal(parsed.messages[1].agent, true);
});

test("parseConv：非法 JSON → null", () => {
  assert.equal(parseConv("not json{{{"), null);
});

test("parseConv：缺 messages → null", () => {
  assert.equal(parseConv('{"workspace":"main"}'), null);
});

test("parseConv：v3 旧格式（顶层 parkingLot，无 reading.threads）兼容", () => {
  const v3 = JSON.stringify({
    version: 3, kind: "edge-tutor-conv", workspace: "main",
    messages: [{ id: "m1", role: "user", content: "hi", ts: 1 }],
    parkingLot: [{ id: "p1", question: "待办", category: "later", parentId: null, anchor: null, createdAt: "" }],
  });
  const parsed = parseConv(v3);
  assert.ok(parsed);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.reading.parkingLot.length, 1);
  assert.equal(parsed.reading.parkingLot[0].question, "待办");
});

test("parseConv：损坏的线程条目被过滤", () => {
  const bad = JSON.stringify({
    workspace: "main",
    messages: [],
    reading: { threads: [null, { id: "q1", title: "ok" }, { id: "q2" }] },
  });
  const parsed = parseConv(bad);
  assert.ok(parsed);
  assert.equal(parsed.reading.threads.length, 1);
  assert.equal(parsed.reading.threads[0].id, "q1");
});

test("removeMessage：按引用删除 + 顺序保持 + 未找到返回 false", () => {
  const conv = freshConv("main");
  const t = addThread(conv, { question: "q" });
  const u = pushMessage(conv, "user", "提问", { lineId: t.id });
  const a = pushMessage(conv, "assistant", "回答", { lineId: t.id });
  const ghost = { id: "mx", role: "user", content: "x", ts: 1 };
  assert.equal(removeMessage(conv, ghost), false);
  assert.equal(removeMessage(conv, u), true);
  assert.equal(conv.messages.length, 1);
  assert.equal(conv.messages[0], a);
  assert.equal(removeMessage(conv, a), true);
  assert.deepEqual(conv.messages, []);
});

test("messagesForView：all / path / node 三种过滤", () => {
  const conv = freshConv("main");
  const root = addThread(conv, { question: "根" });
  const branch = addThread(conv, { question: "分支", parentId: root.id });
  const other = addThread(conv, { question: "独立" });
  pushMessage(conv, "user", "根问题", { lineId: root.id });
  pushMessage(conv, "assistant", "根回答", { lineId: root.id });
  pushMessage(conv, "user", "分支问题", { lineId: branch.id });
  pushMessage(conv, "user", "独立问题", { lineId: other.id });
  conv.reading.activeId = branch.id;

  assert.equal(messagesForView(conv, "all").length, 4);
  // path：活跃线程的祖先链（根+分支）
  const pathMsgs = messagesForView(conv, "path");
  assert.equal(pathMsgs.length, 3);
  // node：仅活跃线程
  const nodeMsgs = messagesForView(conv, "node");
  assert.equal(nodeMsgs.length, 1);
  assert.equal(nodeMsgs[0].content, "分支问题");
});

test("ancestry：从叶到根的祖先链", () => {
  const conv = freshConv("main");
  const a = addThread(conv, { question: "a" });
  const b = addThread(conv, { question: "b", parentId: a.id });
  const c = addThread(conv, { question: "c", parentId: b.id });
  const chain = ancestry(conv, c.id);
  assert.deepEqual(chain.map((t) => t.id), [a.id, b.id, c.id]);
});

test("buildConvFromNodes：工作区边界 + 父子映射 + 消息生成", () => {
  const nodes = [
    { title: "根", parentTitle: undefined, status: "active", anchor: { sourcePath: "", quote: "" }, rootQuestion: "", summary: "" },
    { title: "子A", parentTitle: "根", status: "active", anchor: { sourcePath: "", quote: "" }, rootQuestion: "为什么", summary: "回答A" },
    { title: "子B", parentTitle: "根", status: "paused", anchor: { sourcePath: "p.md", quote: "引文" }, rootQuestion: "怎么", summary: "回答B" },
    // 子工作区节点：parentTitle 指向本工作区不存在的节点 → 归根
    { title: "外来", parentTitle: "不存在", status: "active", anchor: { sourcePath: "", quote: "" }, rootQuestion: "外部", summary: "" },
  ];
  const conv = buildConvFromNodes(nodes, "main");
  assert.equal(conv.workspace, "main");
  assert.equal(conv.reading.threads.length, 4);
  assert.equal(conv.reading.threads[0].id, "q1");
  const a = conv.reading.threads.find((t) => t.title === "子A");
  assert.equal(a.parentId, "q1");
  assert.equal(a.status, "active");
  const b = conv.reading.threads.find((t) => t.title === "子B");
  assert.equal(b.parentId, "q1");
  assert.equal(b.status, "paused");
  const foreign = conv.reading.threads.find((t) => t.title === "外来");
  assert.equal(foreign.parentId, null); // 无效父 → 根
  // 消息：每个线程 ≥1 条 user；有摘要的线程有 assistant
  assert.equal(conv.messages.filter((m) => m.role === "user").length, 4);
  assert.equal(conv.messages.filter((m) => m.role === "assistant").length, 2);
  // 根节点无 rootQuestion → 用标题生成 user 消息
  assert.ok(conv.messages.some((m) => m.content === "根"));
});

test("buildConvFromNodes：完整导师回应优先于摘要", () => {
  const fullMd = [
    "---", "type: 认知节点", "status: active", "---", "",
    "# 直和分解", "",
    "## 💡 导师回应（价值识别）", "",
    "完整回答第一段。这里有一段较长的分析内容用于验证完整提取，不会被内部标题打断。", "",
    "# 一、内部标题段", "",
    "完整回答第二段，继续展开核心论点。", "",
    "## 二、再一个内部标题", "",
    "完整回答第三段，收束结论。", "",
    "## 🔗 原理链", "",
    "- 父节点：（无）", "",
  ].join("\n");
  const nodes = [
    {
      title: "直和分解", parentTitle: undefined, status: "active",
      anchor: { sourcePath: "", quote: "" }, rootQuestion: "问题",
      summary: "短摘要", content: fullMd,
    },
  ];
  const conv = buildConvFromNodes(nodes, "main");
  const assistant = conv.messages.find((m) => m.role === "assistant");
  assert.ok(assistant);
  // 完整内容（含内部标题），不是短摘要
  assert.ok(assistant.content.includes("完整回答第二段"));
  assert.ok(assistant.content.length > 50);
});

test("buildConvFromNodes：locked 节点恢复 mastery 封顶", () => {
  const nodes = [
    { title: "封顶链", parentTitle: undefined, status: "paused", locked: true, anchor: { sourcePath: "", quote: "" }, rootQuestion: "q", summary: "s" },
    { title: "普通链", parentTitle: undefined, status: "active", locked: false, anchor: { sourcePath: "", quote: "" }, rootQuestion: "q2", summary: "s2" },
  ];
  const conv = buildConvFromNodes(nodes, "main");
  const lockedT = conv.reading.threads.find((t) => t.title === "封顶链");
  assert.equal(lockedT.mastery, "mastered");
  const normal = conv.reading.threads.find((t) => t.title === "普通链");
  assert.equal(normal.mastery, undefined);
});

test("cognitiveMapSummary：缩进树 + 封顶标记 + 摘要", () => {
  const conv = freshConv("main");
  const root = addThread(conv, { question: "例 1.3 反函数" });
  root.title = "例 1.3 反函数";
  const child = addThread(conv, { question: "代数变形的目标链", parentId: root.id });
  child.title = "代数变形的目标链";
  child.summary = "从求反函数目标出发，指数化后利用共轭乘积为 1 构造第二式。";
  const grand = addThread(conv, { question: "直和分解", parentId: child.id });
  grand.title = "直和分解";
  grand.mastery = "mastered";
  grand.status = "paused";
  grand.summary = "对称性如何分解空间。";

  const map = cognitiveMapSummary(conv);
  // 封顶链收集
  assert.deepEqual(map.locked, ["直和分解"]);
  // 树结构：根无缩进，子缩进，摘要与封顶标记在行内
  const lines = map.summaryText.split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes("例 1.3 反函数"));
  assert.ok(lines[1].startsWith("  └─ 代数变形的目标链"));
  assert.ok(lines[1].includes("共轭乘积"));
  assert.ok(lines[2].startsWith("    └─ 直和分解"));
  assert.ok(lines[2].includes("🔒 封顶"));
});
