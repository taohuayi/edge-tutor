import { test } from "node:test";
import assert from "node:assert/strict";
import { atToken, extractNoteLinks, buildNoteContextBlocks } from "./.build/ai.cjs";

test("atToken：@ 前是行首/空白/括号才触发", () => {
  assert.deepEqual(atToken("问 @cpu", 6), { token: "cpu", start: 2 });
  assert.deepEqual(atToken("@", 1), { token: "", start: 0 });
  assert.deepEqual(atToken("看（@a", 4), { token: "a", start: 2 });
});

test("atToken：@ 前是普通字符不触发（邮箱等）", () => {
  assert.equal(atToken("a@b", 3), null);
  assert.equal(atToken("邮箱 a@b", 6), null);
  assert.equal(atToken("追问@", 3), null);
  assert.equal(atToken("hello world", 11), null);
  assert.equal(atToken("", 0), null);
});

test("atToken：token 到空白/@ 截断", () => {
  assert.deepEqual(atToken("帮我 @cache 总结", 9), { token: "cache", start: 3 });
  assert.deepEqual(atToken("查 @cpu @gpu", 11), { token: "gpu", start: 7 });
});

test("extractNoteLinks：提取双链（去 alias/subpath）", () => {
  assert.deepEqual(
    extractNoteLinks("看 [[操作系统]] 和 [[CPU 缓存|缓存]] 与 [[笔记#章节]]"),
    ["操作系统", "CPU 缓存", "笔记"]
  );
  assert.deepEqual(extractNoteLinks("没有链接"), []);
});

test("buildNoteContextBlocks：拼接 + 截断 500 字 + 空返回空串", () => {
  const s = buildNoteContextBlocks([{ path: "a.md", content: "x".repeat(800) }]);
  assert.ok(s.includes('<context file="a.md">'));
  assert.ok(!s.includes("x".repeat(501)));
  const multi = buildNoteContextBlocks([
    { path: "a.md", content: "A" },
    { path: "b.md", content: "B" },
  ]);
  assert.ok(multi.includes("a.md") && multi.includes("b.md"));
  assert.equal(buildNoteContextBlocks([]), "");
});
