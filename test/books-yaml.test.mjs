import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBooksYaml } from "./.build/search.cjs";

/** LearningOS 真实 books.yaml 内容（ingest_book.py 注册表，2026-08-10 三本） */
const REAL_BOOKS_YAML = `# LearningOS 教材注册表（ingest_book.py 维护）
# 每本教材一行，edge-tutor 插件据此发现教材

- {id: politics-毛中特选择题集, name: 毛中特选择题集, subject: politics, root: learning/peizhi/learn/_materials/politics/毛中特选择题集, chapters_dir: chapters, toc_file: toc.md}
- {id: math-张宇基础30讲, name: 张宇基础30讲, subject: math, root: learning/peizhi/learn/_materials/math/张宇基础30讲, chapters_dir: chapters, toc_file: toc.md}
- {id: systems-theory-学习观, name: 学习观, subject: systems-theory, root: learning/peizhi/learn/_materials/systems-theory/学习观, chapters_dir: chapters, toc_file: toc.md}
`;

test("parseBooksYaml：真实 books.yaml → 3 条注册项（id/name/root）", () => {
  const books = parseBooksYaml(REAL_BOOKS_YAML);
  assert.equal(books.length, 3);
  assert.deepEqual(
    books.map((b) => b.id),
    ["politics-毛中特选择题集", "math-张宇基础30讲", "systems-theory-学习观"]
  );
  assert.equal(books[1].name, "张宇基础30讲");
  assert.equal(books[2].root, "learning/peizhi/learn/_materials/systems-theory/学习观");
});

test("parseBooksYaml：注释/空行/坏行跳过，不抛错", () => {
  const text = [
    "# 注释",
    "",
    "- {id: ok, name: 好的, root: a/b}",
    "这行不是注册项",
    "- {id: no-root, name: 缺root}",
    "- {id: empty-value, name: , root: x/y}",
  ].join("\n");
  const books = parseBooksYaml(text);
  assert.equal(books.length, 1);
  assert.equal(books[0].id, "ok");
});

test("parseBooksYaml：值带引号剥引号（单/双）", () => {
  const books = parseBooksYaml('- {id: "a", name: \'书名 带空格\', root: "p/q 目录"}');
  assert.equal(books.length, 1);
  assert.equal(books[0].id, "a");
  assert.equal(books[0].name, "书名 带空格");
  assert.equal(books[0].root, "p/q 目录");
});

test("parseBooksYaml：空/非字符串输入 → []", () => {
  assert.deepEqual(parseBooksYaml(""), []);
  assert.deepEqual(parseBooksYaml(null), []);
  assert.deepEqual(parseBooksYaml("----"), []);
});
