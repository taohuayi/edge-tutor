import { test } from "node:test";
import assert from "node:assert/strict";
import { mindMapLayout, layoutToCoordinates, buildEdgePath } from "./.build/canvas.cjs";

function T(id, parentId) {
  return { id, title: id, parentId };
}

test("单根两子：正确生成边与层级", () => {
  const threads = [T("root"), T("a", "root"), T("b", "root")];
  const layout = mindMapLayout(threads);
  assert.equal(layout.nodes.length, 3);
  assert.equal(layout.edges.length, 2);
  const root = layout.nodes.find((p) => p.thread.id === "root");
  assert.equal(root.column, 0);
  for (const p of layout.nodes) {
    if (p.thread.id !== "root") assert.equal(p.column, 1);
  }
});

test("多根：每个根独立放置", () => {
  const layout = mindMapLayout([T("r1"), T("r2"), T("c", "r1")]);
  assert.equal(layout.nodes.length, 3);
  const r1 = layout.nodes.find((p) => p.thread.id === "r1");
  const r2 = layout.nodes.find((p) => p.thread.id === "r2");
  assert.equal(r1.column, 0);
  assert.equal(r2.column, 0);
});

test("环（a↔b）：不死循环，兜底放置", () => {
  const layout = mindMapLayout([T("a", "b"), T("b", "a")]);
  assert.equal(layout.nodes.length, 2);
});

test("无效 parentId：归入根放置", () => {
  const layout = mindMapLayout([T("x", "ghost")]);
  assert.equal(layout.nodes.length, 1);
  const x = layout.nodes[0];
  assert.equal(x.column, 0);
});

test("深度链：父子 column 逐级递增", () => {
  const layout = mindMapLayout([T("a"), T("b", "a"), T("c", "b"), T("d", "c")]);
  const col = (id) => layout.nodes.find((p) => p.thread.id === id).column;
  assert.deepEqual([col("a"), col("b"), col("c"), col("d")], [0, 1, 2, 3]);
});

test("layoutToCoordinates：画布尺寸覆盖最远节点", () => {
  const layout = mindMapLayout([T("a"), T("b", "a"), T("c", "b")]);
  const { positions, canvasWidth, canvasHeight } = layoutToCoordinates(layout);
  assert.ok(canvasWidth >= 300);
  assert.ok(canvasHeight >= 150);
  const a = positions.get("a");
  const c = positions.get("c");
  // 链式树：同一列（x 相同），深度递增（y 递增）
  assert.equal(c.x, a.x);
  assert.ok(c.y > a.y);
});

test("buildEdgePath：生成贝塞尔路径字符串", () => {
  const d = buildEdgePath(0, 0, 100, 100, 150, 48);
  assert.ok(d.startsWith("M "));
  assert.ok(d.includes("C "));
});
