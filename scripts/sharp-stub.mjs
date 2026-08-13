/**
 * sharp 占位模块（Obsidian 渲染进程不可用时的替代）
 *
 * transformers.js 的 node 版 dist 顶层 import sharp 且按 truthy 判断选择图像解码后端：
 * - sharp 为 falsy → 模块加载时抛 "Unable to load image processing library."
 * - sharp 为真 native → 加载时崩（Electron 渲染进程不能加载 .node 原生库）
 * 本插件只用文本模型（embedding/reranker），图像管道（RawImage 解码）不会执行；
 * 占位导出函数让 transformers 走 sharp 分支正常加载，仅在意外调用图像解码时报错。
 */
export default function sharpStub() {
  throw new Error("[edge-tutor] sharp 原生库不可用（图像处理不支持）");
}
