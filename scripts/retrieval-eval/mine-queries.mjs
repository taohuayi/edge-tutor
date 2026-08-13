/**
 * 检索测试集挖掘脚本（阶段 0）
 *
 * 从两处真实素材生成 100 条检索查询：
 *   1. 认知边缘节点（42 个，frontmatter 带 anchor/anchorPath）—— 追问段做 query（学生口语
 *      形态，锚点做 expected 定位）；追问无效时退化为节点标题
 *   2. 教材例题（chapters/*.md 的「例 N.M」行）—— 例题正文剥离 LaTeX 做 query（教材语言
 *      形态），例题所在行做 expected
 *
 * 输出：testdata/retrieval/queries.jsonl（一行一条）
 *   { id, query, source, kind: "node"|"example", anchorPath, anchor, expectedLines: null }
 *   expectedLines 由 eval.mjs 用 anchor 全索引定位后回填。
 *
 * 用法：node scripts/retrieval-eval/mine-queries.mjs [--vault <vault根绝对路径>] [--target 100]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..", "..");
// 默认 vault 根 = 插件目录向上 3 层（.obsidian/plugins/edge-tutor → vault 根）
const DEFAULT_VAULT = path.resolve(PLUGIN_ROOT, "..", "..", "..");
const WIKI_DIR = "learning/peizhi/learn/_wiki/认知边缘";
const TEXTBOOK_DIR = "learning/peizhi/learn/_materials/math/张宇基础30讲";

const args = process.argv.slice(2);
const vaultRoot = args[args.indexOf("--vault") + 1] || DEFAULT_VAULT;
const target = Number(args[args.indexOf("--target") + 1] || 100);

/* ===== 工具 ===== */

/** 剥 frontmatter：返回 { meta, body }；无 frontmatter 时 meta=null */
function splitFrontmatter(text) {
  const clean = text.replace(/^﻿/, "");
  if (!clean.startsWith("---")) return { meta: null, body: clean };
  const end = clean.indexOf("\n---", 3);
  if (end < 0) return { meta: null, body: clean };
  const metaText = clean.slice(3, end);
  const body = clean.slice(end + 4);
  const meta = {};
  for (const line of metaText.split("\n")) {
    const m = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2];
  }
  return { meta, body };
}

/** 提取 body 中「🔍 追问」小节（到下一个 ## 或文件尾；兼容 CRLF） */
function extractFollowup(body) {
  const m = /##\s*🔍\s*追问\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/.exec(body);
  if (!m) return "";
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^[>\-\s*]+/, "").trim()) // 去掉引用/列表/空白
    // 过滤：图片行、表格行、导师回应占位/元指令（🤖 是给 AI 的操作指令，不是学习问题）
    .filter((l) => l && !l.startsWith("![") && !l.startsWith("|") && !l.includes("🤖") && !l.includes("导师回应") && !l.includes("💡") && !l.includes("（无"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 剥离 LaTeX 数学环境（$...$ 与 \[...\]），压缩空白 */
function stripLatex(text) {
  return text
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\$[^$\n]*\$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 归一化（与检索一致）用于去重 */
function norm(text) {
  return text
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角→半角
    .replace(/[^\w一-龥εθλπΣ∫√∂]/g, "")
    .toLowerCase();
}

const seen = new Set();
function isDup(q) {
  const n = norm(q);
  if (!n || seen.has(n)) return true;
  seen.add(n);
  return false;
}

/* ===== 1. 认知边缘节点 ===== */

function walkMd(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "_exports" || ent.name === "images" || ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMd(p, out);
    else if (ent.name.endsWith(".md") && !ent.name.includes("地图")) out.push(p);
  }
  return out;
}

function mineNodes() {
  const wikiDir = path.join(vaultRoot, WIKI_DIR);
  if (!fs.existsSync(wikiDir)) {
    console.error(`[mine-queries] 找不到认知边缘目录：${wikiDir}`);
    return [];
  }
  const nodes = [];
  for (const file of walkMd(wikiDir, [])) {
    const raw = fs.readFileSync(file, "utf8");
    const { meta, body } = splitFrontmatter(raw);
    if (!meta || meta.type !== "认知节点") continue;
    // 标题（首个 # 行）
    const title = (/^#\s+(.+)$/m.exec(body) || [])[1]?.trim() || path.basename(file, ".md");
    const followup = extractFollowup(body);
    const anchor = (meta.anchor || "").replace(/^"|"$/g, "").trim();
    const anchorPath = (meta.anchorPath || "").replace(/^"|"$/g, "").trim();
    // query 优先追问；追问太短/指代上文（"这一部分/这里/它"开头，脱离锚点不可检索）则用标题
    let query = "";
    if (followup.length >= 8 && followup.length <= 120) query = followup;
    if (!query || /^(这一部分|这里|这些|它|那个|这种|这个|你|我)/.test(query)) {
      if (title.length >= 6 && title.length <= 40) query = title;
    }
    if (!query || isDup(query)) continue;
    nodes.push({
      id: `node-${String(nodes.length + 1).padStart(2, "0")}`,
      query,
      source: path.relative(wikiDir, file).replace(/\\/g, "/"),
      kind: "node",
      anchorPath,
      anchor,
      expectedLines: null,
      // 备用查询（锚点形态）：供 eval 时参考
      anchorQuery: anchor.length >= 10 ? stripLatex(anchor).slice(0, 120) : "",
    });
  }
  return nodes;
}

/* ===== 2. 教材例题 ===== */

function mineExamples(targetCount) {
  const chaptersDir = path.join(vaultRoot, TEXTBOOK_DIR, "chapters");
  if (!fs.existsSync(chaptersDir)) {
    console.error(`[mine-queries] 找不到教材目录：${chaptersDir}`);
    return [];
  }
  const files = fs
    .readdirSync(chaptersDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .sort((a, b) => a.localeCompare(b, "zh"));
  const perFile = Math.ceil(targetCount / files.length);
  const out = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(chaptersDir, f), "utf8").split("\n");
    const examples = [];
    lines.forEach((line, i) => {
      const m = /^(例\s*\d+(?:\.\d+)?)[\.\s—:\s]*(.*)$/.exec(line.trim());
      if (!m) return;
      // 只收"例 N.M 题目"这种带正文的（行内至少还有 10 个字）
      const rest = stripLatex(line).slice(m[1].length);
      if (rest.length < 8 || rest.length > 90) return;
      examples.push({ no: m[1].replace(/\s+/g, ""), text: stripLatex(line), line: i + 1 });
    });
    // 均匀抽 perFile 条（不足则全要）
    const step = Math.max(1, Math.floor(examples.length / perFile));
    for (let i = 0; i < examples.length && out.length < targetCount; i += step) {
      const ex = examples[i];
      const q = `${ex.no} ${ex.text.slice(ex.no.length + 1, ex.no.length + 55)}`.trim();
      if (q.length < 12 || isDup(q)) continue;
      out.push({
        id: `example-${String(out.length + 1).padStart(3, "0")}`,
        query: q,
        source: `chapters/${f}`,
        kind: "example",
        anchorPath: `${TEXTBOOK_DIR}/chapters/${f}`,
        anchor: ex.text.slice(0, 200),
        expectedLines: [ex.line, ex.line],
      });
    }
  }
  return out;
}

/* ===== 主流程 ===== */

const nodes = mineNodes();
console.log(`[mine-queries] 认知边缘节点 query：${nodes.length} 条`);
const examples = mineExamples(Math.max(0, target - nodes.length));
console.log(`[mine-queries] 教材例题 query：${examples.length} 条（目标 ${target - nodes.length}）`);

const all = [...nodes, ...examples].slice(0, target);

const outDir = path.join(PLUGIN_ROOT, "testdata", "retrieval");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "queries.jsonl");
fs.writeFileSync(outFile, all.map((q) => JSON.stringify(q)).join("\n") + "\n", "utf8");

const kindCount = all.reduce((m, q) => ((m[q.kind] = (m[q.kind] || 0) + 1), m), {});
console.log(`[mine-queries] 已写出 ${all.length} 条 → ${outFile}`);
console.log(`[mine-queries] 分布：${JSON.stringify(kindCount)}；节点含锚点：${all.filter((q) => q.kind === "node" && q.anchor).length} 条`);
console.log("[mine-queries] 样例：");
for (const q of all.slice(0, 5)) console.log(`  [${q.id}] ${q.query.slice(0, 60)}`);
