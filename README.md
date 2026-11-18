# dsh-english-lit-reader · 英文文献阅读器

**English** — A DeepSeek Harness plugin for reading English papers: drag in a PDF, select a sentence and get a translation beside it, generate a structured Chinese analysis of the paper's innovations and technical approach, resolve the bibliography, explain formulas and terms, highlight and annotate, and search inside the document. Everything runs inside the Harness Web GUI and uses whichever model the Harness is already configured with — no extra API key.

**中文** — 一个安装在 DeepSeek Harness 里的英文文献阅读插件：拖入 PDF、选中句子旁边出译文、按固定结构总结论文创新点与技术方案、自动整理参考文献并查地址、解释公式与专业术语、高亮批注、文内搜索。全部在 Harness 界面内完成，模型用的是 Harness 已经配好的那一个，不需要额外填 API key。

![英文文献阅读器界面](docs/preview.svg)

## 安装

要求 DSH 0.2.x（`dsh.bundle` 型插件）。

```bash
# 在 DSH 的 profile 目录里安装
pnpm add dsh-english-lit-reader
```

或者在 Harness 的「设置 → 插件」里搜索 `dsh-english-lit-reader` 安装。安装后**重启 Harness**，会话页顶部会多出一个「文献阅读」标签页。

手动安装（从源码）：

```bash
git clone https://github.com/yubo1214/dsh-english-lit-reader.git
cd dsh-english-lit-reader
pnpm install
```

把该目录作为 bundle 装进 profile 即可（`package.json` 里已声明 `dsh.bundle.patch`，Harness 的插件管理器会读它）。

## 三个入口

1. 会话页顶部「对话 / 痕迹 / 上下文」那一行里的 **「文献阅读」标签页**（全宽视图）。
2. **左侧边栏工具栏**里的文件夹图标（中央面板打开）。
3. **右侧「开始」面板**里的「文献阅读器」入口（右栏内打开）。

三处共用同一份状态，在任一处打开的论文、译文、分析结果、页码都会在另外两处继续。

## 能做什么

- **选中翻译**：在 PDF 里选中句子 → 右侧「选中翻译」卡片出原文 → 点「翻译」才真正调模型（选中不会自动计费）。支持内联浮层（在选中文字下方弹出，可拖动、可缩放、字号可调），选中文本会先做格式归一（去软连字符、行尾断词、单换行变空格），跨段选区完整拼接，译文会自动回流成整段中文。
- **论文分析**：加载 PDF 时抽取全文，按「研究背景与问题 / 核心创新点 / 技术方案 / 实验与结论 / 局限与可借鉴之处」五段输出中文总结；文中没写的明确标「文中未明确说明」，不臆测。结果按论文保存，只有点「重新分析」才重新调用。
- **参考文献**：与分析并行整理文末参考文献，逐条通过 Crossref 查 DOI / 地址，查不到就写「未找到」，**不编造链接**。
- **公式详解**：选中公式右键 →「解释公式」，弹出卡片用 KaTeX 真排版回显公式，按「公式含义 / 符号说明（表格）/ 在论文中的作用 / 计算与实现要点」详解。
- **术语解释**：选中单个词或短语右键 →「解释术语」，结合它所在的原句和论文全文解释，并自动收录进「术语解释」卡片作为该论文的术语表。
- **高亮与批注**：右键添加，高亮是淡黄底 + 黑字，批注是蓝色虚线，两者是**独立的两条记录**，同一句话可以各有其一；列表可按「全部 / 仅高亮 / 仅批注」筛选，点条目跳回原文位置。
- **文内搜索**：工具栏搜索框，回车跳到第一个命中，▴ / ▾（或 Shift+回车）在命中之间切换并回绕。
- **阅读控制**：单页 / 双页 / 三页布局、缩放（含 Ctrl+滚轮）、双向拖动、近期阅读（PDF 字节存 IndexedDB，刷新后仍可双击直接打开）。
- **外观**：工具栏右侧「显示设置」一个按钮容纳全部外观项——页面配色（默认 / 纸张纹理 / 护眼黄）、界面配色（默认 / 淡蓝 / 淡绿 / 淡黄 / 深蓝 / 淡粉）、功能栏停靠（右侧 / 下方）、内联翻译浮层开关。纸面配色只改 PDF 的白纸，文字、图片、表格颜色不动。

## 实现要点

```
dsh-english-lit-reader/
├── package.json        # exports "." / "./client" / "./locale/*.json" / "./icon" / "./vendor/*"
├── cordis.patch.yml    # insert: english-lit-reader → dsh-english-lit-reader
├── index.js            # Host：HTTP 路由 + llm.stream + 分段 / Map-Reduce / 公式 / 术语
├── client.js           # Client：conversation.view + sidebar.panellist/main + 右栏 guide
├── icon.svg
├── locale/en.json · zh.json
├── docs/DETAIL.md      # 插件详情页
└── vendor/             # pdf.js 3.11.174（UMD + viewer）+ KaTeX 0.16.9
```

- **Host（`index.js`）** 只做三件事：转发到 `llm.stream()`、分段调度、把 `vendor/` 静态文件回给浏览器。所有路由用 `webServer.register` 注册并校验来源。路由前缀 `/plugins/english-lit-reader/`：`meta` / `models` / `efforts` / `translate` / `summary` / `references` / `formula` / `term` / `vendor/*`。
- **Client（`client.js`）** 通过 `window.__ModuleLoader__.load({id, factory})` 注册，5 个槽位：`conversation.view`（`order: 20`，排在 Chat 之后、上下文之前）、`sidebar.panellist` + `main`（左侧入口与中央面板）、`sidebar.right.pane.tab` + `.title`（右侧「开始」入口）。
- **样式**只用 Harness 主题 token（`--dsw-alias-*`），因此自动跟随明暗主题。
- **纸面配色的做法**：pdf.js 把整页白底**画进 canvas**，所以给 `.page` 加 `background-color`（哪怕 `!important`）完全看不见。这里是在画布之上、文字层之下叠两层 `mix-blend-mode: darken` 的层（不透明纸色 + 低透明度纹理），`darken` 逐通道取更暗的一方，于是纯黑文字、比纸色深的图表像素都原样返回，只把白底换成纸色。

## 已知限制

- 扫描版 PDF（纯图片、无文字层）无法选中文本，因此选中翻译、搜索、公式 / 术语解释都用不了。
- 模型输出速度随输入长度超线性增长：选中翻译按句子成组、以 2400 字符为一个调用单元切分；只提供 `high` 档的慢推理模型在长段落上容易接近 120 s 单段超时，未显式选过模型时会自动挑一个 flash 类模型。
- PDF 字节存在浏览器 IndexedDB（单文件上限 60 MB），隐私模式或被禁用时不影响当前阅读，但刷新后需重新选文件。
- 参考文献依赖 Crossref 的元数据，冷门 / 预印本条目可能查不到地址，此时显示「未找到」而不是猜一个。

## 许可

MIT。见 [LICENSE](LICENSE)。

## 第三方组件

- [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174 — Apache-2.0，见 `vendor/PDFJS-LICENSE`。
- [KaTeX](https://github.com/KaTeX/KaTeX) 0.16.9 — MIT，见 `vendor/katex/KATEX-LICENSE`。

两者都以未修改的发行版形式随插件打包（pdf.js 的 viewer 有一处缓存页数常量调整，见源码注释），不依赖任何 CDN。

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。
