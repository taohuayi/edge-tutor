/**
 * 模型下载 CORS 桥（Obsidian 专用）
 *
 * Obsidian 插件运行在 Electron 渲染进程，origin 是 app://obsidian.md：
 * - 浏览器 fetch 下载 HF 模型被 CORS 拦截（hf-mirror.com / huggingface.co 不返回
 *   允许 app://obsidian.md 的 Access-Control-Allow-Origin 头）→ 改走 Node https/http
 *   （Node 客户端不受浏览器 CORS 限制）
 * - onnxruntime 加载本地 wasm 用 fetch(file://) 在浏览器被拒 → 改走 Node fs 读
 * 其余请求透明转发原生 fetch（不影响 opencode 等正常通信）。
 * 幂等：只安装一次；未安装时行为零改动。
 *
 * 注：onnxruntime 后端选择不在此处理（无 ORT_SYMBOL 注入）——transformers.js 的
 * ORT_SYMBOL 分支不填充 supportedDevices，会对默认设备 "cpu" 抛 Unsupported device。
 * 改为在 esbuild 层把 "onnxruntime-node" alias 成 web ort bundle，让 transformers 走
 * IS_NODE_ENV 的 node 分支（设备表正确填充），推理实际用 WASM CPU。
 */

let installed = false;

export function installCorsBypassFetch(): void {
  if (installed) return;
  installed = true;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const https = require("https");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require("http");
  const nativeFetch = globalThis.fetch.bind(globalThis);

  /** 本地文件读（wasm/模型字节），返回 Response 供 fetch 语义消费 */
  const readLocal = (p: string, contentType: string): Promise<Response> =>
    new Promise((resolve, reject) => {
      fs.readFile(p, (err: Error | null, data: Buffer) => {
        if (err) reject(new TypeError("Failed to fetch " + p + ": " + err.message));
        else resolve(new Response(new Uint8Array(data), { status: 200, headers: { "Content-Type": contentType } }));
      });
    });

  /** Node http(s) 请求（自动跟随 3xx 重定向，最多 5 跳） */
  const nodeRequest = (url: string, init: RequestInit | undefined, depth: number): Promise<Response> =>
    new Promise((resolve, reject) => {
      const mod = url.startsWith("https:") ? https : http;
      const req = mod.get(
        url,
        { headers: { "User-Agent": "edge-tutor/0.7", ...((init?.headers as Record<string, string>) ?? {}) } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (res: any) => {
          const loc = res.headers.location;
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 5) {
            res.on("end", () => resolve(nodeRequest(new URL(loc, url).toString(), init, depth + 1)));
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            resolve(
              new Response(new Uint8Array(buf), {
                status: res.statusCode ?? 200,
                headers: { "Content-Type": String(res.headers["content-type"] ?? "application/octet-stream") },
              })
            );
          });
        }
      );
      req.on("error", (e: Error) => reject(new TypeError("Failed to fetch " + url + ": " + e.message)));
      const sig = init?.signal;
      if (sig) {
        if (sig.aborted) req.destroy();
        else sig.addEventListener("abort", () => req.destroy(), { once: true });
      }
    });

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input?.url;
    if (typeof url !== "string") return nativeFetch(input, init);
    if (url.startsWith("file://")) {
      // Handles both file:///E:/path on Windows and file:///tmp/path on POSIX.
      const p = require("url").fileURLToPath(url);
      return readLocal(p, "application/wasm");
    }
    // Windows 本地绝对路径（transformers.js 的 IS_NODE_ENV 分支返回模型文件路径字符串；
    // onnxruntime-web bundle 对字符串一律走 fetch，浏览器式 fetch 不认识盘符路径）→ fs 读
    if (/^[A-Za-z]:[\\/]/.test(url)) return readLocal(url, "application/octet-stream");
    // HF 模型下载（含镜像）→ Node 直连，绕过浏览器 CORS
    if (/^https?:\/\/(hf-mirror\.com|huggingface\.co)/.test(url)) return nodeRequest(url, init, 0);
    return nativeFetch(input, init);
  }) as typeof fetch;
}
