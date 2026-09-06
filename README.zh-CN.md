# Edge Tutor

> 把 Obsidian 笔记中的一个问题，变成可追溯、可分叉、可沉淀的学习路径。

Edge Tutor 是一个面向深度学习与知识管理的 Obsidian 插件。它不把 AI 当成一次性聊天窗口：你可以从一段原文发起追问，保留出处锚点，把有价值的推理沉淀为认知节点，并在自己的 vault 中逐步形成知识地图。

[English README](README.md)

## 能做什么

- **从选中文本发起追问**：问题会保留到原笔记的文本锚点，便于回看上下文。
- **分叉式对话**：沿着不同问题方向继续探索，而不是让所有内容挤在一条聊天记录里。
- **认知地图沉淀**：将有效问答整理为可导航的节点和关系，减少“聊完就忘”。
- **工作区与问题停车场**：按主题组织学习；暂时无暇处理的问题不会丢失。
- **本地资料检索**：可指定 vault 内的 Markdown 资料目录，按需使用关键词、BM25、向量和重排序检索。
- **导入与导出**：支持将工作区导出为 Markdown 或 JSON，也可以恢复 JSON 备份。

## 当前状态

这是公开发布候选版本。核心功能已经有自动化测试覆盖；界面和部分设置项目前以中文为主，英文界面、演示 vault、截图与 Obsidian Community Plugins 上架正在准备。

## 试用安装（BRAT）

仓库发布后，可以通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 试用：

1. 在 Obsidian 的社区插件中安装并启用 BRAT。
2. 在 BRAT 中选择 **Add Beta plugin**。
3. 填入本仓库地址：`https://github.com/taohuayi/edge-tutor`。
4. 返回社区插件列表，启用 **Edge Tutor**。

本地构建时，将 `main.js`、`manifest.json`、`styles.css` 与生成的 `lib/` 目录复制到：

```text
<你的 vault>/.obsidian/plugins/edge-tutor/
```

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm ci
npm test
npm run build
```

`npm run build` 会生成 `main.js`，并将 ONNX Runtime 的 WebAssembly 文件复制到 `lib/`。

## 初次配置

启用插件后，打开 **设置 → Edge Tutor**，完成以下配置：

- 选择或填写一个兼容 OpenAI API 格式的对话服务和 API Key；
- 设置 Edge Tutor 保存认知节点的 vault 相对目录，默认是 `Edge Tutor`；
- 可选：设置本地 Markdown 参考资料目录；
- 可选：配置 embedding 与 rerank，以启用更强的语义检索。

API Key 保存在 Obsidian 本地插件数据中，或从环境变量读取。请不要提交 `data.json`、`.env`、向量索引或模型文件。

## 安全说明

插件提供一个可选的 OpenCode Agent 通道；该通道可以调用本机 OpenCode 服务，并可能具备文件、Shell 和网络访问能力。公开版本默认不启用它。请只在你理解其权限范围、且愿意让本地 Agent 访问的 vault 中启用。

安全问题请勿公开提交 issue，详见 [SECURITY.md](SECURITY.md)。

## 参与贡献

欢迎提交 issue、使用反馈、中文/英文界面改进、演示 vault、截图、无障碍优化及聚焦的 pull request。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开源许可证

本项目采用 [MIT License](LICENSE) 发布。
