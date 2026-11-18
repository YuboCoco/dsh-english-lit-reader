# 宣传文案 · dsh-english-lit-reader

配图在同目录：`01-cover.png`（1280×640 头图）、`02-features.png`（功能九宫格）、`03-tones.png`（配色一览）、`04-workflow.png`（五步流程）、`05-square.png`（1080×1080 社交方图）。
所有文案只描述插件真实具备的能力，配色色值取自 `client.js` 的实际 CSS，可放心对外使用。

---

## 一、一句话简介

**中文**：在 DeepSeek Harness 里直接读英文文献——选中句子就出译文，一次读完创新点、技术方案、术语与公式。

**English**: Read English papers inside DeepSeek Harness — select a sentence to get its translation, and read the innovations, the technical approach, terms and formulas in one pass.

---

## 二、短版（约 60 字 / 40 words，用于市场条目、社交媒体）

**中文**：
> 英文文献阅读器：把 PDF 拖进 DeepSeek Harness，选中句子右侧即时出译文；创新点、技术方案、实验结论按五段结构总结；术语、公式、参考文献一处查完；高亮批注与文内搜索都在同一个界面。六套界面配色、三套页面配色，深色也不伤图。

**English**:
> English literature reader for DeepSeek Harness: drop in a PDF, select a sentence and read the translation beside it. Innovations, technical approach and results come back in a five-part summary; terms, formulas and references are one click away; highlights, notes and in-document search live in the same window. Six interface tones, three paper colours, and figures stay untouched even in dark tones.

---

## 三、长版（用于 GitHub About、市场详情页、博客）

### 中文

**读论文最费时间的，是来回切窗口。**

PDF 在一个窗口、翻译在另一个窗口、总结在对话框里、术语要另开搜索、参考文献还得一条条复制标题去查。一次精读要被切成十几次切换。

**英文文献阅读器**把这一整套放回同一个界面：

- **选中即译**。在页面上划一句话，右侧卡片立刻给出原文，点「翻译」才调用模型——选中本身不计费。译文按句成组回绕成整段中文，不会一段一段断开。需要盯着读时打开内联浮层，浮层可拖动、可缩放、字号可调。
- **论文分析**。按「研究背景与问题 / 核心创新点 / 技术方案 / 实验与结论 / 局限与可借鉴之处」五段输出；文中没写的地方直接标「文中未明确说明」，不编。结果按论文保存，只有点「重新分析」才重新调用模型。
- **参考文献**。逐条通过 Crossref 查 DOI 与地址，查不到就写「未找到」，绝不编造链接。
- **公式详解**。右键「解释公式」，用 KaTeX 真排版回显，再按「公式含义 / 符号说明（表格）/ 在论文中的作用 / 计算与实现要点」拆开讲。
- **术语解释**。选中一个词右键「解释术语」，结合它所在的原句和论文全文解释，并自动收进术语表——同一篇论文的术语越读越全。
- **高亮与批注**。右键添加；高亮是淡黄底黑字，批注是蓝色虚线，两者是**独立的两条记录**，互不覆盖。列表可按「全部 / 仅高亮 / 仅批注」筛选，点条目直接跳回原文位置。
- **文内搜索**。回车跳到首个命中，上/下箭头在命中之间切换并自动回绕。
- **阅读控制**。单页 / 双页 / 三页、缩放（含 Ctrl+滚轮）、双向拖动；近期阅读的 PDF 字节存在浏览器 IndexedDB 里，刷新后仍能双击打开。
- **一个「显示设置」收全部外观项**。页面配色、界面配色、功能栏停靠、内联浮层开关都在这里，工具栏不再堆一排下拉框。

### 配色

**六套界面配色**——只换界面自己的颜色，PDF 内容一点不受影响：

| 档位 | 底色 | 品牌色 | 适合 |
| --- | --- | --- | --- |
| 默认 | 跟随 Harness 主题 | 跟随主题 | 想和宿主保持一致 |
| 淡蓝 `blue` | `#eaf3fc` | `#2f74b8` | 白天长读，冷静 |
| 淡绿 `green` | `#eaf7ee` | `#2f8555` | 长时间阅读最不刺眼 |
| 淡黄 `amber` | `#fdf6e0` | `#9a6b12` | 暖调，像纸质书页 |
| 深蓝 `navy` | `#16263a` | `#6fb0ee` | 夜间与暗房间 |
| 淡粉 `pink` | `#fdeef3` | `#c2456f` | 想要一点温度 |

**三套页面配色**——只把 PDF 的白纸换成纸色，**文字照旧纯黑，图片与表格颜色一点都不动**：

- **默认**：纯白纸面。
- **纸张纹理**：暖白 `#f7f1e3` 纸面，叠三层低透明度纤维纹理，模拟真实纸浆的厚薄。
- **护眼黄**：更淡的纸黄 `#fdf8e2`，久看不刺眼。

纸面是怎么实现的：pdf.js 把不透明白底直接画进页面画布，所以在 `.page` 上设背景色永远看不见。插件改为在画布**之上**叠两层 `mix-blend-mode: darken` 的纸色——`darken` 逐通道取更暗的一侧，于是纯黑文字仍是纯黑，比纸色深的图片、表格、色块原样返回，只有白纸变纸色。

### 三个入口，一份状态

会话页顶部的「文献阅读」标签页（全宽）、左侧边栏的文件夹图标（中央面板）、右侧「开始」面板里的入口——三处打开的是同一份状态，换入口不丢进度。

### English

**The slowest part of reading a paper is switching windows.**

The PDF is in one window, the translation in another, the summary in a chat box, the term lookup somewhere else, and every reference has to be copied out and searched by hand. One careful read becomes a dozen context switches.

**English literature reader** puts all of it back into one surface:

- **Select to translate.** Mark a sentence on the page and the right-hand card shows the original immediately; the model is called only when you press Translate — selecting itself costs nothing. Translations are reflowed into whole Chinese paragraphs instead of chopping at every line. For close reading there is an inline popup that can be dragged, resized and font-sized.
- **Paper analysis.** A five-part structure: background and problem, core innovations, technical approach, experiments and conclusions, limitations and takeaways. Anything the paper does not state is written as "not specified in the paper" instead of being guessed. Results are stored per paper and only recomputed when you press Re-analyze.
- **References.** Every entry is looked up through Crossref for a DOI and URL; when nothing is found it says so and never invents a link.
- **Formula explanation.** Right-click a formula to get it typeset back with KaTeX and explained as meaning, symbol table, role in the paper, and computation notes.
- **Term explanation.** Right-click a selected word to have it explained from the sentence it sits in plus the whole paper, and recorded automatically into a per-paper glossary.
- **Highlights and notes.** Added from the right-click menu; a highlight is a light-yellow band under black text, a note is a blue dotted underline, and the two are **independent records** that never overwrite each other. The list filters by all / highlights only / notes only and jumps back to the exact spot.
- **In-document search.** Enter jumps to the first hit; the up and down arrows step through matches and wrap around.
- **Reading controls.** One, two or three pages per row, zoom including Ctrl+wheel, and two-way panning. Recent PDFs are stored in IndexedDB, so they reopen after a refresh.
- **One Display settings panel** holds every appearance control — page colour, interface tone, where the card column docks, and the inline popup switch — so the toolbar is no longer a row of dropdowns.

**Colours.** Six interface tones recolour the reader's own chrome only (default, light blue, light green, light amber, deep blue, light pink); navy is the dark one and flips the labels to near-white so it stays readable. Three paper colours change only the sheet inside the PDF — clean white, a warm textured paper, and a softer eye-protection yellow. Text stays pure black and figures and tables keep their original colours, because the tint is a `mix-blend-mode: darken` layer stacked above the page canvas: darken keeps the darker side per channel, so black glyphs stay black and anything darker than the tint is returned untouched.

**Three entry points, one shared state**: the full-width Literature tab at the top of a conversation, the folder icon in the left sidebar, and the entry inside the right-hand Start panel.

---

## 四、图片用途对照

| 文件 | 尺寸 | 建议用在哪 |
| --- | --- | --- |
| `01-cover.png` | 1280×640 | GitHub 仓库头图、市场详情页首图、文章封面 |
| `02-features.png` | 1280×940 | 功能介绍段落配图 |
| `03-tones.png` | 1280×940 | 配色章节配图 |
| `04-workflow.png` | 1280×620 | 快速上手 / 安装之后的第一张图 |
| `05-square.png` | 1080×1080 | 社交平台方形预览、聊天群转发 |

图片全部由 `promo/generate.py` 用 Pillow 纯几何绘制，不含截图、不含第三方素材，可随仓库一起分发。
