import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBooksYaml } from "./.build/search.cjs";

/** Portable registry fixture. */
const BOOKS_YAML = `# Optional Edge Tutor reference registry
# One reference collection per line

- {id: calculus-notes, name: Calculus Notes, subject: math, root: References/calculus, chapters_dir: chapters, toc_file: toc.md}
- {id: physics-notes, name: Physics Notes, subject: physics, root: References/physics, chapters_dir: chapters, toc_file: toc.md}
`;

test("parseBooksYaml：registry → id/name/root", () => {
  const books = parseBooksYaml(BOOKS_YAML);
  assert.equal(books.length, 2);
  assert.deepEqual(
    books.map((b) => b.id),
    ["calculus-notes", "physics-notes"]
  );
  assert.equal(books[1].name, "Physics Notes");
  assert.equal(books[0].root, "References/calculus");
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
