import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGuideResponse } from "./.build/guide.cjs";

const fullJson = JSON.stringify({
  entries: [
    {
      id: "A1", jiang: "第6讲", title: "入口一",
      question: "核心问题？", whyWorthExploring: "值得", entryPoint: "切入口",
      tensions: ["张力1"], connections: ["连接1"], possibleTrails: ["尾迹1"],
      anchor: "教材锚点",
    },
  ],
});

test("正常 JSON 解析", () => {
  const entries = parseGuideResponse(fullJson);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.id, "A1");
  assert.equal(e.jiang, "第6讲");
  assert.deepEqual(e.tensions, ["张力1"]);
  assert.equal(e.anchor, "教材锚点");
});

test("新字段解析：type/anchorNode/direction", () => {
  const entries = parseGuideResponse(
    JSON.stringify({
      entries: [
        {
          type: "deepen", anchorNode: "核空间：变换看不到的方向",
          title: "核空间的几何直觉", question: "零空间的方向为什么看不见？",
          direction: "延伸到微分方程齐次解结构",
        },
        { type: "frontier", title: "中值定理新域", question: "为什么拉格朗日把导数极限传回函数值？" },
      ],
    })
  );
  assert.equal(entries.length, 2);
  const deepen = entries[0];
  assert.equal(deepen.type, "deepen");
  assert.equal(deepen.anchorNode, "核空间：变换看不到的方向");
  assert.equal(deepen.direction, "延伸到微分方程齐次解结构");
  const frontier = entries[1];
  assert.equal(frontier.type, "frontier");
  assert.equal(frontier.anchorNode, undefined);
});

test("type 字段缺失/非法 → 默认 frontier", () => {
  const entries = parseGuideResponse(JSON.stringify({ entries: [{ title: "无类型" }, { type: "weird", title: "非法类型" }] }));
  assert.equal(entries[0].type, "frontier");
  assert.equal(entries[1].type, "frontier");
});

test("JSON 被 ``` 代码块包裹", () => {
  const entries = parseGuideResponse("```json\n" + fullJson + "\n```");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "入口一");
});

test("非 JSON 文本：退化为文本行解析", () => {
  const entries = parseGuideResponse("- 方向一：极限\n- 方向二：导数");
  assert.equal(entries.length, 2);
  assert.ok(entries[0].title.includes("方向一"));
});

test("空文本 → 空数组", () => {
  assert.deepEqual(parseGuideResponse(""), []);
  assert.deepEqual(parseGuideResponse("随便说点什么"), []);
});

test("字段缺失/类型错误容错", () => {
  const entries = parseGuideResponse(
    JSON.stringify({ entries: [{ id: 123, title: null, problem: "兼容旧字段" }, {}] })
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "E1");
  assert.equal(entries[0].title, "（未命名入口）");
  assert.equal(entries[0].question, "兼容旧字段");
});
