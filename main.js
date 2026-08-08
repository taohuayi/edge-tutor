var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => EdgeTutorPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");

// src/ai.ts
var PRESET_PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek\uFF08\u5B98\u65B9\uFF09",
    apiBase: "https://api.deepseek.com/v1",
    apiKey: "",
    models: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-flash-0731", "deepseek-v4-pro"]
  },
  {
    id: "tokeness-claude",
    name: "Tokeness\uFF08Claude\uFF09",
    apiBase: "https://n.tokeness.io/v1",
    apiKey: "",
    models: ["claude-opus-4-8", "claude-sonnet-4-6"]
  },
  {
    id: "tokeness-gpt",
    name: "Tokeness\uFF08GPT\uFF09",
    apiBase: "https://n.tokeness.io/v1",
    apiKey: "",
    models: ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]
  },
  {
    id: "zhuomatech",
    name: "Zhuomatech",
    apiBase: "https://api.zhuomatech.cn/v1",
    apiKey: "",
    models: ["codex-auto-review", "gpt-5.4-mini", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-terra"]
  },
  {
    id: "chat2api",
    name: "chat2api \u53CD\u4EE3\uFF08\u672C\u673A 5005\uFF09",
    apiBase: "http://127.0.0.1:5005/v1",
    apiKey: "",
    models: ["gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5", "gpt-4.5o", "gpt-4o", "gpt-4o-mini", "o3-mini"]
  }
];
var DEFAULT_SETTINGS = {
  apiBase: "https://api.deepseek.com/v1",
  apiKeyEnv: "EDGE_TUTOR_API_KEY",
  apiKey: "",
  model: "deepseek-chat",
  nodeFolder: "learning/peizhi/learn/_wiki/\u8BA4\u77E5\u8FB9\u7F18",
  textbookRoot: "learning/peizhi/learn/_materials/math/\u5F20\u5B87\u57FA\u784030\u8BB2/markdown_v2/\u6700\u7EC8\u7248",
  draft: null,
  maxTokens: 4096,
  temperature: 0.7,
  activeProvider: "deepseek",
  agentApiBase: "https://api.deepseek.com/v1",
  agentApiKeyEnv: "DEEPSEEK_API_KEY",
  agentApiKey: "",
  agentModel: "deepseek-chat",
  agentChannel: "opencode",
  opencodeBase: "http://127.0.0.1:10999",
  opencodeProvider: "deepseek",
  opencodeModel: "deepseek-v4-flash",
  agentMaxTurns: 30,
  textbookSearchEnabled: false
};
function resolveProvider(settings) {
  const id = settings.activeProvider || "deepseek";
  const found = PRESET_PROVIDERS.find((p) => p.id === id);
  if (found) return found;
  return PRESET_PROVIDERS[0];
}
function resolveAgentApiKey(settings) {
  var _a, _b;
  if (settings.agentApiKeyEnv) {
    try {
      const env = (_b = (_a = globalThis == null ? void 0 : globalThis.process) == null ? void 0 : _a.env) == null ? void 0 : _b[settings.agentApiKeyEnv];
      if (env) return env;
    } catch (e) {
    }
  }
  return settings.agentApiKey || "";
}
function agentConfig(settings) {
  return {
    apiBase: settings.agentApiBase || "https://api.deepseek.com/v1",
    apiKey: resolveAgentApiKey(settings),
    model: settings.agentModel || "deepseek-chat"
  };
}
function activeEndpoint(settings) {
  const p = resolveProvider(settings);
  const apiBase = p.apiBase || settings.apiBase || "https://api.deepseek.com/v1";
  const key = (
    // 用户显式填的 key 优先（如 chat2api 反代 JWT；环境变量可能存着旧 key 会盖掉它）
    (settings.apiKey && settings.apiKey.trim() ? settings.apiKey : "") || (p.apiKey && p.apiKey.trim() ? p.apiKey : "") || (() => {
      var _a, _b;
      try {
        const env = (_b = (_a = globalThis == null ? void 0 : globalThis.process) == null ? void 0 : _a.env) == null ? void 0 : _b[settings.apiKeyEnv || "EDGE_TUTOR_API_KEY"];
        return env ? String(env) : "";
      } catch (e) {
        return "";
      }
    })() || ""
  );
  return { apiBase, apiKey: key };
}
function buildSystemPrompt() {
  return [
    "\u4F60\u662F\u300C\u8BA4\u77E5\u8FB9\u7F18\u5BFC\u5E08\u300D\u2014\u2014\u4E00\u4E2A\u4EF7\u503C\u8BC6\u522B\u5668\uFF0C\u4E0D\u662F\u8DEF\u7EBF\u89C4\u5212\u5668\u3002",
    "",
    "\u94C1\u5F8B\uFF1A",
    "1. \u5B66\u751F\u81EA\u7531\u63A2\u7D22\uFF0C\u4F60\u57FA\u4E8E\u6559\u6750\u8BC6\u522B\u4EF7\u503C\uFF1A\u73CD\u8D35\uFF08\u7ED3\u6784\u6027/\u53CD\u76F4\u89C9/\u80FD\u8FDE\u63A5\u591A\u8BB2\uFF09\u5C31\u63A8\u6DF1\uFF1B\u7EC6\u8282\uFF08\u6280\u672F\u8BA1\u7B97/\u94FA\u57AB\uFF09\u5C31\u6807\u8BB0\u4E3A\u53EF\u7565\u8FC7\uFF0C\u4F46\u4E0D\u8D2C\u4F4E\u3002",
    "2. \u7EDD\u4E0D\u62C9\u56DE\uFF1A\u4E0D\u56E0\u7AE0\u8282\u8FB9\u754C\u3001\u8D85\u7EB2\u3001\u591F\u7528\u5C31\u597D\u800C\u963B\u6B62\u5B66\u751F\u6DF1\u5165\u3002\u5B66\u751F\u60F3\u8FFD\u6839\u5C31\u966A\u4ED6\u8FFD\u3002",
    "3. \u505C\u6B62\u6743\u5728\u5B66\u751F\uFF1A\u5B66\u751F\u8BF4\u505C\u5C31\u505C\uFF0C\u4E0D\u50AC\u4FC3\u3001\u4E0D\u5E03\u7F6E\u4F5C\u4E1A\u3002",
    "4. \u56DE\u7B54\u57FA\u4E8E\u6559\u6750\u8BC1\u636E\uFF1A\u6559\u6750\u68C0\u7D22\u7ED3\u679C\uFF08\u82E5\u6709\uFF09\u4F1A\u968F\u95EE\u9898\u63D0\u4F9B\uFF0C\u5F15\u7528\u65F6\u6807\u6CE8\u3010\u{1F4D6} \u6587\u4EF6:\u884C\u3011\uFF1B\u672A\u63D0\u4F9B\u68C0\u7D22\u7ED3\u679C\u65F6\u76F4\u63A5\u57FA\u4E8E\u5DF2\u6709\u77E5\u8BC6\u56DE\u7B54\uFF0C\u4E0D\u9700\u8981\u58F0\u660E'\u770B\u4E0D\u5230\u6559\u6750'\u3002",
    "5. \u7528\u4E3A\u4EC0\u4E48\u9A71\u52A8\uFF1A\u5148\u7ED9\u649E\u5899\u95EE\u9898/\u76F4\u89C9\uFF0C\u518D\u7ED9\u7406\u8BBA\uFF0C\u4E0D\u5148\u704C\u5B9A\u4E49\u3002",
    "6. \u73CD\u8D35\u603B\u662F\u5C11\u6570\uFF1A\u6559\u6750\u91CC\u5927\u90E8\u5206\u662F\u7EC6\u8282\uFF0C\u5E2E\u5B66\u751F\u8BC6\u522B\u54EA\u4E9B\u662F\u73CD\u8D35\u5C11\u6570\u3002",
    "",
    "\u8F93\u51FA\u98CE\u683C\uFF1A\u4E2D\u6587\uFF0C\u6559\u7EC3\u53E3\u543B\uFF08\u4E0D\u662FAI\u8154\uFF09\uFF0C\u7528\u53CD\u4F8B\u548C\u8FB9\u754C\u68C0\u9A8C\u7406\u89E3\uFF0C\u5141\u8BB8\u5B66\u751F\u81EA\u5DF1\u63A8\u5BFC\u3002",
    "",
    "\u56DE\u7B54\u7EC4\u7EC7\uFF08\u5F3A\u5236\uFF09\uFF1A",
    "1. \u7ED3\u6784\u6E05\u6670\uFF1A\u5206\u5C0F\u8282\u5C55\u5F00\uFF0C\u6BCF\u5C0F\u8282\u7ED9\u4E00\u4E2A\u5C0F\u6807\u9898\u3002\u63A8\u8350\u7ED3\u6784\uFF1A\u3010\u6838\u5FC3\u76F4\u89C9\u3011\u2192\u3010\u6559\u6750\u91CC\u7684\u673A\u5236\u3011\u2192\u3010\u8FB9\u754C\u4E0E\u53CD\u4F8B\u3011\u2192\u3010\u80FD\u8FFD\u6839\u7684\u65B9\u5411\u3011\u3002",
    "2. \u7528\u6734\u5B9E\u7684\u8BED\u8A00\u8BB2\u6E05\u539F\u7406\uFF0C\u5148\u76F4\u89C9\u540E\u5F62\u5F0F\u5316\u3002\u5B81\u53EF\u8BB2\u900F\u4E00\u4E2A\u70B9\uFF0C\u4E5F\u4E0D\u8981\u5806\u780C\u542B\u6DF7\u7684\u672F\u8BED\u3002",
    "3. \u6570\u5B66\u8868\u8FBE\u5F0F\u5FC5\u987B\u7528\u6807\u51C6 LaTeX \u4E14\u5B8C\u6574\u6210\u5BF9\uFF1A\u884C\u5185\u7528 \\(...\\)\uFF0C\u5757\u7EA7\u7528 \\[...\\]\u3002\u7981\u6B62\u8F93\u51FA\u6B8B\u7F3A\u6216\u4E0D\u5B8C\u6574\u7684\u516C\u5F0F\u6807\u8BB0\u3002",
    "4. \u6BCF\u6BB5\u8BDD\u90FD\u8981\u300C\u8BF4\u4EBA\u8BDD\u300D\uFF1A\u80FD\u8BFB\u51FA\u58F0\u3001\u53E5\u5B50\u901A\u987A\u3001\u903B\u8F91\u8FDE\u8D2F\u3002\u7981\u6B62\u610F\u8BC6\u6D41\u3001\u7981\u6B62\u5806\u780C\u540C\u4E49\u53CD\u590D\u7684\u7384\u5B66\u8868\u8FF0\u3002",
    "5. \u56DE\u7B54\u957F\u5EA6\u9002\u4E2D\uFF08\u51E0\u767E\u5B57\u5230\u4E00\u5343\u5B57\u5DE6\u53F3\uFF09\uFF0C\u628A\u5F53\u524D\u95EE\u9898\u8BB2\u6E05\u695A\u5373\u53EF\uFF1B\u5982\u679C\u5B66\u751F\u8FFD\u95EE\uFF0C\u518D\u6DF1\u5165\u3002\u4E0D\u8981\u4E3A\u4E86\u663E\u5F97\u9AD8\u6DF1\u800C\u8FC7\u5EA6\u53D1\u6563\u3002",
    "6. \u5982\u679C\u8981\u7ED9\u51FA\u53EF\u8FFD\u6839\u7684\u65B9\u5411\uFF0C\u7528\u7B80\u6D01\u7684\u6761\u76EE\u5217\u51FA\uFF0C\u4E0D\u8981\u5C55\u5F00\u6210\u957F\u7BC7\u79BB\u9898\u8BBA\u8FF0\u3002"
  ].join("\n");
}
async function streamCompletion(settings, messages, opts = {}) {
  var _a, _b, _c, _d, _e, _f, _g;
  const { apiBase, apiKey } = activeEndpoint(settings);
  if (!apiKey) {
    throw new Error("\u672A\u914D\u7F6E API Key\uFF1A\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u9009\u62E9 Provider \u6216\u586B\u5199\u5BC6\u94A5");
  }
  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: (_a = settings.temperature) != null ? _a : 0.8,
      max_tokens: (_b = settings.maxTokens) != null ? _b : 4096,
      stream: true
    }),
    signal: opts.signal
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI \u8BF7\u6C42\u5931\u8D25 (${resp.status}): ${errText.slice(0, 300)}`);
  }
  const reader = (_c = resp.body) == null ? void 0 : _c.getReader();
  if (!reader) throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u6D41\u5F0F\u54CD\u5E94");
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = (_f = (_e = (_d = json == null ? void 0 : json.choices) == null ? void 0 : _d[0]) == null ? void 0 : _e.delta) == null ? void 0 : _f.content;
          if (typeof delta === "string" && delta.length) {
            full += delta;
            (_g = opts.onDelta) == null ? void 0 : _g.call(opts, delta);
          }
        } catch (e) {
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}
function atToken(value, cursor) {
  const before = value.slice(0, cursor);
  const m = /(?:^|[\s（(【[，,。.！!？?；;])(@)([^\s@]*)$/.exec(before);
  if (!m) return null;
  return { token: m[2], start: m.index + m[0].indexOf("@") };
}
function extractNoteLinks(content) {
  const re = /\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g;
  const out = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim().split("#")[0].trim();
    if (name) out.push(name);
  }
  return out;
}
function buildNoteContextBlocks(notes) {
  if (notes.length === 0) return "";
  return "\u3010@ \u5F15\u7528\u7B14\u8BB0\u3011\uFF08\u6765\u81EA\u95EE\u9898\u4E2D @ \u5F15\u7528\u7684\u7B14\u8BB0\uFF09\n" + notes.map((n) => `<context file="${n.path}">
${String(n.content).slice(0, 500)}
</context>`).join("\n\n") + "\n\n\u56DE\u7B54\u89C4\u5219\uFF1A\u5F15\u7528\u8FD9\u4E9B\u7B14\u8BB0\u5185\u5BB9\u65F6\u6807\u6CE8\u7B14\u8BB0\u540D\uFF1B\u7B14\u8BB0\u672A\u8986\u76D6\u7684\u90E8\u5206\u57FA\u4E8E\u5DF2\u6709\u77E5\u8BC6\u56DE\u7B54\uFF0C\u4E0D\u8981\u58F0\u660E\u770B\u4E0D\u5230\u7B14\u8BB0\u3002";
}

// src/agent.ts
var import_obsidian = require("obsidian");
var AGENT_TOOLS = [
  {
    name: "read_note",
    description: "\u8BFB\u53D6 vault \u5185\u7B14\u8BB0\u7684\u5B8C\u6574\u5185\u5BB9\u3002\u53C2\u6570 path \u4E3A vault \u76F8\u5BF9\u8DEF\u5F84\uFF08\u5982 learning/peizhi/learn/_wiki/\u8BA4\u77E5\u8FB9\u7F18/xxx.md\uFF09\u3002\u7528\u4E8E\u4E86\u89E3\u5DF2\u6709\u7B14\u8BB0\u5185\u5BB9\u3002",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "vault \u76F8\u5BF9\u8DEF\u5F84" } },
      required: ["path"]
    }
  },
  {
    name: "list_nodes",
    description: "\u5217\u51FA\u8BA4\u77E5\u8FB9\u7F18\u8282\u70B9\uFF08\u5F53\u524D\u5DE5\u4F5C\u533A\u7684\u601D\u7EF4\u94FE\u8282\u70B9\u6811\uFF09\u3002\u8FD4\u56DE\u8282\u70B9\u6807\u9898\u3001\u7236\u8282\u70B9\u3001\u6458\u8981\u3002\u7528\u4E8E\u4E86\u89E3\u8BA4\u77E5\u5730\u56FE\u73B0\u72B6\u3001\u51B3\u5B9A\u6302\u8F7D\u4F4D\u7F6E\u3002",
    parameters: {
      type: "object",
      properties: { workspace: { type: "string", description: "\u5DE5\u4F5C\u533A\u540D\uFF08\u53EF\u9009\uFF0C\u9ED8\u8BA4\u5F53\u524D\uFF09" } }
    }
  },
  {
    name: "create_node",
    description: "\u521B\u5EFA\u8BA4\u77E5\u8282\u70B9\u7B14\u8BB0\uFF08\u6C89\u6DC0\u77E5\u8BC6\u5230\u8BA4\u77E5\u5730\u56FE\uFF09\u3002\u53C2\u6570\uFF1Atitle \u8282\u70B9\u6807\u9898\uFF08\u7B80\u6D01\u3001\u5177\u4F53\uFF0C\u540C\u4E00\u6982\u5FF5\u5408\u5E76\uFF09\uFF1Bcontent \u8282\u70B9\u6B63\u6587\uFF08Markdown\uFF0C\u542B\u7406\u89E3\u6C89\u6DC0\uFF09\uFF1BparentTitle \u7236\u8282\u70B9\u6807\u9898\uFF08\u53EF\u7701\u7565=\u6302\u6839\uFF09\u3002\u5199\u5165\u540E\u81EA\u52A8\u66F4\u65B0 MOC\u3002",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "\u8282\u70B9\u6807\u9898" },
        content: { type: "string", description: "\u8282\u70B9\u6B63\u6587\uFF08Markdown\uFF09" },
        parentTitle: { type: "string", description: "\u7236\u8282\u70B9\u6807\u9898\uFF08\u53EF\u7701\u7565\uFF09" }
      },
      required: ["title", "content"]
    }
  },
  {
    name: "update_moc",
    description: "\u91CD\u65B0\u751F\u6210\u5F53\u524D\u5DE5\u4F5C\u533A\u7684\u8BA4\u77E5\u5730\u56FE\u7D22\u5F15\uFF08MOC\uFF09\u6587\u4EF6\u3002\u7528\u4E8E\u8282\u70B9\u53D8\u52A8\u540E\u5237\u65B0\u7D22\u5F15\u3002",
    parameters: {
      type: "object",
      properties: { workspace: { type: "string", description: "\u5DE5\u4F5C\u533A\u540D\uFF08\u53EF\u9009\uFF0C\u9ED8\u8BA4\u5F53\u524D\uFF09" } }
    }
  },
  {
    name: "query_backlinks",
    description: "\u67E5\u8BE2\u67D0\u4E2A\u7B14\u8BB0\u5728 vault \u4E2D\u7684\u53CD\u5411\u94FE\u63A5\uFF08\u54EA\u4E9B\u7B14\u8BB0\u5F15\u7528\u4E86\u5B83\uFF09\u3002\u53C2\u6570 path \u4E3A vault \u76F8\u5BF9\u8DEF\u5F84\u3002\u7528\u4E8E\u7406\u89E3\u7B14\u8BB0\u95F4\u7684\u5173\u7CFB\u3002",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "vault \u76F8\u5BF9\u8DEF\u5F84" } },
      required: ["path"]
    }
  },
  {
    name: "search_notes",
    description: "\u6309\u5173\u952E\u8BCD\u641C\u7D22 vault \u5185\u7B14\u8BB0\u5185\u5BB9\uFF08\u6807\u9898\u6216\u6B63\u6587\u5305\u542B\u5173\u952E\u8BCD\uFF09\u3002\u8FD4\u56DE\u5339\u914D\u7684\u7B14\u8BB0\u8DEF\u5F84\u548C\u6458\u8981\u7247\u6BB5\u3002\u7528\u4E8E\u5B9A\u4F4D\u76F8\u5173\u6750\u6599\u3002",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "\u641C\u7D22\u5173\u952E\u8BCD" } },
      required: ["query"]
    }
  }
];
var TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.name));
function buildAgentSystemPrompt(wsHint) {
  return [
    "\u4F60\u662F\u300C\u8BA4\u77E5\u8FB9\u7F18\u5BFC\u5E08\u300D\u7684\u6267\u884C\u4EE3\u7406\uFF08agent\uFF09\u3002\u7528\u6237\u5728 Obsidian \u91CC\u7ED9\u4F60\u4E0B\u8FBE\u64CD\u4F5C\u6307\u4EE4\uFF0C\u4F60\u901A\u8FC7\u8C03\u7528\u5DE5\u5177\u5B8C\u6210\u5B83\u3002",
    "",
    wsHint ? wsHint : "",
    "",
    "\u5DE5\u5177\u4F7F\u7528\u94C1\u5F8B\uFF1A",
    "1. \u9700\u8981\u4E86\u89E3\u73B0\u72B6 \u2192 \u5148 list_nodes / search_notes / read_note\uFF0C\u4E0D\u8981\u51ED\u7A7A\u5047\u8BBE\u3002",
    "2. \u6C89\u6DC0\u77E5\u8BC6 \u2192 create_node\uFF1A\u6807\u9898\u7B80\u6D01\u5177\u4F53\uFF1B\u6B63\u6587\u7528 Markdown \u5199\u6E05\u695A\u7406\u89E3\uFF1B\u6709\u660E\u786E\u7236\u5B50\u5173\u7CFB\u65F6\u7ED9 parentTitle\u3002",
    "3. \u4E00\u6B21\u4EFB\u52A1\u53EF\u80FD\u8981\u591A\u6B65\uFF1A\u67E5\u73B0\u72B6 \u2192 \u6267\u884C \u2192 \u9A8C\u8BC1\u3002\u9010\u6B65\u6765\uFF0C\u6BCF\u6B65\u5DE5\u5177\u7ED3\u679C\u4F1A\u8FD4\u56DE\u7ED9\u4F60\u3002",
    "4. \u5DE5\u5177\u5931\u8D25\uFF08\u5982\u8DEF\u5F84\u4E0D\u5B58\u5728\uFF09\u2192 \u6839\u636E\u9519\u8BEF\u4FE1\u606F\u8C03\u6574\u53C2\u6570\u91CD\u8BD5\uFF0C\u4E0D\u8981\u7F16\u9020\u7ED3\u679C\u3002",
    "5. \u4EFB\u52A1\u5B8C\u6210\u540E\uFF0C\u7528\u4E00\u4E24\u53E5\u8BDD\u5411\u7528\u6237\u603B\u7ED3\uFF1A\u505A\u4E86\u4EC0\u4E48\u3001\u8282\u70B9/\u6587\u4EF6\u5728\u54EA\u3001\u5982\u9700\u8C03\u6574\u53EF\u600E\u4E48\u8BF4\u3002",
    "",
    "\u5185\u5BB9\u98CE\u683C\uFF1A\u4E2D\u6587\uFF0C\u6559\u7EC3\u53E3\u543B\uFF08\u4E0D\u662F AI \u8154\uFF09\u3002"
  ].join("\n");
}
async function runAgent(config, userInput, executor, opts = {}) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  const maxTurns = opts.maxTurns && opts.maxTurns > 0 ? opts.maxTurns : 30;
  const toolsUsed = /* @__PURE__ */ new Set();
  const messages = [
    { role: "system", content: buildAgentSystemPrompt(opts.wsHint) },
    { role: "user", content: userInput }
  ];
  let turns = 0;
  while (turns < maxTurns) {
    turns++;
    const payload = {
      model: config.model,
      messages,
      tools: AGENT_TOOLS.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters }
      })),
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 2048
    };
    const resp = await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: opts.signal
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Agent \u8BF7\u6C42\u5931\u8D25 (${resp.status}): ${errText.slice(0, 300)}`);
    }
    const data = await resp.json();
    const msg = (_b = (_a = data == null ? void 0 : data.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message;
    if (!msg) throw new Error("Agent \u8FD4\u56DE\u7A7A\u54CD\u5E94");
    const calls = ((_c = msg.tool_calls) != null ? _c : []).filter((c) => (c == null ? void 0 : c.type) === "function").map((c) => {
      var _a2;
      const fn = c.function;
      let args = {};
      try {
        args = JSON.parse(String((_a2 = fn.arguments) != null ? _a2 : "{}"));
      } catch (e) {
        args = {};
      }
      return { id: String(c.id), name: String(fn.name), arguments: args };
    });
    messages.push({ role: "assistant", content: (_d = msg.content) != null ? _d : "", tool_calls: (_e = msg.tool_calls) != null ? _e : [] });
    if (calls.length === 0) {
      const answer = String((_f = msg.content) != null ? _f : "");
      (_g = opts.onDelta) == null ? void 0 : _g.call(opts, answer);
      return { ok: true, answer, toolsUsed: [...toolsUsed], turns };
    }
    for (const call of calls) {
      if (!TOOL_NAMES.has(call.name)) {
        const err = `\u672A\u77E5\u5DE5\u5177\uFF1A${call.name}`;
        messages.push({ role: "tool", tool_call_id: call.id, content: err });
        (_h = opts.onStep) == null ? void 0 : _h.call(opts, { turn: turns, call, result: err });
        continue;
      }
      toolsUsed.add(call.name);
      let result;
      try {
        result = await executor(call.name, call.arguments);
      } catch (e) {
        result = `\u5DE5\u5177\u6267\u884C\u5931\u8D25: ${e.message.slice(0, 300)}`;
      }
      (_i = opts.onStep) == null ? void 0 : _i.call(opts, { turn: turns, call, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  return {
    ok: true,
    answer: `\u26A0\uFE0F \u4EFB\u52A1\u8D85\u8FC7 ${maxTurns} \u8F6E\u4ECD\u672A\u5B8C\u6210\uFF0C\u5DF2\u505C\u6B62\u3002\u4F60\u53EF\u4EE5\u628A\u4EFB\u52A1\u62C6\u5C0F\u518D\u8BD5\u3002`,
    toolsUsed: [...toolsUsed],
    turns
  };
}
function buildVaultExecutor(app, ctx) {
  const { currentWorkspace, listNodes: listNodes2, createNode, updateMoc } = ctx;
  return async (name, args) => {
    var _a, _b, _c, _d, _e, _f, _g;
    switch (name) {
      case "read_note": {
        const path = String((_a = args.path) != null ? _a : "");
        if (!path) return "\u9519\u8BEF\uFF1A\u9700\u8981 path \u53C2\u6570";
        const f = app.vault.getAbstractFileByPath(path);
        if (!(f instanceof import_obsidian.TFile)) return `\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${path}`;
        const text = await app.vault.read(f);
        return text.slice(0, 4e3);
      }
      case "list_nodes": {
        const ws = String((_b = args.workspace) != null ? _b : "") || currentWorkspace();
        const nodes = await listNodes2(ws);
        if (nodes.length === 0) return "\uFF08\u5F53\u524D\u5DE5\u4F5C\u533A\u6CA1\u6709\u8BA4\u77E5\u8282\u70B9\uFF0C\u53EF\u4EE5\u4ECE\u96F6\u5F00\u59CB\u521B\u5EFA\uFF09";
        return nodes.map((n) => `- ${n.title}${n.parentTitle ? `\uFF08\u7236: ${n.parentTitle}\uFF09` : ""}${n.summary ? `: ${n.summary.slice(0, 80)}` : ""}`).join("\n");
      }
      case "create_node": {
        const title = String((_c = args.title) != null ? _c : "").trim();
        const content = String((_d = args.content) != null ? _d : "").trim();
        if (!title || !content) return "\u9519\u8BEF\uFF1A\u9700\u8981 title \u548C content \u53C2\u6570";
        const parentTitle = args.parentTitle ? String(args.parentTitle) : void 0;
        const ws = currentWorkspace();
        const node = {
          title,
          content,
          parentTitle,
          workspace: ws,
          anchor: { sourcePath: "", quote: "" },
          status: "active"
        };
        const f = await createNode(node);
        return `\u5DF2\u521B\u5EFA\u8282\u70B9\uFF1A${f.path}`;
      }
      case "update_moc": {
        const ws = String((_e = args.workspace) != null ? _e : "") || currentWorkspace();
        await updateMoc(ws);
        return `\u5DF2\u66F4\u65B0\u8BA4\u77E5\u5730\u56FE MOC\uFF08\u5DE5\u4F5C\u533A\uFF1A${ws}\uFF09`;
      }
      case "query_backlinks": {
        const path = String((_f = args.path) != null ? _f : "");
        if (!path) return "\u9519\u8BEF\uFF1A\u9700\u8981 path \u53C2\u6570";
        const cache = app.metadataCache;
        const links = cache.getBacklinksForPath(path);
        const keys = [...links.keys()];
        if (keys.length === 0) return `\u6CA1\u6709\u7B14\u8BB0\u5F15\u7528 ${path}`;
        return `\u5F15\u7528 ${path} \u7684\u7B14\u8BB0\uFF1A
${keys.slice(0, 20).map((k) => `- ${k}`).join("\n")}`;
      }
      case "search_notes": {
        const query = String((_g = args.query) != null ? _g : "").trim();
        if (!query) return "\u9519\u8BEF\uFF1A\u9700\u8981 query \u53C2\u6570";
        const q = query.toLowerCase();
        const hits = [];
        const files = app.vault.getMarkdownFiles();
        for (const f of files) {
          if (hits.length >= 15) break;
          if (f.path.toLowerCase().includes(q)) {
            hits.push(`- ${f.path}\uFF08\u6807\u9898\u547D\u4E2D\uFF09`);
            continue;
          }
          const text = await app.vault.cachedRead(f);
          if (text.toLowerCase().includes(q)) {
            const idx = text.toLowerCase().indexOf(q);
            const snippet = text.slice(Math.max(0, idx - 40), idx + 80).replace(/\n+/g, " ");
            hits.push(`- ${f.path}\uFF1A\u2026${snippet}\u2026`);
          }
        }
        return hits.length ? hits.join("\n") : `\u6CA1\u6709\u627E\u5230\u5305\u542B "${query}" \u7684\u7B14\u8BB0`;
      }
      default:
        return `\u672A\u77E5\u5DE5\u5177\uFF1A${name}`;
    }
  };
}

// src/opencode.ts
var DEFAULT_TOOLS = {
  bash: true,
  read: true,
  glob: true,
  grep: true,
  write: true,
  edit: true,
  webfetch: true,
  websearch: true,
  task: true,
  apply_patch: true
};
var SAFETY_SYSTEM = [
  "\u4F60\u662F\u7528\u6237\u5728 Obsidian vault \u91CC\u7684\u6267\u884C\u4EE3\u7406\u3002\u4EE5\u4E0B\u94C1\u5F8B\u5FC5\u987B\u9075\u5B88\uFF1A",
  "1. \u7981\u6B62\u5220\u9664 vault \u5185\u4EFB\u4F55\u6587\u4EF6\u6216\u6587\u4EF6\u5939\uFF08\u5305\u62EC\u8282\u70B9 .md\u3001.conv.json\u3001.obsidian \u914D\u7F6E\u3001\u9690\u85CF\u6587\u4EF6\uFF09\u3002",
  "2. \u7981\u6B62\u79FB\u52A8/\u91CD\u547D\u540D/\u6279\u91CF\u8986\u76D6\u6587\u4EF6\uFF0C\u9664\u975E\u7528\u6237\u6307\u4EE4\u660E\u786E\u8981\u6C42\uFF0C\u4E14\u64CD\u4F5C\u524D\u5148\u5728\u56DE\u590D\u4E2D\u8BF4\u660E\u8BA1\u5212\u3002",
  "3. \u4FEE\u6539\u6216\u521B\u5EFA\u6587\u4EF6\u524D\uFF0C\u5148\u8BFB\u53D6\u76EE\u6807\u73B0\u72B6\uFF0C\u4E0D\u8981\u51ED\u7A7A\u8986\u76D6\u5DF2\u6709\u5185\u5BB9\u3002",
  "4. \u4EFB\u52A1\u5B8C\u6210\u540E\u7528\u4E00\u4E24\u53E5\u8BDD\u603B\u7ED3\u505A\u4E86\u4EC0\u4E48\u3001\u6587\u4EF6\u5728\u54EA\u3002"
].join("\n");
async function runOpenCodeTask(config, userInput, opts = {}) {
  const base = (config.base || "http://127.0.0.1:10999").replace(/\/+$/, "");
  const sessionId = await createSession(base, opts.signal);
  try {
    return await sendMessage(base, config, sessionId, userInput, opts);
  } finally {
    try {
      await fetch(`${base}/session/${sessionId}`, { method: "DELETE", signal: opts.signal });
    } catch (e) {
    }
  }
}
async function createSession(base, signal) {
  const resp = await fetch(`${base}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "edge-tutor agent task" }),
    signal
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`\u521B\u5EFA opencode \u4F1A\u8BDD\u5931\u8D25 (${resp.status}): ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const id = data == null ? void 0 : data.id;
  if (!id) throw new Error("opencode \u4F1A\u8BDD\u521B\u5EFA\u5931\u8D25\uFF1A\u65E0 id");
  return String(id);
}
async function sendMessage(base, config, sessionId, text, opts = {}) {
  var _a, _b, _c, _d, _e, _f;
  const asyncResp = await fetch(`${base}/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: { providerID: config.provider, modelID: config.model },
      tools: DEFAULT_TOOLS,
      system: (_a = opts.system) != null ? _a : SAFETY_SYSTEM,
      parts: [{ type: "text", text }]
    }),
    signal: opts.signal
  });
  if (!asyncResp.ok) {
    const errText = await asyncResp.text();
    throw new Error(`opencode \u4EFB\u52A1\u5931\u8D25 (${asyncResp.status}): ${errText.slice(0, 300)}`);
  }
  const reported = /* @__PURE__ */ new Set();
  let sseTurn = 0;
  const controller = new AbortController();
  const outer = opts.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort());
  }
  const maxWaitMs = (_b = opts.maxWaitMs) != null ? _b : 15 * 60 * 1e3;
  const evtResp = await fetch(`${base}/event`, { signal: controller.signal });
  if (!evtResp.ok || !evtResp.body) {
    throw new Error(`opencode \u4E8B\u4EF6\u6D41\u5931\u8D25 (${evtResp.status})`);
  }
  const reader = evtResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let idle = false;
  const deadline = Date.now() + maxWaitMs;
  try {
    while (!idle) {
      if (Date.now() > deadline) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let ev;
        try {
          ev = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        const type = ev.type;
        const props = (_c = ev.properties) != null ? _c : {};
        if (type === "session.idle") {
          idle = true;
          break;
        }
        if (type === "message.part.updated" || type === "message.part.created") {
          const part = props.part;
          if ((part == null ? void 0 : part.type) !== "tool" || typeof part.tool !== "string" || !part.id || reported.has(part.id)) {
            continue;
          }
          const st0 = typeof part.state === "object" && part.state !== null ? part.state : {};
          const status0 = String((_d = st0 == null ? void 0 : st0.status) != null ? _d : "");
          const output0 = String((_e = st0 == null ? void 0 : st0.output) != null ? _e : "").trim();
          if (status0 !== "completed" && status0 !== "error" && !output0) continue;
          reported.add(part.id);
          const step = toolPartToStep(part);
          step.turn = ++sseTurn;
          (_f = opts.onStep) == null ? void 0 : _f.call(opts, step);
        }
      }
    }
  } finally {
    controller.abort();
    try {
      reader.releaseLock();
    } catch (e) {
    }
  }
  const listResp = await fetch(`${base}/session/${sessionId}/message`, { signal: opts.signal });
  if (!listResp.ok) {
    throw new Error(`opencode \u8BFB\u53D6\u7ED3\u679C\u5931\u8D25 (${listResp.status})`);
  }
  const msgs = await listResp.json();
  return parseMessages(msgs, opts, reported);
}
function toolPartToStep(part) {
  var _a, _b, _c, _d;
  const st = typeof part.state === "object" && part.state !== null ? part.state : {};
  const status = String((_a = st == null ? void 0 : st.status) != null ? _a : "");
  const output = String((_b = st == null ? void 0 : st.output) != null ? _b : "").trim();
  const title = String((_c = st == null ? void 0 : st.title) != null ? _c : "");
  const rawInput = st == null ? void 0 : st.input;
  const inputArg = title || (typeof rawInput === "string" ? rawInput.trim() : summarizeJson(rawInput, 100)) || summarizeJson(part.input, 100);
  const out = output || summarizeOutput(void 0);
  const result = status === "error" ? `\u26A0\uFE0F \u5931\u8D25\uFF1A${out}` : out.length > 300 ? out.slice(0, 300) + "\u2026" : out;
  return { turn: 0, call: { name: (_d = part.tool) != null ? _d : "", arguments: inputArg }, result };
}
function parseMessages(msgs, opts, reported) {
  var _a, _b, _c, _d, _e, _f;
  const texts = [];
  const steps = [];
  let turn = 0;
  for (const raw of msgs) {
    const msg = raw != null ? raw : {};
    const role = (_a = msg.info) == null ? void 0 : _a.role;
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    for (const rp of parts) {
      const p = rp != null ? rp : {};
      if (p.type === "text" && typeof p.text === "string" && p.text.trim() && role !== "user") {
        texts.push(p.text);
      } else if (p.type === "tool" && typeof p.tool === "string") {
        turn++;
        const already = reported == null ? void 0 : reported.has((_b = p.id) != null ? _b : "");
        const step = { turn, call: { name: p.tool, arguments: "" }, result: "" };
        const st = typeof p.state === "object" && p.state !== null ? p.state : {};
        const status = String((_c = st == null ? void 0 : st.status) != null ? _c : "");
        const output = String((_d = st == null ? void 0 : st.output) != null ? _d : "").trim();
        const title = String((_e = st == null ? void 0 : st.title) != null ? _e : "");
        const rawInput = st == null ? void 0 : st.input;
        const inputArg = title || (typeof rawInput === "string" ? rawInput.trim() : summarizeJson(rawInput, 100)) || summarizeJson(p.input, 100);
        const out = output || summarizeOutput(p.output);
        step.call.arguments = inputArg;
        step.result = status === "error" ? `\u26A0\uFE0F \u5931\u8D25\uFF1A${out}` : out.length > 300 ? out.slice(0, 300) + "\u2026" : out;
        steps.push(step);
        if (!already) (_f = opts.onStep) == null ? void 0 : _f.call(opts, step);
      }
    }
  }
  const answer = texts.join("\n\n").trim() || "\uFF08\u4EFB\u52A1\u5B8C\u6210\uFF0C\u65E0\u6587\u672C\u56DE\u590D\uFF09";
  return { ok: true, answer, steps };
}
function summarizeJson(v, maxLen) {
  if (v === void 0 || v === null) return "";
  let s;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch (e) {
    s = String(v);
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > maxLen ? s.slice(0, maxLen) + "\u2026" : s;
}
function summarizeOutput(out) {
  if (Array.isArray(out)) {
    const text = out.filter((x) => x.type === "text").map((x) => {
      var _a;
      return (_a = x.text) != null ? _a : "";
    }).join(" ");
    const plain = text.replace(/\s+/g, " ").trim();
    if (plain) return plain.length > 200 ? plain.slice(0, 200) + "\u2026" : plain;
    const kinds = out.map((x) => {
      var _a;
      return (_a = x.type) != null ? _a : "?";
    }).join(",");
    return kinds ? `[\u8F93\u51FA\uFF1A${kinds}]` : "[\u65E0\u6587\u672C\u8F93\u51FA]";
  }
  const s = summarizeJson(out, 200);
  return s || "[\u65E0\u6587\u672C\u8F93\u51FA]";
}

// src/tutor.ts
function makeNodeTitle(question, maxLen = 28) {
  const clean = question.replace(/[？?。！!，,；;：:、"'（）()【】\[\]——\-—\s]+/g, " ").replace(/^(为什么|为啥|如何|怎么|怎样|是否|能不能|可以|什么是|啥是)\s*/, "").trim();
  if (!clean) return "\u8BA4\u77E5\u8282\u70B9_" + Date.now().toString(36);
  let title = clean.slice(0, maxLen);
  title = title.replace(/[？?。！!，,；;：:、\s]+$/, "");
  return title || "\u8BA4\u77E5\u8282\u70B9_" + Date.now().toString(36);
}
function buildNodeContent(node) {
  const lines = [];
  lines.push("---");
  lines.push("type: \u8BA4\u77E5\u8282\u70B9");
  lines.push("status: " + node.status);
  lines.push("created: " + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
  lines.push('anchor: "' + node.anchor.quote.slice(0, 80) + '"');
  if (node.anchor.sourcePath) lines.push('anchorPath: "' + node.anchor.sourcePath + '"');
  if (node.parentTitle) lines.push('parent: "[[' + node.parentTitle + ']]"');
  if (node.summary) lines.push('summary: "' + node.summary.replace(/"/g, "'").slice(0, 120) + '"');
  if (node.locked) lines.push("locked: true");
  lines.push("---");
  lines.push("");
  lines.push("# " + node.title);
  lines.push("");
  lines.push("## \u{1F4D6} \u6559\u6750\u951A\u70B9");
  lines.push("");
  if (node.anchor.sourcePath) {
    const blockSuffix = node.anchor.blockId ? `#^${node.anchor.blockId}` : "";
    lines.push(`> \u6765\u6E90\uFF1A[[${node.anchor.sourcePath}${blockSuffix}]]`);
  }
  if (node.anchor.quote) {
    lines.push(`> ${node.anchor.quote.slice(0, 120)}${node.anchor.quote.length > 120 ? "\u2026" : ""}`);
  }
  lines.push("");
  lines.push("## \u{1F50D} \u8FFD\u95EE");
  lines.push("");
  lines.push(node.rootQuestion ? node.rootQuestion : "\uFF08\u8FD9\u91CC\u662F\u4F60\u7684\u95EE\u9898\uFF09");
  lines.push("");
  lines.push("## \u{1F4A1} \u5BFC\u5E08\u56DE\u5E94\uFF08\u4EF7\u503C\u8BC6\u522B\uFF09");
  lines.push("");
  lines.push(node.summary ? node.summary : "\uFF08AI \u56DE\u7B54\u5C06\u5728\u6B64\u5C55\u5F00 \u2014\u2014 \u73CD\u8D35/\u7EC6\u8282\u5224\u65AD + \u63A8\u6DF1\u65B9\u5411\uFF09");
  lines.push("");
  lines.push("## \u{1F517} \u539F\u7406\u94FE");
  lines.push("");
  lines.push("- \u7236\u8282\u70B9\uFF1A" + (node.parentTitle ? `[[${node.parentTitle}]]` : "\uFF08\u65E0\uFF09"));
  lines.push("- \u5B50\u8282\u70B9\uFF1A\uFF08\u5F85\u8FFD\u6839\uFF09");
  lines.push("");
  return lines.join("\n");
}
function extractMentorResponse(content) {
  var _a, _b;
  if (!content) return "";
  const m = content.match(/## 💡 导师回应[^\n]*\n([\s\S]*?)(?=\n## 🔗 原理链|\n## 📖 教材锚点|\n## 🔍 追问|\n---|$)/);
  return (_b = (_a = m == null ? void 0 : m[1]) == null ? void 0 : _a.trim()) != null ? _b : "";
}
function parseNodeFromContent(title, content, sourcePath) {
  var _a, _b, _c, _d;
  const status = content.includes("status: paused") ? "paused" : "active";
  const parentMatch = content.match(/parent:\s*"\[\[([^\]]+)\]\]"/);
  const anchorMatch = content.match(/^anchor:\s*"([^"]*)"/m);
  const summaryMatch = content.match(/^summary:\s*"([^"]*)"/m);
  const anchorPathMatch = content.match(/^anchorPath:\s*"([^"]*)"/m);
  const lockedMatch = content.match(/^locked:\s*true/m);
  let rootQuestion;
  const qMatch = content.match(/## 🔍 追问\s*\n([\s\S]*?)\n## /);
  if (qMatch == null ? void 0 : qMatch[1]) rootQuestion = qMatch[1].trim().slice(0, 300) || void 0;
  let summary;
  const full = extractMentorResponse(content);
  if (full) summary = full.slice(0, 300);
  return {
    title,
    content,
    parentTitle: (_a = parentMatch == null ? void 0 : parentMatch[1]) != null ? _a : void 0,
    anchor: {
      sourcePath: (_b = anchorPathMatch == null ? void 0 : anchorPathMatch[1]) != null ? _b : sourcePath,
      quote: (_c = anchorMatch == null ? void 0 : anchorMatch[1]) != null ? _c : ""
    },
    status,
    rootQuestion,
    summary: (_d = summaryMatch == null ? void 0 : summaryMatch[1]) != null ? _d : summary,
    locked: !!lockedMatch
  };
}
function buildMocContent(nodes) {
  const lines = [];
  lines.push("---");
  lines.push("type: \u8BA4\u77E5\u5730\u56FE");
  lines.push("updated: " + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
  lines.push("---");
  lines.push("");
  lines.push("# \u{1F5FA}\uFE0F \u8BA4\u77E5\u8FB9\u7F18\u5730\u56FE");
  lines.push("");
  lines.push("> \u539F\u7406\u94FE\u603B\u89C8\uFF1A\u6BCF\u6761\u94FE = \u4ECE\u6559\u6750\u4F8B\u9898\u8FFD\u6839\u5230\u62BD\u8C61\u539F\u7406\u7684\u8F68\u8FF9");
  lines.push("");
  for (const n of nodes) {
    const statusIcon = n.status === "active" ? "\u{1F7E2}" : "\u23F8\uFE0F";
    lines.push(`- ${statusIcon} [[${n.title}]] \u2014 ${n.anchor.quote.slice(0, 40)}`);
  }
  lines.push("");
  return lines.join("\n");
}
function parkQuestion(question, opts = {}) {
  var _a, _b;
  const text = String(question || "").trim();
  if (!text) return null;
  return {
    id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    question: text,
    category: opts.category === "branch" ? "branch" : "later",
    parentId: (_a = opts.parentId) != null ? _a : null,
    anchor: (_b = opts.anchor) != null ? _b : null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function takeParked(list, id) {
  const index = list.findIndex((it) => it.id === id);
  if (index < 0) return { list, item: null };
  const item = list[index];
  return { list: list.filter((_, i) => i !== index), item };
}

// src/search.ts
function parseChapterIndex(tocText) {
  const out = [];
  const re = /##\s*\[\[chapters\/([^\]|]+\.md)\|([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(tocText != null ? tocText : "")) !== null) {
    const file = "chapters/" + m[1].trim();
    const title = m[2].trim();
    if (m[1].trim() && title) out.push({ file, title });
  }
  return out;
}
function normalizeQuery(query) {
  const q = String(query != null ? query : "").replace(/[，。！？、；：""''（）《》【】\s]+/g, "").replace(/^(为什么|为啥|如何|怎么|怎样|是否|能不能|可以|什么是|啥是|帮我|我想|请问|那|这个|就|请|解释一下|讲讲|介绍一下|详细|具体|深入|继续|然后)/g, "").replace(/^(为什么|为啥|如何|怎么|怎样|是否|能不能|可以|什么是|啥是|帮我|我想|请问|那|这个|就|请|解释一下|讲讲|介绍一下|详细|具体|深入|继续|然后)+/g, "").trim();
  return q.slice(0, 40);
}
function parseSearchResult(answer) {
  const a = String(answer != null ? answer : "").trim();
  if (!a || /^(未找到|没有找到|无|未发现|无法)/.test(a)) {
    return { found: false, text: "", count: 0, refs: [] };
  }
  const refs = [];
  const newRe = /【文件】\s*`?([^`\n]+)`?[\s\S]*?【行号】\s*([0-9]+)\s*(?:-|—|～|~|至)\s*([0-9]+)[\s\S]*?【原文】\s*([\s\S]*?)(?=【文件】|$)/g;
  let m;
  while ((m = newRe.exec(a)) !== null) {
    const file = m[1].trim();
    const s = parseInt(m[2], 10);
    const e = parseInt(m[3], 10);
    const text2 = m[4].trim();
    if (!file || !text2 || !Number.isFinite(s)) continue;
    refs.push({ file, startLine: s, endLine: e >= s ? e : s, text: text2 });
  }
  if (refs.length === 0) {
    const oldRe = /【文件路径】\s*`?([^`\n]+)`?([\s\S]*?)(?=【文件路径】|$)/g;
    while ((m = oldRe.exec(a)) !== null) {
      const raw = m[1].trim();
      let body = m[2].trim().replace(/^(原文片段|原文|摘录|内容|结果)[：:]\s*/, "").replace(/^「|」$/g, "").trim();
      let s = 0;
      let e = 0;
      const lineMatch = raw.match(/:([0-9]+)\s*(?:-|—|～|~|至)\s*([0-9]+)$/) || raw.match(/:([0-9]+)$/);
      if (lineMatch) {
        s = parseInt(lineMatch[1], 10);
        e = lineMatch[2] ? parseInt(lineMatch[2], 10) : s;
      } else {
        const bodyLine = body.match(/(?:第[^:：\n]+|[^:：\n]+\.md)[:：]([0-9]+)\s*(?:-|—|～|~|至)\s*([0-9]+)/);
        if (bodyLine) {
          s = parseInt(bodyLine[1], 10);
          e = parseInt(bodyLine[2], 10);
          body = body.replace(/（.*?）|\(.*?\)/g, "").trim();
        }
      }
      const file = raw.replace(/:\d+(-\d+)?$/, "");
      if (!file || !body || body.length < 10) continue;
      refs.push({ file, startLine: s, endLine: e >= s ? e : s, text: body });
    }
  }
  if (refs.length === 0) {
    const body = a.replace(/^(好的|可以|已找到|相关内容如下|以下是)[：:。\s]*/, "").trim();
    if (body.length < 20) return { found: false, text: "", count: 0, refs: [] };
    return { found: true, text: body.slice(0, 3e3), count: 1, refs: [{ file: "", startLine: 0, endLine: 0, text: body.slice(0, 3e3) }] };
  }
  const seen = /* @__PURE__ */ new Set();
  const top = [];
  for (const r of refs) {
    const key = `${r.file}:${r.startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    top.push(r);
    if (top.length >= 3) break;
  }
  const text = top.map((r, i) => {
    const loc = r.startLine > 0 ? `\u884C\uFF1A${r.startLine}${r.endLine > r.startLine ? `-${r.endLine}` : ""}` : "\u4F4D\u7F6E\uFF1A\u89C1\u539F\u6587";
    return `\u3010\u6559\u6750\u5F15\u7528 #${i + 1}\u3011\u6587\u4EF6\uFF1A${r.file} ${loc}
\u539F\u6587\uFF1A${r.text.slice(0, 300)}`;
  }).join("\n\n");
  return { found: true, text: text.slice(0, 3e3), count: top.length, refs: top };
}

// src/conv.ts
function freshConv(workspace) {
  return {
    workspace,
    messages: [],
    reading: {
      mode: "deep",
      sequence: 0,
      activeId: null,
      threads: [],
      parkingLot: []
    }
  };
}
function serializeConv(conv) {
  return JSON.stringify(
    {
      version: 4,
      kind: "edge-tutor-conv",
      workspace: conv.workspace,
      messages: conv.messages,
      reading: conv.reading
    },
    null,
    2
  );
}
function parseConv(text) {
  var _a, _b;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return null;
    if (!Array.isArray(data.messages)) return null;
    const messages = data.messages.filter((m) => m && typeof m.content === "string");
    const reading = data.reading && typeof data.reading === "object" ? data.reading : {};
    const parking = Array.isArray(reading.parkingLot) ? reading.parkingLot : Array.isArray(data.parkingLot) ? data.parkingLot : [];
    const conv = {
      workspace: data.workspace || "main",
      messages,
      reading: {
        mode: reading.mode === "quick" ? "quick" : "deep",
        sequence: (_a = reading.sequence) != null ? _a : 0,
        activeId: (_b = reading.activeId) != null ? _b : null,
        threads: Array.isArray(reading.threads) ? reading.threads.filter((t) => t && t.id && (t.title || t.rootQuestion)) : [],
        parkingLot: parking.filter((p) => p && typeof p.question === "string")
      }
    };
    return conv;
  } catch (e) {
    return null;
  }
}
function nextThreadId(conv) {
  conv.reading.sequence += 1;
  return "q" + conv.reading.sequence;
}
function addThread(conv, input) {
  var _a, _b;
  const id = nextThreadId(conv);
  const thread = {
    id,
    title: input.question,
    rootQuestion: input.question,
    parentId: (_a = input.parentId) != null ? _a : null,
    anchor: (_b = input.anchor) != null ? _b : null,
    summary: "",
    status: "active",
    originExcerpt: input.originExcerpt,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  conv.reading.threads.push(thread);
  conv.reading.activeId = id;
  return thread;
}
function ancestry(conv, id) {
  const byId = new Map(conv.reading.threads.map((t) => [t.id, t]));
  const chain = [];
  let cur = id;
  const guard = /* @__PURE__ */ new Set();
  while (cur && byId.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    const t = byId.get(cur);
    chain.unshift(t);
    cur = t.parentId;
  }
  return chain;
}
function activeThread(conv) {
  var _a;
  if (!conv.reading.activeId) return null;
  return (_a = conv.reading.threads.find((t) => t.id === conv.reading.activeId)) != null ? _a : null;
}
function childrenOf(conv, id) {
  return conv.reading.threads.filter((t) => t.parentId === id);
}
function orderedThreads(conv) {
  var _a;
  const out = [];
  const byParent = /* @__PURE__ */ new Map();
  for (const t of conv.reading.threads) {
    const p = t.parentId;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(t);
  }
  const queue = [null];
  const seen = /* @__PURE__ */ new Set();
  while (queue.length) {
    const cur = queue.shift();
    const kids = (_a = byParent.get(cur ? cur.id : null)) != null ? _a : [];
    for (const k of kids) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k);
      queue.push(k);
    }
  }
  for (const t of conv.reading.threads) {
    if (!seen.has(t.id)) out.push(t);
  }
  return out;
}
function isDescendant(conv, ancestorId, descendantId) {
  var _a, _b, _c, _d;
  const byId = new Map(conv.reading.threads.map((t) => [t.id, t]));
  let cur = (_b = (_a = byId.get(descendantId)) == null ? void 0 : _a.parentId) != null ? _b : null;
  const guard = /* @__PURE__ */ new Set();
  while (cur && byId.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    if (cur === ancestorId) return true;
    cur = (_d = (_c = byId.get(cur)) == null ? void 0 : _c.parentId) != null ? _d : null;
  }
  return false;
}
function reparentThread(conv, threadId, newParentId) {
  const t = conv.reading.threads.find((x) => x.id === threadId);
  if (!t) return false;
  if (newParentId === threadId) return false;
  if (newParentId && isDescendant(conv, threadId, newParentId)) return false;
  t.parentId = newParentId;
  t.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return true;
}
function switchThread(conv, id) {
  if (!conv.reading.threads.some((t) => t.id === id)) return false;
  conv.reading.activeId = id;
  return true;
}
function pauseActive(conv) {
  const t = activeThread(conv);
  if (t) t.status = "paused";
  conv.reading.activeId = null;
}
function pushMessage(conv, role, content, opts = {}) {
  const msg = {
    id: "m" + Date.now().toString(36),
    role,
    content,
    anchor: opts.anchor,
    lineId: opts.lineId,
    agent: opts.agent,
    ts: Date.now()
  };
  conv.messages.push(msg);
  return msg;
}
function removeMessage(conv, msg) {
  const idx = conv.messages.indexOf(msg);
  if (idx < 0) return false;
  conv.messages.splice(idx, 1);
  return true;
}
function buildConvFromNodes(nodes, workspace) {
  var _a, _b, _c;
  const conv = freshConv(workspace);
  const idByTitle = /* @__PURE__ */ new Map();
  nodes.forEach((n, i) => idByTitle.set(n.title, "q" + (i + 1)));
  for (const n of nodes) {
    const id = idByTitle.get(n.title);
    const parentId = n.parentTitle ? (_a = idByTitle.get(n.parentTitle)) != null ? _a : null : null;
    const thread = addThread(conv, {
      question: n.rootQuestion || n.title,
      parentId,
      anchor: n.anchor
    });
    thread.id = id;
    thread.title = n.title;
    thread.rootQuestion = n.rootQuestion || n.title;
    thread.summary = n.summary || "";
    thread.status = n.status;
    if (n.locked) thread.mastery = "mastered";
    pushMessage(conv, "user", n.rootQuestion || n.title, { lineId: id });
    const fullResponse = extractMentorResponse(n.content);
    if (fullResponse) pushMessage(conv, "assistant", fullResponse, { lineId: id });
    else if (n.summary) pushMessage(conv, "assistant", n.summary, { lineId: id });
  }
  conv.reading.activeId = (_c = (_b = conv.reading.threads[0]) == null ? void 0 : _b.id) != null ? _c : null;
  return conv;
}
function finishAnswer(conv, message, question) {
  var _a;
  const lineId = message.lineId;
  const thread = lineId && conv.reading.threads.find((t) => t.id === lineId) || activeThread(conv);
  if (!thread) return null;
  thread.summary = String((_a = message.content) != null ? _a : "").replace(/\s+/g, " ").trim().slice(0, 300);
  thread.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (question) thread.lastQuestion = question;
  return thread;
}
function collectSubtree(conv, id) {
  const out = [];
  const stack = [];
  const root = conv.reading.threads.find((t) => t.id === id);
  if (!root) return out;
  stack.push(root);
  while (stack.length) {
    const cur = stack.pop();
    out.push(cur);
    for (const k of childrenOf(conv, cur.id)) stack.push(k);
  }
  return out;
}
function messageLineId(msg) {
  var _a;
  return (_a = msg.lineId) != null ? _a : null;
}
function branchContext(conv, id) {
  const path = ancestry(conv, id);
  if (!path.length) return "";
  return path.map((thread, index) => {
    let line = (index ? "\u5206\u652F" : "\u6839") + "\uFF1A" + (thread.rootQuestion || thread.title);
    if (thread.originExcerpt) line += "\n\u7531\u8FD9\u6BB5\u539F\u6587\u5F15\u51FA\uFF1A" + thread.originExcerpt;
    if (thread.summary) line += "\n\u65AD\u70B9\u6458\u8981\uFF1A" + thread.summary;
    return line;
  }).join("\n\n");
}
function cognitiveMapSummary(conv) {
  var _a, _b, _c;
  const threads = conv.reading.threads;
  const byParent = /* @__PURE__ */ new Map();
  for (const t of threads) {
    const key = (_a = t.parentId) != null ? _a : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  }
  const locked = [];
  const lines = [];
  const lineOf = (t) => {
    const marks = [];
    if (t.mastery === "mastered") {
      marks.push("\u{1F512} \u5C01\u9876");
      locked.push(t.title || t.rootQuestion || t.id);
    } else if (t.status === "paused") {
      marks.push("\u23F8\uFE0F \u6682\u505C");
    }
    const summary = t.summary ? `\uFF08\u6458\u8981\uFF1A${t.summary.replace(/\s+/g, " ").trim().slice(0, 80)}\uFF09` : "";
    return `${t.title || t.rootQuestion || t.id}${marks.length ? ` [${marks.join(" ")}]` : ""}${summary}`;
  };
  const walk = (parentKey, depth) => {
    var _a2;
    const kids = (_a2 = byParent.get(parentKey)) != null ? _a2 : [];
    for (const kid of kids) {
      lines.push(`${"  ".repeat(depth)}${depth === 0 ? "" : "\u2514\u2500 "}${lineOf(kid)}`);
      walk(kid.id, depth + 1);
    }
  };
  walk(null, 0);
  const placed = /* @__PURE__ */ new Set();
  byParent.forEach((kids) => kids.forEach((k) => placed.add(k.id)));
  for (const t of threads) {
    if (!placed.has(t.id) && t.parentId) {
      lines.push(`  \u2514\u2500 ${lineOf(t)}`);
    }
  }
  const active = activeThread(conv);
  return {
    locked: [...new Set(locked)],
    active: active ? active.title || active.rootQuestion : null,
    activeAnchorPath: (_c = (_b = active == null ? void 0 : active.anchor) == null ? void 0 : _b.sourcePath) != null ? _c : null,
    summaryText: lines.length ? lines.join("\n") : "\uFF08\u5C1A\u65E0\u8BA4\u77E5\u8282\u70B9\uFF0C\u5168\u65B0\u63A2\u7D22\uFF09"
  };
}
function responseInstruction(isFollowup) {
  const base = "\u9605\u8BFB\u6A21\u5F0F\uFF1A\u6301\u7EED\u6DF1\u5EA6\u5BF9\u8BDD\u3002\u8BF7\u5C55\u793A\u771F\u5B9E\u7684\u63A2\u7D22\u8FC7\u7A0B\uFF0C\u800C\u4E0D\u53EA\u662F\u6253\u78E8\u540E\u7684\u6700\u7EC8\u7ED3\u8BBA\u3002\u56DE\u5E94\u53CD\u5BF9\u610F\u89C1\uFF0C\u53D1\u5C55\u5177\u4F53\u53D8\u4F53\uFF0C\u8FDE\u63A5\u66F4\u6DF1\u7684\u80CC\u666F\u2014\u2014\u4F46\u59CB\u7EC8\u7528\u6E05\u6670\u3001\u8BF4\u4EBA\u8BDD\u7684\u4E2D\u6587\uFF0C\u7ED3\u6784\u5206\u660E\uFF0C\u4E0D\u8981\u5806\u780C\u542B\u6DF7\u672F\u8BED\u3002\u4FDD\u6301\u8FD9\u4E2A\u5206\u652F\u4E0E\u601D\u7EF4\u6811\u4E2D\u5176\u4ED6\u5144\u5F1F\u5206\u652F\u6982\u5FF5\u4E0A\u5206\u79BB\u3002";
  return isFollowup ? base + " \u8BF7\u4ECE\u8FD9\u4E2A\u5206\u652F\u5DF2\u6709\u7684\u4E0A\u4E0B\u6587\u548C\u672A\u89E3\u51B3\u95EE\u9898\u7EE7\u7EED\u3002" : base + " \u8FD9\u662F\u4E00\u4E2A\u65B0\u5206\u652F\uFF1B\u53EA\u628A\u63D0\u4F9B\u7684\u7956\u5148\u94FE\u5F53\u4F5C\u5B9A\u4F4D\u53C2\u8003\u3002";
}
function branchInstruction(conv, isFollowup) {
  const parts = [];
  parts.push("---\n" + responseInstruction(isFollowup));
  const ctx = branchContext(conv, conv.reading.activeId);
  if (ctx) parts.push("[\u601D\u7EF4\u6811\u7956\u5148\u94FE\uFF08\u4EC5\u4F5C\u5B9A\u4F4D\uFF0C\u8BF7\u5F85\u5728\u6D3B\u8DC3\u5206\u652F\u5185\uFF09]\n" + ctx);
  return parts.join("\n\n");
}
function messagesForView(conv, mode) {
  if (mode === "all") return conv.messages.slice();
  if (mode === "path") {
    const ids = new Set(ancestry(conv, conv.reading.activeId).map((t) => t.id));
    return conv.messages.filter((m) => !!m.lineId && ids.has(m.lineId));
  }
  if (!conv.reading.activeId) return [];
  return conv.messages.filter((m) => m.lineId === conv.reading.activeId);
}
function compactLine(s) {
  return String(s != null ? s : "").replace(/\s+/g, " ").trim().toLowerCase();
}
function excerptAround(value, query) {
  const v = String(value != null ? value : "");
  const q = String(query != null ? query : "").trim();
  const idx = v.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return v.slice(0, 60);
  const start = Math.max(0, idx - 40);
  const end = Math.min(v.length, idx + q.length + 40);
  return (start > 0 ? "\u2026" : "") + v.slice(start, end) + (end < v.length ? "\u2026" : "");
}
function searchConversation(conv, query) {
  const needle = compactLine(query);
  if (!conv || !needle) return [];
  const results = [];
  conv.reading.threads.forEach((thread) => {
    const titleNeedle = compactLine(thread.title || thread.rootQuestion);
    if (titleNeedle.includes(needle)) {
      results.push({
        lineId: thread.id,
        messageIndex: -1,
        role: "\u7EBF\u7A0B",
        excerpt: thread.title || thread.rootQuestion,
        field: "thread.title"
      });
    }
    if (thread.originExcerpt && compactLine(thread.originExcerpt).includes(needle)) {
      results.push({
        lineId: thread.id,
        messageIndex: -1,
        role: "\u539F\u6587",
        excerpt: excerptAround(thread.originExcerpt, needle),
        field: "thread.originExcerpt"
      });
    }
  });
  conv.messages.forEach((message, index) => {
    var _a;
    if (!message) return;
    const content = String((_a = message.content) != null ? _a : "");
    if (compactLine(content).includes(needle)) {
      results.push({
        lineId: messageLineId(message),
        messageIndex: index,
        role: message.role === "assistant" ? "\u56DE\u7B54" : "\u8FFD\u95EE",
        excerpt: excerptAround(content, needle),
        field: "content"
      });
    }
    if (message.verbatimContent && compactLine(message.verbatimContent).includes(needle)) {
      results.push({
        lineId: messageLineId(message),
        messageIndex: index,
        role: "\u539F\u6587",
        excerpt: excerptAround(message.verbatimContent, needle),
        field: "verbatimContent"
      });
    }
  });
  return results;
}

// src/export.ts
function formatConvMarkdown(conv, metadata = {}) {
  const title = metadata.title || "\u5BF9\u8BDD\u7B14\u8BB0";
  const source = metadata.source || "";
  const workspace = metadata.workspace || "main";
  const when = metadata.exportedAt instanceof Date ? metadata.exportedAt : /* @__PURE__ */ new Date();
  const exportedAt = when.toISOString().replace("T", " ").slice(0, 19);
  const parts = [];
  parts.push(`# ${title}`);
  parts.push("");
  if (source) parts.push(`- **\u6765\u6E90**\uFF1A${source}`);
  parts.push(`- **\u5DE5\u4F5C\u533A**\uFF1A${workspace === "main" ? "\u9ED8\u8BA4" : workspace}`);
  parts.push(`- **\u5BFC\u51FA\u65F6\u95F4**\uFF1A${exportedAt}`);
  parts.push("");
  const threads = orderedThreads(conv);
  parts.push("## \u601D\u7EF4\u94FE\u603B\u89C8");
  parts.push("");
  if (!threads.length) {
    parts.push("\u6682\u65E0\u601D\u7EF4\u8282\u70B9\u3002");
  } else {
    for (const t of threads) parts.push(outlineLine(conv, t));
  }
  parts.push("");
  const assigned = {};
  threads.forEach((thread, index) => {
    appendThread(parts, conv, thread, index + 1);
    conv.messages.forEach((m, mi) => {
      if (m && messageLineId(m) === thread.id) assigned[mi] = true;
    });
  });
  appendUnassignedMessages(parts, conv, assigned);
  appendParkingLot(parts, conv);
  return parts.join("\n");
}
function treeDepth(conv, thread) {
  return Math.max(0, ancestry(conv, thread.id).length - 1);
}
function outlineLine(conv, thread) {
  const depth = treeDepth(conv, thread);
  const indent = "  ".repeat(depth);
  return `${indent}- [${thread.id}] ${thread.title || thread.rootQuestion || "\u672A\u547D\u540D\u8282\u70B9"}`;
}
function messageLabel(message, counters) {
  if (message.role === "user") {
    counters.user += 1;
    return "\u95EE\u9898 " + counters.user;
  }
  if (message.role === "assistant") {
    counters.assistant += 1;
    return "\u56DE\u7B54 " + counters.assistant;
  }
  counters.other += 1;
  return "\u6D88\u606F " + counters.other;
}
function appendMessage(parts, message, counters) {
  var _a;
  const label = messageLabel(message, counters);
  parts.push(`**${label}**`);
  parts.push("");
  parts.push(String((_a = message.content) != null ? _a : ""));
  parts.push("");
  if (message.verbatimContent && message.verbatimContent !== message.content) {
    parts.push(`**${label}\u7684\u9010\u5B57\u539F\u6587**`);
    parts.push("");
    parts.push(String(message.verbatimContent));
    parts.push("");
  }
}
function appendThread(parts, conv, thread, ordinal) {
  var _a, _b;
  const depth = treeDepth(conv, thread);
  const title = thread.title || thread.rootQuestion || "\u672A\u547D\u540D\u601D\u7EF4\u8282\u70B9";
  parts.push(`${"#".repeat(Math.min(6, depth + 2))} ${ordinal}. ${title}`);
  parts.push("");
  parts.push(`- **\u8282\u70B9**\uFF1A${thread.id}`);
  if (thread.status) parts.push(`- **\u72B6\u6001**\uFF1A${thread.status}`);
  if ((_a = thread.anchor) == null ? void 0 : _a.sourcePath) parts.push(`- **\u6559\u6750**\uFF1A${thread.anchor.sourcePath}`);
  if ((_b = thread.anchor) == null ? void 0 : _b.quote) parts.push(`- **\u951A\u5B9A**\uFF1A${thread.anchor.quote.slice(0, 120)}`);
  parts.push("");
  if (thread.originExcerpt) {
    parts.push("**\u7531\u4E0A\u4E00\u6BB5\u6587\u5B57\u5F15\u51FA**");
    parts.push("");
    parts.push(markdownQuote(thread.originExcerpt));
    parts.push("");
  }
  const counters = { user: 0, assistant: 0, other: 0 };
  const messages = conv.messages.filter((m) => messageLineId(m) === thread.id);
  if (!messages.length && thread.rootQuestion) {
    parts.push("**\u8282\u70B9\u95EE\u9898**");
    parts.push("");
    parts.push(String(thread.rootQuestion));
    parts.push("");
  } else {
    messages.forEach((m) => appendMessage(parts, m, counters));
  }
}
function appendUnassignedMessages(parts, conv, assigned) {
  const unassigned = conv.messages.filter((_, index) => !assigned[index]);
  if (!unassigned.length) return;
  parts.push("## \u672A\u5F52\u5165\u601D\u7EF4\u8282\u70B9\u7684\u6D88\u606F");
  parts.push("");
  const counters = { user: 0, assistant: 0, other: 0 };
  unassigned.forEach((m) => appendMessage(parts, m, counters));
}
function appendParkingLot(parts, conv) {
  const parked = conv.reading.parkingLot || [];
  parts.push("## \u95EE\u9898\u505C\u8F66\u573A");
  parts.push("");
  if (!parked.length) {
    parts.push("\u6682\u65E0\u3002");
    parts.push("");
    return;
  }
  parked.forEach((item, index) => {
    const kind = item.category === "branch" ? "\u5206\u652F" : "\u7A0D\u540E";
    parts.push(`### ${index + 1}. ${kind}`);
    parts.push("");
    if (item.parentId) parts.push(`- **\u7236\u8282\u70B9**\uFF1A${item.parentId}`);
    if (item.anchor) parts.push(`- **\u951A\u70B9**\uFF1A${item.anchor}`);
    if (item.parentId || item.anchor) parts.push("");
    parts.push(String(item.question));
    parts.push("");
  });
}
function markdownQuote(value) {
  return String(value != null ? value : "").split(/\r?\n/).map((l) => "> " + l).join("\n");
}
function parseJSONBackup(text) {
  const empty = { nodes: [], meta: {}, ok: false };
  if (typeof text !== "string" || !text.trim()) {
    return { ...empty, error: "\u7A7A\u8F93\u5165" };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ...empty, error: "JSON \u89E3\u6790\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e)) };
  }
  if (!raw || typeof raw !== "object") {
    return { ...empty, error: "\u9876\u5C42\u4E0D\u662F\u5BF9\u8C61" };
  }
  const obj = raw;
  let rawNodes = [];
  if (Array.isArray(obj.nodes)) {
    rawNodes = obj.nodes;
  } else if (Array.isArray(raw)) {
    rawNodes = raw;
  }
  const nodes = [];
  for (const item of rawNodes) {
    if (!item || typeof item !== "object") continue;
    const it = item;
    const anchorSrc = it.anchor && typeof it.anchor === "object" ? it.anchor : {};
    const anchor = {
      sourcePath: typeof anchorSrc.sourcePath === "string" ? anchorSrc.sourcePath : "",
      quote: typeof anchorSrc.quote === "string" ? anchorSrc.quote : "",
      blockId: typeof anchorSrc.blockId === "string" ? anchorSrc.blockId : void 0
    };
    const status = it.status === "active" || it.status === "paused" ? it.status : "paused";
    nodes.push({
      title: typeof it.title === "string" ? it.title : "",
      content: typeof it.content === "string" ? it.content : "",
      parentTitle: typeof it.parentTitle === "string" ? it.parentTitle : void 0,
      anchor,
      status,
      rootQuestion: typeof it.rootQuestion === "string" ? it.rootQuestion : void 0,
      summary: typeof it.summary === "string" ? it.summary : void 0,
      question: typeof it.question === "string" ? it.question : void 0,
      mentorResponse: typeof it.mentorResponse === "string" ? it.mentorResponse : void 0
    });
  }
  const metaSrc = obj.meta && typeof obj.meta === "object" ? obj.meta : {};
  const meta = { ...metaSrc };
  return { nodes, meta, ok: true };
}

// src/data.ts
var import_obsidian2 = require("obsidian");
async function collectMdFiles(app, folder, acc) {
  for (const child of folder.children) {
    if (child instanceof import_obsidian2.TFile && child.name.endsWith(".md")) {
      acc.push(child);
    } else if (child instanceof import_obsidian2.TFolder) {
      await collectMdFiles(app, child, acc);
    }
  }
}
async function listNodes(app, workspacePath, excludeName) {
  const folder = app.vault.getAbstractFileByPath(workspacePath);
  const nodes = [];
  if (!(folder instanceof import_obsidian2.TFolder)) return nodes;
  const files = [];
  await collectMdFiles(app, folder, files);
  for (const f of files) {
    if (excludeName && f.name === excludeName) continue;
    if (f.name.startsWith(".")) continue;
    if (f.name === "\u8BA4\u77E5\u8FB9\u7F18\u5730\u56FE.md") continue;
    const content = await app.vault.cachedRead(f);
    nodes.push(parseNodeFromContent(f.basename, content, f.path));
  }
  return nodes;
}
async function buildMapSummary(app, workspacePath, nodes) {
  return {
    total: nodes.length,
    nodeTitles: nodes.map((n) => n.title),
    activeNodes: nodes.filter((n) => n.status === "active").map((n) => n.title)
  };
}
function workspaceFolderPath(nodeFolder, workspace) {
  return workspace && workspace !== "main" ? `${nodeFolder}/${workspace}` : nodeFolder;
}
function convPath(nodeFolder, workspace) {
  return `${workspaceFolderPath(nodeFolder, workspace)}/.conv.json`;
}
function uniqueNodePath(app, folder, title) {
  let path = `${folder}/${title}.md`;
  let i = 2;
  while (app.vault.getAbstractFileByPath(path) instanceof import_obsidian2.TFile) {
    path = `${folder}/${title}-${i}.md`;
    i++;
  }
  return path;
}

// src/view.ts
var import_obsidian4 = require("obsidian");

// src/guide.ts
function buildGuideSystemPrompt(scope = "whole", mode = "mixed") {
  const scopeRule = scope === "whole" ? "\u8303\u56F4\uFF1A\u5168\u4E66\u3002\u4ECE\u6574\u672C\u6559\u6750\u4E2D\u6311\u9009\u9AD8\u4EF7\u503C\u5165\u53E3\uFF0C\u4E0D\u88AB\u5B66\u751F\u5F53\u524D\u6240\u5728\u8BB2\u6B21\u56F0\u4F4F\u3002" : "\u8303\u56F4\uFF1A\u5F53\u524D\u6240\u5728\u4F4D\u7F6E\u9644\u8FD1\uFF08\u5F53\u524D\u6D3B\u8DC3\u7EBF\u7A0B\u951A\u5B9A\u7684\u6559\u6750\u7AE0\u8282\uFF0C\u4EE5\u53CA\u4E0E\u4E4B\u7D27\u5BC6\u76F8\u5173\u7684\u524D\u540E\u51E0\u8BB2/\u540C\u4E3B\u9898\u7AE0\u8282\uFF09\u3002\u5728\u5C40\u90E8\u8303\u56F4\u5185\u63A8\u8350\u6700\u503C\u5F97\u6DF1\u5165\u7684\u5165\u53E3\uFF0C\u4E0D\u8DF3\u5230\u5168\u4E66\u8FDC\u5904\u3002";
  const modeRule = mode === "deepen" ? "\u6A21\u5F0F\uFF1A\u6DF1\u5316\u5F53\u524D\u8BA4\u77E5\u94FE\u3002\u53EA\u63A8\u8350\u57FA\u4E8E\u5B66\u751F\u5DF2\u6709\u8282\u70B9\u7EE7\u7EED\u6DF1\u5165\u7684\u5165\u53E3\uFF08\u8FB9\u754C\u68C0\u9A8C\u3001\u53CD\u4F8B\u3001\u7EDF\u4E00\u62BD\u8C61\u3001\u8DE8\u94FE\u8FDE\u63A5\u3001\u66F4\u6DF1\u7684\u6570\u5B66\u7ED3\u6784\uFF09\u3002\u4E0D\u63A8\u8350\u5168\u65B0\u4E3B\u9898\u3002" : mode === "frontier" ? "\u6A21\u5F0F\uFF1A\u5168\u4E66\u65B0\u57DF\u3002\u53EA\u63A8\u8350\u5B66\u751F\u8BA4\u77E5\u5730\u56FE\u4E2D\u5C1A\u672A\u89E6\u53CA\u7684\u9AD8\u4EF7\u503C\u533A\u57DF\uFF0C\u4E0D\u63A8\u8350\u57FA\u4E8E\u5DF2\u6709\u8282\u70B9\u7684\u6DF1\u5316\u5165\u53E3\u3002" : "\u6A21\u5F0F\uFF1A\u6DF7\u5408\u3002\u5927\u7EA6\u4E00\u534A\u662F\u6DF1\u5316\u5DF2\u6709\u8BA4\u77E5\u94FE\u7684\u5165\u53E3\uFF08\u8FB9\u754C/\u53CD\u4F8B/\u7EDF\u4E00/\u8FDE\u63A5/\u66F4\u6DF1\u7684\u6570\u5B66\u7ED3\u6784\uFF09\uFF0C\u4E00\u534A\u662F\u5168\u4E66\u5C1A\u672A\u89E6\u53CA\u7684\u65B0\u57DF\u5165\u53E3\u3002";
  return [
    "\u4F60\u662F\u300C\u8BA4\u77E5\u8FB9\u7F18\u5BFC\u5E08\u300D\u7684\u65B9\u5411\u6307\u5F15\u6A21\u5757 \u2014\u2014 \u4E3A\u81EA\u7531\u63A2\u7D22\u53D1\u73B0\u4E0B\u4E00\u5835\u503C\u5F97\u649E\u7684\u5899\u3002",
    "",
    "\u6838\u5FC3\u539F\u5219\uFF1A",
    "1. " + scopeRule,
    "2. " + modeRule,
    "3. \u5165\u53E3\u5FC5\u987B\u53EF\u8DF3\u5165\uFF1A\u6BCF\u4E2A\u5165\u53E3\u72EC\u7ACB\u6210\u7ACB\uFF0C\u4E0D\u8981\u6C42\u5B66\u751F\u5148\u5B8C\u6210\u524D\u9762\u7684\u5185\u5BB9\u3002",
    "4. \u73CD\u8D35\u603B\u662F\u5C11\u6570\uFF1A\u53EA\u63A8\u8350\u771F\u6B63\u6709\u8BA4\u77E5\u5F20\u529B\u7684\u65B9\u5411\uFF08\u7ED3\u6784\u8FDE\u63A5/\u53CD\u5E38\u73B0\u8C61/\u7ED3\u8BBA\u8FB9\u754C/\u7EDF\u4E00\u89E3\u91CA/\u672A\u51B3\u95EE\u9898\uFF09\u3002",
    "5. \u7EDD\u4E0D\u62C9\u56DE\uFF1A\u4E0D\u56E0\u7AE0\u8282\u8FB9\u754C\u6216\u8D85\u7EB2\u963B\u6B62\u5B66\u751F\u6DF1\u5165\uFF0C\u53CD\u800C\u63A8\u8350\u90A3\u4E9B\u80FD\u8FFD\u6839\u5230\u66F4\u6DF1\u539F\u7406\u7684\u5165\u53E3\u3002",
    "6. \u8282\u70B9\u662F\u8DEF\u6807\u4E0D\u662F\u7EC8\u70B9\uFF1A\u5B66\u751F\u7684\u8BA4\u77E5\u8282\u70B9\u4E0D\u662F'\u5DF2\u638C\u63E1\u5E94\u56DE\u907F'\u7684\u533A\u57DF\uFF0C\u800C\u662F\u7EE7\u7EED\u6DF1\u5165\u7684\u6700\u4F73\u8D77\u70B9\u3002\u5DF2\u8D70\u8FC7\u7684\u94FE\u4F18\u5148\u627E\u4E0B\u4E00\u5C42\uFF1A",
    "   - \u8FB9\u754C\u68C0\u9A8C\uFF1A\u8282\u70B9\u7684\u7ED3\u8BBA\u5728\u4EC0\u4E48\u6761\u4EF6\u4E0B\u5931\u6548\uFF1F",
    "   - \u53CD\u4F8B\uFF1A\u6784\u9020\u4E00\u4E2A\u6253\u7834\u76F4\u89C9\u7684\u4F8B\u5B50\u3002",
    "   - \u7EDF\u4E00\u62BD\u8C61\uFF1A\u8282\u70B9\u4E0E\u5176\u5B83\u6982\u5FF5\u662F\u5426\u5171\u4EAB\u66F4\u6DF1\u7684\u6570\u5B66\u7ED3\u6784\uFF1F",
    "   - \u8DE8\u94FE\u8FDE\u63A5\uFF1A\u4E0D\u540C\u94FE\u4E4B\u95F4\u6709\u54EA\u4E9B\u7ED3\u6784\u76F8\u4F3C\u6027\uFF1F",
    "   - \u66F4\u6DF1\u5904\uFF1A\u8282\u70B9\u80CC\u540E\u8FD8\u6709\u54EA\u4E00\u5C42\u6570\u5B66\uFF1F",
    "7. \u5C01\u9876\u94FE\uFF08\u6807\u8BB0 \u{1F512}\uFF09\uFF1A\u5B66\u751F\u4E3B\u52A8\u6682\u505C\u8BE5\u94FE\uFF0C\u4E0D\u91CD\u590D\u5176\u5DF2\u8BB2\u5185\u5BB9\uFF0C\u53EA\u5141\u8BB8\u4ECE\u8FB9\u754C/\u53CD\u4F8B\u7684\u65B0\u89D2\u5EA6\u8F7B\u89E6\uFF0C\u63A8\u8350\u91CD\u70B9\u653E\u5728\u672A\u5C01\u9876\u94FE\u548C\u5176\u4ED6\u65B0\u57DF\u3002",
    "8. \u4F60\u4E0D\u662F\u8BFE\u7A0B\u89C4\u5212\u5668\u3001\u80FD\u529B\u8BC4\u4F30\u5668\u6216\u8BAD\u7EC3\u8BA1\u5212\u751F\u6210\u5668\uFF0C\u4E0D\u8981\u627F\u8BFA\u5B66\u5B8C\u8FBE\u5230\u4EC0\u4E48\u6C34\u5E73\uFF0C\u4E5F\u4E0D\u8981\u5B89\u6392\u590D\u6D4B\u6216\u5B66\u4E60\u6B65\u9AA4\u3002",
    "9. \u6BCF\u4E2A\u5165\u53E3\u5FC5\u987B\u6709\u660E\u786E\u7684\u6982\u5FF5\u6216\u6559\u6750\u951A\u70B9\uFF1B\u4E0D\u786E\u5B9A\u7684\u6559\u6750\u8BC1\u636E\u8981\u6807\u6CE8\u672A\u786E\u8BA4\u3002",
    "",
    "\u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C JSON\uFF09\uFF1A",
    '{ "entries": [',
    '  { "type": "deepen", "anchorNode": "\u951A\u5B9A\u8282\u70B9\u6807\u9898\uFF08\u987B\u6765\u81EA\u3010\u6211\u7684\u8BA4\u77E5\u5730\u56FE\u3011\uFF0C\u4E0D\u80FD\u81EA\u9020\uFF09",',
    '    "id": "A1", "jiang": "\u7B2C6\u8BB2", "title": "\u5165\u53E3\u6807\u9898",',
    '    "question": "\u5177\u4F53\u7684\u4E0B\u4E00\u5835\u5899\uFF08\u53EF\u76F4\u63A5\u5F00\u804A\u7684\u95EE\u9898\uFF09", "whyWorthExploring": "\u4E3A\u4EC0\u4E48\u73B0\u5728\u503C\u5F97\u6DF1\u5165",',
    '    "entryPoint": "\u6700\u81EA\u7136\u7684\u5207\u5165\u53E3", "tensions": ["\u5173\u952E\u5F20\u529B"],',
    '    "connections": ["\u53EF\u8FDE\u63A5\u7684\u6982\u5FF5"], "possibleTrails": ["\u53EF\u80FD\u7684\u540E\u7EED\u95EE\u9898"],',
    '    "direction": "\u5EF6\u4F38\u65B9\u5411\uFF08\u4E3B\u9898\u7EA7\uFF0C\u4E0E question \u4E92\u8865\uFF09", "anchor": "\u6559\u6750\u951A\u70B9" }',
    "]}",
    "",
    "type \u53EA\u5141\u8BB8 deepen\uFF08\u6DF1\u5316\u5DF2\u6709\u94FE\uFF0C\u5FC5\u987B\u5E26 anchorNode\uFF09\u6216 frontier\uFF08\u5168\u4E66\u65B0\u57DF\uFF0C\u4E0D\u5E26 anchorNode\uFF09\u3002",
    "\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u5176\u4ED6\u6587\u5B57\u30022-4 \u4E2A\u5165\u53E3\u3002\u6BCF\u4E2A\u5165\u53E3\u5FC5\u987B\u5F7C\u6B64\u660E\u663E\u4E0D\u540C\u3002"
  ].join("\n");
}
function parseGuideResponse(text) {
  const parseEntry = (e, i) => {
    const type = e.type === "deepen" || e.type === "frontier" ? e.type : "frontier";
    return {
      id: typeof e.id === "string" ? e.id : `E${i + 1}`,
      jiang: typeof e.jiang === "string" ? e.jiang : "",
      title: typeof e.title === "string" ? e.title : "\uFF08\u672A\u547D\u540D\u5165\u53E3\uFF09",
      question: typeof e.question === "string" ? e.question : typeof e.problem === "string" ? e.problem : typeof e.title === "string" ? e.title : "",
      whyWorthExploring: typeof e.whyWorthExploring === "string" ? e.whyWorthExploring : typeof e.valueType === "string" ? e.valueType : "",
      entryPoint: typeof e.entryPoint === "string" ? e.entryPoint : "",
      tensions: Array.isArray(e.tensions) ? e.tensions.filter((x) => typeof x === "string") : [],
      connections: Array.isArray(e.connections) ? e.connections.filter((x) => typeof x === "string") : [],
      possibleTrails: Array.isArray(e.possibleTrails) ? e.possibleTrails.filter((x) => typeof x === "string") : [],
      anchor: typeof e.anchor === "string" ? e.anchor : "",
      type,
      anchorNode: typeof e.anchorNode === "string" ? e.anchorNode : void 0,
      direction: typeof e.direction === "string" ? e.direction : void 0
    };
  };
  const textEntries = (lines, offset = 0) => lines.map((l, i) => ({
    id: `E${offset + i + 1}`,
    jiang: "",
    title: l.trim().slice(0, 50),
    question: l.trim().slice(0, 120),
    whyWorthExploring: "",
    entryPoint: "",
    tensions: [],
    connections: [],
    possibleTrails: [],
    anchor: "",
    type: "frontier"
  }));
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const lines = text.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("|"));
    if (lines.length === 0) return [];
    return textEntries(lines);
  }
  try {
    const data = JSON.parse(jsonMatch[0]);
    const entries = Array.isArray(data == null ? void 0 : data.entries) ? data.entries : [];
    return entries.map((e, i) => parseEntry(e, i));
  } catch (e) {
    const lines = text.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("|"));
    if (lines.length === 0) return [];
    return textEntries(lines);
  }
}

// src/canvas.ts
function mindMapLayout(threads) {
  var _a, _b;
  const byID = /* @__PURE__ */ new Map();
  for (const t of threads) byID.set(t.id, t);
  const children = /* @__PURE__ */ new Map();
  for (const t of threads) {
    const parent = t.parentId && byID.has(t.parentId) ? t.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(t);
  }
  const positions = /* @__PURE__ */ new Map();
  const edges = [];
  const visiting = /* @__PURE__ */ new Set();
  const finished = /* @__PURE__ */ new Set();
  let nextRow = 0;
  function place(thread, column) {
    var _a2;
    if (!thread || finished.has(thread.id)) return positions.get(thread.id);
    if (visiting.has(thread.id)) {
      const cyclePosition = { thread, column, row: nextRow++ };
      positions.set(thread.id, cyclePosition);
      finished.add(thread.id);
      return cyclePosition;
    }
    visiting.add(thread.id);
    const childPositions = [];
    for (const child of (_a2 = children.get(thread.id)) != null ? _a2 : []) {
      if (visiting.has(child.id)) continue;
      edges.push({ from: thread.id, to: child.id });
      const childPosition = place(child, column + 1);
      if (childPosition) childPositions.push(childPosition);
    }
    const row = childPositions.length ? childPositions.reduce((sum, p) => sum + p.row, 0) / childPositions.length : nextRow++;
    const position = { thread, column, row };
    positions.set(thread.id, position);
    visiting.delete(thread.id);
    finished.add(thread.id);
    return position;
  }
  for (const thread of (_a = children.get(null)) != null ? _a : []) {
    place(thread, 0);
  }
  for (const t of threads) {
    if (!finished.has(t.id)) place(t, 0);
  }
  const ordered = [];
  const seen = /* @__PURE__ */ new Set();
  const queue = [null];
  while (queue.length > 0) {
    const cur = queue.shift();
    const kids = (_b = children.get(cur ? cur.id : null)) != null ? _b : [];
    for (const k of kids) {
      if (!seen.has(k.id)) {
        seen.add(k.id);
        ordered.push(k);
        queue.push(k);
      }
    }
  }
  for (const t of threads) {
    if (!seen.has(t.id) && positions.has(t.id)) {
      seen.add(t.id);
      ordered.push(t);
    }
  }
  return {
    nodes: ordered.filter((t) => positions.has(t.id)).map((t) => positions.get(t.id)),
    edges,
    ordered
  };
}
function layoutToCoordinates(layout, opts = {}) {
  var _a, _b, _c, _d, _e;
  const NODE_W = (_a = opts.nodeW) != null ? _a : 150;
  const NODE_H = (_b = opts.nodeH) != null ? _b : 48;
  const X_STEP = (_c = opts.xStep) != null ? _c : 166;
  const Y_STEP = (_d = opts.yStep) != null ? _d : 76;
  const PAD = (_e = opts.pad) != null ? _e : 18;
  let maxColumn = 0;
  let maxRow = 0;
  const positions = /* @__PURE__ */ new Map();
  for (const p of layout.nodes) {
    maxColumn = Math.max(maxColumn, p.column);
    maxRow = Math.max(maxRow, p.row);
    positions.set(p.thread.id, {
      x: PAD + p.row * X_STEP,
      y: PAD + p.column * Y_STEP,
      column: p.column,
      row: p.row
    });
  }
  const canvasWidth = Math.max(300, PAD * 2 + maxRow * X_STEP + NODE_W);
  const canvasHeight = Math.max(150, PAD * 2 + maxColumn * Y_STEP + NODE_H);
  return { positions, canvasWidth, canvasHeight };
}
function buildEdgePath(fromX, fromY, toX, toY, nodeW, nodeH) {
  const x1 = fromX + nodeW / 2;
  const y1 = fromY + nodeH;
  const x2 = toX + nodeW / 2;
  const y2 = toY;
  const bend = Math.max(22, (y2 - y1) * 0.48);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

// src/suggest.ts
var import_obsidian3 = require("obsidian");
var NoteSuggest = class extends import_obsidian3.AbstractInputSuggest {
  constructor(app, textarea, onChoose) {
    super(app, textarea);
    this.textarea = textarea;
    this.onChoose = onChoose;
    this.limit = 20;
  }
  getValue() {
    return this.textarea.value;
  }
  setValue(value) {
    this.textarea.value = value;
  }
  /** @ 触发：光标前有 @token 且能匹配到笔记才弹列表，否则关闭 */
  onInputChange() {
    var _a;
    const hit = atToken(this.textarea.value, (_a = this.textarea.selectionStart) != null ? _a : this.textarea.value.length);
    if (!hit) {
      this.close();
      return;
    }
    const items = this.getSuggestions(hit.token);
    if (items.length > 0) {
      this.showSuggestions(items);
    } else {
      this.close();
    }
  }
  getSuggestions(query) {
    const q = query.toLowerCase();
    return this.app.vault.getMarkdownFiles().filter((f) => !q || f.basename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }
  renderSuggestion(file, el) {
    el.empty();
    el.createDiv({ cls: "suggestion-title", text: file.basename });
    const folder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
    if (folder) el.createDiv({ cls: "suggestion-note", text: folder });
  }
  selectSuggestion(file, evt) {
    var _a;
    const cursor = (_a = this.textarea.selectionStart) != null ? _a : this.textarea.value.length;
    const hit = atToken(this.textarea.value, cursor);
    if (hit) {
      this.textarea.setRangeText(`[[${file.basename}]]`, hit.start, cursor, "end");
      this.textarea.focus();
    }
    this.onChoose(file);
    this.close();
  }
  /** 建议框是否打开（keydown 守卫用；isOpen 未在类型中暴露） */
  isSuggestOpen() {
    return !!this.isOpen;
  }
};

// src/view.ts
var VIEW_TYPE_TUTOR = "edge-tutor-view";
var DRAFT_SAVE_DELAY_MS = 800;
var TutorView = class extends import_obsidian4.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.conv = freshConv("main");
    this.busy = false;
    this.currentWorkspace = "main";
    this.viewMode = "path";
    this.noteSuggest = null;
    this.draftTimer = null;
    this.branchNext = false;
    this.branchOrigin = "";
    /** 待发送的原文锚点（由此追问选中，发送时使用） */
    this.pendingAnchor = null;
    /** 已选中的方向导引入口，发送前允许用户改写 */
    this.pendingGuide = null;
    this.branchClipboard = [];
    /** 剪贴板分支的来源工作区（粘贴后「删除源」用） */
    this.branchClipboardWs = "";
    this.selBtn = null;
    this.searchQuery = "";
    this.searchHits = [];
    this.searchCursor = -1;
    /** 剪贴板是否包含消息 */
    this.branchClipboardMessages = [];
    /** 消息滚动位置（按视图模式记忆） */
    this.messageScroll = {};
    /** 懒渲染窗口起点（按视图模式记忆，P2-6）：只渲染 [loadedStart, total) */
    this.loadedStart = {};
    /** 上一帧活跃线程 id（用于导图自动定位） */
    this.lastRenderedMapId = null;
    /** vault 修改监听引用（agent 外部改 conv 时同步面板） */
    this.modifyRef = null;
    /** 等待回答结束后再重载（busy 时不打断） */
    this.pendingExternalReload = false;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_TUTOR;
  }
  getDisplayText() {
    return "\u8BA4\u77E5\u8FB9\u7F18\u5BFC\u5E08";
  }
  getIcon() {
    return "compass";
  }
  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("edge-tutor-panel");
    const header = container.createEl("div", { cls: "edge-tutor-header" });
    header.createEl("div", { text: "\u{1F9ED} \u8BA4\u77E5\u8FB9\u7F18\u5BFC\u5E08", cls: "edge-tutor-title" });
    header.createEl("div", {
      text: "\u9009\u4E2D\u6559\u6750\u6587\u672C \u2192 \u7531\u6B64\u8FFD\u95EE\u3002\u73CD\u8D35\u63A8\u6DF1\uFF0C\u7EC6\u8282\u6807\u8BB0\uFF0C\u7EDD\u4E0D\u62C9\u56DE\u3002\u505C\u6B62\u6743\u5728\u4F60\u3002",
      cls: "edge-tutor-subtitle"
    });
    const wsRow = header.createEl("div", { cls: "edge-tutor-ws-row" });
    this.wsSelect = wsRow.createEl("select", { cls: "edge-tutor-ws-select" });
    const wsNewBtn = wsRow.createEl("button", { text: "\uFF0B", cls: "edge-tutor-ws-btn", attr: { title: "\u65B0\u5EFA\u5DE5\u4F5C\u533A" } });
    const wsRenameBtn = wsRow.createEl("button", { text: "\u270E", cls: "edge-tutor-ws-btn", attr: { title: "\u91CD\u547D\u540D\u5F53\u524D\u5DE5\u4F5C\u533A" } });
    await this.refreshWorkspaceSelect();
    this.wsSelect.addEventListener("change", async () => {
      const target = this.wsSelect.value;
      if (target === this.currentWorkspace) return;
      if (this.busy) {
        new import_obsidian4.Notice("\u56DE\u7B54\u751F\u6210\u4E2D\uFF0C\u6682\u4E0D\u80FD\u5207\u6362\u5DE5\u4F5C\u533A");
        await this.refreshWorkspaceSelect();
        return;
      }
      try {
        await this.plugin.saveConv(this.conv);
        this.currentWorkspace = target;
        this.conv = await this.ensureWorkspaceLoaded(target);
        this.lastRenderedMapId = null;
        this.searchQuery = "";
        this.searchHits = [];
        this.searchCursor = -1;
        if (this.searchEl) this.searchEl.value = "";
        await this.renderAll();
        await this.restoreDraft();
        this.setStatus("\u5DF2\u5207\u6362\u5230\u5DE5\u4F5C\u533A\uFF1A" + (target === "main" ? "\u9ED8\u8BA4" : target));
      } catch (e) {
        new import_obsidian4.Notice("\u5207\u6362\u5DE5\u4F5C\u533A\u5931\u8D25\uFF1A" + e.message.slice(0, 80));
        await this.refreshWorkspaceSelect();
      }
    });
    wsNewBtn.addEventListener("click", async () => {
      const name = await new PromptModal(this.app, "\u65B0\u5EFA\u601D\u7EF4\u94FE\u5DE5\u4F5C\u533A", "\u4E3B\u9898\u540D\uFF0C\u5982\uFF1A\u4E2D\u503C\u5B9A\u7406").openPrompt();
      if (!name) return;
      const clean = name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
      if (!clean) {
        new import_obsidian4.Notice("\u5DE5\u4F5C\u533A\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
        return;
      }
      await this.plugin.createWorkspace(clean);
      await this.refreshWorkspaceSelect();
      new import_obsidian4.Notice("\u5DF2\u521B\u5EFA\u65B0\u5DE5\u4F5C\u533A\uFF1A" + clean);
    });
    wsRenameBtn.addEventListener("click", async () => {
      const cur = this.currentWorkspace;
      if (cur === "main") {
        new import_obsidian4.Notice("\u9ED8\u8BA4\u5DE5\u4F5C\u533A\u4E0D\u80FD\u6539\u540D\uFF1A\u8BF7\u5148\u65B0\u5EFA\u4E00\u4E2A\u5DE5\u4F5C\u533A");
        return;
      }
      const name = await new PromptModal(this.app, "\u91CD\u547D\u540D\u5DE5\u4F5C\u533A", "", cur).openPrompt();
      if (!name || name === cur) return;
      const clean = name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
      if (!clean) {
        new import_obsidian4.Notice("\u5DE5\u4F5C\u533A\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
        return;
      }
      await this.plugin.renameWorkspace(cur, clean);
      this.currentWorkspace = clean;
      this.conv.workspace = clean;
      await this.plugin.saveConv(this.conv);
      await this.refreshWorkspaceSelect();
      new import_obsidian4.Notice("\u5DF2\u91CD\u547D\u540D\u4E3A\uFF1A" + clean);
    });
    const viewRow = container.createEl("div", { cls: "edge-tutor-view-row" });
    viewRow.createEl("span", { text: "\u89C6\u56FE\uFF1A", cls: "edge-tutor-view-label" });
    this.viewSelect = viewRow.createEl("select", { cls: "edge-tutor-view-select" });
    this.viewSelect.createEl("option", { value: "path", text: "\u5F53\u524D\u8DEF\u5F84" });
    this.viewSelect.createEl("option", { value: "all", text: "\u5168\u90E8\u6D88\u606F" });
    this.viewSelect.createEl("option", { value: "node", text: "\u5355\u8282\u70B9" });
    this.viewSelect.value = this.viewMode;
    this.viewSelect.addEventListener("change", () => {
      this.viewMode = this.viewSelect.value;
      this.renderAll();
    });
    this.currentBox = container.createEl("div", { cls: "edge-tutor-current" });
    this.currentBox.style.display = "none";
    this.mapTitle = container.createEl("div", { cls: "edge-tutor-map-title" });
    this.mapTitle.style.display = "none";
    this.mapContainer = container.createEl("div", { cls: "edge-tutor-map" });
    this.mapContainer.style.display = "none";
    this.initMapPan();
    this.msgContainer = container.createEl("div", { cls: "edge-tutor-messages" });
    this.parkContainer = container.createEl("div", { cls: "edge-tutor-park" });
    this.parkContainer.style.display = "none";
    const tools = container.createEl("div", { cls: "edge-tutor-tools" });
    const agentBtn = tools.createEl("button", { text: "\u{1F916} \u6267\u884C\u9762\u677F", cls: "edge-tutor-btn edge-tutor-agent-open" });
    agentBtn.addEventListener("click", () => void this.plugin.activateAgentView());
    const ocBtn = tools.createEl("button", { text: "\u{1F50C} opencode", cls: "edge-tutor-btn edge-tutor-oc-btn", attr: { title: "\u68C0\u6D4B / \u542F\u52A8 opencode serve\uFF08\u6267\u884C\u9762\u677F\u540E\u7AEF\uFF09" } });
    ocBtn.addEventListener("click", async () => {
      if (this.busy) return;
      ocBtn.disabled = true;
      this.setStatus("\u68C0\u67E5 opencode serve\u2026");
      const r = await this.plugin.ensureOpenCodeServer();
      ocBtn.disabled = false;
      this.setStatus(r.message);
      if (r.ok) {
        new import_obsidian4.Notice(r.message);
      } else {
        new import_obsidian4.Notice("\u26A0\uFE0F " + r.message);
      }
    });
    const searchBtn = tools.createEl("button", {
      text: "\u{1F50D} \u6559\u6750\u68C0\u7D22",
      cls: "edge-tutor-btn edge-tutor-search-toggle" + (this.plugin.settings.textbookSearchEnabled ? " active" : ""),
      attr: { title: "\u5F00\u5173\uFF1A\u63D0\u95EE\u65F6\u81EA\u52A8\u68C0\u7D22\u6559\u6750\u539F\u6587\u6CE8\u5165\u95EE\u7B54\u6A21\u578B\uFF08\u7ED3\u679C\u4E0D\u8FDB\u5BF9\u8BDD\u6D41\uFF09" }
    });
    searchBtn.addEventListener("click", async () => {
      this.plugin.settings.textbookSearchEnabled = !this.plugin.settings.textbookSearchEnabled;
      await this.plugin.saveSettings();
      searchBtn.classList.toggle("active", this.plugin.settings.textbookSearchEnabled);
      this.setStatus(
        this.plugin.settings.textbookSearchEnabled ? "\u{1F50D} \u6559\u6750\u68C0\u7D22\u5DF2\u5F00\u542F\uFF1A\u63D0\u95EE\u65F6\u81EA\u52A8\u68C0\u7D22\u6559\u6750\u539F\u6587\uFF08\u7ED3\u679C\u4EC5\u63D0\u4F9B\u7ED9\u95EE\u7B54\u6A21\u578B\uFF09" : "\u6559\u6750\u68C0\u7D22\u5DF2\u5173\u95ED"
      );
    });
    const guideBtn = tools.createEl("button", { text: "\u{1F9ED} \u65B9\u5411\u6307\u5F15", cls: "edge-tutor-btn" });
    guideBtn.addEventListener("click", () => this.requestGuide());
    const mapBtn = tools.createEl("button", { text: "\u{1F5FA}\uFE0F \u5BFC\u56FE", cls: "edge-tutor-btn" });
    mapBtn.addEventListener("click", async () => {
      const show = this.mapContainer.style.display === "none";
      this.mapContainer.style.display = show ? "block" : "none";
      this.mapTitle.style.display = show ? "block" : "none";
      if (show) await this.renderWorkflow();
    });
    const parkBtn = tools.createEl("button", { text: "\u{1F4CC} \u505C\u8F66\u573A", cls: "edge-tutor-btn" });
    parkBtn.addEventListener("click", async () => {
      if (this.inputEl.value.trim()) {
        await this.parkInput();
        return;
      }
      const show = this.parkContainer.style.display === "none";
      this.parkContainer.style.display = show ? "block" : "none";
      if (show) await this.renderParkingLot();
    });
    const saveBtn = tools.createEl("button", { text: "\u{1F4BE} \u6C89\u6DC0", cls: "edge-tutor-btn" });
    saveBtn.addEventListener("click", () => this.saveConversation());
    const wideBtn = tools.createEl("button", { text: "\u26F6", cls: "edge-tutor-btn", attr: { title: "\u5BBD\u5C4F\u6A21\u5F0F\uFF08\u79FB\u52A8\u5230\u4E3B\u7F16\u8F91\u533A\uFF09" } });
    wideBtn.addEventListener("click", () => this.toggleWideMode());
    const clearBtn = tools.createEl("button", { text: "\u2716 \u6E05\u5C4F", cls: "edge-tutor-btn", attr: { title: "\u6E05\u7A7A\u5F53\u524D\u5BF9\u8BDD" } });
    clearBtn.addEventListener("click", () => {
      void this.confirmClear();
    });
    const tools2 = container.createEl("div", { cls: "edge-tutor-tools edge-tutor-tools2" });
    this.searchEl = tools2.createEl("input", {
      cls: "edge-tutor-search",
      attr: { placeholder: "\u641C\u7D22\u4F1A\u8BDD\u2026\uFF08Enter \u8DF3\u8F6C\uFF09", type: "text" }
    });
    this.searchCountEl = tools2.createEl("span", { cls: "edge-tutor-search-count" });
    const pasteRootBtn = tools2.createEl("button", { text: "\u{1F4CC}", cls: "edge-tutor-btn", attr: { title: "\u5C06\u526A\u8D34\u677F\u8282\u70B9\u7C98\u8D34\u4E3A\u6839\u8282\u70B9" } });
    pasteRootBtn.addEventListener("click", () => this.pasteAsRoot());
    const exportMdBt = tools2.createEl("button", { text: "MD", cls: "edge-tutor-btn", attr: { title: "\u5BFC\u51FA\u5F53\u524D\u5DE5\u4F5C\u533A\u4E3A Markdown \u7B14\u8BB0" } });
    exportMdBt.addEventListener("click", () => void this.plugin.exportWorkspace("markdown"));
    const exportJsonBt = tools2.createEl("button", { text: "JSON", cls: "edge-tutor-btn", attr: { title: "\u5BFC\u51FA\u5F53\u524D\u5DE5\u4F5C\u533A\u4E3A JSON \u5907\u4EFD" } });
    exportJsonBt.addEventListener("click", () => void this.plugin.exportWorkspace("json"));
    this.searchEl.addEventListener("input", () => {
      this.searchQuery = this.searchEl.value;
      this.searchHits = [];
      this.searchCursor = -1;
      this.renderSearchResults();
    });
    this.searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.updateSearch(this.searchEl.value);
        this.navigateSearchHit(this.searchCursor + (e.shiftKey ? -1 : 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.searchEl.value = "";
        this.updateSearch("");
      }
    });
    this.searchResultsEl = container.createEl("div", { cls: "edge-tutor-search-results" });
    this.chipsEl = container.createEl("div", { cls: "edge-tutor-context-chips" });
    this.chipsEl.style.display = "none";
    const inputRow = container.createEl("div", { cls: "edge-tutor-input-row" });
    this.inputRowEl = inputRow;
    this.inputEl = inputRow.createEl("textarea", {
      cls: "edge-tutor-input",
      attr: { placeholder: "\u8FFD\u95EE\u6216\u63D0\u95EE\u2026\uFF08Enter \u53D1\u9001\uFF0CShift+Enter \u6362\u884C\uFF09", rows: "3" }
    });
    this.sendBtn = inputRow.createEl("button", { text: "\u53D1\u9001", cls: "edge-tutor-send" });
    this.sendBtn.addEventListener("click", () => this.sendFromInput());
    this.inputEl.addEventListener("input", () => this.scheduleDraftSave());
    this.inputEl.addEventListener("keydown", (e) => {
      if (this.noteSuggest && this.noteSuggest.isSuggestOpen()) {
        if (e.key === "Enter" || e.key === "Escape" || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab") {
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendFromInput();
      }
    });
    this.noteSuggest = new NoteSuggest(this.app, this.inputEl, (file) => {
      new import_obsidian4.Notice(`\u5DF2\u5F15\u7528\u7B14\u8BB0\uFF1A${file.basename}\uFF08\u968F\u6D88\u606F\u53D1\u9001\u7ED9 AI\uFF09`);
    });
    this.statusBar = container.createEl("div", { cls: "edge-tutor-status" });
    this.initSelFloat();
    this.registerConvWatcher();
    try {
      this.conv = await this.ensureWorkspaceLoaded(this.currentWorkspace);
    } catch (e) {
      this.conv = freshConv(this.currentWorkspace);
    }
    await this.restoreDraft();
    await this.renderAll();
    this.scrollToBottom();
  }
  /**
   * 统一加载逻辑（onOpen + 工作区切换共用）：
   * - conv 全空（0 消息 0 线程）且节点文件存在 → 从节点重建（清屏/新建/迁移语义，节点永存）
   * - threads=0 但 messages>0 → 用户主动删除/移动的结果，不重建，原样返回
   */
  async ensureWorkspaceLoaded(ws) {
    const conv = await this.plugin.loadConv(ws);
    if (conv.messages.length === 0 && conv.reading.threads.length === 0) {
      const rebuilt = await this.plugin.rebuildConvFromNodes(ws);
      if (rebuilt) {
        await this.plugin.saveConv(rebuilt);
        this.setStatus(`\u5DF2\u4ECE ${rebuilt.reading.threads.length} \u4E2A\u8282\u70B9\u6587\u4EF6\u6062\u590D\u8BA4\u77E5\u5730\u56FE`);
        return rebuilt;
      }
    }
    return conv;
  }
  /** 供命令调用：用外部重建的 conv 替换当前会话并刷新 */
  async reloadFromConv(conv) {
    this.conv = conv;
    this.currentWorkspace = conv.workspace || this.currentWorkspace;
    await this.plugin.saveConv(this.conv);
    this.lastRenderedMapId = null;
    await this.renderAll();
  }
  async onClose() {
    await this.flushDraft();
    await this.plugin.saveConv(this.conv);
    if (this.selBtn) this.selBtn.remove();
    if (this.modifyRef) {
      this.app.vault.offref(this.modifyRef);
      this.modifyRef = null;
    }
    this.contentEl.empty();
  }
  /** 注册 conv 外部修改监听：agent 等外部进程改 .conv.json 时面板自动同步。
   * 内容与内存一致 = 自身保存（跳过）；不一致 = 外部修改（重载）。 */
  registerConvWatcher() {
    if (this.modifyRef) return;
    const ref = this.app.vault.on("modify", async (file) => {
      const folder = this.plugin.workspaceFolder(this.currentWorkspace).replace(/\/+$/, "");
      if (file.path !== `${folder}/.conv.json`) return;
      try {
        const disk = await this.app.vault.adapter.read(file.path);
        if (disk === serializeConv(this.conv)) return;
        if (this.busy) {
          this.pendingExternalReload = true;
          return;
        }
        const next = await this.plugin.loadConv(this.currentWorkspace);
        this.conv = next;
        this.lastRenderedMapId = null;
        await this.renderAll();
        this.setStatus("\u68C0\u6D4B\u5230\u4F1A\u8BDD\u6587\u4EF6\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u5DF2\u540C\u6B65");
      } catch (e) {
      }
    });
    this.modifyRef = ref;
  }
  /**
   * 供 main.ts / 浮动按钮调用：选中文本 → 设为追问来源（branchOrigin）
   * 对齐 Zotero：选中后只聚焦输入框等用户提问，不立即发送。
   */
  receiveSelection(selection, sourcePath) {
    this.branchOrigin = selection;
    this.branchNext = false;
    this.inputEl.value = "";
    this.inputEl.placeholder = "\u57FA\u4E8E\u9009\u4E2D\u6587\u5B57\u7EE7\u7EED\u8FFD\u95EE\u2026";
    this.inputEl.focus();
    this.pendingAnchor = sourcePath != null ? sourcePath : null;
    const active = activeThread(this.conv);
    if (active) {
      switchThread(this.conv, active.id);
    }
    this.setStatus("\u5DF2\u9009\u4E2D\u539F\u6587\uFF0C\u8BF7\u8F93\u5165\u4F60\u7684\u95EE\u9898");
    this.updateChips();
  }
  /**
   * 上下文 chips 渲染（P0-1A）：pendingAnchor 存在时在输入区上方显示
   * 「📖 文件名 + 引用前 30 字」chip，可点击跳转、× 移除（移除后该消息不带锚点发送）。
   */
  updateChips() {
    var _a;
    if (!this.chipsEl) return;
    this.chipsEl.empty();
    if (!this.pendingAnchor) {
      this.chipsEl.style.display = "none";
      return;
    }
    const src = this.pendingAnchor;
    const file = (_a = src.split("/").pop()) != null ? _a : src;
    const quote = (this.branchOrigin || "").replace(/\s+/g, " ").trim().slice(0, 30);
    const chip = this.chipsEl.createEl("button", { cls: "edge-tutor-context-chip", attr: { title: "\u70B9\u51FB\u8DF3\u8F6C\u5230\u539F\u6587\u4F4D\u7F6E" } });
    const label = chip.createSpan({ text: `\u{1F4D6} ${file}${quote ? `\uFF1A${quote}` : ""}` });
    label.addClass("edge-tutor-chip-text");
    const x = chip.createEl("span", { text: "\xD7", cls: "edge-tutor-chip-x", attr: { title: "\u79FB\u9664\u5F15\u7528\uFF08\u8BE5\u6D88\u606F\u5C06\u4E0D\u5E26\u951A\u70B9\u53D1\u9001\uFF09" } });
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      this.pendingAnchor = null;
      this.branchOrigin = "";
      this.inputEl.placeholder = "\u8FFD\u95EE\u6216\u63D0\u95EE\u2026\uFF08Enter \u53D1\u9001\uFF0CShift+Enter \u6362\u884C\uFF09";
      this.updateChips();
      this.setStatus("\u5DF2\u79FB\u9664\u5F15\u7528\u6765\u6E90");
    });
    chip.addEventListener("click", () => {
      if (this.pendingAnchor) void this.navigateToTextAnchor(this.pendingAnchor, this.branchOrigin || void 0);
    });
    this.chipsEl.style.display = "flex";
  }
  /**
   * 宽屏模式：把面板从右侧边栏移到主编辑区作为独立标签页（Obsidian 原生全宽）。
   * 再次点击返回右侧边栏。
   */
  async toggleWideMode() {
    const leaf = this.leaf;
    const state = leaf.getViewState();
    await this.plugin.saveConv(this.conv);
    const root = leaf.getRoot();
    const inSidebar = root === this.app.workspace.leftSplit || root === this.app.workspace.rightSplit;
    if (inSidebar) {
      const newLeaf = this.app.workspace.getLeaf("tab");
      await newLeaf.setViewState({ ...state, type: VIEW_TYPE_TUTOR, active: true });
      this.app.workspace.revealLeaf(newLeaf);
      this.setStatus("\u5BBD\u5C4F\u6A21\u5F0F\uFF1A\u9762\u677F\u5DF2\u79FB\u5230\u4E3B\u7F16\u8F91\u533A\u3002\u518D\u6B21\u70B9 \u26F6 \u53EF\u56DE\u5230\u4FA7\u680F\u3002");
    } else {
      const newLeaf = this.app.workspace.getRightLeaf(false);
      if (!newLeaf) return;
      await newLeaf.setViewState({ ...state, type: VIEW_TYPE_TUTOR, active: true });
      this.app.workspace.revealLeaf(newLeaf);
    }
  }
  /** ===== 渲染 ===== */
  async renderAll() {
    var _a;
    const prevScroll = this.messageScroll[this.viewMode];
    this.msgContainer.empty();
    const mode = this.viewMode;
    const msgs = messagesForView(this.conv, mode);
    if (msgs.length === 0) {
      this.appendWelcome();
    } else {
      const total = msgs.length;
      let start = 0;
      if (total > 100) {
        const saved = (_a = this.loadedStart[mode]) != null ? _a : Math.max(0, total - 50);
        this.loadedStart[mode] = Math.min(saved, total - 50);
        start = this.loadedStart[mode];
      }
      if (start > 0) {
        const loadBtn = this.msgContainer.createEl("button", {
          text: `\u2B06 \u52A0\u8F7D\u66F4\u65E9\u6D88\u606F\uFF08\u8FD8\u6709 ${start} \u6761\uFF09`,
          cls: "edge-tutor-load-more",
          attr: { title: "\u5411\u524D\u52A0\u8F7D 50 \u6761\u66F4\u65E9\u6D88\u606F" }
        });
        loadBtn.addEventListener("click", () => {
          this.loadedStart[mode] = Math.max(0, start - 50);
          const anchorMsg = msgs[start];
          void this.renderAll().then(() => {
            if (anchorMsg) this.scrollToMessageIndex(this.conv.messages.indexOf(anchorMsg));
          });
        });
      }
      let lastLineId = null;
      for (let i = start; i < total; i++) {
        const m = msgs[i];
        const lineId = messageLineId(m);
        const showContext = mode !== "node" && lineId !== lastLineId;
        if (showContext) lastLineId = lineId;
        const thread = lineId ? this.conv.reading.threads.find((t) => t.id === lineId) : void 0;
        const globalIndex = this.conv.messages.indexOf(m);
        this.appendMessage(m, { showContext, thread, messageIndex: globalIndex });
      }
    }
    if (prevScroll !== void 0) {
      this.msgContainer.scrollTop = prevScroll;
    }
    this.renderCurrent();
    if (this.mapContainer.style.display !== "none") {
      if (this.conv.reading.threads.length > 0) {
        await this.renderWorkflow();
      } else {
        this.mapContainer.style.display = "none";
        this.mapTitle.style.display = "none";
      }
    }
    if (this.conv.reading.parkingLot.length > 0) {
      this.parkContainer.style.display = "block";
      await this.renderParkingLot();
    } else {
      this.parkContainer.style.display = "none";
    }
  }
  appendWelcome() {
    this.appendMessageRaw({
      role: "assistant",
      content: "\u6211\u662F\u4F60\u7684\u8BA4\u77E5\u8FB9\u7F18\u5BFC\u5E08\u3002\n\n**\u600E\u4E48\u7528\uFF1A**\n1. \u5728\u6559\u6750\u91CC\u9009\u4E2D\u4E00\u6BB5\u6587\u5B57 \u2192 \u84DD\u8272\u300C\u7531\u6B64\u8FFD\u95EE\u300D\u6309\u94AE\n2. \u6216\u76F4\u63A5\u5728\u4E0B\u9762\u5BF9\u8BDD\u6846\u63D0\u95EE\n\n**\u53EF\u4EE5\u95EE\u6211\uFF1A**\n- \u300C\u4E3A\u4EC0\u4E48\u8FD9\u91CC\u8981\u6784\u9020\u8F85\u52A9\u51FD\u6570\uFF1F\u300D\uFF08\u8FFD\u6839\uFF09\n- \u300C\u8FD9\u4E2A\u5B9A\u7406\u7684\u8FB9\u754C\u6761\u4EF6\u53BB\u6389\u4F1A\u600E\u6837\uFF1F\u300D\uFF08\u53CD\u4F8B\uFF09\n- \u70B9\u300C\u{1F9ED} \u65B9\u5411\u6307\u5F15\u300D\u8BA9 AI \u57FA\u4E8E\u5168\u4E66\u63A8\u8350\u4E0B\u4E00\u5835\u503C\u5F97\u649E\u7684\u5899\n- \u6709\u6682\u65F6\u4E0D\u60F3\u5904\u7406\u7684\u7591\u95EE\uFF1F\u70B9\u300C\u{1F4CC} \u505C\u8F66\u573A\u300D\n\n\u8BB0\u4F4F\uFF1A\u4F60\u968F\u65F6\u53EF\u4EE5\u505C\uFF0C\u6211\u4E0D\u4F1A\u62C9\u4F60\u56DE\u6765\u3002"
    });
  }
  /** ===== 锚点定位（Obsidian markdown 文本锚点，替代 Zotero PDF 框选） ===== */
  /**
   * 打开 markdown 文件并定位到引用文本。
   * Obsidian 适配：Zotero 是 PDF 页内框选定位，Obsidian 无此能力 →
   * 改为打开文件后搜索引用文本，滚动定位 + 临时高亮。
   * 支持行号优先定位（教材检索引用【📖 文件:行】）。
   */
  async navigateToTextAnchor(sourcePath, quote, line) {
    var _a;
    const f = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(f instanceof import_obsidian4.TFile)) {
      new import_obsidian4.Notice("\u951A\u70B9\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A" + sourcePath);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(f);
    await new Promise((r) => setTimeout(r, 120));
    const editor = (_a = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView)) == null ? void 0 : _a.editor;
    if (!editor) return;
    if (line && line > 0) {
      const target = Math.min(Math.max(0, line - 1), editor.lineCount() - 1);
      const from2 = { line: target, ch: 0 };
      const to2 = { line: target, ch: editor.getLine(target).length };
      editor.setSelection(from2, to2);
      editor.scrollIntoView({ from: from2, to: to2 }, true);
      editor.focus();
      window.setTimeout(() => {
        try {
          const cur = editor.getCursor();
          editor.setSelection(cur, cur);
        } catch (e) {
        }
      }, 2500);
      return;
    }
    if (!quote) return;
    const norm = (s) => String(s).replace(/\s+/g, " ").trim();
    const needle = norm(quote).slice(0, 80);
    if (!needle) return;
    const doc = editor.getValue();
    const docNorm = norm(doc);
    const idx = docNorm.indexOf(needle);
    if (idx < 0) {
      new import_obsidian4.Notice("\u672A\u80FD\u5728\u6587\u4EF6\u4E2D\u627E\u5230\u951A\u70B9\u6587\u672C");
      return;
    }
    let rawPos = 0;
    let normPos = 0;
    let found = -1;
    const chars = doc;
    while (normPos <= idx && rawPos < chars.length) {
      if (chars[rawPos] === "\n" || chars[rawPos] === " " || chars[rawPos] === "	" || chars[rawPos] === "\r") {
        rawPos++;
        continue;
      }
      if (normPos === idx) {
        found = rawPos;
        break;
      }
      normPos++;
      rawPos++;
    }
    if (found < 0) {
      found = doc.indexOf(quote.slice(0, 60));
      if (found < 0) found = doc.search(needle.slice(0, 30));
    }
    if (found < 0) {
      new import_obsidian4.Notice("\u672A\u80FD\u5728\u6587\u4EF6\u4E2D\u627E\u5230\u951A\u70B9\u6587\u672C");
      return;
    }
    const lineNo = editor.offsetToPos(found).line;
    const from = { line: lineNo, ch: 0 };
    const to = { line: lineNo, ch: editor.getLine(lineNo).length };
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    editor.focus();
    window.setTimeout(() => {
      try {
        const cur = editor.getCursor();
        editor.setSelection(cur, cur);
      } catch (e) {
      }
    }, 2500);
  }
  /** 当前思维链区（Zotero: ui.current） */
  renderCurrent() {
    var _a;
    const cur = activeThread(this.conv);
    this.currentBox.empty();
    if (!cur) {
      this.currentBox.style.display = "none";
      return;
    }
    this.currentBox.style.display = "block";
    const path = ancestry(this.conv, cur.id);
    const crumb = this.currentBox.createEl("div", { cls: "edge-tutor-breadcrumb" });
    crumb.createSpan({ text: path.map((t) => t.title).join(" \u203A ") });
    const title = this.currentBox.createEl("div", { cls: "edge-tutor-current-title" });
    title.createSpan({ text: "\u5F53\u524D\u601D\u7EF4\u94FE" });
    const q = this.currentBox.createEl("div", { cls: "edge-tutor-current-q" });
    q.createSpan({ text: cur.lastQuestion || cur.rootQuestion || cur.title });
    if (cur.originExcerpt) {
      const origin = this.currentBox.createEl("div", { cls: "edge-tutor-origin" });
      origin.createEl("div", { text: "\u7531\u4E0A\u4E00\u6BB5\u6587\u5B57\u5F15\u51FA", cls: "edge-tutor-origin-label" });
      origin.createEl("div", { text: cur.originExcerpt, cls: "edge-tutor-origin-text" });
    }
    if ((_a = cur.anchor) == null ? void 0 : _a.sourcePath) {
      const anchorBtn = this.currentBox.createEl("button", { text: "\u{1F4CD} \u6559\u6750\u951A\u70B9", cls: "edge-tutor-anchor" });
      anchorBtn.setAttribute("title", "\u6253\u5F00\u6559\u6750\u6587\u4EF6\u5E76\u5B9A\u4F4D\u5230\u5F15\u7528\u6587\u672C");
      anchorBtn.addEventListener("click", () => {
        var _a2;
        void this.navigateToTextAnchor(cur.anchor.sourcePath, (_a2 = cur.anchor) == null ? void 0 : _a2.quote);
      });
    }
    if (cur.summary) {
      const a = this.currentBox.createEl("div", { cls: "edge-tutor-current-a" });
      a.createSpan({ text: "\u4E0A\u6B21\u505C\u5728\uFF1A" + cur.summary.slice(0, 120) });
    }
    const actions = this.currentBox.createEl("div", { cls: "edge-tutor-current-actions" });
    const branch = actions.createEl("button", {
      text: "\u4ECE\u8FD9\u91CC\u5206\u53C9",
      cls: "edge-tutor-mini",
      attr: { title: "\u4E0B\u4E00\u6761\u6D88\u606F\u5C06\u5EFA\u7ACB\u72EC\u7ACB\u5206\u652F\uFF0C\u5E76\u7EE7\u627F\u5F53\u524D\u601D\u8DEF\u7684\u65AD\u70B9" }
    });
    branch.addEventListener("click", () => {
      if (this.busy) return;
      this.branchNext = true;
      this.branchOrigin = cur.summary || cur.rootQuestion || "";
      this.inputEl.value = "";
      this.inputEl.placeholder = "\u8F93\u5165\u65B0\u5206\u652F\u7684\u8D77\u70B9\u2026";
      this.inputEl.focus();
    });
    const pause = actions.createEl("button", { text: "\u6682\u65F6\u6401\u7F6E", cls: "edge-tutor-mini" });
    pause.addEventListener("click", () => {
      if (this.busy) return;
      pauseActive(this.conv);
      this.branchNext = false;
      this.inputEl.value = "";
      this.inputEl.placeholder = "\u8F93\u5165\u4E00\u4E2A\u65B0\u95EE\u9898\uFF0C\u6216\u4ECE\u601D\u7EF4\u5730\u56FE\u6062\u590D\u65E7\u5206\u652F\u2026";
      void this.plugin.saveConv(this.conv);
      this.renderAll();
      this.inputEl.focus();
    });
  }
  /** 发送输入框内容（对齐 Zotero：branchNext / branchOrigin 决定行为） */
  async sendFromInput() {
    var _a;
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    this.inputEl.value = "";
    await this.clearDraft();
    const active = activeThread(this.conv);
    let lineId;
    const isFromSelection = this.pendingAnchor !== null;
    const origin = this.branchOrigin || "";
    const originAnchor = isFromSelection ? this.pendingAnchor : void 0;
    const guide = this.pendingGuide;
    this.pendingAnchor = null;
    this.pendingGuide = null;
    this.updateChips();
    if (guide) {
      const t = addThread(this.conv, {
        question: text.slice(0, 60),
        parentId: null,
        // 导引的教材锚点是说明文本，只有当前编辑器锚点才是可导航的 vault 路径。
        anchor: this.plugin.getAnchor(),
        originExcerpt: guide.whyWorthExploring.slice(0, 200)
      });
      lineId = t.id;
    } else if (this.branchNext) {
      const t = addThread(this.conv, {
        question: text.slice(0, 60),
        parentId: (_a = active == null ? void 0 : active.id) != null ? _a : null,
        anchor: this.plugin.getAnchor(),
        originExcerpt: isFromSelection ? origin.slice(0, 200) : void 0
      });
      lineId = t.id;
      this.branchNext = false;
      this.branchOrigin = "";
    } else if (isFromSelection && origin) {
      const t = addThread(this.conv, {
        question: text.slice(0, 60),
        parentId: null,
        anchor: { sourcePath: originAnchor != null ? originAnchor : "", quote: origin.slice(0, 80) },
        originExcerpt: origin.slice(0, 200)
      });
      lineId = t.id;
      this.branchOrigin = "";
    } else if (active) {
      lineId = active.id;
    }
    const content = isFromSelection && origin ? `\u3010\u7531\u8FD9\u6BB5\u539F\u6587\u5F15\u51FA\u3011
> ${origin}

\u95EE\u9898\uFF1A${text}` : text;
    pushMessage(this.conv, "user", content, { anchor: originAnchor != null ? originAnchor : void 0, lineId });
    this.inputEl.placeholder = "\u8FFD\u95EE\u2026";
    await this.plugin.saveConv(this.conv);
    this.renderAll();
    await this.respond();
  }
  /** AI 回答（流式，对齐 Zotero streaming） */
  async respond() {
    if (this.busy) return;
    this.busy = true;
    this.sendBtn.setText("\u601D\u8003\u4E2D\u2026");
    this.sendBtn.disabled = true;
    const sysPrompt = buildSystemPrompt();
    const history = [{ role: "system", content: sysPrompt }];
    const lastUser = [...this.conv.messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      const links = extractNoteLinks(lastUser.content);
      if (links.length > 0) {
        const files = this.app.vault.getMarkdownFiles();
        const notes = [];
        for (const name of links) {
          const hit = files.find((f) => f.path === name || f.path === `${name}.md` || f.basename === name);
          if (!hit || notes.some((n) => n.path === hit.path)) continue;
          try {
            notes.push({ path: hit.path, content: await this.app.vault.cachedRead(hit) });
          } catch (e) {
            console.error("\u8BFB\u53D6 @ \u5F15\u7528\u7B14\u8BB0\u5931\u8D25", hit.path, e);
          }
        }
        if (notes.length > 0) {
          history.unshift({ role: "system", content: buildNoteContextBlocks(notes) });
        }
      }
    }
    let searchNote = "";
    if (lastUser && this.plugin.settings.textbookSearchEnabled) {
      this.setStatus("\u{1F50D} \u6B63\u5728\u6559\u6750\u68C0\u7D22\uFF08\u8BED\u4E49\u5B9A\u4F4D\u6559\u6750\u539F\u6587\uFF0C\u7EA6 15-45 \u79D2\uFF09\u2026");
      const hit = await this.plugin.semanticTextbookSearch(lastUser.content);
      if (hit.found) {
        history.unshift({
          role: "system",
          content: [
            "\u3010\u6559\u6750\u68C0\u7D22\u7ED3\u679C\u3011\uFF08\u7531\u68C0\u7D22\u4EE3\u7406\u4ECE\u6559\u6750\u539F\u6587\u5B9A\u4F4D\uFF0C\u884C\u53F7\u53EF\u8DF3\u8F6C\u6838\u5BF9\uFF09",
            hit.text,
            "",
            "\u56DE\u7B54\u89C4\u5219\uFF1A",
            "1. \u57FA\u4E8E\u5F15\u7528\u7684\u6559\u6750\u539F\u6587\u56DE\u7B54\uFF0C\u5F15\u7528\u5904\u6807\u6CE8\u3010\u{1F4D6} \u6587\u4EF6:\u884C\u3011\uFF08\u5982\u3010\u{1F4D6} \u7B2C6\u8BB2.md:364\u3011\uFF09\u3002",
            "2. \u5F15\u7528\u8986\u76D6\u4E0D\u5230\u7684\u90E8\u5206\uFF0C\u660E\u786E\u8BF4\u300C\u6559\u6750\u4E2D\u672A\u76F4\u63A5\u5BF9\u5E94\uFF0C\u4EE5\u4E0B\u662F\u57FA\u4E8E\u5DF2\u6709\u77E5\u8BC6\u7684\u63A8\u65AD\u300D\u3002",
            "3. \u4E0D\u7F16\u9020\u539F\u6587\u2014\u2014\u5F15\u7528\u7684\u6587\u5B57\u5FC5\u987B\u6765\u81EA\u4E0A\u9762\u7684\u6559\u6750\u5F15\u7528\u3002"
          ].join("\n")
        });
        searchNote = `\uFF08\u5DF2\u68C0\u7D22 ${hit.count} \u5904\u6559\u6750\u539F\u6587\uFF09`;
      } else {
        history.unshift({
          role: "system",
          content: "\u3010\u6559\u6750\u68C0\u7D22\u3011\u672C\u6B21\u672A\u5728\u6559\u6750\u4E2D\u5B9A\u4F4D\u5230\u4E0E\u95EE\u9898\u76F4\u63A5\u76F8\u5173\u7684\u539F\u6587\uFF08\u53EF\u80FD\u6559\u6750\u672A\u8986\u76D6\u8BE5\u5185\u5BB9\u6216\u8868\u8FF0\u5DEE\u5F02\uFF09\u3002\u8BF7\u76F4\u63A5\u57FA\u4E8E\u5DF2\u6709\u77E5\u8BC6\u6B63\u5E38\u56DE\u7B54\uFF0C\u4E0D\u8981\u58F0\u660E\u300C\u770B\u4E0D\u5230\u6559\u6750/\u6CA1\u6709\u6559\u6750\u76EE\u5F55/\u53EA\u80FD\u57FA\u4E8E\u622A\u56FE\u5206\u6790\u300D\u4E4B\u7C7B\u7684\u8BDD\u3002"
        });
      }
    }
    const isFollowup = !!lastUser && !!lastUser.lineId && lastUser.lineId === this.conv.reading.activeId;
    const branchInstr = branchInstruction(this.conv, isFollowup);
    for (let i = 0; i < this.conv.messages.length; i++) {
      const m = this.conv.messages[i];
      if (m.role === "user") {
        const anchorPrefix = m.anchor ? `\u3010\u6559\u6750\u951A\u70B9\uFF1A${m.anchor}\u3011
` : "";
        const isCurrent = m === lastUser;
        const instr = isCurrent && branchInstr ? `

${branchInstr}` : "";
        history.push({ role: "user", content: anchorPrefix + m.content + instr });
      } else {
        history.push({ role: "assistant", content: m.content });
      }
    }
    const streamingEl = this.appendMessageRaw({ role: "assistant", content: "" });
    const streamContentEl = streamingEl.querySelector(".edge-tutor-msg-content");
    const commitContainer = document.createElement("div");
    commitContainer.className = "edge-tutor-stream-committed";
    streamContentEl.appendChild(commitContainer);
    const streamTextEl = document.createElement("div");
    streamTextEl.className = "edge-tutor-stream-text";
    streamContentEl.appendChild(streamTextEl);
    let streamed = "";
    let pending = "";
    let lastRenderAt = 0;
    const followScroll = () => {
      const maxScroll = Math.max(0, this.msgContainer.scrollHeight - this.msgContainer.clientHeight);
      if (maxScroll - this.msgContainer.scrollTop <= 60) {
        this.msgContainer.scrollTop = this.msgContainer.scrollHeight;
      }
    };
    const paragraphReady = (t) => {
      let fences = 0;
      for (const line of t.split("\n")) if (line.trimStart().startsWith("```")) fences++;
      if (fences % 2 !== 0) return false;
      return t.split("\\(").length - 1 === t.split("\\)").length - 1 && t.split("\\[").length - 1 === t.split("\\]").length - 1;
    };
    const flushStreamRender = () => {
      lastRenderAt = Date.now();
      if (!pending) return;
      const parts = pending.split("\n\n");
      const done = [];
      let rest = "";
      for (let i = 0; i < parts.length; i++) {
        if (i < parts.length - 1 && paragraphReady(parts[i])) {
          done.push(parts[i]);
        } else {
          rest = parts.slice(i).join("\n\n");
          break;
        }
      }
      if (done.length > 0) {
        pending = rest;
        for (const p of done) {
          const div = document.createElement("div");
          div.className = "edge-tutor-md";
          commitContainer.appendChild(div);
          void import_obsidian4.MarkdownRenderer.render(this.app, normalizeMath(p), div, this.plugin.settings.textbookRoot, this).then(() => {
            this.attachCitationButtons(div);
            this.attachCodeCopyButtons(div);
          });
        }
      }
      streamTextEl.textContent = rest;
      followScroll();
    };
    const finalizeStreamRender = () => {
      if (pending) {
        const div = document.createElement("div");
        div.className = "edge-tutor-md";
        commitContainer.appendChild(div);
        void import_obsidian4.MarkdownRenderer.render(this.app, normalizeMath(pending), div, this.plugin.settings.textbookRoot, this).then(() => {
          this.attachCitationButtons(div);
          this.attachCodeCopyButtons(div);
        });
        pending = "";
        streamTextEl.textContent = "";
      }
    };
    let lastPersistAt = 0;
    let lastPersistLen = 0;
    let partialMsg = null;
    const persistPartial = () => {
      if (streamed.length <= lastPersistLen) return;
      if (!partialMsg) {
        partialMsg = pushMessage(this.conv, "assistant", streamed, { lineId: lastUser == null ? void 0 : lastUser.lineId });
      } else {
        partialMsg.content = streamed;
      }
      lastPersistLen = streamed.length;
      lastPersistAt = Date.now();
      void this.plugin.saveConv(this.conv);
    };
    const getPartial = () => partialMsg;
    try {
      const answer = await streamCompletion(this.plugin.settings, history, {
        onDelta: (delta) => {
          streamed += delta;
          pending += delta;
          if (Date.now() - lastRenderAt >= 200) flushStreamRender();
          else followScroll();
          const now = Date.now();
          if (streamed.length - lastPersistLen >= 1500 || now - lastPersistAt >= 3e3 && streamed.length > lastPersistLen) {
            persistPartial();
          }
        }
      });
      finalizeStreamRender();
      const partial = getPartial();
      let assistantMsg;
      if (partial) {
        partial.content = answer;
        assistantMsg = partial;
      } else {
        assistantMsg = pushMessage(this.conv, "assistant", answer, { lineId: lastUser == null ? void 0 : lastUser.lineId });
      }
      if ((lastUser == null ? void 0 : lastUser.anchor) && !assistantMsg.anchor) assistantMsg.anchor = lastUser.anchor;
      await this.plugin.saveConv(this.conv);
      if (lastUser) finishAnswer(this.conv, assistantMsg, lastUser.content);
      streamingEl.remove();
      this.renderAll();
    } catch (e) {
      if (streamed) {
        const errMsg = `

\u26A0\uFE0F \u56DE\u7B54\u4E2D\u65AD\uFF1A${e.message.slice(0, 120)}`;
        persistPartial();
        const partial = getPartial();
        if (partial) partial.content = streamed + errMsg;
        await this.plugin.saveConv(this.conv);
        this.renderAll();
      } else {
        this.appendMessageRaw({
          role: "assistant",
          content: `\u26A0\uFE0F \u8C03\u7528\u5931\u8D25\uFF1A${e.message.slice(0, 150)}

\u8BF7\u68C0\u67E5\u8BBE\u7F6E\u4E2D\u7684 API Key \u548C\u7F51\u7EDC\u3002`
        });
      }
    } finally {
      this.busy = false;
      this.sendBtn.setText("\u53D1\u9001");
      this.sendBtn.disabled = false;
      if (searchNote) this.setStatus(`\u56DE\u7B54\u5B8C\u6210 ${searchNote}`);
      if (this.pendingExternalReload) {
        this.pendingExternalReload = false;
        try {
          const next = await this.plugin.loadConv(this.currentWorkspace);
          this.conv = next;
          await this.renderAll();
          this.setStatus("\u68C0\u6D4B\u5230\u4F1A\u8BDD\u6587\u4EF6\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u5DF2\u540C\u6B65");
        } catch (e) {
        }
      }
    }
    this.scrollToBottom();
  }
  /**
   * 重新生成某条 AI 回答（网络波动/回答不佳时使用）：
   * 用该回答对应的提问重建历史（提问及其之前），流式重新生成并替换原回答。
   */
  async regenerate(target) {
    if (this.busy) {
      new import_obsidian4.Notice("\u6709\u56DE\u7B54\u751F\u6210\u4E2D\uFF0C\u8BF7\u7A0D\u5019");
      return;
    }
    const tIdx = this.conv.messages.indexOf(target);
    if (tIdx < 0) return;
    let uIdx = -1;
    for (let i = tIdx - 1; i >= 0; i--) {
      if (this.conv.messages[i].role === "user") {
        uIdx = i;
        break;
      }
    }
    if (uIdx < 0) {
      new import_obsidian4.Notice("\u627E\u4E0D\u5230\u5BF9\u5E94\u7684\u63D0\u95EE");
      return;
    }
    const userMsg = this.conv.messages[uIdx];
    this.busy = true;
    this.sendBtn.setText("\u601D\u8003\u4E2D\u2026");
    this.sendBtn.disabled = true;
    this.setStatus("\u{1F504} \u91CD\u65B0\u751F\u6210\u4E2D\u2026");
    const history = [{ role: "system", content: buildSystemPrompt() }];
    const isFollowup = !!userMsg.lineId && userMsg.lineId === this.conv.reading.activeId;
    const branchInstr = branchInstruction(this.conv, isFollowup);
    for (let i = 0; i <= uIdx; i++) {
      const m = this.conv.messages[i];
      if (m.role === "user") {
        const instr = i === uIdx && branchInstr ? `

${branchInstr}` : "";
        history.push({ role: "user", content: m.content + instr });
      } else {
        history.push({ role: "assistant", content: m.content });
      }
    }
    const msgEl = this.msgContainer.querySelector(`[data-msg-index="${tIdx}"]`);
    const streamEl = msgEl != null ? msgEl : this.appendMessageRaw({ role: "assistant", content: "" });
    const contentEl = streamEl.querySelector(".edge-tutor-msg-content");
    contentEl.empty();
    const streamTextEl = document.createElement("div");
    streamTextEl.className = "edge-tutor-stream-text";
    contentEl.appendChild(streamTextEl);
    let streamed = "";
    try {
      const answer = await streamCompletion(this.plugin.settings, history, {
        onDelta: (delta) => {
          streamed += delta;
          streamTextEl.textContent = streamed;
          this.scrollToBottom();
        }
      });
      target.content = answer;
      delete target.verbatimContent;
      if (userMsg.anchor) target.anchor = userMsg.anchor;
      finishAnswer(this.conv, target, userMsg.content);
      await this.plugin.saveConv(this.conv);
      this.renderAll();
      this.setStatus("\u{1F504} \u5DF2\u91CD\u65B0\u751F\u6210");
    } catch (e) {
      if (streamed) {
        target.content = streamed + `

\u26A0\uFE0F \u56DE\u7B54\u4E2D\u65AD\uFF1A${e.message.slice(0, 120)}`;
        await this.plugin.saveConv(this.conv);
        this.renderAll();
        this.setStatus("\u26A0\uFE0F \u56DE\u7B54\u4E2D\u65AD\uFF0C\u53EF\u518D\u6B21\u91CD\u65B0\u751F\u6210");
      } else {
        this.renderAll();
        new import_obsidian4.Notice("\u91CD\u65B0\u751F\u6210\u5931\u8D25\uFF1A" + e.message.slice(0, 100));
      }
    } finally {
      this.busy = false;
      this.sendBtn.setText("\u53D1\u9001");
      this.sendBtn.disabled = false;
    }
  }
  /** 方向指引 */
  /** 方向指引（范围 + 模式可选；感知认知链结构，节点是路标不是终点） */
  async requestGuide() {
    var _a;
    if (this.busy) return;
    const picked = await new ScopeModal(this.app).openScope();
    if (!picked) return;
    const { scope, mode } = picked;
    this.busy = true;
    const active = activeThread(this.conv);
    const scopeLabel = scope === "whole" ? "\u5168\u4E66" : "\u5F53\u524D\u4F4D\u7F6E\u9644\u8FD1";
    const modeLabel = mode === "deepen" ? "\u6DF1\u5316\u5F53\u524D\u94FE" : mode === "frontier" ? "\u5168\u4E66\u65B0\u57DF" : "\u6DF7\u5408";
    pushMessage(this.conv, "user", `\u{1F9ED} \u8BF7\u7ED9\u6211\u65B9\u5411\u6307\u5F15\uFF08\u8303\u56F4\uFF1A${scopeLabel}\uFF1B\u6A21\u5F0F\uFF1A${modeLabel}\uFF09\uFF1A\u63A8\u8350\u503C\u5F97\u6DF1\u5165\u7684\u9AD8\u4EF7\u503C\u5165\u53E3\u3002`, { lineId: active == null ? void 0 : active.id });
    await this.plugin.saveConv(this.conv);
    this.renderAll();
    const loadingMsg = this.appendMessageRaw({ role: "assistant", content: "" });
    const streamTextEl = document.createElement("div");
    streamTextEl.className = "edge-tutor-stream-text";
    loadingMsg.querySelector(".edge-tutor-msg-content").appendChild(streamTextEl);
    let streamed = "";
    let guidePersistLen = 0;
    let guidePartial = null;
    const persistGuide = () => {
      if (streamed.length <= guidePersistLen) return;
      if (!guidePartial) {
        guidePartial = pushMessage(this.conv, "assistant", streamed, { lineId: active == null ? void 0 : active.id });
      } else {
        guidePartial.content = streamed;
      }
      guidePersistLen = streamed.length;
      void this.plugin.saveConv(this.conv);
    };
    try {
      const toc = await this.plugin.readToc();
      let mapText;
      let locked;
      if (scope === "whole") {
        const g = await this.plugin.buildGlobalMapText();
        mapText = g.text;
        locked = g.locked;
      } else {
        const map = cognitiveMapSummary(this.conv);
        mapText = map.summaryText;
        locked = map.locked;
      }
      const readingAnchor = (_a = this.plugin.getCurrentReadingAnchor()) != null ? _a : null;
      const guideMessages = [
        { role: "system", content: buildGuideSystemPrompt(scope, mode) },
        {
          role: "user",
          content: [
            "\u3010\u6559\u6750\u603B\u76EE\u5F55\u3011",
            toc.slice(0, 6e3),
            "",
            "\u3010\u6211\u7684\u8BA4\u77E5\u5730\u56FE\uFF08\u8282\u70B9\u6811\uFF1A\u7F29\u8FDB=\u5C42\u7EA7\uFF0C\u542B\u6458\u8981\u4E0E\u72B6\u6001\uFF1Bwhole \u6A21\u5F0F\u542B\u5168\u90E8\u5DE5\u4F5C\u533A\uFF09\u3011",
            mapText,
            "",
            scope === "nearby" && readingAnchor ? [
              `\u3010\u5F53\u524D\u9605\u8BFB\u4F4D\u7F6E\u3011\u6587\u4EF6\uFF1A${readingAnchor.sourcePath}`,
              readingAnchor.quote ? `\u5F53\u524D\u6BB5\u843D/\u9009\u4E2D\u6587\u672C\uFF1A${readingAnchor.quote}` : ""
            ].filter(Boolean).join("\n") : "",
            mode === "deepen" || mode === "mixed" ? `\u3010\u5F53\u524D\u5DE5\u4F5C\u533A\u3011${this.currentWorkspace === "main" ? "\u9ED8\u8BA4" : this.currentWorkspace}` : "",
            locked.length ? `\u3010\u5C01\u9876\u94FE\uFF08\u{1F512}\uFF09\u3011${locked.join(" / ")}` : "",
            "",
            scope === "nearby" ? "\u8BF7\u5728\u5F53\u524D\u4F4D\u7F6E\u9644\u8FD1\u63A8\u8350 2-4 \u4E2A\u503C\u5F97\u6DF1\u5165\u7684\u9AD8\u4EF7\u503C\u5165\u53E3\u3002" : "\u8BF7\u63A8\u8350 2-4 \u4E2A\u5168\u4E66\u8303\u56F4\u5185\u503C\u5F97\u6DF1\u5165\u7684\u9AD8\u4EF7\u503C\u5165\u53E3\u3002"
          ].filter(Boolean).join("\n")
        }
      ];
      const answer = await streamCompletion(this.plugin.settings, guideMessages, {
        onDelta: (delta) => {
          streamed += delta;
          streamTextEl.textContent = streamed;
          if (streamed.length - guidePersistLen >= 1500) {
            persistGuide();
          }
        }
      });
      const entries = parseGuideResponse(answer);
      if (entries.length === 0) {
        this.replaceMessage(loadingMsg, { role: "assistant", content: "\u26A0\uFE0F AI \u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u5165\u53E3\u3002\u8BF7\u91CD\u8BD5\u3002" });
      } else {
        this.replaceMessage(loadingMsg, {
          role: "assistant",
          content: `\u{1F9ED} ${scopeLabel}\u5185\u63A8\u8350\u7684\u9AD8\u4EF7\u503C\u5165\u53E3\uFF08\u81EA\u7531\u9009\u62E9\uFF0C\u53EF\u8DF3\u5165\uFF09\uFF1A`,
          guideEntries: entries
        });
        const gp = guidePartial;
        if (gp) gp.content = answer;
      }
      await this.plugin.saveConv(this.conv);
    } catch (e) {
      this.replaceMessage(loadingMsg, { role: "assistant", content: `\u26A0\uFE0F \u65B9\u5411\u6307\u5F15\u5931\u8D25\uFF1A${e.message.slice(0, 150)}` });
    } finally {
      this.busy = false;
    }
  }
  /** 沉淀当前对话为认知节点（从会话同步到 .md 镜像） */
  async saveConversation() {
    var _a, _b, _c, _d;
    const active = activeThread(this.conv);
    const lastUser = [...this.conv.messages].reverse().find((m) => m.role === "user");
    const lastAssistant = [...this.conv.messages].reverse().find((m) => m.role === "assistant");
    if (!lastUser) {
      new import_obsidian4.Notice("\u8FD8\u6CA1\u6709\u5BF9\u8BDD\u53EF\u6C89\u6DC0");
      return;
    }
    const title = makeNodeTitle(lastUser.content) || "\u8BA4\u77E5\u8282\u70B9";
    const node = {
      title,
      content: buildNodeContent({
        title,
        content: "",
        parentTitle: (active == null ? void 0 : active.parentId) ? (_b = (_a = this.conv.reading.threads.find((t) => t.id === active.parentId)) == null ? void 0 : _a.title) != null ? _b : void 0 : void 0,
        anchor: { sourcePath: (_c = lastUser.anchor) != null ? _c : "", quote: lastUser.content.slice(0, 80) },
        status: (active == null ? void 0 : active.status) === "paused" ? "paused" : "active",
        rootQuestion: lastUser.content,
        summary: lastAssistant == null ? void 0 : lastAssistant.content.slice(0, 200)
      }),
      anchor: { sourcePath: (_d = lastUser.anchor) != null ? _d : "", quote: lastUser.content.slice(0, 80) },
      status: (active == null ? void 0 : active.status) === "paused" ? "paused" : "active",
      rootQuestion: lastUser.content,
      summary: lastAssistant == null ? void 0 : lastAssistant.content.slice(0, 200),
      workspace: this.currentWorkspace
    };
    await this.plugin.createNode(node);
    new import_obsidian4.Notice("\u2705 \u8BA4\u77E5\u8282\u70B9\u5DF2\u6C89\u6DC0");
  }
  /** 清屏确认：检测未沉淀对话 → 自动备份 → 清空 */
  async confirmClear() {
    const hasContent = this.conv.messages.length > 0 || this.conv.reading.threads.length > 0;
    if (!hasContent) {
      new import_obsidian4.Notice("\u5F53\u524D\u5BF9\u8BDD\u5DF2\u7ECF\u662F\u7A7A\u7684");
      return;
    }
    const hasUnsaved = await this.hasUnsavedConversation();
    const modal = new ClearModal(this.app, hasUnsaved);
    modal.onBackupAndClear = async () => {
      await this.plugin.exportWorkspace("json");
      await this.doClear();
    };
    modal.onSaveAndClear = async () => {
      await this.saveConversation();
      await this.plugin.exportWorkspace("json");
      await this.doClear();
    };
    modal.open();
  }
  /** 是否有未沉淀的对话：最后一条消息时间 > 节点目录里最新文件时间 */
  async hasUnsavedConversation() {
    var _a, _b;
    const lastMsg = this.conv.messages[this.conv.messages.length - 1];
    if (!lastMsg) return false;
    const folder = this.plugin.workspaceFolder(this.currentWorkspace).replace(/\/+$/, "");
    const files = this.app.vault.getMarkdownFiles();
    let latest = 0;
    for (const f of files) {
      if (f.path === folder || f.path.startsWith(folder + "/")) {
        const mtime = (_b = (_a = f.stat) == null ? void 0 : _a.mtime) != null ? _b : 0;
        if (mtime > latest) latest = mtime;
      }
    }
    return lastMsg.ts > latest;
  }
  /** 真正执行清屏 */
  async doClear() {
    this.conv.messages = [];
    this.conv.reading.threads = [];
    this.conv.reading.activeId = null;
    this.conv.reading.parkingLot = [];
    await this.plugin.saveConv(this.conv);
    this.renderAll();
    new import_obsidian4.Notice("\u5DF2\u6E05\u7A7A\u5F53\u524D\u5BF9\u8BDD\uFF08\u8282\u70B9\u6587\u4EF6\u672A\u53D7\u5F71\u54CD\uFF0C\u5DF2\u81EA\u52A8\u5907\u4EFD\uFF09");
  }
  /** 暂存问题到停车场 */
  async parkInput() {
    var _a, _b;
    const text = this.inputEl.value.trim();
    if (!text) {
      new import_obsidian4.Notice("\u8F93\u5165\u6846\u4E3A\u7A7A\uFF0C\u6CA1\u6709\u53EF\u6682\u5B58\u7684\u95EE\u9898");
      return;
    }
    const anchor = this.plugin.getAnchor();
    const active = activeThread(this.conv);
    const item = parkQuestion(text, { anchor: (_a = anchor == null ? void 0 : anchor.sourcePath) != null ? _a : null, parentId: (_b = active == null ? void 0 : active.id) != null ? _b : null });
    if (!item) return;
    this.conv.reading.parkingLot.push(item);
    await this.plugin.saveConv(this.conv);
    this.inputEl.value = "";
    await this.clearDraft();
    new import_obsidian4.Notice("\u{1F4CC} \u5DF2\u6682\u5B58\u5230\u95EE\u9898\u505C\u8F66\u573A");
    this.parkContainer.style.display = "block";
    await this.renderParkingLot();
  }
  /** 渲染停车场（对齐 Zotero：提问按钮直接取出） */
  async renderParkingLot() {
    this.parkContainer.empty();
    const list = this.conv.reading.parkingLot;
    if (list.length === 0) {
      this.parkContainer.createEl("div", { text: "\uFF08\u505C\u8F66\u573A\u4E3A\u7A7A\uFF09", cls: "edge-tutor-park-empty" });
      return;
    }
    this.parkContainer.createEl("div", { text: `\u{1F4CC} \u95EE\u9898\u505C\u8F66\u573A\uFF08${list.length}\uFF09`, cls: "edge-tutor-park-title" });
    for (const it of list) {
      const row = this.parkContainer.createEl("div", { cls: "edge-tutor-park-row" });
      const tag = it.category === "branch" ? "\u5206\u652F" : "\u7A0D\u540E";
      row.createEl("span", { text: `[${tag}] ${it.question}`, cls: "edge-tutor-park-question" });
      const takeBtn = row.createEl("button", { text: "\u63D0\u95EE", cls: "edge-tutor-mini" });
      takeBtn.addEventListener("click", async () => {
        var _a, _b, _c, _d;
        const taken = takeParked(this.conv.reading.parkingLot, it.id);
        this.conv.reading.parkingLot = taken.list;
        await this.plugin.saveConv(this.conv);
        if ((_a = taken.item) == null ? void 0 : _a.parentId) {
          switchThread(this.conv, taken.item.parentId);
        }
        this.inputEl.value = (_c = (_b = taken.item) == null ? void 0 : _b.question) != null ? _c : "";
        this.branchNext = !!((_d = taken.item) == null ? void 0 : _d.parentId);
        this.renderAll();
        this.inputEl.focus();
      });
    }
  }
  /** ===== 会话搜索（Zotero searchConversation） ===== */
  updateSearch(query) {
    this.searchQuery = String(query || "");
    this.searchHits = searchConversation(this.conv, this.searchQuery);
    this.searchCursor = -1;
    this.renderAll();
    this.renderSearchResults();
  }
  async navigateSearchHit(index) {
    const hits = this.searchHits;
    if (!hits.length) return;
    if (index < 0) index = hits.length - 1;
    if (index >= hits.length) index = 0;
    const hit = hits[index];
    const lineId = hit.lineId;
    const lineExists = lineId && this.conv.reading.threads.some((t) => t.id === lineId);
    if (lineExists && lineId !== this.conv.reading.activeId) {
      if (this.busy) {
        this.setStatus("\u56DE\u7B54\u751F\u6210\u4E2D\uFF0C\u6682\u4E0D\u5207\u6362\u5230\u5176\u4ED6\u601D\u7EF4\u8282\u70B9\u3002");
        return;
      }
      switchThread(this.conv, lineId);
      void this.plugin.saveConv(this.conv);
    } else if (!lineExists && this.viewMode !== "all") {
      this.viewMode = "all";
      this.viewSelect.value = "all";
      void this.plugin.saveConv(this.conv);
    }
    this.searchCursor = index;
    if (hit.messageIndex >= 0) {
      const target = await this.ensureMessageLoaded(hit.messageIndex);
      if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    this.renderSearchResults();
  }
  renderSearchResults() {
    if (!this.searchResultsEl || !this.searchCountEl) return;
    this.searchResultsEl.empty();
    const query = String(this.searchQuery || "").trim();
    if (!query) {
      this.searchCountEl.textContent = "";
      this.searchResultsEl.style.display = "none";
      return;
    }
    const hits = this.searchHits;
    this.searchCountEl.textContent = hits.length ? (this.searchCursor >= 0 ? this.searchCursor + 1 + "/" : "") + hits.length + " \u5904" : "\u65E0\u5339\u914D";
    if (!hits.length) {
      this.searchResultsEl.style.display = "none";
      return;
    }
    hits.slice(0, 50).forEach((hit, i) => {
      const row = this.searchResultsEl.createEl("button", {
        cls: "edge-tutor-search-result" + (i === this.searchCursor ? " active" : "")
      });
      const kind = row.createEl("span", { text: hit.role, cls: "edge-tutor-search-result-kind" });
      const excerpt = row.createEl("span", {
        text: (hit.lineId ? hit.lineId + " \xB7 " : "") + (hit.excerpt || ""),
        cls: "edge-tutor-search-result-text"
      });
      row.addEventListener("click", () => this.navigateSearchHit(i));
    });
    this.searchResultsEl.style.display = "block";
  }
  /** 粘贴为根（Zotero pasteRoot：不挂任何节点） */
  async pasteAsRoot() {
    var _a, _b, _c;
    if (this.branchClipboard.length === 0) {
      this.setStatus("\u526A\u8D34\u677F\u4E3A\u7A7A\uFF1A\u5148\u5728\u67D0\u4E2A\u8282\u70B9\u4E0A\u70B9\u300C\u590D\u5236\u300D\u3002");
      return;
    }
    const conv = this.conv;
    const idMap = /* @__PURE__ */ new Map();
    for (const src of this.branchClipboard) {
      const newId = "q" + ++conv.reading.sequence;
      idMap.set(src.id, newId);
      const isRootOfBranch = src.parentId === this.branchClipboard[0].id;
      const newParent = isRootOfBranch ? null : (_b = idMap.get((_a = src.parentId) != null ? _a : "")) != null ? _b : src.parentId;
      conv.reading.threads.push({
        ...src,
        id: newId,
        parentId: newParent,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    if (this.branchClipboardMessages.length > 0) {
      const oldToNew = new Map(idMap);
      for (const srcMsg of this.branchClipboardMessages) {
        const newLine = srcMsg.lineId ? (_c = oldToNew.get(srcMsg.lineId)) != null ? _c : srcMsg.lineId : void 0;
        pushMessage(conv, srcMsg.role, srcMsg.content, { anchor: srcMsg.anchor, lineId: newLine });
      }
    }
    await this.plugin.saveConv(conv);
    this.renderAll();
    this.setStatus(`\u5DF2\u7C98\u8D34 ${this.branchClipboard.length} \u4E2A\u8282\u70B9\u4E3A\u6839${this.branchClipboardMessages.length ? `\uFF08\u542B ${this.branchClipboardMessages.length} \u6761\u6D88\u606F\uFF09` : ""}`);
  }
  /** 刷新工作区下拉框 */
  async refreshWorkspaceSelect() {
    const workspaces = await this.plugin.discoverWorkspaces();
    this.wsSelect.empty();
    for (const ws of workspaces) {
      const text = ws === "main" ? "\u9ED8\u8BA4\u5DE5\u4F5C\u533A" : ws.includes("/") ? `\u{1F4D8} ${ws}` : `\u{1F4D8} ${ws}`;
      const opt = this.wsSelect.createEl("option", { value: ws, text });
      if (ws === this.currentWorkspace) opt.setAttribute("selected", "selected");
    }
    if (workspaces.length > 0 && !workspaces.includes(this.currentWorkspace)) {
      this.currentWorkspace = workspaces[0];
    }
  }
  /** 导图平移/滚动（Zotero：拖空白平移 + wheel 横向滚动） */
  initMapPan() {
    const map = this.mapContainer;
    map.addEventListener("wheel", (event) => {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta) return;
      if (map.scrollWidth <= map.clientWidth) return;
      event.preventDefault();
      map.scrollLeft += delta;
    }, { passive: false });
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    map.addEventListener("mousedown", (event) => {
      const target = event.target;
      if (target.closest("button")) return;
      if (target.closest(".edge-tutor-map-node")) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = map.scrollLeft;
      startTop = map.scrollTop;
      map.classList.add("dragging");
      event.preventDefault();
    });
    map.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      map.scrollLeft = startLeft - (event.clientX - startX);
      map.scrollTop = startTop - (event.clientY - startY);
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      map.classList.remove("dragging");
    };
    map.addEventListener("mouseup", stop);
    map.addEventListener("mouseleave", stop);
  }
  /** ===== 思维导图（Zotero renderWorkflow） ===== */
  async renderWorkflow() {
    var _a, _b;
    const conv = this.conv;
    const state = conv.reading;
    if (!conv || state.threads.length === 0) {
      this.mapContainer.style.display = "none";
      this.mapTitle.style.display = "none";
      return;
    }
    const threads = state.threads.map((t) => ({
      id: t.id,
      title: t.title || t.rootQuestion,
      parentId: t.parentId,
      status: t.status
    }));
    const layout = mindMapLayout(threads);
    const { positions, canvasWidth, canvasHeight } = layoutToCoordinates(layout);
    this.mapContainer.style.display = "block";
    this.mapContainer.empty();
    this.mapTitle.style.display = "block";
    this.mapTitle.textContent = `\u{1F9ED} \u601D\u7EF4\u5BFC\u56FE \xB7 \u7EB5\u5411\u4E3B\u5E72\u4E0E\u5206\u652F\uFF08${state.threads.length} \u4E2A\u8282\u70B9\uFF09`;
    const NODE_W = 150;
    const NODE_H = 48;
    const ns = "http://www.w3.org/2000/svg";
    const canvas = document.createElement("div");
    canvas.className = "edge-tutor-map-canvas";
    canvas.style.position = "relative";
    canvas.style.width = canvasWidth + "px";
    canvas.style.height = canvasHeight + "px";
    this.mapContainer.appendChild(canvas);
    const activePath = new Set(ancestry(conv, state.activeId).map((t) => t.id));
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(canvasWidth));
    svg.setAttribute("height", String(canvasHeight));
    svg.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
    svg.setAttribute("class", "edge-tutor-map-links");
    for (const edge of layout.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", buildEdgePath(from.x, from.y, to.x, to.y, NODE_W, NODE_H));
      const active = activePath.has(edge.from) && activePath.has(edge.to);
      path.setAttribute("class", "edge-tutor-map-link" + (active ? " active" : ""));
      svg.appendChild(path);
    }
    canvas.appendChild(svg);
    for (const p of layout.nodes) {
      const point = positions.get(p.thread.id);
      if (!point) continue;
      const t = state.threads.find((x) => x.id === p.thread.id);
      if (!t) continue;
      const childrenCount = layout.edges.filter((e) => e.from === t.id).length;
      const cls = [
        "edge-tutor-map-node",
        p.column === 0 ? "root" : "",
        childrenCount > 1 ? "branch" : "",
        t.id === state.activeId ? "active" : "",
        t.status === "paused" ? "paused" : "",
        t.title && t.title !== t.rootQuestion ? "renamed" : "",
        t.mastery === "mastered" ? "mastered" : ""
      ].filter(Boolean).join(" ");
      const node = document.createElement("div");
      node.className = cls;
      node.setAttribute("data-thread-id", t.id);
      node.style.position = "absolute";
      node.style.left = point.x + "px";
      node.style.top = point.y + "px";
      node.style.width = NODE_W + "px";
      node.style.height = NODE_H + "px";
      node.setAttribute("aria-level", String(p.column + 1));
      node.setAttribute(
        "title",
        `\u539F\u59CB\u95EE\u9898\uFF1A${t.rootQuestion || t.title || "\u2014"}` + (((_a = t.anchor) == null ? void 0 : _a.quote) ? `
\u951A\u5B9A\uFF1A${t.anchor.quote.slice(0, 60)}` : "") + (t.summary ? `

\u6458\u8981\uFF1A${t.summary.slice(0, 100)}` : "") + "\n\n\u62D6\u62FD\u53EF\u8C03\u6574\u5C42\u7EA7\uFF1A\u62D6\u5230\u53E6\u4E00\u8282\u70B9\u4E0A=\u53D8\u4E3A\u5176\u5B50\u8282\u70B9\uFF0C\u62D6\u5230\u7A7A\u767D=\u56DE\u5230\u4E3B\u5E72\u3002"
      );
      const label = document.createElement("span");
      label.className = "edge-tutor-map-node-title";
      label.textContent = t.title || t.rootQuestion;
      node.appendChild(label);
      canvas.appendChild(node);
      const actions = document.createElement("div");
      actions.className = "edge-tutor-map-acts";
      node.appendChild(actions);
      const act = (labelText, tip, handler, danger = false) => {
        const b = document.createElement("button");
        b.textContent = labelText;
        b.className = "edge-tutor-map-act" + (danger ? " danger" : "");
        b.setAttribute("title", tip);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.busy) return;
          void handler();
        });
        actions.appendChild(b);
      };
      act("\u2795", "\u5728\u6B64\u8282\u70B9\u4E0B\u63D2\u5165\u4E00\u4E2A\u65B0\u95EE\u9898\u8282\u70B9", async () => {
        const q = await new PromptModal(this.app, `\u65B0\u95EE\u9898\u8282\u70B9\uFF08\u6302\u5728\u300C${t.title || t.rootQuestion}\u300D\u4E4B\u4E0B\uFF09`).openPrompt();
        if (q == null) return;
        addThread(conv, { question: q, parentId: t.id, anchor: this.plugin.getAnchor() });
        await this.plugin.saveConv(conv);
        this.renderAll();
        this.inputEl.placeholder = "\u5411\u8FD9\u4E2A\u65B0\u95EE\u9898\u63D0\u95EE\u2026";
        this.inputEl.focus();
      });
      act("\u270F\uFE0F", "\u6539\u5199\u6807\u9898\uFF08\u539F\u59CB\u95EE\u9898\u4ECD\u4FDD\u7559\uFF09", async () => {
        const v = await new PromptModal(this.app, "\u6539\u5199\u8282\u70B9\u6807\u9898\uFF08\u539F\u59CB\u95EE\u9898\u4E0D\u53D8\uFF09", "", t.title || t.rootQuestion).openPrompt();
        if (v == null || v === t.title) return;
        t.title = v;
        t.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await this.plugin.saveConv(conv);
        this.renderAll();
      });
      act("\u{1F512}", t.mastery === "mastered" ? "\u5DF2\u5C01\u9876\uFF0C\u70B9\u51FB\u53D6\u6D88" : "\u6B64\u94FE\u5C01\u9876\uFF08\u5BFC\u5F15\u6682\u4E0D\u6DF1\u5316\u6B64\u94FE\uFF0C\u53EF\u968F\u65F6\u53D6\u6D88\uFF09", async () => {
        t.mastery = t.mastery === "mastered" ? "exploring" : "mastered";
        t.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await this.plugin.saveConv(conv);
        await this.plugin.setNodeLocked(this.currentWorkspace, t.title, t.mastery === "mastered");
        this.renderAll();
        this.setStatus(t.mastery === "mastered" ? `\u300C${t.title}\u300D\u5DF2\u5C01\u9876\uFF08\u5BFC\u5F15\u5C06\u805A\u7126\u5176\u4ED6\u94FE\uFF09` : `\u300C${t.title}\u300D\u5DF2\u89E3\u9664\u5C01\u9876`);
      });
      act("\u{1F4CB}", "\u590D\u5236\u6B64\u8282\u70B9\u53CA\u5176\u5168\u90E8\u5206\u652F", () => {
        const subtree = collectSubtree(conv, t.id);
        const ids = new Set(subtree.map((s) => s.id));
        this.branchClipboard = subtree;
        this.branchClipboardWs = this.currentWorkspace;
        this.branchClipboardMessages = conv.messages.filter((m) => m.lineId && ids.has(m.lineId));
        this.setStatus(`\u5DF2\u590D\u5236 ${subtree.length} \u4E2A\u8282\u70B9\uFF08\u542B ${this.branchClipboardMessages.length} \u6761\u6D88\u606F\uFF09\uFF0C\u5728\u4EFB\u4F55\u8282\u70B9\u4E0A\u70B9\u300C\u7C98\u8D34\u300D\u53EF\u6302\u5165`);
      });
      act("\u{1F4CC}", "\u5C06\u526A\u8D34\u677F\u8282\u70B9\u7C98\u8D34\u4E3A\u6B64\u8282\u70B9\u7684\u5B50\u8282\u70B9", async () => {
        var _a2, _b2, _c;
        if (this.branchClipboard.length === 0) {
          this.setStatus("\u526A\u8D34\u677F\u4E3A\u7A7A\uFF1A\u5148\u5728\u67D0\u4E2A\u8282\u70B9\u4E0A\u70B9\u300C\u590D\u5236\u300D\u3002");
          return;
        }
        const idMap = /* @__PURE__ */ new Map();
        for (const src of this.branchClipboard) {
          const newId = "q" + ++conv.reading.sequence;
          idMap.set(src.id, newId);
          const isRootOfBranch = src.parentId === this.branchClipboard[0].id;
          const newParent = isRootOfBranch ? t.id : (_b2 = idMap.get((_a2 = src.parentId) != null ? _a2 : "")) != null ? _b2 : src.parentId;
          conv.reading.threads.push({
            ...src,
            id: newId,
            parentId: newParent,
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        if (this.branchClipboardMessages.length > 0) {
          for (const srcMsg of this.branchClipboardMessages) {
            const newLine = srcMsg.lineId ? (_c = idMap.get(srcMsg.lineId)) != null ? _c : srcMsg.lineId : void 0;
            pushMessage(conv, srcMsg.role, srcMsg.content, { anchor: srcMsg.anchor, lineId: newLine });
          }
        }
        await this.plugin.saveConv(conv);
        this.renderAll();
        this.setStatus(`\u5DF2\u7C98\u8D34 ${this.branchClipboard.length} \u4E2A\u8282\u70B9\u5230\u300C${t.title}\u300D\u4E4B\u4E0B`);
        const srcWs = this.branchClipboardWs;
        const srcIds = this.branchClipboard.map((s) => s.id);
        if (srcWs && srcWs !== this.currentWorkspace && srcIds.length > 0) {
          const srcTitles = this.branchClipboard.map((s) => s.title || s.rootQuestion).slice(0, 3).join("\u3001");
          const modal = new ConfirmModal(this.app, "\u5220\u9664\u6E90\u5DE5\u4F5C\u533A\u7684\u8282\u70B9\uFF1F", [
            `\u5DF2\u628A\u5206\u652F\u7C98\u8D34\u5230\u300C${this.currentWorkspace}\u300D\u3002`,
            `\u662F\u5426\u540C\u65F6\u5220\u9664\u300C${srcWs}\u300D\u4E2D\u7684 ${srcIds.length} \u4E2A\u6E90\u8282\u70B9\uFF08${srcTitles}${this.branchClipboard.length > 3 ? "\u2026" : ""}\uFF09\uFF1F`,
            "\u5220\u9664\u4F1A\u8FDE\u5E26\u79FB\u9664\u6D88\u606F\u548C\u8282\u70B9\u6587\u4EF6\uFF08\u8FDB\u56DE\u6536\u7AD9\uFF09\u3002"
          ].join("\n"));
          modal.onConfirm = async () => {
            const n = await this.plugin.deleteThreadsWithFiles(srcWs, srcIds);
            new import_obsidian4.Notice(`\u5DF2\u4ECE\u300C${srcWs}\u300D\u5220\u9664 ${n} \u4E2A\u6E90\u8282\u70B9`);
          };
          modal.open();
        }
      });
      act("\u{1F4DD}", "\u6539\u5199\u6458\u8981\uFF08\u7406\u89E3\u6C89\u6DC0\uFF09", async () => {
        const v = await new PromptModal(this.app, "\u6539\u5199\u6458\u8981\uFF08\u7406\u89E3\u6C89\u6DC0\uFF09", "", t.summary || "").openPrompt();
        if (v == null) return;
        t.summary = v;
        t.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await this.plugin.saveConv(conv);
        this.renderAll();
      });
      act("\u{1F5D1}\uFE0F", "\u5220\u9664\u6B64\u8282\u70B9\u53CA\u5176\u5168\u90E8\u5206\u652F\uFF08\u542B\u6D88\u606F\u4E0E\u8282\u70B9\u6587\u4EF6\uFF0C\u8FDB\u56DE\u6536\u7AD9\uFF09", async () => {
        const subtree = collectSubtree(conv, t.id);
        const ids = subtree.map((s) => s.id);
        const modal = new ConfirmModal(
          this.app,
          "\u5220\u9664\u8282\u70B9\uFF1F",
          `\u5220\u9664\u300C${t.title || t.rootQuestion}\u300D\u53CA\u5176 ${ids.length - 1} \u4E2A\u5B50\u5206\u652F\uFF1F
\u5C06\u540C\u6B65\u5220\u9664\u6D88\u606F\u4E0E\u8282\u70B9\u6587\u4EF6\uFF08\u8FDB\u56DE\u6536\u7AD9\u53EF\u627E\u56DE\uFF09\u3002`,
          "\u786E\u8BA4\u5220\u9664"
        );
        modal.onConfirm = async () => {
          await this.plugin.deleteThreadsWithFiles(this.currentWorkspace, ids);
          this.conv = await this.plugin.loadConv(this.currentWorkspace);
          this.renderAll();
          this.setStatus(`\u5DF2\u5220\u9664 ${ids.length} \u4E2A\u8282\u70B9\uFF08\u542B\u6D88\u606F\u4E0E\u6587\u4EF6\uFF09`);
        };
        modal.open();
      });
      this.attachDrag(conv, node, t, point.x, point.y, canvas);
      node.addEventListener("click", (e) => {
        if (this.busy) return;
        if (e.target.closest(".edge-tutor-map-act")) return;
        if (t.id === state.activeId) return;
        switchThread(conv, t.id);
        this.branchNext = false;
        void this.plugin.saveConv(conv);
        this.renderAll();
        this.inputEl.placeholder = "\u7EE7\u7EED\u8FD9\u6761\u601D\u8DEF\u2026";
        this.inputEl.focus();
      });
    }
    const activePoint = positions.get((_b = state.activeId) != null ? _b : "");
    const mapLocate = !this.lastRenderedMapId || this.lastRenderedMapId !== state.activeId;
    if (activePoint && mapLocate) {
      this.mapContainer.scrollLeft = Math.max(0, activePoint.x - Math.max(0, (this.mapContainer.clientWidth - NODE_W) / 2));
      this.mapContainer.scrollTop = Math.max(0, activePoint.y - 54);
    }
    this.lastRenderedMapId = state.activeId;
    this.scrollToBottom();
  }
  /** 拖拽重组（Zotero pointerdown 移植） */
  attachDrag(conv, node, thread, origX, origY, canvas) {
    let drag = null;
    let suppressClick = false;
    node.addEventListener("pointerdown", (e) => {
      if (this.busy) return;
      if (e.button !== 0) return;
      if (e.target.closest(".edge-tutor-map-act")) return;
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: origX,
        origTop: origY,
        moved: false
      };
      const onMove = (ev) => {
        if (!drag) return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) {
          drag.moved = true;
          node.classList.add("dragging");
        }
        if (!drag.moved) return;
        node.style.left = drag.origLeft + dx + "px";
        node.style.top = drag.origTop + dy + "px";
        canvas.querySelectorAll(".edge-tutor-map-node.drop-target").forEach((n) => n.classList.remove("drop-target"));
        const target = dropTargetAt(canvas, ev.clientX, ev.clientY);
        if (target && target.getAttribute("data-thread-id") !== thread.id) {
          target.classList.add("drop-target");
        }
      };
      const onUp = (ev) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (drag == null ? void 0 : drag.moved) suppressClick = true;
        const target = dropTargetAt(canvas, ev.clientX, ev.clientY);
        const targetId = target ? target.getAttribute("data-thread-id") : null;
        if (targetId && targetId !== thread.id) {
          if (reparentThread(conv, thread.id, targetId)) {
            void this.plugin.saveConv(conv);
            this.renderAll();
          }
        } else if (!targetId && thread.parentId) {
          if (reparentThread(conv, thread.id, null)) {
            void this.plugin.saveConv(conv);
            this.renderAll();
          }
        }
        drag = null;
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
    node.addEventListener("click", (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
    });
  }
  /** 选中文本浮动按钮 */
  initSelFloat() {
    const selBtn = document.createElement("button");
    selBtn.textContent = "\u7531\u6B64\u8FFD\u95EE";
    selBtn.style.cssText = "position:fixed;z-index:2147483647;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:4px 12px;font:12px/1.6 -apple-system,'Segoe UI','Microsoft YaHei UI',sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);display:none;";
    document.body.appendChild(selBtn);
    this.selBtn = selBtn;
    const updateSelFloat = () => {
      var _a;
      try {
        const sel = document.getSelection();
        if (!sel || !sel.rangeCount) {
          selBtn.style.display = "none";
          return;
        }
        const txt = String(sel).trim();
        if (txt.length < 2) {
          selBtn.style.display = "none";
          return;
        }
        const rc = sel.getRangeAt(0).getBoundingClientRect();
        if (!rc || rc.width < 2 || rc.height < 2) {
          selBtn.style.display = "none";
          return;
        }
        selBtn.setAttribute("data-sel", txt);
        const x = rc.left + rc.width / 2 - 42;
        let y = rc.top - 34;
        if (y < 6) y = rc.bottom + 8;
        const btnRect = { left: Math.max(4, x), top: Math.max(4, y), width: 84, height: 28 };
        const inputRect = (_a = this.inputRowEl) == null ? void 0 : _a.getBoundingClientRect();
        if (inputRect && btnRect.left < inputRect.right && btnRect.left + btnRect.width > inputRect.left && btnRect.top < inputRect.bottom && btnRect.top + btnRect.height > inputRect.top) {
          selBtn.style.display = "none";
          return;
        }
        selBtn.style.left = btnRect.left + "px";
        selBtn.style.top = btnRect.top + "px";
        selBtn.style.display = "block";
      } catch (e) {
        selBtn.style.display = "none";
      }
    };
    selBtn.addEventListener("click", async () => {
      var _a, _b, _c;
      const txt = selBtn.getAttribute("data-sel") || "";
      if (!txt) return;
      (_a = document.getSelection()) == null ? void 0 : _a.removeAllRanges();
      selBtn.style.display = "none";
      this.receiveSelection(txt, (_c = (_b = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView)) == null ? void 0 : _b.file) == null ? void 0 : _c.path);
    });
    document.addEventListener("selectionchange", updateSelFloat);
    this.registerInterval(window.setInterval(updateSelFloat, 500));
  }
  /** ===== 草稿 ===== */
  scheduleDraftSave() {
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => {
      this.draftTimer = null;
      void this.flushDraft();
    }, DRAFT_SAVE_DELAY_MS);
  }
  async flushDraft() {
    var _a, _b;
    const text = (_b = (_a = this.inputEl) == null ? void 0 : _a.value) != null ? _b : "";
    if (!text.trim()) return;
    this.plugin.settings.draft = {
      text,
      timestamp: Date.now(),
      workspace: this.currentWorkspace,
      branchNext: this.branchNext,
      branchOrigin: this.branchOrigin,
      nextAnchor: this.pendingAnchor
    };
    await this.plugin.saveSettings();
  }
  async clearDraft() {
    this.plugin.settings.draft = null;
    await this.plugin.saveSettings();
  }
  async restoreDraft() {
    var _a;
    const draft = this.plugin.settings.draft;
    if (draft && draft.text && draft.workspace === this.currentWorkspace) {
      this.inputEl.value = draft.text;
      this.pendingAnchor = (_a = draft.nextAnchor) != null ? _a : null;
      if (draft.branchNext) {
        this.branchNext = true;
        this.branchOrigin = draft.branchOrigin || "";
        this.inputEl.placeholder = "\u8F93\u5165\u65B0\u5206\u652F\u7684\u8D77\u70B9\u2026";
      } else if (this.pendingAnchor && this.branchOrigin) {
        this.inputEl.placeholder = "\u57FA\u4E8E\u9009\u4E2D\u6587\u5B57\u7EE7\u7EED\u8FFD\u95EE\u2026";
      } else {
        this.inputEl.placeholder = "\u7EE7\u7EED\u8FD9\u6761\u601D\u8DEF\u2026";
      }
      this.setStatus("\u5DF2\u6062\u590D\u672A\u53D1\u9001\u7684\u8349\u7A3F\u3002");
      this.updateChips();
    }
  }
  async saveConv() {
    await this.plugin.saveConv(this.conv);
  }
  setStatus(text) {
    if (this.statusBar) this.statusBar.textContent = text;
  }
  /** ===== 消息渲染 ===== */
  appendMessage(m, ctx) {
    var _a, _b;
    if (ctx.showContext && ctx.thread) {
      const sep = this.msgContainer.createEl("div", { cls: "edge-tutor-thread-sep" });
      const label = sep.createEl("button", { text: ctx.thread.title || ctx.thread.rootQuestion, cls: "edge-tutor-thread-sep-btn" });
      label.addEventListener("click", () => {
        if (this.busy) return;
        switchThread(this.conv, ctx.thread.id);
        void this.plugin.saveConv(this.conv);
        this.renderAll();
      });
    }
    return this.appendMessageRaw({
      role: m.role,
      content: m.content,
      anchor: m.anchor,
      anchorQuote: (_b = (_a = ctx.thread) == null ? void 0 : _a.anchor) == null ? void 0 : _b.quote,
      agent: m.agent,
      messageIndex: ctx.messageIndex,
      // 普通 AI 回答可重新生成（导引/执行结果除外）
      onRegenerate: m.role === "assistant" && !m.agent && !m.content.trimStart().startsWith("\u{1F9ED}") ? () => void this.regenerate(m) : void 0,
      onEdit: async (el, content) => {
        const editor = el.createEl("textarea", { cls: "edge-tutor-edit-area", attr: { rows: "6" } });
        editor.value = content;
        const bar = el.createEl("div", { cls: "edge-tutor-edit-bar" });
        const save = bar.createEl("button", { text: "\u4FDD\u5B58", cls: "edge-tutor-mini" });
        const cancel = bar.createEl("button", { text: "\u53D6\u6D88", cls: "edge-tutor-mini" });
        save.addEventListener("click", async () => {
          if (!m.verbatimContent && m.content !== editor.value) m.verbatimContent = m.content;
          m.content = editor.value;
          await this.plugin.saveConv(this.conv);
          this.renderAll();
        });
        cancel.addEventListener("click", () => this.renderAll());
        editor.focus();
      },
      onDelete: () => {
        const modal = new ConfirmModal(this.app, "\u5220\u9664\u8FD9\u6761\u6D88\u606F\uFF1F", "\u5C06\u5220\u9664\u8BE5\u6761\u5BF9\u8BDD\u6D88\u606F\uFF08\u5DF2\u6C89\u6DC0\u7684\u8282\u70B9\u7B14\u8BB0\u4E0D\u53D7\u5F71\u54CD\uFF09\u3002", "\u786E\u8BA4\u5220\u9664");
        modal.onConfirm = () => {
          removeMessage(this.conv, m);
          void this.plugin.saveConv(this.conv);
          this.renderAll();
          this.setStatus("\u5DF2\u5220\u9664\u8BE5\u6761\u6D88\u606F");
        };
        modal.open();
      }
    });
  }
  /** 消息渲染（含编辑按钮，无线程归属则纯展示） */
  appendMessageRaw(opts) {
    const el = this.msgContainer.createEl("div", { cls: `edge-tutor-msg edge-tutor-${opts.role}` });
    if (opts.agent) el.classList.add("edge-tutor-msg-agent");
    if (typeof opts.messageIndex === "number") el.setAttribute("data-msg-index", String(opts.messageIndex));
    const content = el.createEl("div", { cls: "edge-tutor-msg-content" });
    if (opts.agent) content.createEl("div", { text: "\u{1F916} \u6267\u884C\u7ED3\u679C", cls: "edge-tutor-agent-badge" });
    if (opts.guideEntries && opts.guideEntries.length > 0) {
      content.createEl("p", { text: opts.content });
      for (const e of opts.guideEntries) {
        const box = content.createEl("div", { cls: "edge-tutor-entry" });
        const heading = box.createEl("h5");
        const badge = heading.createSpan({
          text: e.type === "deepen" ? "\u{1F53B} \u6DF1\u5316" : "\u{1F195} \u65B0\u57DF",
          cls: "edge-tutor-entry-badge" + (e.type === "deepen" ? " deepen" : "")
        });
        heading.createSpan({ text: `${e.id} ${e.title}` });
        if (e.jiang) heading.createSpan({ text: ` \xB7 ${e.jiang}`, cls: "edge-tutor-entry-meta" });
        const rows = [];
        if (e.type === "deepen" && e.anchorNode) rows.push(["\u951A\u5B9A\u8282\u70B9", `[[${e.anchorNode}]]`]);
        if (e.question) rows.push(["\u4E0B\u4E00\u5835\u5899", e.question]);
        if (e.direction) rows.push(["\u5EF6\u4F38\u65B9\u5411", e.direction]);
        if (e.whyWorthExploring) rows.push(["\u4E3A\u4EC0\u4E48\u503C\u5F97\u8FFD", e.whyWorthExploring]);
        if (e.entryPoint) rows.push(["\u81EA\u7136\u5207\u5165\u53E3", e.entryPoint]);
        if (e.tensions.length) rows.push(["\u5173\u952E\u5F20\u529B", e.tensions.join("\uFF1B")]);
        if (e.connections.length) rows.push(["\u53EF\u8FDE\u63A5", e.connections.join("\uFF1B")]);
        if (e.possibleTrails.length) rows.push(["\u53EF\u80FD\u5C3E\u8FF9", e.possibleTrails.join("\uFF1B")]);
        if (e.anchor) rows.push(["\u6559\u6750\u951A\u70B9", e.anchor]);
        for (const [k, v] of rows) {
          const line = box.createEl("p", { cls: "edge-tutor-entry-row" });
          line.createEl("strong", { text: `${k}\uFF1A` });
          line.createSpan({ text: v });
        }
        const start = box.createEl("button", { text: "\u4ECE\u8FD9\u91CC\u5F00\u59CB\u63A2\u7D22", cls: "edge-tutor-entry-start" });
        start.addEventListener("click", () => {
          if (this.busy) return;
          this.pendingGuide = e;
          this.branchNext = false;
          this.branchOrigin = "";
          this.inputEl.value = e.question || e.title;
          this.inputEl.placeholder = "\u53EF\u4EE5\u6539\u5199\u8FD9\u4E2A\u95EE\u9898\uFF0C\u7136\u540E\u53D1\u9001\u2026";
          this.inputEl.focus();
        });
      }
    } else if (opts.anchor) {
      const src = opts.anchor;
      const quote = opts.anchorQuote;
      if (opts.role === "user") {
        const bq = content.createEl("blockquote", { text: `\u{1F4D6} ${src}` });
        bq.classList.add("edge-tutor-anchor-quote");
        bq.addEventListener("click", () => void this.navigateToTextAnchor(src, quote));
      }
      const mdEl = content.createEl("div", { cls: "edge-tutor-md" });
      void import_obsidian4.MarkdownRenderer.render(this.app, normalizeMath(opts.content), mdEl, this.plugin.settings.textbookRoot, this).then(() => {
        this.attachCitationButtons(mdEl);
        this.attachCodeCopyButtons(mdEl);
      });
      if (opts.role === "assistant") {
        const ctx = el.createEl("div", { cls: "edge-tutor-msg-ctx" });
        ctx.createEl("button", { text: `\u57FA\u4E8E \u{1F4D6} ${src}`, cls: "edge-tutor-msg-ctx-btn", attr: { title: "\u70B9\u51FB\u8DF3\u8F6C\u5230\u539F\u6587\u4F4D\u7F6E" } }).addEventListener("click", () => void this.navigateToTextAnchor(src, quote));
      }
    } else {
      const mdEl = content.createEl("div", { cls: "edge-tutor-md" });
      void import_obsidian4.MarkdownRenderer.render(this.app, normalizeMath(opts.content), mdEl, this.plugin.settings.textbookRoot, this).then(() => {
        this.attachCitationButtons(mdEl);
        this.attachCodeCopyButtons(mdEl);
      });
    }
    if (opts.onEdit || opts.onRegenerate || opts.onDelete) {
      const acts = el.createEl("div", { cls: "edge-tutor-msg-acts" });
      const actBtn = (label, tip, handler, danger = false) => {
        const b = acts.createEl("button", {
          text: label,
          cls: "edge-tutor-msg-act" + (danger ? " danger" : ""),
          attr: { title: tip }
        });
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          void handler();
        });
        return b;
      };
      actBtn("\u{1F4CB} \u590D\u5236", "\u590D\u5236\u8FD9\u6761\u6D88\u606F\u5185\u5BB9", async () => {
        try {
          await navigator.clipboard.writeText(opts.content);
          new import_obsidian4.Notice("\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F");
        } catch (e) {
          console.error("\u590D\u5236\u6D88\u606F\u5931\u8D25", e);
          new import_obsidian4.Notice("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u590D\u5236");
        }
      });
      if (opts.onEdit) {
        actBtn("\u270F\uFE0F \u7F16\u8F91", "\u7F16\u8F91\u8FD9\u6761\u6D88\u606F", () => {
          content.empty();
          opts.onEdit(content, opts.content);
        });
      }
      if (opts.onRegenerate) {
        actBtn("\u{1F504} \u91CD\u65B0\u751F\u6210", "\u91CD\u65B0\u751F\u6210\u8FD9\u6761\u56DE\u7B54\uFF08\u7F51\u7EDC\u6CE2\u52A8/\u56DE\u7B54\u4E0D\u4F73\u65F6\u4F7F\u7528\uFF09", () => opts.onRegenerate());
      }
      if (opts.onDelete) {
        actBtn("\u{1F5D1}\uFE0F \u5220\u9664", "\u5220\u9664\u8FD9\u6761\u6D88\u606F", () => opts.onDelete(), true);
      }
    }
    this.scrollToBottom();
    return el;
  }
  replaceMessage(el, msg) {
    el.remove();
    this.appendMessageRaw(msg);
  }
  /** 扫描回答中的引用标记【📖 文件:行】→ 可点击按钮（跳转教材行） */
  attachCitationButtons(container) {
    var _a;
    const re = /【📖\s*([^】]+?):(\d+)(?:-(\d+))?】/g;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = (_a = node.nodeValue) != null ? _a : "";
      if (!text.includes("\u3010\u{1F4D6}")) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      re.lastIndex = 0;
      let replaced = 0;
      while ((m = re.exec(text)) !== null) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const file = m[1].trim();
        const line = parseInt(m[2], 10);
        const btn = document.createElement("button");
        btn.className = "edge-tutor-cite-btn";
        btn.textContent = `\u{1F4D6} ${file}:${line}`;
        btn.addEventListener("click", () => void this.navigateToTextAnchor(file, "", line));
        frag.appendChild(btn);
        replaced++;
        last = m.index + m[0].length;
      }
      if (replaced > 0) {
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
      }
    }
  }
  /** 代码块 hover 复制按钮（P2-5）：在 MarkdownRenderer.render 完成后调用 */
  attachCodeCopyButtons(container) {
    for (const pre of Array.from(container.querySelectorAll("pre"))) {
      if (pre.querySelector(".edge-tutor-code-copy")) continue;
      const code = pre.querySelector("code");
      if (!code) continue;
      pre.classList.add("edge-tutor-code-block");
      const btn = document.createElement("button");
      btn.className = "edge-tutor-code-copy";
      btn.textContent = "\u{1F4CB}";
      btn.setAttribute("title", "\u590D\u5236\u4EE3\u7801");
      btn.addEventListener("click", async (e) => {
        var _a;
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText((_a = code.textContent) != null ? _a : "");
          new import_obsidian4.Notice("\u5DF2\u590D\u5236\u4EE3\u7801");
        } catch (err) {
          console.error("\u590D\u5236\u4EE3\u7801\u5931\u8D25", err);
          new import_obsidian4.Notice("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u590D\u5236");
        }
      });
      pre.appendChild(btn);
    }
  }
  scrollToBottom() {
    if (this.msgContainer) {
      this.msgContainer.scrollTop = this.msgContainer.scrollHeight;
    }
  }
  /** 滚动到指定消息（data-msg-index），保持其顶部贴合容器顶部（P2-6 懒渲染分页用） */
  scrollToMessageIndex(index) {
    const el = this.msgContainer.querySelector(`[data-msg-index="${index}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cRect = this.msgContainer.getBoundingClientRect();
    this.msgContainer.scrollTop += rect.top - cRect.top;
  }
  /** 确保某条消息在渲染窗口内（P2-6）：不在则调整窗口并重渲染，返回消息元素 */
  async ensureMessageLoaded(messageIndex) {
    let el = this.msgContainer.querySelector(`[data-msg-index="${messageIndex}"]`);
    if (el) return el;
    const msgs = messagesForView(this.conv, this.viewMode);
    if (msgs.length > 100) {
      const pos = msgs.findIndex((m) => this.conv.messages.indexOf(m) === messageIndex);
      if (pos < 0) return null;
      this.loadedStart[this.viewMode] = Math.max(0, pos - 25);
    }
    await this.renderAll();
    return this.msgContainer.querySelector(`[data-msg-index="${messageIndex}"]`);
  }
};
function dropTargetAt(canvas, clientX, clientY) {
  const els = Array.from(canvas.querySelectorAll(".edge-tutor-map-node"));
  for (const n of els) {
    const node = n;
    if (node.classList.contains("dragging")) continue;
    const r = node.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      return node;
    }
  }
  return null;
}
function normalizeMath(text) {
  let out = text;
  out = out.replace(/\\\[[\s\S]*?\\\]/g, (m) => "$$" + m.slice(2, -2).trim() + "$$");
  out = out.replace(/\\\(([^\\]*?)\\\)/g, (m) => "$" + m.slice(2, -2).trim() + "$");
  out = out.replace(/\\\(/g, "$").replace(/\\\)/g, "$");
  out = out.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$");
  return out;
}
var PromptModal = class extends import_obsidian4.Modal {
  constructor(app, title, placeholder = "", initial = "") {
    super(app);
    this.placeholder = placeholder;
    this.initial = initial;
    this.titleEl.setText(title);
  }
  openPrompt() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const input = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: this.placeholder, value: this.initial }
    });
    input.addClass("edge-tutor-prompt-input");
    input.focus();
    input.select();
    const submit = () => {
      const v = input.value.trim();
      this.resolve(v || null);
      this.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") {
        this.resolve(null);
        this.close();
      }
    });
    const btnRow = contentEl.createEl("div", { cls: "edge-tutor-prompt-btns" });
    const okBtn = btnRow.createEl("button", { text: "\u786E\u5B9A", cls: "mod-cta" });
    okBtn.addEventListener("click", submit);
    const cancelBtn = btnRow.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.addEventListener("click", () => {
      this.resolve(null);
      this.close();
    });
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
var ConfirmModal = class extends import_obsidian4.Modal {
  constructor(app, title, text, confirmText = "\u786E\u8BA4\u6E05\u7A7A") {
    super(app);
    this.onConfirm = () => {
    };
    this.text = text;
    this.confirmText = confirmText;
    this.titleEl.setText(title);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("div", { text: this.text, cls: "edge-tutor-scope-desc" });
    const row = contentEl.createEl("div", { cls: "edge-tutor-scope-btns" });
    const ok = row.createEl("button", { text: this.confirmText, cls: "edge-tutor-mini mod-cta" });
    ok.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
    const cancel = row.createEl("button", { text: "\u53D6\u6D88", cls: "edge-tutor-mini" });
    cancel.addEventListener("click", () => this.close());
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
var ClearModal = class extends import_obsidian4.Modal {
  constructor(app, hasUnsaved) {
    super(app);
    this.onBackupAndClear = () => {
    };
    this.onSaveAndClear = () => {
    };
    this.hasUnsaved = hasUnsaved;
    this.titleEl.setText("\u6E05\u7A7A\u5F53\u524D\u5BF9\u8BDD\uFF1F");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("div", {
      text: [
        "\u5C06\u5220\u9664\u5F53\u524D\u5DE5\u4F5C\u533A\u7684\u5168\u90E8\u5BF9\u8BDD\u8BB0\u5F55\u548C\u601D\u7EF4\u5BFC\u56FE\u7ED3\u6784\uFF08.conv.json\uFF09\u3002",
        "\u5DF2\u6C89\u6DC0\u7684\u8282\u70B9\u7B14\u8BB0\uFF08.md \u6587\u4EF6\uFF09\u4E0D\u53D7\u5F71\u54CD\u3002",
        this.hasUnsaved ? "\u26A0\uFE0F \u68C0\u6D4B\u5230\u6700\u8FD1\u7684\u5BF9\u8BDD\u8FD8\u6CA1\u6709\u6C89\u6DC0\u4E3A\u8282\u70B9\u3002" : "",
        "\u65E0\u8BBA\u54EA\u79CD\u65B9\u5F0F\uFF0C\u6E05\u7A7A\u524D\u90FD\u4F1A\u81EA\u52A8\u5BFC\u51FA JSON \u5907\u4EFD\u5230 _exports/\uFF0C\u53EF\u968F\u65F6\u6062\u590D\u3002"
      ].filter(Boolean).join("\n"),
      cls: "edge-tutor-scope-desc"
    });
    const row = contentEl.createEl("div", { cls: "edge-tutor-scope-btns" });
    if (this.hasUnsaved) {
      const save = row.createEl("button", { text: "\u{1F4BE} \u5148\u6C89\u6DC0\u518D\u6E05\u5C4F", cls: "edge-tutor-mini mod-cta" });
      save.addEventListener("click", () => {
        this.onSaveAndClear();
        this.close();
      });
    }
    const backup = row.createEl("button", { text: "\u5907\u4EFD\u5E76\u6E05\u5C4F", cls: "edge-tutor-mini" });
    backup.addEventListener("click", () => {
      this.onBackupAndClear();
      this.close();
    });
    const cancel = row.createEl("button", { text: "\u53D6\u6D88", cls: "edge-tutor-mini" });
    cancel.addEventListener("click", () => this.close());
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
var ScopeModal = class extends import_obsidian4.Modal {
  constructor() {
    super(...arguments);
    /** 模式选择（null=未选，提交时默认混合） */
    this.pendingMode = null;
  }
  openScope() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "\u65B9\u5411\u6307\u5F15\u8BBE\u7F6E" });
    contentEl.createEl("div", {
      text: "\u5148\u9009\u6A21\u5F0F\uFF08\u70B9\u51FB\u9AD8\u4EAE\uFF09\uFF0C\u518D\u9009\u8303\u56F4\u786E\u5B9A\u3002\u4E0D\u9009\u6A21\u5F0F\u5219\u9ED8\u8BA4\u6DF7\u5408\u3002",
      cls: "edge-tutor-scope-desc"
    });
    contentEl.createEl("h4", { text: "\u6A21\u5F0F" });
    const modeRow = contentEl.createEl("div", { cls: "edge-tutor-scope-btns" });
    const mkModeBtn = (text, value) => {
      const b = modeRow.createEl("button", { text, cls: "edge-tutor-mini" });
      b.addEventListener("click", () => {
        this.pendingMode = value;
        modeRow.querySelectorAll("button").forEach((x) => x.removeClass("mod-cta"));
        b.addClass("mod-cta");
      });
      return b;
    };
    mkModeBtn("\u6DF7\u5408\uFF08\u6DF1\u5316+\u65B0\u57DF\uFF09", "mixed");
    mkModeBtn("\u{1F53B} \u6DF1\u5316\u5F53\u524D\u94FE", "deepen");
    mkModeBtn("\u{1F195} \u5168\u4E66\u65B0\u57DF", "frontier");
    contentEl.createEl("h4", { text: "\u8303\u56F4" });
    const row = contentEl.createEl("div", { cls: "edge-tutor-scope-btns" });
    const whole = row.createEl("button", { text: "\u{1F4D6} \u5168\u4E66\u8303\u56F4", cls: "edge-tutor-mini mod-cta" });
    whole.addEventListener("click", () => this.pick("whole"));
    const nearby = row.createEl("button", { text: "\u{1F4CD} \u5F53\u524D\u4F4D\u7F6E\u9644\u8FD1", cls: "edge-tutor-mini" });
    nearby.addEventListener("click", () => this.pick("nearby"));
    const cancel = row.createEl("button", { text: "\u53D6\u6D88", cls: "edge-tutor-mini" });
    cancel.addEventListener("click", () => this.closeResolve(null));
  }
  pick(scope) {
    var _a;
    this.resolve({ scope, mode: (_a = this.pendingMode) != null ? _a : "mixed" });
    this.close();
  }
  closeResolve(v) {
    this.resolve(v);
    this.close();
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};

// src/agentview.ts
var import_obsidian5 = require("obsidian");
var VIEW_TYPE_AGENT = "edge-tutor-agent-view";
function freshAgentConv() {
  return { workspace: "main", tasks: [] };
}
var AgentView = class extends import_obsidian5.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.conv = freshAgentConv();
    this.busy = false;
    this.abort = null;
    /** 当前进行中任务的日志容器（实时追加步骤） */
    this.pendingLogEl = null;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_AGENT;
  }
  getDisplayText() {
    return "\u{1F916} \u6267\u884C\u9762\u677F";
  }
  getIcon() {
    return "terminal";
  }
  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("edge-tutor-panel");
    const header = container.createEl("div", { cls: "edge-tutor-header" });
    header.createEl("div", { text: "\u{1F916} \u6267\u884C\u9762\u677F\uFF08agent\uFF09", cls: "edge-tutor-title" });
    header.createEl("div", {
      text: "\u8F93\u5165\u6307\u4EE4\uFF0Cagent \u5728 vault \u5185\u6267\u884C\u3002\u8BB0\u5F55\u72EC\u7ACB\u5B58\u50A8\uFF0C\u4E0D\u8FDB\u5165\u5BF9\u8BDD\u3002",
      cls: "edge-tutor-subtitle"
    });
    this.msgContainer = container.createEl("div", { cls: "edge-tutor-messages" });
    const inputRow = container.createEl("div", { cls: "edge-tutor-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "edge-tutor-input",
      attr: { placeholder: "\u6307\u4EE4\uFF1Aagent \u6267\u884C\uFF08\u5982\uFF1A\u6574\u7406\u67D0\u76EE\u5F55\u3001\u751F\u6210\u7D22\u5F15\u3001\u6C89\u6DC0\u8282\u70B9\uFF09\u2026\uFF08Enter \u6267\u884C\uFF0CShift+Enter \u6362\u884C\uFF09", rows: "3" }
    });
    this.sendBtn = inputRow.createEl("button", { text: "\u6267\u884C", cls: "edge-tutor-send" });
    this.sendBtn.addEventListener("click", () => {
      if (this.busy && this.abort) {
        this.abort.abort();
        return;
      }
      void this.runTask();
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendBtn.click();
      }
    });
    const tools = container.createEl("div", { cls: "edge-tutor-tools" });
    const clearBtn = tools.createEl("button", { text: "\u{1F5D1} \u6E05\u7A7A\u6267\u884C\u8BB0\u5F55", cls: "edge-tutor-btn" });
    clearBtn.addEventListener("click", () => {
      this.conv.tasks = [];
      void this.plugin.saveAgentConv(this.conv);
      this.renderAll();
      new import_obsidian5.Notice("\u5DF2\u6E05\u7A7A\u6267\u884C\u8BB0\u5F55");
    });
    this.statusBar = container.createEl("div", { cls: "edge-tutor-status" });
    const ws = this.plugin.currentWorkspace();
    this.statusBar.setText(
      ws && ws !== "main" ? `\u5F53\u524D\u8BA4\u77E5\u5DE5\u4F5C\u533A\uFF1A${ws}\uFF08agent \u6C89\u6DC0\u8282\u70B9\u5C06\u5199\u5165\u8BE5\u5DE5\u4F5C\u533A\uFF09` : "\u5F53\u524D\u8BA4\u77E5\u5DE5\u4F5C\u533A\uFF1A\u9ED8\u8BA4\uFF08\u8BA4\u77E5\u8FB9\u7F18\u6839\u76EE\u5F55\uFF09"
    );
    try {
      this.conv = await this.plugin.loadAgentConv();
      let marked = false;
      for (const t of this.conv.tasks) {
        if (t.running) {
          t.running = false;
          t.status = "stopped";
          t.error = void 0;
          marked = true;
        }
      }
      if (marked) {
        await this.plugin.saveAgentConv(this.conv);
      }
    } catch (e) {
      this.conv = freshAgentConv();
    }
    this.renderAll();
  }
  async onClose() {
    await this.plugin.saveAgentConv(this.conv);
    this.contentEl.empty();
  }
  /** ===== 渲染 ===== */
  renderAll() {
    this.msgContainer.empty();
    if (this.conv.tasks.length === 0) {
      const el = this.msgContainer.createEl("div", { cls: "edge-tutor-msg edge-tutor-assistant" });
      el.createEl("div", {
        cls: "edge-tutor-msg-content",
        text: "\u8FD8\u6CA1\u6709\u6267\u884C\u8BB0\u5F55\u3002\u8F93\u5165\u6307\u4EE4\u5F00\u59CB\uFF0C\u4F8B\u5982\uFF1A\n\n- \u628A\u5F53\u524D\u5DE5\u4F5C\u533A\u7684\u5BF9\u8BDD\u6574\u7406\u6210\u8BA4\u77E5\u8282\u70B9\u5E76\u6302\u5230\u5730\u56FE\n- \u626B\u63CF\u67D0\u76EE\u5F55\u4E0B\u6240\u6709 md \u6587\u4EF6\u751F\u6210 MOC \u7D22\u5F15\n- \u641C\u7D22\u5305\u542B\u300Cxxx\u300D\u7684\u7B14\u8BB0\u5E76\u6C47\u603B"
      });
      return;
    }
    for (const task of [...this.conv.tasks].reverse()) {
      this.renderTask(task);
    }
  }
  renderTask(task) {
    const el = this.msgContainer.createEl("div", { cls: "edge-tutor-msg edge-tutor-user edge-tutor-msg-agent" });
    el.setAttribute("data-task-id", task.id);
    const content = el.createEl("div", { cls: "edge-tutor-msg-content" });
    const head = content.createEl("div", { cls: "edge-tutor-agent-task-head" });
    const time = new Date(task.ts).toLocaleString("zh-CN", { hour12: false });
    head.createEl("span", { text: `\u{1F916} ${time}`, cls: "edge-tutor-agent-badge" });
    head.createEl("span", {
      text: task.running ? " \u23F3 \u6267\u884C\u4E2D" : task.status === "done" ? " \u2705 \u5B8C\u6210" : task.status === "error" ? " \u26A0\uFE0F \u5931\u8D25" : task.status === "stopped" ? " \u23F9 \u5DF2\u505C\u6B62" : "",
      cls: "edge-tutor-agent-badge"
    });
    content.createEl("div", { text: task.input, cls: "edge-tutor-agent-task-input" });
    const log = content.createEl("div", { cls: "edge-tutor-agent-log" });
    if (task.steps.length === 0 && task.running) {
      log.createEl("div", { text: "\u23F3 \u6B63\u5728\u5206\u6790\u4EFB\u52A1\u2026", cls: "edge-tutor-agent-log-line" });
    }
    for (const st of task.steps) {
      const args = st.args.length > 100 ? st.args.slice(0, 100) + "\u2026" : st.args;
      log.createEl("div", { text: `\u7B2C${st.turn}\u8F6E \u2192 ${st.name}(${args})`, cls: "edge-tutor-agent-log-line" });
      const summary = st.result.split("\n").filter(Boolean).slice(0, 3).join(" ");
      log.createEl("div", { text: `   \u21B3 ${summary.slice(0, 140)}`, cls: "edge-tutor-agent-log-line" });
    }
    if (task.status === "error" && task.error) {
      content.createEl("div", { text: `\u26A0\uFE0F ${task.error}`, cls: "edge-tutor-agent-task-error" });
    } else if (task.answer) {
      const mdEl = content.createEl("div", { cls: "edge-tutor-md" });
      void import_obsidian5.MarkdownRenderer.render(this.app, task.answer, mdEl, "", this);
    }
    this.scrollToBottom();
  }
  /** 执行任务 */
  async runTask() {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    this.inputEl.value = "";
    this.busy = true;
    this.sendBtn.setText("\u505C\u6B62");
    this.sendBtn.disabled = false;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const task = {
      id: "t" + Date.now().toString(36),
      ts: Date.now(),
      input: text,
      running: true,
      status: "done",
      steps: [],
      answer: ""
    };
    this.conv.tasks.push(task);
    await this.plugin.saveAgentConv(this.conv);
    this.renderAll();
    this.setStatus("\u23F3 \u6267\u884C\u4E2D\u2026");
    const taskEl = this.msgContainer.querySelector(`[data-task-id="${task.id}"] .edge-tutor-agent-log`);
    this.pendingLogEl = taskEl instanceof HTMLElement ? taskEl : null;
    const appendStepLog = (name, args, result) => {
      if (!this.pendingLogEl) return;
      const a = args.length > 100 ? args.slice(0, 100) + "\u2026" : args;
      this.pendingLogEl.createEl("div", { text: `\u7B2C${task.steps.length}\u8F6E \u2192 ${name}(${a})`, cls: "edge-tutor-agent-log-line" });
      const summary = result.split("\n").filter(Boolean).slice(0, 3).join(" ");
      this.pendingLogEl.createEl("div", { text: `   \u21B3 ${summary.slice(0, 140)}`, cls: "edge-tutor-agent-log-line" });
      this.scrollToBottom();
    };
    const t0 = Date.now();
    const timer = setInterval(() => {
      this.setStatus(`\u23F3 \u8FD0\u884C\u4E2D ${Math.floor((Date.now() - t0) / 1e3)}s\u2026\uFF08\u6B65\u9AA4 ${task.steps.length} \u4E2A\uFF09`);
    }, 1e3);
    try {
      const result = await this.plugin.runAgentTask(text, {
        signal,
        onStep: (step) => {
          const raw = typeof step.call.arguments === "string" ? step.call.arguments : JSON.stringify(step.call.arguments);
          task.steps.push({ turn: step.turn, name: step.call.name, args: raw, result: step.result });
          appendStepLog(step.call.name, raw, step.result);
          void this.plugin.saveAgentConv(this.conv);
        }
      });
      task.answer = result.answer;
      task.status = "done";
      task.running = false;
      await this.plugin.saveAgentConv(this.conv);
      this.renderAll();
      this.setStatus(`\u5B8C\u6210\uFF08${result.turns} \u8F6E\uFF0C\u5DE5\u5177\uFF1A${result.toolsUsed.length ? result.toolsUsed.join("\u3001") : "\u65E0"}\uFF09`);
    } catch (e) {
      task.running = false;
      if (signal.aborted) {
        task.status = "stopped";
        task.error = void 0;
        task.answer = "\u23F9 \u5DF2\u505C\u6B62\u6267\u884C\u3002";
      } else {
        task.status = "error";
        task.error = e.message.slice(0, 250);
      }
      await this.plugin.saveAgentConv(this.conv);
      this.renderAll();
      this.setStatus(task.status === "stopped" ? "\u5DF2\u505C\u6B62" : "\u6267\u884C\u5931\u8D25");
    } finally {
      clearInterval(timer);
      this.pendingLogEl = null;
      this.abort = null;
      this.busy = false;
      this.sendBtn.setText("\u6267\u884C");
      this.sendBtn.disabled = false;
    }
  }
  setStatus(text) {
    this.statusBar.setText(text);
  }
  scrollToBottom() {
    if (this.msgContainer) {
      this.msgContainer.scrollTop = this.msgContainer.scrollHeight;
    }
  }
};

// src/main.ts
var _EdgeTutorPlugin = class _EdgeTutorPlugin extends import_obsidian6.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    /**
     * 教材检索（语义版）：委托 opencode 在教材目录定位原文，结构化引用返回。
     * - 会话级缓存（query 归一化 + LRU 10 条）：同主题追问 <1s
     * - opencode 全量语义检索（20s 超时），失败/超时降级本地 grep
     * - 结果只提供给问答模型（respond 注入 system），不落盘、不显示
     */
    this.searchCache = /* @__PURE__ */ new Map();
    /** 章节地图缓存（toc.md → 讲次标题列表） */
    this.chapterIndex = null;
  }
  async onload() {
    await this.loadSettings();
    await this.runMigration();
    this.registerView(VIEW_TYPE_TUTOR, (leaf) => new TutorView(leaf, this));
    this.registerView(VIEW_TYPE_AGENT, (leaf) => new AgentView(leaf, this));
    this.addCommand({
      id: "open-tutor-panel",
      name: "\u{1F9ED} \u6253\u5F00\u8BA4\u77E5\u8FB9\u7F18\u5BFC\u5E08\u9762\u677F",
      callback: () => {
        this.activateView();
      }
    });
    this.addCommand({
      id: "open-agent-panel",
      name: "\u{1F916} \u6253\u5F00\u6267\u884C\u9762\u677F\uFF08agent\uFF09",
      callback: () => {
        this.activateAgentView();
      }
    });
    this.addCommand({
      id: "rebuild-conv-from-nodes",
      name: "\u4ECE\u8282\u70B9\u6587\u4EF6\u91CD\u5EFA\u4F1A\u8BDD\uFF08\u5F53\u524D\u5DE5\u4F5C\u533A\uFF09",
      callback: async () => {
        const rebuilt = await this.rebuildConvFromNodes();
        if (rebuilt) {
          new import_obsidian6.Notice(`\u5DF2\u4ECE ${rebuilt.reading.threads.length} \u4E2A\u8282\u70B9\u91CD\u5EFA\u4F1A\u8BDD`);
          const view = this.getTutorView();
          if (view) await view.reloadFromConv(rebuilt);
        } else {
          new import_obsidian6.Notice("\u5F53\u524D\u5DE5\u4F5C\u533A\u6CA1\u6709\u8282\u70B9\u6587\u4EF6\u53EF\u91CD\u5EFA");
        }
      }
    });
    this.addCommand({
      id: "ask-from-selection",
      name: "\u7531\u6B64\u8FFD\u95EE\uFF08\u9009\u4E2D\u6559\u6750\u6587\u672C \u2192 \u9762\u677F\uFF09",
      checkCallback: (checking) => {
        var _a, _b, _c, _d;
        const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
        const selection = (_c = (_b = (_a = view == null ? void 0 : view.editor) == null ? void 0 : _a.getSelection) == null ? void 0 : _b.call(_a)) != null ? _c : "";
        if (!selection) return false;
        if (!checking) this.askFromSelection(selection, (_d = view == null ? void 0 : view.file) == null ? void 0 : _d.path);
        return true;
      }
    });
    this.addCommand({
      id: "open-cognitive-map",
      name: "\u6253\u5F00\u8BA4\u77E5\u8FB9\u7F18\u5730\u56FE\uFF08MOC\uFF09",
      callback: async () => {
        await this.openMoc();
      }
    });
    this.addCommand({
      id: "export-workspace-md",
      name: "\u{1F4E4} \u5BFC\u51FA\u5F53\u524D\u5DE5\u4F5C\u533A\u4E3A Markdown \u7B14\u8BB0",
      callback: async () => {
        await this.exportWorkspace("markdown");
      }
    });
    this.addCommand({
      id: "export-workspace-json",
      name: "\u{1F4E6} \u5BFC\u51FA\u5F53\u524D\u5DE5\u4F5C\u533A\u4E3A JSON \u5907\u4EFD",
      callback: async () => {
        await this.exportWorkspace("json");
      }
    });
    this.addCommand({
      id: "import-workspace-json",
      name: "\u{1F4E5} \u5BFC\u5165 JSON \u5907\u4EFD\uFF08\u6062\u590D\u8BA4\u77E5\u8282\u70B9\uFF09",
      callback: async () => {
        await this.importWorkspaceJson();
      }
    });
    this.addRibbonIcon("compass", "\u{1F9ED} \u8BA4\u77E5\u8FB9\u7F18\u5BFC\u5E08", () => {
      this.activateView();
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selection = editor.getSelection();
        if (selection) {
          menu.addItem((item) => {
            item.setTitle("\u{1F50D} \u7531\u6B64\u8FFD\u95EE\uFF08\u8BA4\u77E5\u8FB9\u7F18\u5BFC\u5E08\uFF09").setIcon("help").onClick(async () => {
              var _a;
              const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
              await this.askFromSelection(selection, (_a = view == null ? void 0 : view.file) == null ? void 0 : _a.path);
            });
          });
        }
      })
    );
    this.addSettingTab(new EdgeTutorSettingTab(this.app, this));
  }
  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TUTOR);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** ===== 迁移：旧 .conv.json 的线程 → 节点 .md（一次性） ===== */
  async runMigration() {
    var _a, _b, _c, _d, _e;
    if (this.settings.migrated) return;
    try {
      let migratedAny = false;
      const workspaces = await this.discoverWorkspaces();
      for (const ws of workspaces) {
        const path = convPath(this.settings.nodeFolder, ws);
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof import_obsidian6.TFile)) continue;
        const parsed = parseConv(await this.app.vault.cachedRead(f));
        if (!parsed) continue;
        const legacy = (_a = parsed.reading) == null ? void 0 : _a.threads;
        if (Array.isArray(legacy) && legacy.length > 0) {
          await this.ensureFolder(this.workspaceFolderPathOf(ws));
          const folder = this.workspaceFolderPathOf(ws);
          for (const t of legacy) {
            if (!t || typeof t.title !== "string") continue;
            const node = {
              title: t.title,
              content: "",
              parentTitle: void 0,
              anchor: { sourcePath: (_c = (_b = t.anchor) == null ? void 0 : _b.sourcePath) != null ? _c : "", quote: (_e = (_d = t.anchor) == null ? void 0 : _d.quote) != null ? _e : "" },
              status: t.status === "paused" ? "paused" : "active",
              rootQuestion: t.rootQuestion || t.title,
              summary: t.summary
            };
            node.content = buildNodeContent(node);
            const pathN = uniqueNodePath(this.app, folder, node.title);
            await this.app.vault.create(pathN, node.content);
          }
          migratedAny = true;
        }
      }
      if (migratedAny) {
        new import_obsidian6.Notice("\u5DF2\u4ECE\u65E7\u7248\u4F1A\u8BDD\u8FC1\u79FB\u8BA4\u77E5\u7EBF\u7A0B\u5230\u8282\u70B9\u6587\u4EF6");
      }
      this.settings.migrated = true;
      await this.saveSettings();
    } catch (e) {
      console.warn("edge-tutor \u8FC1\u79FB\u5931\u8D25\uFF08\u8DF3\u8FC7\uFF09", e);
    }
  }
  /** 激活右侧面板 */
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TUTOR);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new import_obsidian6.Notice("\u65E0\u6CD5\u6253\u5F00\u53F3\u4FA7\u9762\u677F");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_TUTOR, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  /** 获取面板实例 */
  getTutorView() {
    var _a, _b;
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TUTOR);
    return (_b = (_a = leaves[0]) == null ? void 0 : _a.view) != null ? _b : null;
  }
  /** 激活执行面板 */
  async activateAgentView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new import_obsidian6.Notice("\u65E0\u6CD5\u6253\u5F00\u6267\u884C\u9762\u677F");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_AGENT, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  /** 选中文本 → 发送到面板 */
  async askFromSelection(selection, sourcePath) {
    await this.activateView();
    const view = this.getTutorView();
    if (!view) {
      new import_obsidian6.Notice("\u9762\u677F\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u8BD5");
      return;
    }
    view.receiveSelection(selection, sourcePath);
  }
  /** 当前工作区（面板视图可能缓存；这里以面板为准） */
  currentWorkspace() {
    const view = this.getTutorView();
    return view ? view.currentWorkspace : "main";
  }
  /** 获取当前编辑文件的锚点 */
  getAnchor() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!(view == null ? void 0 : view.file)) return null;
    return {
      sourcePath: view.file.path,
      quote: view.editor.getSelection() || ""
    };
  }
  /** 获取当前正在阅读的教材位置；面板成为 active view 时仍能找到最近的教材页。 */
  getCurrentReadingAnchor() {
    var _a;
    const root = this.settings.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const activeFile = this.app.workspace.getActiveFile();
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const candidates = leaves.map((leaf) => leaf.view).filter((view2) => view2 instanceof import_obsidian6.MarkdownView && !!view2.file).filter((view2) => {
      const path = view2.file.path.replace(/\\/g, "/");
      return path === root || path.startsWith(root + "/");
    });
    const view = (_a = activeFile && candidates.find((candidate) => {
      var _a2;
      return ((_a2 = candidate.file) == null ? void 0 : _a2.path) === activeFile.path;
    })) != null ? _a : candidates[0];
    if (!(view == null ? void 0 : view.file)) return null;
    const selection = view.editor.getSelection().trim();
    const cursor = view.editor.getCursor();
    const line = view.editor.getLine(cursor.line).trim();
    return {
      sourcePath: view.file.path,
      quote: (selection || line).slice(0, 240)
    };
  }
  /** 工作区节点目录路径 */
  workspaceFolderPathOf(workspace) {
    return workspaceFolderPath(this.settings.nodeFolder, workspace);
  }
  /**
   * 发现所有工作区（两级）：
   *   - 教材容器（一级目录含子文件夹或直接节点）→ 教材根 = 教材名（main 角色），子文件夹 = 教材名/子工作区名
   *   - 普通工作区（无子文件夹的一级目录）→ 工作区名
   *   - 节点目录根的直接节点 → main
   */
  async discoverWorkspaces() {
    const root = this.app.vault.getAbstractFileByPath(this.settings.nodeFolder);
    const ws = [];
    if (!(root instanceof import_obsidian6.TFolder)) return ws;
    const rootHasNodes = root.children.some(
      (c) => c instanceof import_obsidian6.TFile && c.name.endsWith(".md") && !c.name.startsWith(".") && c.name !== "\u8BA4\u77E5\u8FB9\u7F18\u5730\u56FE.md"
    );
    if (rootHasNodes) ws.push("main");
    for (const child of root.children) {
      if (!(child instanceof import_obsidian6.TFolder)) continue;
      if (_EdgeTutorPlugin.SPECIAL_FOLDERS.has(child.name)) continue;
      const subFolders = child.children.filter((c) => c instanceof import_obsidian6.TFolder);
      const directNodes = child.children.some(
        (c) => c instanceof import_obsidian6.TFile && c.name.endsWith(".md") && !c.name.startsWith(".") && c.name !== "\u8BA4\u77E5\u8FB9\u7F18\u5730\u56FE.md"
      );
      if (subFolders.length > 0 || directNodes) {
        ws.push(child.name);
        for (const sub of subFolders) {
          if (sub.name === "images") continue;
          ws.push(`${child.name}/${sub.name}`);
        }
      }
    }
    return [...new Set(ws)];
  }
  /** 读取教材总目录内容 */
  async readToc() {
    const tocCandidates = [
      `${this.settings.textbookRoot}/toc.md`,
      `${this.settings.textbookRoot}/\u8003\u7814\u6570\u5B6630\u8BB2_\u603B\u76EE\u5F55.md`
    ];
    for (const tocPath of tocCandidates) {
      const f = this.app.vault.getAbstractFileByPath(tocPath);
      if (f instanceof import_obsidian6.TFile) {
        return await this.app.vault.cachedRead(f);
      }
    }
    const root = this.app.vault.getAbstractFileByPath(this.settings.textbookRoot);
    if (root instanceof import_obsidian6.TFolder) {
      return root.children.filter((c) => c instanceof import_obsidian6.TFile && c.name.endsWith(".md")).map((c) => `- [[${c.basename}]]`).join("\n");
    }
    return "\uFF08\u65E0\u6CD5\u8BFB\u53D6\u6559\u6750\u76EE\u5F55\uFF09";
  }
  /** 认知地图摘要（供方向指引） */
  async buildMapSummary() {
    const ws = this.currentWorkspace();
    const nodes = await listNodes(this.app, this.workspaceFolderPathOf(ws));
    const summary = await buildMapSummary(this.app, this.workspaceFolderPathOf(ws), nodes);
    return summary;
  }
  /** 列出某工作区节点（供 MOC 更新） */
  async listNodes(workspace) {
    const ws = workspace != null ? workspace : this.currentWorkspace();
    return listNodes(this.app, this.workspaceFolderPathOf(ws));
  }
  /** 创建认知节点笔记（冲突自动加序号） */
  async createNode(node) {
    var _a;
    const ws = (_a = node.workspace) != null ? _a : this.currentWorkspace();
    const folder = this.workspaceFolderPathOf(ws);
    await this.ensureFolder(folder);
    const path = uniqueNodePath(this.app, folder, node.title);
    const content = node.content || buildNodeContent(node);
    const f = await this.app.vault.create(path, content);
    await this.updateMoc(ws);
    return f;
  }
  /** 更新认知地图 MOC（按工作区；只收工作区直接节点，不递归子工作区） */
  async updateMoc(workspace) {
    const ws = workspace != null ? workspace : this.currentWorkspace();
    const folder = this.workspaceFolderPathOf(ws);
    await this.ensureFolder(folder);
    const mocPath = `${folder}/\u8BA4\u77E5\u8FB9\u7F18\u5730\u56FE.md`;
    const folderObj = this.app.vault.getAbstractFileByPath(folder);
    const nodes = [];
    if (folderObj instanceof import_obsidian6.TFolder) {
      for (const f of folderObj.children) {
        if (!(f instanceof import_obsidian6.TFile) || !f.name.endsWith(".md")) continue;
        if (f.name.startsWith(".") || f.name === "\u8BA4\u77E5\u8FB9\u7F18\u5730\u56FE.md") continue;
        const content2 = await this.app.vault.cachedRead(f);
        nodes.push(parseNodeFromContent(f.basename, content2, f.path));
      }
    }
    const content = buildMocContent(nodes);
    const existing = this.app.vault.getAbstractFileByPath(mocPath);
    if (existing instanceof import_obsidian6.TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(mocPath, content);
    }
  }
  /** 打开 MOC */
  async openMoc() {
    const ws = this.currentWorkspace();
    const folder = this.workspaceFolderPathOf(ws);
    const mocPath = `${folder}/\u8BA4\u77E5\u8FB9\u7F18\u5730\u56FE.md`;
    const f = this.app.vault.getAbstractFileByPath(mocPath);
    if (f instanceof import_obsidian6.TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(f);
    } else {
      new import_obsidian6.Notice("\u8BA4\u77E5\u5730\u56FE\u8FD8\u4E0D\u5B58\u5728 \u2014\u2014 \u5148\u5728\u9762\u677F\u91CC\u6C89\u6DC0\u5BF9\u8BDD");
    }
  }
  /** 新建工作区（子文件夹；当前在教材下则归入该教材容器，教材根也归入教材） */
  async createWorkspace(name) {
    const clean = name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
    if (!clean) return;
    const cur = this.currentWorkspace();
    const slash = cur.indexOf("/");
    const bookPrefix = slash > 0 ? cur.slice(0, slash + 1) : cur !== "main" ? cur + "/" : "";
    await this.ensureFolder(this.workspaceFolderPathOf(bookPrefix + clean));
  }
  /** 重命名工作区（移动文件夹） */
  async renameWorkspace(oldName, newName) {
    const oldPath = this.workspaceFolderPathOf(oldName);
    const newPath = this.workspaceFolderPathOf(newName);
    const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
    if (oldFolder instanceof import_obsidian6.TFolder) {
      try {
        await this.app.vault.rename(oldFolder, newPath);
      } catch (e) {
        new import_obsidian6.Notice("\u91CD\u547D\u540D\u5931\u8D25\uFF1A" + e.message.slice(0, 80));
      }
    }
  }
  /**
   * 三处同步删除：线程 + 消息 + 节点文件（回收站）。
   * 供导图「🗑️ 删除」与「粘贴后删除源」使用。
   */
  async deleteThreadsWithFiles(workspace, threadIds) {
    const ids = new Set(threadIds);
    if (ids.size === 0) return 0;
    const conv = await this.loadConv(workspace);
    let deleted = 0;
    const titles = [];
    const threads = conv.reading.threads.filter((t) => ids.has(t.id));
    for (const t of threads) {
      titles.push(t.title || t.rootQuestion || "");
      conv.reading.threads = conv.reading.threads.filter((x) => x.id !== t.id);
      deleted++;
    }
    conv.messages = conv.messages.filter((m) => !(m.lineId && ids.has(m.lineId)));
    if (conv.reading.activeId && ids.has(conv.reading.activeId)) {
      conv.reading.activeId = conv.reading.threads.length ? conv.reading.threads[0].id : null;
    }
    await this.saveConv(conv);
    const folder = this.workspaceFolderPathOf(workspace);
    for (const title of titles) {
      if (!title) continue;
      const f = this.app.vault.getAbstractFileByPath(`${folder}/${title}.md`);
      if (f instanceof import_obsidian6.TFile) {
        try {
          await this.app.vault.trash(f, true);
        } catch (e) {
          console.warn("[edge-tutor] \u8282\u70B9\u6587\u4EF6\u5220\u9664\u5931\u8D25", title, e);
        }
      }
    }
    return deleted;
  }
  /** 加载工作区会话（conv）—— 用 adapter 直接读，避免 Obsidian 隐藏文件索引问题 */
  async loadConv(workspace) {
    const path = convPath(this.settings.nodeFolder, workspace);
    try {
      const exists = await this.app.vault.adapter.exists(path);
      if (exists) {
        const text = await this.app.vault.adapter.read(path);
        const parsed = parseConv(text);
        if (parsed) return parsed;
        console.warn("[edge-tutor] loadConv \u89E3\u6790\u5931\u8D25\uFF0C\u5C1D\u8BD5 .bak \u6062\u590D", path);
      }
    } catch (e) {
      console.warn("[edge-tutor] loadConv \u5931\u8D25", path, e);
    }
    try {
      const backupPath = path + ".bak";
      if (await this.app.vault.adapter.exists(backupPath)) {
        const text = await this.app.vault.adapter.read(backupPath);
        const parsed = parseConv(text);
        if (parsed) {
          console.warn("[edge-tutor] loadConv \u5DF2\u4ECE .bak \u6062\u590D", path);
          return parsed;
        }
      }
    } catch (e) {
      console.warn("[edge-tutor] loadConv .bak \u4E5F\u5931\u8D25", e);
    }
    return freshConv(workspace);
  }
  /** 保存工作区会话（conv）—— 用 adapter 直接写，隐藏文件也能写 */
  async saveConv(conv) {
    const folder = this.workspaceFolderPathOf(conv.workspace);
    await this.ensureFolder(folder);
    const path = convPath(this.settings.nodeFolder, conv.workspace);
    const content = serializeConv(conv);
    try {
      const backupPath = path + ".bak";
      try {
        if (await this.app.vault.adapter.exists(path)) {
          const prev = await this.app.vault.adapter.read(path);
          await this.app.vault.adapter.write(backupPath, prev);
        }
      } catch (be) {
      }
      await this.app.vault.adapter.write(path, content);
    } catch (e) {
      console.warn("[edge-tutor] saveConv adapter \u5931\u8D25\uFF0C\u9000\u56DE vault API", e);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof import_obsidian6.TFile) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(path, content);
      }
    }
  }
  /** 导出当前工作区（markdown 树形大纲 / JSON 完整会话） */
  async exportWorkspace(format) {
    const ws = this.currentWorkspace();
    const conv = await this.loadConv(ws);
    const hasContent = conv.messages.length > 0 || conv.reading.threads.length > 0;
    if (!hasContent) {
      new import_obsidian6.Notice("\u5F53\u524D\u5DE5\u4F5C\u533A\u6CA1\u6709\u4F1A\u8BDD\u53EF\u5BFC\u51FA");
      return;
    }
    const exportFolder = "learning/peizhi/learn/_wiki/\u8BA4\u77E5\u8FB9\u7F18/_exports";
    await this.ensureFolder(exportFolder);
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const safeWs = ws.replace(/[/\\]/g, "_");
    if (format === "markdown") {
      const md = formatConvMarkdown(conv, {
        title: `\u8BA4\u77E5\u8FB9\u7F18\u4F1A\u8BDD\u5BFC\u51FA\uFF08${ws === "main" ? "\u9ED8\u8BA4" : ws}\uFF09`,
        source: "\u5F20\u5B87\u57FA\u784030\u8BB2",
        workspace: ws
      });
      const path = `${exportFolder}/\u8BA4\u77E5\u8FB9\u7F18\u5BFC\u51FA_${safeWs}_${stamp}.md`;
      await this.writeUnique(exportFolder, path, md);
      new import_obsidian6.Notice("\u{1F4E4} Markdown \u7B14\u8BB0\u5DF2\u5BFC\u51FA\uFF1A" + path);
    } else {
      const json = serializeConv(conv);
      const path = `${exportFolder}/\u8BA4\u77E5\u8FB9\u7F18\u5907\u4EFD_${safeWs}_${stamp}.json`;
      await this.writeUnique(exportFolder, path, json);
      new import_obsidian6.Notice("\u{1F4E6} JSON \u5907\u4EFD\u5DF2\u5BFC\u51FA\uFF1A" + path);
    }
  }
  /** 导入 JSON 备份（恢复认知节点） */
  async importWorkspaceJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      var _a;
      try {
        const file = (_a = input.files) == null ? void 0 : _a[0];
        if (!file) return;
        const text = await file.text();
        const { nodes, meta } = parseJSONBackup(text);
        if (nodes.length === 0) {
          new import_obsidian6.Notice("\u5907\u4EFD\u89E3\u6790\u5931\u8D25\u6216\u6CA1\u6709\u8282\u70B9");
          return;
        }
        const targetWs = (meta == null ? void 0 : meta.workspace) && meta.workspace !== "main" ? meta.workspace : "main";
        const folder = this.workspaceFolderPathOf(targetWs);
        await this.ensureFolder(folder);
        let count = 0;
        for (const n of nodes) {
          const path = uniqueNodePath(this.app, folder, n.title);
          await this.app.vault.create(path, n.content || buildNodeContent(n));
          count++;
        }
        await this.updateMoc(targetWs);
        new import_obsidian6.Notice(`\u{1F4E5} \u5DF2\u5BFC\u5165 ${count} \u4E2A\u8BA4\u77E5\u8282\u70B9\u5230\u5DE5\u4F5C\u533A\u300C${targetWs}\u300D`);
      } catch (e) {
        new import_obsidian6.Notice("\u5BFC\u5165\u5931\u8D25\uFF1A" + e.message.slice(0, 100));
      }
    };
    input.click();
  }
  /** 写入文件（冲突自动加序号） */
  async writeUnique(folder, path, content) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!(existing instanceof import_obsidian6.TFile)) {
      await this.app.vault.create(path, content);
      return;
    }
    const dot = path.lastIndexOf(".");
    const base = dot > 0 ? path.slice(0, dot) : path;
    const ext = dot > 0 ? path.slice(dot) : "";
    const stamp = Date.now().toString(36);
    await this.app.vault.create(`${base}_${stamp}${ext}`, content);
  }
  /** 递归确保文件夹存在 */
  async ensureFolder(path) {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!(this.app.vault.getAbstractFileByPath(cur) instanceof import_obsidian6.TFolder)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch (e) {
        }
      }
    }
  }
  /** 工作区目录（供 view 用） */
  workspaceFolder(workspace) {
    return this.workspaceFolderPathOf(workspace);
  }
  /** 递归确保文件夹存在（公开，供 view 用） */
  async ensureFolderPublic(path) {
    await this.ensureFolder(path);
  }
  /** 执行面板 agent 记录文件路径（vault 内，隐藏文件） */
  agentConvPath() {
    return `${this.settings.nodeFolder.replace(/\/+$/, "")}/.agent-conv.json`;
  }
  /** 加载执行面板记录 */
  async loadAgentConv() {
    const path = this.agentConvPath();
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const text = await this.app.vault.adapter.read(path);
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.tasks)) {
          return { workspace: parsed.workspace || "main", tasks: parsed.tasks };
        }
      }
    } catch (e) {
      console.warn("[edge-tutor] loadAgentConv \u5931\u8D25", e);
    }
    return freshAgentConv();
  }
  /** 保存执行面板记录 */
  async saveAgentConv(conv) {
    const path = this.agentConvPath();
    try {
      await this.ensureFolder(this.settings.nodeFolder);
      await this.app.vault.adapter.write(path, JSON.stringify(conv, null, 2));
    } catch (e) {
      console.warn("[edge-tutor] saveAgentConv \u5931\u8D25", e);
    }
  }
  /**
   * 从节点文件重建会话（conv）：
   * 节点 .md 是单一数据源，会话为空时（清屏/迁移）用它恢复线程树与消息。
   * 只读当前工作区的直接节点（不递归子工作区）。
   */
  async rebuildConvFromNodes(workspace) {
    const ws = workspace != null ? workspace : this.currentWorkspace();
    const folder = this.app.vault.getAbstractFileByPath(this.workspaceFolderPathOf(ws));
    if (!(folder instanceof import_obsidian6.TFolder)) return null;
    const files = folder.children.filter(
      (f) => f instanceof import_obsidian6.TFile && f.name.endsWith(".md") && !f.name.startsWith(".") && f.name !== "\u8BA4\u77E5\u8FB9\u7F18\u5730\u56FE.md"
    );
    if (files.length === 0) return null;
    const nodes = [];
    for (const f of files) {
      const content = await this.app.vault.cachedRead(f);
      nodes.push(parseNodeFromContent(f.basename, content, f.path));
    }
    return buildConvFromNodes(nodes, ws);
  }
  /**
   * 设置节点封顶标记（🔒）：同步写入节点 frontmatter（持久化，重建会话时恢复）。
   * 节点文件不存在时仅返回 false（不强制）。
   */
  async setNodeLocked(workspace, title, locked) {
    const folder = this.workspaceFolderPathOf(workspace);
    const f = this.app.vault.getAbstractFileByPath(`${folder}/${title}.md`);
    if (!(f instanceof import_obsidian6.TFile)) return false;
    try {
      const content = await this.app.vault.read(f);
      const hasLocked = /^locked:\s*true/m.test(content);
      if (hasLocked === locked) return true;
      let next;
      if (locked) {
        next = content.replace(/^---\n([\s\S]*?)\n---/, (_m, body) => `---
${body}${body.trimEnd().endsWith("\n") ? "" : "\n"}locked: true
---`);
      } else {
        next = content.replace(/^locked:\s*true\n/m, "");
      }
      if (next === content) return false;
      await this.app.vault.modify(f, next);
      return true;
    } catch (e) {
      console.warn("[edge-tutor] setNodeLocked \u5931\u8D25", title, e);
      return false;
    }
  }
  /**
   * 聚合所有工作区的认知地图树文本（供 whole 范围导引）。
   * 每工作区一段（标注工作区名），空工作区跳过，locked 合并。
   */
  async buildGlobalMapText() {
    const workspaces = await this.discoverWorkspaces();
    const parts = [];
    const locked = /* @__PURE__ */ new Set();
    let total = 0;
    for (const ws of workspaces) {
      const conv = await this.loadConv(ws);
      const summary = cognitiveMapSummary(conv);
      if (!summary.summaryText || summary.summaryText.includes("\u5C1A\u65E0\u8BA4\u77E5\u8282\u70B9")) continue;
      const label = ws === "main" ? "\u9ED8\u8BA4\u5DE5\u4F5C\u533A" : ws;
      parts.push(`\u3010\u5DE5\u4F5C\u533A\uFF1A${label}\u3011
${summary.summaryText}`);
      summary.locked.forEach((l) => locked.add(l));
      total += conv.reading.threads.length;
    }
    return {
      text: parts.join("\n\n") || "\uFF08\u5C1A\u65E0\u8BA4\u77E5\u8282\u70B9\uFF0C\u5168\u65B0\u63A2\u7D22\uFF09",
      locked: [...locked],
      total
    };
  }
  /**
   * 执行模式（Agent）：在 vault 内执行用户指令。
   * 通道独立于对话（对话走反代免费号，agent 走支持 tool_calls 的通道）。
   * - opencode：委托本机 opencode serve（完整 agent，bash/网络/文件全能力，轮数不受限）
   * - openai：直连官方 API，自建工具循环（vault 内 6 个工具）
   */
  async runAgentTask(input, opts = {}) {
    const s = this.settings;
    const wsLabel = this.currentWorkspace();
    const wsHint = `\u5F53\u524D\u8BA4\u77E5\u5DE5\u4F5C\u533A\uFF1A${wsLabel === "main" ? "\u9ED8\u8BA4\uFF08\u8BA4\u77E5\u8FB9\u7F18\u6839\u76EE\u5F55\uFF09" : wsLabel}\u3002\u6C89\u6DC0\u8BA4\u77E5\u8282\u70B9\u8BF7\u4F7F\u7528\u8BE5\u5DE5\u4F5C\u533A\uFF1B\u5220\u9664/\u79FB\u52A8 vault \u6587\u4EF6\u524D\u5FC5\u987B\u62A5\u544A\u8BA1\u5212\u3002`;
    if (s.agentChannel === "opencode") {
      const result = await runOpenCodeTask(
        {
          base: s.opencodeBase || "http://127.0.0.1:10999",
          provider: s.opencodeProvider || "deepseek",
          model: s.opencodeModel || "deepseek-v4-flash"
        },
        input,
        {
          signal: opts.signal,
          system: `${wsHint}

\u7981\u6B62\u5220\u9664 vault \u5185\u4EFB\u4F55\u6587\u4EF6\u6216\u6587\u4EF6\u5939\uFF08\u5305\u62EC\u8282\u70B9 .md\u3001.conv.json\u3001.obsidian \u914D\u7F6E\u3001\u9690\u85CF\u6587\u4EF6\uFF09\u3002\u4FEE\u6539\u6216\u521B\u5EFA\u6587\u4EF6\u524D\uFF0C\u5148\u8BFB\u53D6\u76EE\u6807\u73B0\u72B6\u3002`,
          onStep: (step) => {
            var _a;
            (_a = opts.onStep) == null ? void 0 : _a.call(opts, {
              turn: step.turn,
              call: { id: "", name: step.call.name, arguments: step.call.arguments },
              result: step.result
            });
          }
        }
      );
      return {
        ok: result.ok,
        answer: result.answer,
        toolsUsed: [...new Set(result.steps.map((st) => st.call.name))],
        turns: result.steps.length ? result.steps[result.steps.length - 1].turn : 1
      };
    }
    const cfg = agentConfig(this.settings);
    if (!cfg.apiKey) {
      throw new Error(
        `\u6267\u884C\u6A21\u5F0F\u672A\u914D\u7F6E API Key\uFF1A\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199\uFF08\u73AF\u5883\u53D8\u91CF ${s.agentApiKeyEnv || "DEEPSEEK_API_KEY"} \u4F18\u5148\uFF09`
      );
    }
    const executor = buildVaultExecutor(this.app, {
      currentWorkspace: () => this.currentWorkspace(),
      listNodes: (ws) => this.listNodes(ws),
      createNode: (node) => this.createNode(node),
      updateMoc: (ws) => this.updateMoc(ws)
    });
    return runAgent(cfg, input, executor, { ...opts, maxTurns: s.agentMaxTurns || 30, wsHint });
  }
  /**
   * 确保 opencode serve 在运行：检测 → 未运行则后台启动 → 等待就绪。
   * 供面板「🔌 opencode」按钮调用。
   */
  async ensureOpenCodeServer() {
    const base = (this.settings.opencodeBase || "http://127.0.0.1:10999").replace(/\/+$/, "");
    if (await this.pingOpenCode(base)) {
      return { ok: true, message: `opencode serve \u5DF2\u5728\u8FD0\u884C\uFF08${base}\uFF09` };
    }
    let port = 10999;
    try {
      port = parseInt(new URL(base).port, 10) || 10999;
    } catch (e) {
    }
    try {
      const { spawn } = globalThis.require("child_process");
      const child = spawn("opencode", ["serve", "--port", String(port), "--cors", "app://obsidian.md"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: true
      });
      child.unref();
    } catch (e) {
      return { ok: false, message: `\u542F\u52A8 opencode \u5931\u8D25\uFF1A${e.message.slice(0, 120)}` };
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await this.pingOpenCode(base)) {
        return { ok: true, message: "\u5DF2\u542F\u52A8 opencode serve\uFF08\u540E\u53F0\u8FD0\u884C\uFF0C\u7AEF\u53E3 " + port + "\uFF09" };
      }
    }
    return { ok: false, message: "\u5DF2\u53D1\u8D77\u542F\u52A8\uFF0C\u4F46 serve \u672A\u54CD\u5E94\u3002\u8BF7\u786E\u8BA4 opencode \u547D\u4EE4\u5728 PATH \u4E2D" };
  }
  /** 探测 opencode serve 健康端点 */
  async pingOpenCode(base) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3e3);
      const resp = await fetch(base + "/global/health", { signal: controller.signal });
      clearTimeout(timer);
      return resp.ok;
    } catch (e) {
      return false;
    }
  }
  /** 读取/缓存章节地图（教材 toc.md 解析） */
  async getChapterIndex() {
    var _a;
    if (this.chapterIndex && this.chapterIndex.length > 0) return this.chapterIndex;
    try {
      const toc = await this.readToc();
      this.chapterIndex = parseChapterIndex(toc);
    } catch (e) {
      this.chapterIndex = [];
    }
    return (_a = this.chapterIndex) != null ? _a : [];
  }
  async semanticTextbookSearch(query) {
    const s = this.settings;
    const root = s.textbookRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const rawQ = String(query != null ? query : "").trim().slice(0, 200);
    if (!rawQ) return { found: false, text: "", count: 0, refs: [] };
    const qKey = normalizeQuery(rawQ);
    if (qKey) {
      const cached = this.searchCache.get(qKey);
      if (cached) {
        this.searchCache.delete(qKey);
        this.searchCache.set(qKey, cached);
        return cached.hit;
      }
    }
    let hit = { found: false, text: "", count: 0, refs: [] };
    if (s.agentChannel === "opencode") {
      try {
        const chapters = await this.getChapterIndex();
        const chapterMap = chapters.length > 0 ? chapters.map((c) => `- ${c.file}\uFF1A${c.title}`).join("\n") : "\uFF08\u65E0\u6CD5\u8BFB\u53D6\u7AE0\u8282\u5730\u56FE\uFF0C\u8BF7\u81EA\u884C\u6D4F\u89C8\u76EE\u5F55\uFF09";
        const instruction = [
          `\u5728\u6559\u6750\u76EE\u5F55 "${root}" \u4E0B\u67E5\u627E\u4E0E\u300C${rawQ}\u300D\u6700\u76F8\u5173\u7684\u6559\u6750\u539F\u6587\uFF0C\u5B9A\u4F4D\u5230\u5177\u4F53\u7684\u884C\u3002`,
          "",
          "\u3010\u7AE0\u8282\u5730\u56FE\u3011\uFF08\u6559\u6750\u8BB2\u6B21\u7ED3\u6784\uFF0C\u7528\u4E8E\u5224\u65AD\u53BB\u54EA\u91CC\u627E\uFF09",
          chapterMap,
          "",
          "\u8981\u6C42\uFF1A",
          "1. \u5148\u6839\u636E\u7AE0\u8282\u5730\u56FE\u5224\u65AD\u6700\u76F8\u5173\u7684 1-2 \u4E2A\u8BB2\u6B21 \u2192 \u7528 read/grep \u5728\u8BE5\u6587\u4EF6\u4E2D\u5B9A\u4F4D\u539F\u6587\u3002",
          "2. \u82E5\u76EE\u6807\u8BB2\u6B21\u4E2D\u6CA1\u6709\uFF0C\u518D\u68C0\u67E5\u76F8\u90BB\u8BB2\u6B21\uFF1B\u4ECD\u627E\u4E0D\u5230\u5C31\u53EA\u8F93\u51FA\uFF1A\u672A\u627E\u5230",
          "3. \u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C\u9075\u5B88\uFF0C\u53EA\u8F93\u51FA 1-3 \u5904\uFF0C\u6BCF\u5904\u4E00\u4E2A\u5757\uFF09\uFF1A",
          "\u3010\u6587\u4EF6\u3011vault \u76F8\u5BF9\u8DEF\u5F84\uFF08\u4E0D\u542B\u884C\u53F7\uFF09",
          "\u3010\u884C\u53F7\u3011\u8D77\u884C-\u6B62\u884C",
          "\u3010\u539F\u6587\u3011\u8BE5\u533A\u95F4\u539F\u6587\uFF0C150-300 \u5B57\uFF0C\u4FDD\u7559\u539F\u8868\u8FF0"
        ].join("\n");
        const result = await runOpenCodeTask(
          {
            base: s.opencodeBase || "http://127.0.0.1:10999",
            provider: s.opencodeProvider || "deepseek",
            model: s.opencodeModel || "deepseek-v4-flash"
          },
          instruction,
          { maxWaitMs: 5e4 }
        );
        hit = parseSearchResult(result.answer);
      } catch (e) {
        console.warn("[edge-tutor] opencode \u68C0\u7D22\u5931\u8D25\uFF0C\u964D\u7EA7 grep", e.message.slice(0, 120));
        hit = { found: false, text: "", count: 0, refs: [] };
      }
    }
    if (!hit.found) {
      hit = await this.searchTextbookLocal(rawQ, root);
    }
    if (qKey) {
      if (this.searchCache.size >= 10) {
        const oldest = this.searchCache.keys().next().value;
        if (oldest !== void 0) this.searchCache.delete(oldest);
      }
      this.searchCache.set(qKey, { hit, ts: Date.now() });
    }
    return hit;
  }
  /** 插件内 grep 检索（降级兜底）：遍历教材 md，关键词命中返回上下文片段 */
  async searchTextbookLocal(query, root) {
    const q = normalizeQuery(query).toLowerCase();
    const hits = [];
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(root + "/") || f.path === root);
    for (const f of files) {
      if (hits.length >= 3) break;
      const text2 = await this.app.vault.cachedRead(f);
      const lower = text2.toLowerCase();
      if (!q || !lower.includes(q)) continue;
      const lines = text2.split("\n");
      const idx = lower.indexOf(q);
      const startLine = text2.slice(0, idx).split("\n").length;
      const snippet = lines.slice(Math.max(0, startLine - 2), startLine + 6).join("\n").trim();
      hits.push({ file: f.path, startLine, endLine: startLine + 6, text: snippet });
    }
    if (hits.length === 0) return { found: false, text: "", count: 0, refs: [] };
    const text = hits.map((h, i) => `\u3010\u6559\u6750\u5F15\u7528 #${i + 1}\u3011\u6587\u4EF6\uFF1A${h.file} \u884C\uFF1A${h.startLine}${h.endLine > h.startLine ? `-${h.endLine}` : ""}
\u539F\u6587\uFF1A${h.text.slice(0, 300)}`).join("\n\n");
    return { found: true, text: text.slice(0, 3e3), count: hits.length, refs: hits };
  }
};
/** 特殊目录：不作为工作区/教材容器（concepts/t-maps/images 是资源与跨教材活页） */
_EdgeTutorPlugin.SPECIAL_FOLDERS = /* @__PURE__ */ new Set(["concepts", "t-maps", "images"]);
var EdgeTutorPlugin = _EdgeTutorPlugin;
var EdgeTutorSettingTab = class extends import_obsidian6.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "\u{1F916} \u6267\u884C\u6A21\u5F0F\uFF08Agent\uFF09\u901A\u9053" });
    containerEl.createEl("p", {
      text: "\u5BF9\u8BDD\u6A21\u5F0F\u8D70\u4E0B\u65B9 Provider\uFF08\u53CD\u4EE3\u514D\u8D39\u53F7\u5373\u53EF\uFF09\uFF1B\u6267\u884C\u6A21\u5F0F\u8D70\u8FD9\u6761\u901A\u9053\uFF08\u5FC5\u987B\u652F\u6301 function calling\uFF0C\u5982 DeepSeek \u5B98\u65B9 API\uFF09\u3002\u4E24\u6761\u901A\u9053\u72EC\u7ACB\u914D\u7F6E\u3002",
      cls: "setting-item-description"
    });
    new import_obsidian6.Setting(containerEl).setName("Agent \u901A\u9053").setDesc("opencode\uFF08\u672C\u673A serve\uFF0C\u5B8C\u6574 agent\uFF1Abash/\u7F51\u7EDC/\u6587\u4EF6\u5168\u80FD\u529B\uFF0C\u8F6E\u6570\u4E0D\u53D7\u9650\uFF0C\u63A8\u8350\uFF09\uFF1Bopenai\uFF08\u76F4\u8FDE API\uFF0C\u81EA\u5EFA vault \u5DE5\u5177\u5FAA\u73AF\uFF0C\u8F6E\u6570=\u4E0B\u65B9\u8BBE\u7F6E\uFF09\u3002").addDropdown((dropdown) => {
      dropdown.addOption("opencode", "opencode\uFF08\u672C\u673A serve\uFF09");
      dropdown.addOption("openai", "OpenAI \u517C\u5BB9\u76F4\u8FDE");
      dropdown.setValue(this.plugin.settings.agentChannel || "opencode");
      dropdown.onChange(async (v) => {
        this.plugin.settings.agentChannel = v;
        await this.plugin.saveSettings();
        this.display();
      });
    });
    if (this.plugin.settings.agentChannel === "opencode") {
      new import_obsidian6.Setting(containerEl).setName("opencode serve \u5730\u5740").setDesc("\u9700\u5148\u542F\u52A8\uFF1Aopencode serve --port 10999").addText(
        (text) => text.setValue(this.plugin.settings.opencodeBase || "http://127.0.0.1:10999").onChange(async (v) => {
          this.plugin.settings.opencodeBase = v.trim() || "http://127.0.0.1:10999";
          await this.plugin.saveSettings();
        })
      );
      new import_obsidian6.Setting(containerEl).setName("Provider / \u6A21\u578B").setDesc("opencode \u914D\u7F6E\u4E2D\u7684 provider \u4E0E\u6A21\u578B id\uFF0C\u5982 deepseek / deepseek-v4-flash").addText(
        (text) => text.setValue(this.plugin.settings.opencodeProvider || "deepseek").onChange(async (v) => {
          this.plugin.settings.opencodeProvider = v.trim() || "deepseek";
          await this.plugin.saveSettings();
        })
      ).addText(
        (text) => text.setValue(this.plugin.settings.opencodeModel || "deepseek-v4-flash").onChange(async (v) => {
          this.plugin.settings.opencodeModel = v.trim() || "deepseek-v4-flash";
          await this.plugin.saveSettings();
        })
      );
    } else {
      new import_obsidian6.Setting(containerEl).setName("Agent API \u5730\u5740").setDesc("OpenAI \u517C\u5BB9\u7AEF\u70B9\uFF08\u9700\u652F\u6301 tool_calls\uFF09\u3002").addText(
        (text) => text.setValue(this.plugin.settings.agentApiBase || "https://api.deepseek.com/v1").onChange(async (v) => {
          this.plugin.settings.agentApiBase = v.trim() || "https://api.deepseek.com/v1";
          await this.plugin.saveSettings();
        })
      );
      new import_obsidian6.Setting(containerEl).setName("Agent API Key \u73AF\u5883\u53D8\u91CF\u540D").setDesc("\u4ECE\u73AF\u5883\u53D8\u91CF\u8BFB\u53D6\u5BC6\u94A5\uFF08\u4F18\u5148\u4E8E\u4E0B\u9762\u660E\u6587\uFF09\u3002").addText(
        (text) => text.setValue(this.plugin.settings.agentApiKeyEnv || "DEEPSEEK_API_KEY").onChange(async (v) => {
          this.plugin.settings.agentApiKeyEnv = v.trim() || "DEEPSEEK_API_KEY";
          await this.plugin.saveSettings();
        })
      );
      new import_obsidian6.Setting(containerEl).setName("Agent API Key\uFF08\u660E\u6587\uFF09").setDesc("\u73AF\u5883\u53D8\u91CF\u8BFB\u4E0D\u5230\u65F6\u4F7F\u7528\uFF1B\u4EC5\u5B58\u672C\u5730 data.json\u3002").addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("sk-...").setValue(this.plugin.settings.agentApiKey || "").onChange(async (v) => {
          this.plugin.settings.agentApiKey = v.trim();
          await this.plugin.saveSettings();
        });
      });
      new import_obsidian6.Setting(containerEl).setName("Agent \u6A21\u578B").setDesc("\u652F\u6301 function calling \u7684\u6A21\u578B\uFF08\u9ED8\u8BA4 deepseek-chat\uFF09\u3002").addText(
        (text) => text.setValue(this.plugin.settings.agentModel || "deepseek-chat").onChange(async (v) => {
          this.plugin.settings.agentModel = v.trim() || "deepseek-chat";
          await this.plugin.saveSettings();
        })
      );
      new import_obsidian6.Setting(containerEl).setName("\u6700\u5927\u8F6E\u6570").setDesc("\u81EA\u5EFA\u5DE5\u5177\u5FAA\u73AF\u7684\u6700\u5927\u8F6E\u6570\uFF08\u9ED8\u8BA4 30\uFF09\u3002").addText(
        (text) => {
          var _a;
          return text.setPlaceholder("30").setValue(String((_a = this.plugin.settings.agentMaxTurns) != null ? _a : 30)).onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.agentMaxTurns = Number.isFinite(n) && n > 0 ? n : 30;
            await this.plugin.saveSettings();
          });
        }
      );
    }
    containerEl.createEl("h3", { text: "\u{1F4AC} \u5BF9\u8BDD\uFF08\u4EF7\u503C\u8BC6\u522B\u5668\uFF09\u901A\u9053" });
    new import_obsidian6.Setting(containerEl).setName("Provider").setDesc("\u9009\u62E9 API \u63D0\u4F9B\u5546\uFF08\u9884\u8BBE\uFF1ADeepSeek \u5B98\u65B9 / Tokeness-Claude / Tokeness-GPT / Zhuomatech\uFF09\u3002\u5207\u6362\u540E\u81EA\u52A8\u586B\u5145\u5730\u5740\u3001\u5BC6\u94A5\u4E0E\u6A21\u578B\u3002").addDropdown((dropdown) => {
      for (const p of PRESET_PROVIDERS) {
        dropdown.addOption(p.id, p.name);
      }
      const cur = this.plugin.settings.activeProvider || "deepseek";
      dropdown.setValue(cur);
      dropdown.onChange(async (v) => {
        const p = PRESET_PROVIDERS.find((x) => x.id === v);
        if (p) {
          this.plugin.settings.activeProvider = p.id;
          this.plugin.settings.apiBase = p.apiBase;
          this.plugin.settings.apiKey = p.apiKey;
          this.plugin.settings.model = p.models[0] || this.plugin.settings.model;
          await this.plugin.saveSettings();
          this.display();
        }
      });
    });
    new import_obsidian6.Setting(containerEl).setName("\u6A21\u578B").setDesc("\u5F53\u524D Provider \u7684\u53EF\u7528\u6A21\u578B\u3002").addDropdown((dropdown) => {
      var _a;
      const provider = PRESET_PROVIDERS.find((p) => p.id === this.plugin.settings.activeProvider);
      const models = ((_a = provider == null ? void 0 : provider.models) == null ? void 0 : _a.length) ? provider.models : [this.plugin.settings.model];
      const all = /* @__PURE__ */ new Set([...models, this.plugin.settings.model]);
      for (const m of all) {
        dropdown.addOption(m, m);
      }
      dropdown.setValue(this.plugin.settings.model);
      dropdown.onChange(async (v) => {
        this.plugin.settings.model = v;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian6.Setting(containerEl).setName("API \u5730\u5740").setDesc("OpenAI \u517C\u5BB9\u7AEF\u70B9\uFF08\u5207\u6362 Provider \u81EA\u52A8\u586B\u5145\uFF0C\u53EF\u624B\u52A8\u6539\uFF09").addText(
      (text) => text.setValue(this.plugin.settings.apiBase).onChange(async (v) => {
        this.plugin.settings.apiBase = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("API Key").setDesc("\u5F53\u524D Provider \u7684\u5BC6\u94A5\uFF08\u5207\u6362 Provider \u81EA\u52A8\u586B\u5145\uFF0C\u53EF\u624B\u52A8\u6539\uFF1B\u4EC5\u5B58\u672C\u5730 data.json\uFF09").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("sk-...").setValue(this.plugin.settings.apiKey).onChange(async (v) => {
        this.plugin.settings.apiKey = v.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian6.Setting(containerEl).setName("\u56DE\u7B54\u957F\u5EA6\uFF08max_tokens\uFF09").setDesc("\u56DE\u7B54\u6700\u5927 token \u6570\u3002\u8D8A\u5927\u56DE\u7B54\u8D8A\u957F\uFF08\u9ED8\u8BA4 4096\uFF09\u3002").addText(
      (text) => {
        var _a;
        return text.setPlaceholder("4096").setValue(String((_a = this.plugin.settings.maxTokens) != null ? _a : 4096)).onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.maxTokens = Number.isFinite(n) && n > 0 ? n : 4096;
          await this.plugin.saveSettings();
        });
      }
    );
    new import_obsidian6.Setting(containerEl).setName("\u53D1\u6563\u5EA6\uFF08temperature\uFF09").setDesc("0-2\uFF0C\u8D8A\u9AD8\u56DE\u7B54\u8D8A\u53D1\u6563\u3001\u8D8A\u6709\u521B\u9020\u6027\uFF08\u9ED8\u8BA4 0.8\uFF09\u3002").addText(
      (text) => {
        var _a;
        return text.setPlaceholder("0.8").setValue(String((_a = this.plugin.settings.temperature) != null ? _a : 0.8)).onChange(async (v) => {
          const n = parseFloat(v);
          this.plugin.settings.temperature = Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : 0.8;
          await this.plugin.saveSettings();
        });
      }
    );
    new import_obsidian6.Setting(containerEl).setName("\u8BA4\u77E5\u8282\u70B9\u76EE\u5F55").setDesc("vault \u5185\u76F8\u5BF9\u8DEF\u5F84\uFF0C\u8BA4\u77E5\u8282\u70B9\u548C\u5730\u56FE\u653E\u8FD9\u91CC\uFF08\u5B66\u4E60\u4EA7\u7269\u5F52\u4F4D\uFF1A_wiki/ \u4E0B\uFF09").addText(
      (text) => text.setValue(this.plugin.settings.nodeFolder).onChange(async (v) => {
        this.plugin.settings.nodeFolder = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("\u6559\u6750\u6839\u76EE\u5F55").setDesc("\u6559\u6750 md \u6240\u5728\u76EE\u5F55\uFF08\u7528\u4E8E\u951A\u70B9\u5B9A\u4F4D\uFF09").addText(
      (text) => text.setValue(this.plugin.settings.textbookRoot).onChange(async (v) => {
        this.plugin.settings.textbookRoot = v;
        await this.plugin.saveSettings();
      })
    );
  }
};
