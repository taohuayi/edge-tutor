/**
 * 本地向量检索工具层（transformers.js + bge-small-zh-v1.5）
 *
 * 约束与降级：整层可选——transformers.js 加载失败、模型下载失败、推理异常一律返回 null/空，
 * 由调用方（main.ts）静默跳过本层，不影响回答。
 * 向量索引落盘（encodeVecs/decodeVecs，base64 Float32Array），重启直接加载，
 * 重建 embedding 需数分钟，必须缓存。
 *
 * 纯函数（encodeVecs/decodeVecs/cosine/topKVectors）无 obsidian 依赖，可单测；
 * loadEmbedder 依赖 WASM 运行时，仅在插件内调用。
 */

import type { SearchChunk, SearchRef } from "./search";
import { installCorsBypassFetch } from "./fetchshim";

/** 向量检索索引（内存形态） */
export interface VectorIndex {
  chunks: SearchChunk[];
  vecs: number[][];
  model: string;
  root: string;
  dim: number;
}

/** 向量检索命中（与 SearchRef 同构，供 formatRefsText/注入使用；多一个相似度分） */
export interface VectorHit extends SearchRef {
  score: number;
}

/** 落盘格式（search-vectors.json） */
export interface VectorIndexFile {
  version: number;
  root: string;
  model: string;
  chunks: SearchChunk[];
  /** Float32Array 的 base64（每行一个向量） */
  vecsB64: string;
  dim: number;
}

/** 向量编码为 base64（Float32Array 平铺） */
export function encodeVecs(vecs: number[][]): string {
  if (vecs.length === 0) return "";
  const buf = new Float32Array(vecs.length * vecs[0].length);
  for (let i = 0; i < vecs.length; i++) buf.set(vecs[i], i * vecs[0].length);
  return Buffer.from(buf.buffer).toString("base64");
}

/** base64 解码为向量数组 */
export function decodeVecs(b64: string, dim: number): number[][] {
  if (!b64 || dim <= 0) return [];
  const buf = Buffer.from(b64, "base64");
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const out: number[][] = [];
  for (let i = 0; i + dim <= arr.length; i += dim) {
    out.push(Array.from(arr.slice(i, i + dim)));
  }
  return out;
}

/** 余弦相似度（向量已归一化时等价点积；未归一化也可用） */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** 暴力余弦 top-k（数千块 sub-100ms，无需 HNSW） */
export function topKVectors(
  q: number[],
  vecs: number[][],
  k: number
): { idx: number; score: number }[] {
  const scored: { idx: number; score: number }[] = [];
  for (let i = 0; i < vecs.length; i++) {
    scored.push({ idx: i, score: cosine(q, vecs[i]) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// ---- transformers.js 懒加载（失败即禁用，重试机制：失败后置空允许下次再试）----

export interface Embedder {
  /** 批量文本 → 归一化向量；opts.query=true 表示检索查询（模型侧加指令/前缀，文档侧不加） */
  embed(texts: string[], opts?: { query?: boolean }): Promise<number[][]>;
}

// ---- reranker（交叉编码器；条件 rerank 用，加载失败即跳过） ----

export interface Reranker {
  /** (query, doc) 对打分：返回与 texts 对齐的分数数组（越大越相关；相对排序即可用） */
  rerank(query: string, texts: string[]): Promise<number[]>;
}

/** 多语言交叉编码器（ONNX）；缺失/加载失败 → 跳过重排，用融合分排序 */
export const RERANKER_MODEL_ID = "onnx-community/bge-reranker-v2-m3-ONNX";

let rerankerModule: Reranker | null = null;
let rerankerLoading: Promise<Reranker | null> | null = null;

/** 加载 reranker（懒 + 失败禁用；与 loadEmbedder 同构） */
export function loadReranker(cacheDir: string, wasmDir?: string): Promise<Reranker | null> {
  if (rerankerModule) return Promise.resolve(rerankerModule);
  if (!rerankerLoading) {
    rerankerLoading = (async () => {
      try {
        installCorsBypassFetch();
        // 后端选择由 esbuild alias 保证（"onnxruntime-node" → web ort bundle，transformers
        // 走 node 分支且设备表正确填充，推理用 WASM CPU）；不要注入 ORT_SYMBOL（分支不填设备表）
        const tf = (await import("@huggingface/transformers")) as typeof import("@huggingface/transformers");
        tf.env.cacheDir = cacheDir;
        tf.env.allowLocalModels = false;
        // wasm 运行时随插件分发（scripts/copy-wasm.mjs → lib/）：
        // - wasmPaths（尾斜杠必须保留）：ORT 用 new URL(文件名, wasmPaths) 解析 emscripten
        //   factory（jsep.mjs），无尾斜杠会把 lib 当文件名丢弃
        // - wasmBinary：wasm 字节直给，emscripten 不再按 URL 拉 wasm（避免相对路径 fetch）
        // - numThreads=1：单线程加载路径确定（多线程走 blob: import，Node 的 ESM loader 不支持）
        if (wasmDir && tf.env.backends.onnx.wasm) {
          // wasmPaths 必须显式置空（transformers 默认是 CDN 对象，会触发它自己的预加载：
          // 把 jsep.mjs 变成 blob: URL，而 Node 的 ESM loader 不认 blob: import）。
          // 也不能设成 file:// 字符串/对象：那会让 onnxruntime 动态 import jsep.mjs——
          // Node（probe/测试）认 file:// import，但 Obsidian 的 Electron 渲染进程 import
          // 由 Chromium 处理，file:// 模块被拒（"Failed to fetch dynamically imported module"）。
          // 置空后 ORT 走 bundle 内联的 node factory（require 分支，零外部 import），
          // wasmBinary 直给，Node 与 Chromium 两条环境都通。
          // （undefined 与 null 同效：transformers 里 wasmPaths 按 truthiness/typeof 判定）
          tf.env.backends.onnx.wasm.wasmPaths = undefined;
          tf.env.backends.onnx.wasm.numThreads = 1;
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fs = require("fs");
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const path = require("path");
          tf.env.backends.onnx.wasm.wasmBinary = new Uint8Array(
            fs.readFileSync(path.join(wasmDir, "ort-wasm-simd-threaded.jsep.wasm"))
          );
          // 读取失败直接抛错 → 外层 catch 禁用本层（无 wasm 二进制时 ORT 会抛
          // "cannot determine the script source URL."）
        }
        // 不用 text-classification pipeline：其批处理把 {text, text_pair} 对象数组当单个文本
        // （底层 tokenizer 不认对象 → 全部 tokenize 成相同输入），且单 logit 模型被 softmax
        // 恒等于 1（pipeline 仅 multi_label_classification 才 sigmoid）。bge-reranker 是回归式
        // 单 logit：直接 AutoTokenizer（显式 text_pair 数组批处理）+ AutoModel + sigmoid。
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tryLoad = async (host?: string): Promise<any> => {
          if (host) tf.env.remoteHost = host;
          const tokenizer = await tf.AutoTokenizer.from_pretrained(RERANKER_MODEL_ID);
          const model = await tf.AutoModel.from_pretrained(RERANKER_MODEL_ID, { dtype: "q8" });
          return { tokenizer, model };
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let loaded: any;
        try {
          loaded = await tryLoad("https://hf-mirror.com");
        } catch (e) {
          console.warn("[edge-tutor] hf-mirror 下载失败，回退 huggingface.co", String((e as Error)?.message ?? e).slice(0, 150));
          loaded = await tryLoad("https://huggingface.co");
        }
        const { tokenizer, model } = loaded as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tokenizer: any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: any;
        };
        const rerank = async (query: string, texts: string[]): Promise<number[]> => {
          const scores: number[] = [];
          const BATCH = 8;
          for (let i = 0; i < texts.length; i += BATCH) {
            const batch = texts.slice(i, i + BATCH);
            // 批处理文本对：query 重复 n 次 + text_pair 数组（PreTrainedTokenizer._call
            // 的 batched text_pair 分支正确拼接两段，对象数组形式不受支持）
            const inputs = tokenizer(batch.map(() => query), {
              text_pair: batch.map((t) => t.slice(0, 500)),
              padding: true,
              truncation: true,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const out: any = await model(inputs);
            // 单 logit → sigmoid（越大越相关）
            const logits: number[][] = out.logits.tolist();
            for (const row of logits) {
              const logit = typeof row[0] === "number" ? row[0] : 0;
              scores.push(1 / (1 + Math.exp(-logit)));
            }
            // 宏任务让出（见 loadEmbedder 的 embed）：rerank 也是同步 WASM，不能饿死 UI
            await new Promise((res) => setTimeout(res, 0));
          }
          return scores;
        };
        rerankerModule = { rerank };
        return rerankerModule;
      } catch (e) {
        console.warn("[edge-tutor] reranker 加载失败，跳过重排（用融合分排序）", e);
        return null;
      }
    })();
  }
  return rerankerLoading;
}

export const MODEL_ID = "Xenova/bge-small-zh-v1.5";
/** BGE v1.5 官方推荐 query 前缀（文档侧不加） */
export const QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";

let embedderModule: Embedder | null = null;
let embedderLoading: Promise<Embedder | null> | null = null;

/** 加载 embedding 模型（懒 + 失败禁用；cacheDir 为模型缓存目录绝对路径，wasmDir 为 onnxruntime wasm 目录） */
export function loadEmbedder(cacheDir: string, wasmDir?: string): Promise<Embedder | null> {
  if (embedderModule) return Promise.resolve(embedderModule);
  if (!embedderLoading) {
    embedderLoading = (async () => {
      try {
        // Obsidian 渲染进程 CORS 桥：模型下载走 Node（绕过浏览器 CORS 拦截）、本地 wasm 走 fs
        installCorsBypassFetch();
        const tf = (await import("@huggingface/transformers")) as typeof import("@huggingface/transformers");
        // 模型缓存到插件目录 models/（vault 内 .obsidian 已被 gitignore，不进仓库）
        tf.env.cacheDir = cacheDir;
        tf.env.allowLocalModels = false;
        // wasm 运行时随插件分发（scripts/copy-wasm.mjs → lib/）：
        // - wasmPaths（尾斜杠必须保留）：ORT 用 new URL(文件名, wasmPaths) 解析 emscripten
        //   factory（jsep.mjs），无尾斜杠会把 lib 当文件名丢弃
        // - wasmBinary：wasm 字节直给，emscripten 不再按 URL 拉 wasm（避免相对路径 fetch）
        // - numThreads=1：单线程加载路径确定（多线程走 blob: import，Node 的 ESM loader 不支持）
        if (wasmDir && tf.env.backends.onnx.wasm) {
          // wasmPaths 必须显式置空（transformers 默认是 CDN 对象，会触发它自己的预加载：
          // 把 jsep.mjs 变成 blob: URL，而 Node 的 ESM loader 不认 blob: import）。
          // 也不能设成 file:// 字符串/对象：那会让 onnxruntime 动态 import jsep.mjs——
          // Node（probe/测试）认 file:// import，但 Obsidian 的 Electron 渲染进程 import
          // 由 Chromium 处理，file:// 模块被拒（"Failed to fetch dynamically imported module"）。
          // 置空后 ORT 走 bundle 内联的 node factory（require 分支，零外部 import），
          // wasmBinary 直给，Node 与 Chromium 两条环境都通。
          // （undefined 与 null 同效：transformers 里 wasmPaths 按 truthiness/typeof 判定）
          tf.env.backends.onnx.wasm.wasmPaths = undefined;
          tf.env.backends.onnx.wasm.numThreads = 1;
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fs = require("fs");
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const path = require("path");
          tf.env.backends.onnx.wasm.wasmBinary = new Uint8Array(
            fs.readFileSync(path.join(wasmDir, "ort-wasm-simd-threaded.jsep.wasm"))
          );
          // 读取失败直接抛错 → 外层 catch 禁用本层（无 wasm 二进制时 ORT 会抛
          // "cannot determine the script source URL."）
        }
        // 模型下载默认走 hf-mirror.com 镜像（huggingface.co 直连在中国大陆网络不可用），失败回退官方源
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tryPipeline = (host?: string): Promise<any> => {
          if (host) tf.env.remoteHost = host;
          return tf.pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let extractor: any;
        try {
          extractor = await tryPipeline("https://hf-mirror.com");
        } catch (e) {
          console.warn("[edge-tutor] hf-mirror 下载失败，回退 huggingface.co", String((e as Error)?.message ?? e).slice(0, 150));
          // 显式传官方源：不传会保留上一轮的 remoteHost（仍走镜像）
          extractor = await tryPipeline("https://huggingface.co");
        }
        const embed = async (texts: string[], opts?: { query?: boolean }): Promise<number[][]> => {
          // 检索查询侧加 BGE v1.5 官方前缀（文档侧不加）。前缀拼接收拢到 embedder
          // 内部——调用方（main.ts）不再关心具体模型的前缀/指令格式差异。
          const inputs = opts?.query ? texts.map((t) => QUERY_PREFIX + t) : texts;
          const out: number[][] = [];
          // 批 8：WASM 推理是同步的，每批同步块 ~100-250ms。批次间必须 setTimeout 宏任务
          // 让出——单纯 await 只让微任务，UI 事件（渲染/点击）会被连续推理饿死，
          // Obsidian 整个界面卡死（构建是后台任务，不能阻塞使用）。
          const BATCH = 8;
          for (let i = 0; i < inputs.length; i += BATCH) {
            const batch = inputs.slice(i, i + BATCH);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const r: any = await extractor(batch, { pooling: "mean", normalize: true });
            // 批量返回 Tensor（tolist 可用）；单条/旧版返回 data 数组
            if (typeof r.tolist === "function") {
              const list = r.tolist() as number[][];
              for (const v of list) out.push(Array.from(v));
            } else {
              out.push(Array.from(r.data as Float32Array));
            }
            await new Promise((res) => setTimeout(res, 0));
          }
          return out;
        };
        embedderModule = { embed };
        return embedderModule;
      } catch (e) {
        console.warn("[edge-tutor] embedding 模型加载失败，向量检索禁用", e);
        return null;
      }
    })();
  }
  return embedderLoading;
}

// ---- 远程 embedding（OpenAI 兼容端点，如阿里百炼 text-embedding-v4）----

/** 远程 embedding 配置（OpenAI 兼容端点） */
export interface RemoteEmbedderConfig {
  apiKey: string;
  /** base URL（不含 /embeddings），如 https://dashscope.aliyuncs.com/compatible-mode/v1 */
  baseUrl: string;
  /** 模型 id（如 text-embedding-v4） */
  model: string;
  /** 输出维度（OpenAI 兼容 dimensions 参数） */
  dim: number;
}

/** 远程端点单请求最大输入条数（阿里 text-embedding-v4 官方限制 10；实测 11 条报 400） */
const REMOTE_BATCH = 10;

/** 阿里 text-embedding-v4 检索查询指令（仅 query 类型可用；实测生效：instruct 改变查询向量子空间） */
const DASHSCOPE_QUERY_INSTRUCT =
  "Given a web search query, retrieve relevant passages that answer the query";

/**
 * 远程 embedding（OpenAI 兼容 /embeddings 端点）。
 * 文档侧默认编码；opts.query=true 时按检索查询编码（阿里 text-embedding-v4 的
 * text_type=query + instruct，对齐本地 bge 的 QUERY_PREFIX 语义，实测向量不同）。
 * 任何失败抛错，由调用方（main.ts）捕获降级到本地模型/纯文本检索。
 */
export function loadRemoteEmbedder(cfg: RemoteEmbedderConfig): Embedder {
  const embed = async (texts: string[], opts?: { query?: boolean }): Promise<number[][]> => {
    const out: number[][] = [];
    const base = cfg.baseUrl.replace(/\/+$/, "");
    for (let i = 0; i < texts.length; i += REMOTE_BATCH) {
      const batch = texts.slice(i, i + REMOTE_BATCH);
      const res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          input: batch,
          dimensions: cfg.dim,
          encoding_format: "float",
          ...(opts?.query ? { text_type: "query", instruct: DASHSCOPE_QUERY_INSTRUCT } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`embedding API ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json().catch(() => null);
      const data = json?.data;
      if (!Array.isArray(data) || data.length < batch.length) {
        throw new Error("embedding API 响应缺少 data 结果");
      }
      // data 按 input 顺序返回（index 对齐）；防御性按 index 放置
      const byIndex = new Map(data.map((d) => [d.index, d.embedding]));
      for (let j = 0; j < batch.length; j++) {
        const v = byIndex.get(j);
        if (!Array.isArray(v)) throw new Error(`embedding API 缺第 ${j} 条结果`);
        out.push(Array.from(v));
      }
      // 网络请求间让出宏任务（构建 1698 块 ≈ 170 请求，避免长循环饿死 UI）
      await new Promise((res) => setTimeout(res, 0));
    }
    return out;
  };
  return { embed };
}

// ---- 远程 reranker（OpenAI 兼容 reranks 端点，如阿里百炼 qwen3-rerank）----

/** 远程 reranker 配置（OpenAI 兼容 reranks 端点） */
export interface RemoteRerankerConfig {
  apiKey: string;
  /** base URL（不含 /reranks）。注意：阿里是 compatible-api 路径（与 embedding 的 compatible-mode 不同） */
  baseUrl: string;
  /** 模型 id（默认 qwen3-rerank） */
  model: string;
}

/**
 * 远程 reranker（OpenAI 兼容 /reranks 端点）。
 * 与本地 Reranker 接口同构：rerank(query, texts) → 与 texts 对齐的分数数组，
 * main.ts 调用点零改动。响应 results[] 按 relevance_score 降序、含 index →
 * 按 index 还原回 texts 顺序。失败抛错，由 main.ts 降级本地 bge-reranker / RRF。
 * query 与文档各 ≤4000 token、documents ≤500：top-40 候选远低于限制。
 */
export function loadRemoteReranker(cfg: RemoteRerankerConfig): Reranker {
  const rerank = async (query: string, texts: string[]): Promise<number[]> => {
    const base = cfg.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/reranks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, query, documents: texts }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`rerank API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json().catch(() => null);
    const results = json?.results;
    if (!Array.isArray(results)) throw new Error("rerank API 响应缺少 results");
    // results 按 relevance_score 降序、含 index → 按 index 对齐回 texts 顺序
    const scores: number[] = new Array(texts.length).fill(0);
    for (const r of results) {
      const i = r?.index;
      if (typeof i === "number" && i >= 0 && i < texts.length) {
        scores[i] = typeof r.relevance_score === "number" ? r.relevance_score : 0;
      }
    }
    return scores;
  };
  return { rerank };
}
