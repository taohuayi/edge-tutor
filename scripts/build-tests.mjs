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

const modules = ["canvas", "conv", "export", "guide", "tutor", "search", "ai"];

await Promise.all(
  modules.map((m) =>
    esbuild.build({
      entryPoints: [path.join(root, "src", m + ".ts")],
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node18",
      external: ["obsidian"],
      outfile: path.join(outDir, m + ".cjs"),
      logLevel: "error",
    })
  )
);

console.log("测试构建完成:", modules.join(", "));
