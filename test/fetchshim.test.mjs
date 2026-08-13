import { test } from "node:test";
import assert from "node:assert/strict";
import { installCorsBypassFetch } from "./.build/fetchshim.cjs";

test("CORS 桥：file:// 读取本地文件并返回 Response（wasm 加载路径）", async () => {
  installCorsBypassFetch();
  const url = "file:///" + "E:/杂七杂八的垃圾堆/LearningOS/.obsidian/plugins/edge-tutor/lib/ort-wasm-simd-threaded.wasm";
  const res = await fetch(url);
  assert.equal(res.status, 200);
  const buf = await res.arrayBuffer();
  assert.ok(buf.byteLength > 1000, "wasm 文件字节数应 > 1KB");
  // 内容即文件内容（magic \0asm）
  const magic = new Uint8Array(buf.slice(0, 4));
  assert.deepEqual(Array.from(magic), [0, 97, 115, 109]);
});

test("CORS 桥：file:// 文件不存在 → reject（与浏览器行为一致的 TypeError）", async () => {
  installCorsBypassFetch();
  await assert.rejects(() => fetch("file:///E:/__不存在__/x.wasm"), TypeError);
});

test("CORS 桥：非 file/hf 请求透明转发原生 fetch（本地 http server）", async () => {
  installCorsBypassFetch();
  const http = await import("node:http");
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
  } finally {
    server.close();
  }
});
