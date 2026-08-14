/**
 * 测试构建：把被测纯函数模块 bundle 成 cjs（external: obsidian），
 * 供 test/*.test.mjs 直接 import。
 */
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "test", ".build");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const modules = ["canvas", "conv", "export", "guide", "tutor", "search", "ai", "vector", "fetchshim", "viewlogic"];

await Promise.all(
  modules.map((m) =>
    esbuild.build({
      entryPoints: [path.join(root, "src", m + ".ts")],
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node18",
      // vector 引用 onnxruntime：与插件 main.js 一致——transformers.js 走 IS_NODE_ENV
      // node 分支 import("onnxruntime-node")，alias 到 web bundle（内联 wasm）让设备表
      // 正确填充且推理走 WASM CPU（真 onnxruntime-node 是 native 模块，测试环境不可用）
      alias: m === "vector"
        ? {
            "onnxruntime-node": path.join(root, "node_modules", "onnxruntime-web", "dist", "ort.bundle.min.mjs"),
            "onnxruntime-web": path.join(root, "node_modules", "onnxruntime-web", "dist", "ort.bundle.min.mjs"),
            // 与插件 main.js 一致：transformers 顶层 import sharp 且按 truthy 分支，
            // 测试环境同样没有 sharp native 库 → 占位（调用才抛错，本层只用文本模型）
            "sharp": path.join(root, "scripts", "sharp-stub.mjs"),
          }
        : undefined,
      external: ["obsidian", "https", "http", "fs"],
      outfile: path.join(outDir, m + ".cjs"),
      logLevel: "error",
    })
  )
);

console.log("测试构建完成:", modules.join(", "));
