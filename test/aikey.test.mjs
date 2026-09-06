/**
 * v0.9.0 密钥出源码回归测试：
 * resolveProviderKey / readEnv 优先级 + PRESET_PROVIDERS 无明文 key
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRESET_PROVIDERS,
  DEFAULT_SETTINGS,
  readEnv,
  resolveProvider,
  resolveProviderKey,
} from "./.build/ai.cjs";

test("readEnv：注入 env 表读取；缺失返回空串", () => {
  assert.equal(
    readEnv("EDGE_TUTOR_KEY_DEEPSEEK", { EDGE_TUTOR_KEY_DEEPSEEK: "sk-test" }),
    "sk-test",
  );
  assert.equal(readEnv("NOPE", { EDGE_TUTOR_KEY_DEEPSEEK: "sk-test" }), "");
});

test("PRESET_PROVIDERS：apiKey 全空且每个预设有专属 keyEnv（明文 key 不得再进源码）", () => {
  for (const p of PRESET_PROVIDERS) {
    assert.ok(!/sk-[A-Za-z0-9]{8}/.test(p.apiKey || ""), p.id + " 的 apiKey 含明文 key");
    assert.ok(p.keyEnv, p.id + " 缺少 keyEnv");
    assert.match(p.keyEnv, /^EDGE_TUTOR_KEY_/, p.id + " 的 keyEnv 命名");
  }
});

test("resolveProviderKey：显式 apiKey 优先于环境变量", () => {
  const s = { ...DEFAULT_SETTINGS, apiKey: "explicit-jwt" };
  const p = resolveProvider(s);
  assert.equal(
    resolveProviderKey(s, p, { EDGE_TUTOR_KEY_DEEPSEEK: "env-key", EDGE_TUTOR_API_KEY: "global" }),
    "explicit-jwt",
  );
});

test("resolveProviderKey：Provider 专属 env > 全局 env", () => {
  const s = {
    ...DEFAULT_SETTINGS,
    apiKey: "",
    apiKeyEnv: "EDGE_TUTOR_API_KEY",
    activeProvider: "deepseek",
  };
  const p = resolveProvider(s);
  assert.equal(
    resolveProviderKey(s, p, { EDGE_TUTOR_API_KEY: "global", EDGE_TUTOR_KEY_DEEPSEEK: "provider" }),
    "provider",
  );
  assert.equal(resolveProviderKey(s, p, { EDGE_TUTOR_API_KEY: "global" }), "global");
});

test("resolveProviderKey：全缺 → 空串（不抛错）", () => {
  const s = { ...DEFAULT_SETTINGS, apiKey: "", activeProvider: "custom" };
  assert.equal(resolveProviderKey(s, resolveProvider(s), {}), "");
});
