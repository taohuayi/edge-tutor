import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeVecs, decodeVecs, cosine, topKVectors, loadRemoteEmbedder, loadRemoteReranker } from "./.build/vector.cjs";

test("encodeVecs/decodeVecs：roundtrip 数值不变", () => {
  const vecs = [
    [0.1, 0.2, 0.3],
    [-1, 0.5, 2.25],
    [0, 0, 0],
  ];
  const b64 = encodeVecs(vecs);
  const back = decodeVecs(b64, 3);
  assert.equal(back.length, 3);
  assert.ok(Math.abs(back[0][0] - 0.1) < 1e-6);
  assert.ok(Math.abs(back[1][2] - 2.25) < 1e-6);
});

test("decodeVecs：空输入/非法维度 → 空数组", () => {
  assert.deepEqual(decodeVecs("", 3), []);
  assert.deepEqual(decodeVecs("AAAA", 0), []);
});

test("cosine：相同向量 = 1，正交 = 0，反向 = -1", () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-6);
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-6);
  assert.ok(Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-6);
});

test("topKVectors：按相似度降序取 top-k", () => {
  const q = [1, 0];
  const vecs = [
    [0, 1],
    [1, 0],
    [0.5, 0.5],
    [1, 0],
  ];
  const top = topKVectors(q, vecs, 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].idx, 1);
  assert.ok(Math.abs(top[0].score - 1) < 1e-6);
  assert.equal(top[1].idx, 3);
});

// ---- loadRemoteEmbedder（mock fetch：不碰真实网络） ----

/** mock fetch：记录调用并返回构造响应；用后恢复 */
function withMockFetch(handler) {
  const orig = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = orig;
  };
}

/** 按 input 顺序生成与请求对齐的响应（真实 API 行为） */
function okEmbeddings(calls, vecsOf) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, opts, body });
    return {
      ok: true,
      json: async () => ({
        object: "list",
        data: body.input.map((t, idx) => ({
          object: "embedding",
          index: idx,
          embedding: vecsOf(t, idx),
        })),
      }),
    };
  };
}

test("loadRemoteEmbedder：请求构造（URL/认证/参数/文档侧默认）", async () => {
  const calls = [];
  const restore = withMockFetch(okEmbeddings(calls, () => [0.1, 0.2, 0.3]));
  try {
    const { embed } = loadRemoteEmbedder({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1/",
      model: "text-embedding-v4",
      dim: 3,
    });
    const out = await embed(["你好"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.com/v1/embeddings"); // 尾斜杠归一
    assert.equal(calls[0].opts.method, "POST");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer sk-test");
    assert.equal(calls[0].body.model, "text-embedding-v4");
    assert.deepEqual(calls[0].body.input, ["你好"]);
    assert.equal(calls[0].body.dimensions, 3);
    assert.equal(calls[0].body.encoding_format, "float");
    assert.equal(calls[0].body.text_type, undefined); // 文档侧默认无指令参数
    assert.deepEqual(out, [[0.1, 0.2, 0.3]]);
  } finally {
    restore();
  }
});

test("loadRemoteEmbedder：query 标记 → text_type=query + instruct", async () => {
  const calls = [];
  const restore = withMockFetch(okEmbeddings(calls, () => [1, 0]));
  try {
    const { embed } = loadRemoteEmbedder({ apiKey: "k", baseUrl: "https://e.com/v1", model: "m", dim: 2 });
    await embed(["检索问题"], { query: true });
    assert.equal(calls[0].body.text_type, "query");
    assert.ok(calls[0].body.instruct.includes("retrieve relevant passages"));
    // 无 query 标记时不带这些参数
    await embed(["文档内容"]);
    assert.equal(calls[1].body.text_type, undefined);
    assert.equal(calls[1].body.instruct, undefined);
  } finally {
    restore();
  }
});

test("loadRemoteEmbedder：10 条/请求分批 + 顺序对齐", async () => {
  const texts = Array.from({ length: 25 }, (_, i) => `文本${i}`);
  const batchSizes = [];
  const restore = withMockFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    batchSizes.push(body.input.length);
    return {
      ok: true,
      json: async () => ({
        object: "list",
        data: body.input.map((t, idx) => ({
          object: "embedding",
          index: idx,
          // 全局索引编码在文本里（"文本N" → N）：跨批次仍能验证顺序对齐
          embedding: [Number(t.replace("文本", "")), 0],
        })),
      }),
    };
  });
  try {
    const { embed } = loadRemoteEmbedder({ apiKey: "k", baseUrl: "https://e.com/v1", model: "m", dim: 2 });
    const out = await embed(texts);
    assert.deepEqual(batchSizes, [10, 10, 5]);
    assert.equal(out.length, 25);
    assert.deepEqual(out[10], [10, 0]); // 批次边界处顺序仍对齐
    assert.deepEqual(out[24], [24, 0]);
  } finally {
    restore();
  }
});

test("loadRemoteEmbedder：非 2xx 抛错 / 响应缺 data 抛错", async () => {
  const restore = withMockFetch(async () => ({ ok: false, status: 400, text: async () => "batch too big" }));
  try {
    const { embed } = loadRemoteEmbedder({ apiKey: "k", baseUrl: "https://e.com/v1", model: "m", dim: 2 });
    await assert.rejects(() => embed(["x"]), /400/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    await assert.rejects(() => embed(["x"]), /data/);
    // 结果数不足也抛错（防截断）
    globalThis.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          object: "list",
          data: body.input.slice(0, 1).map((_, idx) => ({ object: "embedding", index: idx, embedding: [1, 0] })),
        }),
      };
    };
    await assert.rejects(() => embed(["a", "b"]), /结果/);
  } finally {
    restore();
  }
});

// ---- loadRemoteReranker（mock fetch：不碰真实网络） ----

/** 按真实 API 行为生成 rerank 响应：results 按 relevance_score 降序、含原始 index */
function okReranks(calls, scoresOf) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, opts, body });
    // 打乱顺序 + 降序排列（真实 API 不保证与 documents 同序，靠 index 对齐）
    const results = body.documents
      .map((t, idx) => ({ index: idx, relevance_score: scoresOf(t, idx) }))
      .sort((a, b) => b.relevance_score - a.relevance_score);
    return { ok: true, json: async () => ({ object: "list", results }) };
  };
}

test("loadRemoteReranker：请求构造（URL/认证/参数）+ 乱序结果按 index 对齐", async () => {
  const calls = [];
  // 分数与输入顺序相反 → 响应按分数降序（即倒序 index），对齐后必须还原输入顺序
  const restore = withMockFetch(okReranks(calls, (_t, idx) => [0.5, 0.9, 0.7][idx]));
  try {
    const { rerank } = loadRemoteReranker({
      apiKey: "sk-test",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-api/v1/",
      model: "qwen3-rerank",
    });
    const scores = await rerank("为什么要求连续", ["文档A", "文档B", "文档C"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://dashscope.aliyuncs.com/compatible-api/v1/reranks"); // 尾斜杠归一 + /reranks
    assert.equal(calls[0].opts.method, "POST");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer sk-test");
    assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
    assert.equal(calls[0].body.model, "qwen3-rerank");
    assert.equal(calls[0].body.query, "为什么要求连续");
    assert.deepEqual(calls[0].body.documents, ["文档A", "文档B", "文档C"]);
    // 响应按 index 对齐回 texts 顺序（0.5/0.9/0.7）
    assert.deepEqual(scores, [0.5, 0.9, 0.7]);
    assert.equal(scores.length, 3);
  } finally {
    restore();
  }
});

test("loadRemoteReranker：非 2xx 抛错 / 响应缺 results 抛错 / index 越界防御", async () => {
  const restore = withMockFetch(async () => ({ ok: false, status: 429, text: async () => "rate limited" }));
  try {
    const { rerank } = loadRemoteReranker({ apiKey: "k", baseUrl: "https://e.com/v1", model: "m" });
    await assert.rejects(() => rerank("q", ["a"]), /429/);
    // 缺 results → 抛错（调用方降级）
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    await assert.rejects(() => rerank("q", ["a"]), /results/);
    // index 越界/非数字 → 防御性忽略，不崩
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ results: [{ index: 99, relevance_score: 0.9 }, { index: "x", relevance_score: 0.8 }] }),
    });
    const scores = await rerank("q", ["a", "b"]);
    assert.deepEqual(scores, [0, 0]); // 越界与非法 index 全部丢弃
  } finally {
    restore();
  }
});
