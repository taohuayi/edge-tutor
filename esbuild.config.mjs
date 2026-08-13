import esbuild from "esbuild";
import process from "process";
import path from "path";
import { fileURLToPath } from "url";

const prod = !process.argv.includes("--watch");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  // onnxruntime 后端选择：Obsidian 渲染进程 IS_NODE_ENV=true（有 process.versions.node），
  // transformers.js 模块初始化走 node 分支 → import("onnxruntime-node")（其 dist 预打包文件
  // 实际是 CJS 的 require("onnxruntime-node")）。
  // 该分支会正确填充 supportedDevices/defaultDevices（cpu 等），但真 onnxruntime-node 是
  // native 模块（.node）插件环境不可用 → alias 到 onnxruntime-web 的 web bundle（内联 wasm，
  // 形状兼容：InferenceSession/Tensor/env），实际推理走 WASM CPU。
  // 注意：不能改用 ORT_SYMBOL 注入（ensureOrtSymbol）——那分支不填充 supportedDevices，
  // deviceToExecutionProviders 会对默认设备 "cpu" 抛 Unsupported device。
  alias: {
    "onnxruntime-node": path.join(root, "node_modules", "onnxruntime-web", "dist", "ort.bundle.min.mjs"),
    // sharp：transformers node 版顶层 import 且按 truthy 分支；Obsidian 渲染进程不能加载
    // .node 原生库（加载即崩），本插件只用文本模型 → 占位函数（调用才抛错，见 sharp-stub.mjs）
    "sharp": path.join(root, "scripts", "sharp-stub.mjs"),
  },
  // platform 必须是 "node"（不能是默认 browser）：transformers 的 node 版 dist 用 CJS
  // require("onnxruntime-node") 引用后端，platform=browser 时 require 不走 resolver、
  // alias 失效（解析到真 native 包 onnxruntime-node 的空模块）；platform=node 时 require
  // 与 import 统一走 resolver，alias 生效（Obsidian 渲染进程有完整 Node 权限）。
  platform: "node",
  // https/http/fs：CORS 桥（fetchshim）在 Obsidian 渲染进程用 Node 模块绕过浏览器 CORS，保持外部引用
  external: ["obsidian", "child_process", "https", "http", "fs"],
  format: "cjs",
  target: "es2020", // es2018 不支持 BigInt 字面量（onnxruntime-web 依赖）
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
