# Avon Translator 翻译助手（Chrome 插件）

划词即翻译，字段可配置，支持历史与生词复习。

详细使用教程： [使用教程](tutorial.html)

## 功能亮点
- 划选任意文本，按可配置热键（默认 `Ctrl+Shift+L`）在选区下方弹出翻译。
- 单词/段落字段可自定义，输出 JSON 结构由字段配置自动生成。
- 支持 Markdown 基础渲染（标题/列表/粗斜体/代码）。
- 历史记录与生词本（仅收录单词），支持搜索、排序与批量删除。
- 设置页可修改热键、模型 ID、接口地址，填写 API Key，并进行接口测速。
- PDF 等无法注入页面时会打开手动翻译页。

## 使用步骤
1. 在代码或设置页中，将 `{llm_api_key}` 替换为你的 Google AI Studio API Key（或在设置页输入）。
2. 在 Chrome 中加载插件：
   - 打开 `chrome://extensions/`
   - 打开「开发者模式」
   - 选择「加载已解压的扩展程序」，选中本项目文件夹
3. 如需调整快捷键：
   - 进入 `chrome://extensions/shortcuts` 修改命令「Translate selection with Avon」（全局命令）
   - 或在插件的设置页修改内容页热键
4. 如需自定义字段与规则：
   - 设置页 → “翻译输出配置” → 选择单词或段落字段
   - 添加字段并保存（固定返回格式会自动更新）

## 运行细节
- 翻译调用：Service Worker 向 `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` 发起请求，模型默认 `gemini-2.5-flash`。
- 存储：历史记录存放于 `chrome.storage.local`；设置与热键存放于 `chrome.storage.sync`。
- 限制：长文本会自动截断；如字段全部为空将提示调整配置。
