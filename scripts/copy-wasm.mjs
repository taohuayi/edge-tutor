/**
 * 复制 onnxruntime-web 的 wasm 运行时文件到插件 lib/ 目录。
 * 运行时（Obsidian/Electron）无法访问 node_modules，必须随插件分发；
 * transformers.js 通过 env.backends.onnx.wasm.wasmPaths 指向此处。
 *
 * 全量复制所有 ort-wasm*.wasm（约 100MB）：onnxruntime 按运行环境选择文件——
 * 多线程版本（simd-threaded）需要 SharedArrayBuffer，Electron 沙箱/渲染进程
 * 不可用时自动降级到单线程版本（ort-wasm-simd / ort-wasm），缺文件即加载失败。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "node_modules", "onnxruntime-web", "dist");
const outDir = path.join(root, "lib");

fs.mkdirSync(outDir, { recursive: true });
// wasm 二进制：按运行环境选择（simd-threaded 等）
// .jsep.mjs：ort.bundle.min.mjs（bundle 版本，JSEP 算子混编）加载的 JS 运行时
const needFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".wasm") || f.endsWith(".jsep.mjs"));
if (needFiles.length === 0) {
  console.warn("onnxruntime-web dist 下未找到 wasm 文件？", srcDir);
  process.exit(0);
}
for (const f of needFiles) {
  fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
  console.log("copied:", f);
}
console.log(`wasm 运行时已复制到 lib/（${needFiles.length} 个文件）`);
