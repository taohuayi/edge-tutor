import { test } from "node:test";
import assert from "node:assert/strict";
import { toJSONBackup, parseJSONBackup, formatConversationMarkdown, formatConvMarkdown } from "./.build/export.cjs";
import { freshConv, addThread, pushMessage } from "./.build/conv.cjs";

const sampleNodes = [
  {
    title: "共轭式：不是神来的第一笔",
    content: "",
    parentTitle: "代数变形的目标链",
    anchor: { sourcePath: "PDF p.11", quote: "例1.3 指数化" },
    status: "active",
    rootQuestion: "为什么想到构造这个式子",
    summary: "区分发现过程与呈现过程",
    question: "为什么想到构造这个式子",
    mentorResponse: "先用移项平方得到倒数项",
  },
];

test("JSON 备份 roundtrip：全字段完整", () => {
  const json = toJSONBackup(sampleNodes, { workspace: "main", source: "Example notes" });
  const parsed = parseJSONBackup(json);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.nodes.length, 1);
  const n = parsed.nodes[0];
  assert.equal(n.title, "共轭式：不是神来的第一笔");
  assert.equal(n.parentTitle, "代数变形的目标链");
  assert.equal(n.anchor.sourcePath, "PDF p.11");
  assert.equal(n.anchor.quote, "例1.3 指数化");
  assert.equal(n.status, "active");
  assert.equal(n.summary, "区分发现过程与呈现过程");
  assert.equal(n.mentorResponse, "先用移项平方得到倒数项");
  assert.equal(parsed.meta.workspace, "main");
});

test("parseJSONBackup：非法 JSON → ok:false + error", () => {
  const parsed = parseJSONBackup("{broken");
  assert.equal(parsed.ok, false);
  assert.ok(parsed.error);
  assert.equal(parsed.nodes.length, 0);
});

test("parseJSONBackup：空输入 → ok:false", () => {
  const parsed = parseJSONBackup("");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.nodes.length, 0);
});

test("parseJSONBackup：顶层数组兜底解析", () => {
  const parsed = parseJSONBackup(JSON.stringify([{ title: "A", status: "active" }]));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.nodes[0].title, "A");
});

test("formatConversationMarkdown：节点分节完整", () => {
  const md = formatConversationMarkdown(sampleNodes, { title: "导出", source: "教材", workspace: "main" });
  assert.ok(md.includes("# 导出"));
  assert.ok(md.includes("**节点问题**"));
  assert.ok(md.includes("[[代数变形的目标链]]"));
  assert.ok(md.includes("PDF p.11"));
});

test("formatConvMarkdown：线程树 + 未归属消息 + 停车场", () => {
  const conv = freshConv("main");
  const t = addThread(conv, { question: "根问题", anchor: { sourcePath: "a.md", quote: "x" } });
  pushMessage(conv, "user", "根问题", { lineId: t.id });
  pushMessage(conv, "assistant", "根回答", { lineId: t.id });
  pushMessage(conv, "user", "未归属消息");
  conv.reading.parkingLot.push({ id: "p1", question: "稍后想", category: "later", parentId: null, anchor: null, createdAt: "" });
  const md = formatConvMarkdown(conv, { title: "会话导出" });
  assert.ok(md.includes("## 思维链总览"));
  assert.ok(md.includes("根问题"));
  assert.ok(md.includes("未归入思维节点的消息"));
  assert.ok(md.includes("问题停车场"));
  assert.ok(md.includes("稍后想"));
});
