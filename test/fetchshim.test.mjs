import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installCorsBypassFetch } from "./.build/fetchshim.cjs";

test("CORS 桥：file:// 读取本地文件并返回 Response（wasm 加载路径）", async () => {
  installCorsBypassFetch();
  const dir = await mkdtemp(join(tmpdir(), "edge-tutor-fetch-"));
  const file = join(dir, "fixture.wasm");
  try {
    await writeFile(file, Buffer.from([0, 97, 115, 109, ...new Array(1200).fill(0)]));
    const res = await fetch(pathToFileURL(file));
    assert.equal(res.status, 200);
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 1000, "wasm 文件字节数应 > 1KB");
    const magic = new Uint8Array(buf.slice(0, 4));
    assert.deepEqual(Array.from(magic), [0, 97, 115, 109]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
