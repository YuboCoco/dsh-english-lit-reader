# Changelog

所有版本的变更记录，最新的在最上面。每一项都写了「现象 → 根因 → 做法」，因为很多问题（尤其是 pdf.js 的渲染顺序、CSS 的层叠与包含块、拖拽的事件语义）不看根因就无法判断后续改动会不会把它改回来。

版本号规则：`x.y.z`，其中 `y` 每轮需求 +1。

---
### v47 · 1.0.50

**界面配色加入淡粉色（v47）**

- 沿用 v40 的机制：一档配色 = 一条规则就地重声明那 10 个 `--dsw-alias-*`，阅读器里所有界面元素本来就只消费这些 token，所以新增一档只加一条 CSS + 一遍接线，不需要逐个组件改样式。
- 色板：底 `#fdeef3`、卡片 `#fff6f9`、次级底 `#f9dfe8`、浮层 `#fffafc`、边框 `#f0cddb` / `#e6b7c9`、品牌色 `#c2456f`、正文 `#3a1a26`、次级文字 `#7d4f5f`。
- 两个刻意的选择：
  - **品牌色用深玫瑰（`#c2456f`）而不是浅粉**。分段控件的选中项、分隔条上的拖动提示胶囊、`⚙` 激活态都是用品牌色画的，浅粉在淡粉底上几乎没有对比度，会看不见。
  - **正文色是带一点暖调的深色（`#3a1a26`）而不是纯黑**。纯黑压在粉底上会显脏，暖深色更像印刷品；同时它相对底色的对比度仍 ≥7:1。
- 校验脚本不是只看「规则存在」，而是把颜色本身算了一遍：底色**必须足够亮**（感知亮度 >225）、**红 > 蓝 > 绿**（是玫瑰调而不是橙调或紫调）、蓝通道与红通道差距 **≤12**（不能滑到琥珀档）、正文色亮度 <90 且与底色对比度 **≥7:1**、品牌色亮度 <150 且相对底色对比度 **≥3:1**。
- 归一化同步扩到五档（`blue / green / amber / navy / pink`），任何无法识别的值仍然回落到 `default`（宿主主题原样），避免在快照里存了个坏值导致整块样式不生效。

**本地验证**：`node --check` 通过（`client.js` / `index.js`）；静态校验 **25/25**（版本 1.0.50 两份文件一致、粉色规则含全部 10 个 token、四条色值/对比度断言、归一化与 `toneCls` 都认 `pink`、设置面板下拉里真的有这个选项、四份词典 183/183、`tone.pink` 中英一致、v46 设置面板 / v45 纹理 / v44 移除项 / 缩放与搜索全部未回潮）；桩渲染 harness **13/13**（快照里存 `pink` 时根节点带 `elr-tone-pink` 且不带其它四档；通过设置面板下拉选中 `pink` 后根节点真的换上该类并亮起提示圆点、下拉读数同步；切回 `default` 后类与圆点一起消失；文本模式同样生效；快照里存 `chartreuse` 这种坏值时五档类名一个都不出现）；Host 实时冒烟 `/meta` 200（112 B）、四个 `vendor/*?v=1.0.50` 全 200（320004 / 233111 / 56588 / 277038 B）、`nope.txt` 404、`POST /translate` 200（1569 ms）。

### v46 · 1.0.49

**把修改外观的按键统一收进一个「显示设置」菜单（v46）**

- 现象：改外观要用的控件散在工具栏右侧——「页面配色」下拉、「界面配色」下拉、「功能栏停靠」按钮、「内联翻译」开关，四个并排，和阅读操作（翻页 / 缩放 / 搜索）混在同一行里，既挤又不容易找到；而且文本模式与 PDF 模式的摆放还不一致。
- 现在工具栏只剩一个 **「显示设置」** 按钮，点开弹出面板，一行一项：**页面配色 / 界面配色 / 功能栏停靠 / 内联翻译浮层**。PDF 模式四行，文本模式三行（没有渲染页，不出现「页面配色」）。
- 按钮能自己提示状态：当前不是「默认外观」时，按钮文字右侧亮起一颗品牌色小圆点（`theme !== 'default' || uiTone !== 'default'`），收起面板后也能一眼看出改过外观。
- 关闭方式三种：再点一次按钮、点面板外的任意位置（`mousedown` 捕获阶段判定点是否落在按钮 + 面板这个整体之外）、按 **Esc**。后两种走同一个 `document` 级 effect，面板收起时立刻解绑，不会留下监听器。
- 面板构造上刻意**只做一份**：`settingsPanel(withTheme)` 由两种模式共用，`withTheme` 只决定要不要那行「页面配色」。四种控件的排布通过两个小构造器 `settingsRow()`（整行 `<label>`，点标签文字也能命中控件）与 `settingsSeg()`（两段式分段按钮，当前项带 `active`）拼出来，没有为每个控件各写一遍结构。
- 每行都是 `<label>` 包住「标签 + 控件」，因此鼠标点行内任意位置都能操作，窄宽度下也不会点空。
- 有一处必须一起改，否则功能会坏：**选区守卫 `inOwnCard()` 的白名单**（原本是 `.elr-popup, .elr-formula-card, .elr-note-bubble, .elr-menu`）必须把 `.elr-settings` 也算进去——漏掉的话，在设置面板里点下拉框会被当成「在 PDF 上点了鼠标」，触发选区逻辑把面板顶掉。
- 面板本身是普通兄弟节点、绝对定位在按钮下方（`right: 0; top: calc(100% + 6px)`，宽 264px、`max-width: 88vw`），所以功能栏再窄也不会溢出到屏幕外。

**本地验证**：`node --check` 通过（`client.js` / `index.js`）；静态校验 **43/43**（版本 1.0.49 两份文件一致、设置面板的 state / ref / 外点关闭 effect、四个 `settingsRow` 与两个 `settingsSeg`、五个界面配色选项、八条 `.elr-settings*` CSS、`inOwnCard` 已含 `.elr-settings`、四份词典 182/182、9 个新键齐全、v45 的纸面层与纹理仍在、v44 的移除项没有回潮、缩放与搜索仍在工具栏）；桩渲染 harness **41/41**（5 个槽位、`conversation.view` `order: 20`、渲染树 130+ 节点、面板默认收起、点按钮后展开出 4 行 2 个下拉框、通过下拉框换配色后根节点真的带上 `elr-tone-navy` 且按钮亮起小圆点、点「下方」停靠后根节点出现 `dock-bottom`、再点按钮收起、文本模式 3 行且没有「页面配色」这一行）；Host 实时冒烟 `/meta` 200（112 B）、四个 `vendor/*?v=1.0.49` 全 200（320004 / 233111 / 56588 / 277038 B）、`nope.txt` 404、`POST /translate` 200。

### v45 · 1.0.48

**① 护眼黄更淡（v45 #1）**

- 平涂纸色从 `#fdf6d3` 换成 `#fdf8e2`，四周画布边框从 `#f3e9b8` 换成 `#f6efd2`，页框描边从 `#ece0a8` 换成 `#f0e9c4`。
- 三个数值都不是随手调的：新纸色的**感知亮度更高**（相对旧值 0.2126R+0.7152G+0.0722B 之和更大），且**蓝-红差值更小**——也就是「更亮、更少黄」。校验脚本里用这两条数值断言把这一点固定下来，避免以后又被改回偏深偏黄。

**② 纸张纹理回归，但这次是真的「像纸」（v45 #2）**

- 上一版（v44）我把纹理整组删了，理由写在代码注释里：纹理本身就是一张盖在整页上的网，无论多淡都会在图表浅色区印上线。你说想要真实感纹理，于是这次不是把它搬回来，而是**换成一组只可能「减光」的低透明度渐变**，配合原有的 `darken` 混合：
  - `::before`——**不透明**平涂纸色，负责把纯白完整换成纸色（v44 的那一层，只是拆成独立图层）；
  - `::after`——**纹理**，由 4 组低透明度渐变组成：0° / 90° / 46° 三向纤维（节距 3 / 4 / 7 px，互质所以不形成格纹）+ 各向同性颗粒斑点（`repeating-radial-gradient`，0.7px 颗粒）+ 3 块大面积柔和色斑（模拟纸浆厚薄不均）。
- 因为混合模式是 `darken`，且纹理每一层的 alpha 都压在 **0.09 以下**（护眼黄档 ≤0.07），所以纹理**只能从通道里减掉一点光**：纯黑文字丝毫不变，比纹理深的图表像素原样返回，只有近乎纯白的区域会获得可感的纤维感——这正是真实印刷品里图表浅色区也会透出纸纹的样子。
- 刻意没用 `multiply`（会压暗所有图表），也没用上一版 v8 那种不透明网格（那是硬线条）。
- 校验脚本把纹理的结构也钉住了：**7 个渐变层**、三个方向角都在、有斑点层、有 3 块色斑、最大 alpha ≤0.09、且**护眼黄档必须比纸张档更淡**。

**本地验证**：`node --check` 通过（`client.js` / `index.js`）；静态校验 **38/38**（版本 1.0.48 两份文件一致、`#fdf6d3` / `#f3e9b8` 旧值已彻底消失、新亮度与饱和度断言、7 层纹理结构、alpha 上限、两层都用 `darken` 且无 `multiply`、`z-index` 1/3/4 层次不变量、v44 的回归项仍在、四档界面配色完好、四份词典 173/173）；桩渲染 harness **19/19**（5 个槽位、`conversation.view` `order: 20`、渲染树 40+ 节点、两个下拉框共 7 个选项、`theme:'eye'` 与 `theme:'paper' + uiTone:'navy'` 两次启动都正确）；Host 实时冒烟 `/meta` 200（112 B）、四个 `vendor/*?v=1.0.48` 全 200（320004 / 233111 / 56588 / 277038 B）、`nope.txt` 404、`POST /translate` 200（2036 ms）。

### v44 · 1.0.47

**① 移除悬浮在所有界面右下角的「文献阅读器」按钮及其全屏浮层（v44 #1）**

- 现象需要：那个胶囊按钮 `position: fixed; right: 20px; bottom: 20px`，**在任何页面、任何会话上都会盖着**，包括你根本不在读论文的时候；点开还会铺一层全屏浮层，遮住整个 Harness。
- 处理：整个 `shell.overlay` 槽位注册删掉，连带 `OverlayLauncher` 组件、`overlayT` 桥、`disposeLauncher` 与 `.elr-launcher` / `.elr-overlay` / `.elr-overlay-inner` / `.elr-mini-chip` 四组样式一起删除。**`.elr-launcher-dot` 那条小圆点规则保留**——阅读器自己的头部在用。
- 结果：槽位注册从 6 个降为 **5 个**（会话标签页 / 左栏图标 + 中央面板 / 右栏 guide 的两段式注册），三个入口指向同一个 `Reader` 与同一份 `localStorage` 快照，所以功能没有损失。

**② 移除 PDF 阅读区左下角那行灰色提示（v44 #2）**

- 删掉的是 PDF 模式下 `position: absolute; bottom: 0; left: 0; right: 0` 的那行 `.elr-hint`（原文「提示：在 PDF 中选中句子，右侧会实时显示译文。」），它一直浮在页面底部压着正文。
- **文本模式**文本框下面那行提示保留（那块空间不会盖住内容），所以 `.elr-hint` 样式与 `selection.hint` 词条都还在。`pdf.textHint` 词条从两处内联字典与两份 `locale/*.json` 里一并删除，四份词典重新对齐到 **173** 条。

**③ 纸张纹理 / 护眼黄重做：只换白纸，不动文字、图片与表格（v44 #3）**

- 现象：选「纸张纹理」或「护眼黄」后，**整页连同文字、图片、表格一起被染黄**，图表失真。
- 根因（两个各自独立的问题）：
  1. **pdf.js 把白底画进了 canvas**——`CanvasGraphics.beginDrawing` 里 `this.ctx.fillStyle = background || "#ffffff"; this.ctx.fillRect(0, 0, w, h)`，而 `PDFPageView` 构造 `renderContext` 时**根本不传 `background`**（只有 `canvasContext / transform / viewport / annotationMode / optionalContentConfigPromise / annotationCanvasMap / pageColors`），于是 `#ffffff` 永远生效。所有写在 `.pdfViewer .page` 上的 `background-color`（哪怕 `!important`）都被画布完全盖住，从来没有生效过。
  2. 唯一真正可见的那层效果是 `.elr-theme-paper .pdfViewer .page::after` 的网格纹理——它是**盖在整页上的一层网**，所以文字、图片、表格全被一起压上暖色调。
- 修复：改用 `.canvasWrapper::after` 一层**纯色 + `mix-blend-mode: darken`** 的覆盖层（`z-index: 1`，位于画布之上、文字层之下）。`darken` 逐通道取「更暗的一方」，所以：
  - 纯黑文字 → 仍是纯黑（黑比任何纸色都暗）；
  - 图片、表格里任何比纸色深的像素 → **原样返回**，完全不受影响；
  - 只有白底（255,255,255）被换成纸色（米黄 `#f7f1e3` / 淡黄 `#fdf6d3`）。
- 为什么不用 `multiply` / `pageColors` / `filter: invert()`：`multiply` 会把图片一起压暗；`pageColors` 走的是 `filterFactory.addHCMFilter`，那是高对比度模式的**逐色重映射**，图表会被彻底改色；`invert` 在 v5 就因图片失真被否掉过。
- **网格纹理主动删除**（**v45 已按需求恢复**，见上方 v45 ②：改为全低透明度的渐变纹理，仍受 `darken` 约束）：纹理本身就是一张网，无论多淡都会在图片与表格的浅色区域印上线条——那就是在改内容。纸感改由「平涂纸色 + 四周画布边框（`.elr-pdf-wrap` / `.elr-pdf-container` 的深一档底色）」营造。
- 层次不变：纸色层 `z-index: 1` < 高亮层 `z-index: 3` < 搜索命中层 `z-index: 4`，两者互不干扰。

**本地验证**：`node --check` 通过（`client.js` / `index.js`）；静态校验 **44/44**（版本 1.0.47、无 `shell.overlay`、无 launcher / overlay 样式、`elr-launcher-dot` 保留且仍被渲染、无 `t('pdf.textHint')`、无 `.elr-theme-paper .pdfViewer .page::after`、无 `background-color: #f7f1e3 !important`、新 `canvasWrapper::after` + `darken`、三层层级不变量、四档配色完好、无写死黑白、四份词典 173/173）；桩渲染 harness **18/18**（5 个槽位注册、`conversation.view` 仍 `order: 20`、渲染树 > 40 节点、根节点 `elr-view`、树中无 `elr-launcher` / `elr-overlay` 类、PDF 模式无 `elr-hint`、`theme:'eye' + uiTone:'navy'` 的第二次启动仍正确着色）；Host 实时冒烟 `/meta` 200（112 B）、四个 `vendor/*?v=1.0.47` 全 200（320004 / 233111 / 56588 / 277038 B）、`nope.txt` 404、`POST /translate` 200（2186 ms）。

### v43 · 1.0.46

**① 去掉「功能栏」标题行下面那条横线，并给功能栏 / 论文分析之间的分隔条加上明显的拖动提示（v43）**

- **上一版认错了线（v42 #3 的更正）**：v42 把「功能栏下方多余的横线」理解成**分隔条自带的两道边框**，于是把 `.elr-splitter` 改成透明无边框 —— 结果真正挡眼的那条线还在，而本该有的分隔条反倒消失了。按截图红框确认：用户指的是 **「功能栏」标题行（右侧有 ⚙）下面、第一张卡片上面** 那条线，也就是 `.elr-col-head` 的 `border-bottom`；分隔条在**更下面**，位于功能栏与论文分析之间。
- **去掉标题行横线**：`.elr-col-head` 的基础规则里删掉 `border-bottom: 1px solid var(--dsw-alias-border-l1)`；同时给 `.elr-col-head.elr-card-head` 补一条覆盖规则 `background: var(--dsw-alias-bg-base); border-bottom: none; margin-bottom: 6px;`。底色是不透明的，因此 `.elr-side-body` 滚动时卡片不会从标题行底下透出来；`margin-bottom: 6px` 补回原来那条线提供的视觉间隔 —— **线没了，但两块依然是分开的**。
- **恢复分隔条**：`.elr-splitter` 回到 `flex: 0 0 8px` + `background: var(--dsw-alias-bg-layer-2)` + 上下各一条 `border-l1`，并改成 `display: flex; align-items: center; justify-content: center` 好让提示居中；热区仍靠 `::before` 向外扩 5px。
- **常驻拖动提示**：`.elr-splitter::after` 画一枚 `48×5` 的**全圆角品牌色胶囊**（`opacity: .45`，不悬浮时也看得见，不会「找不到把手」）；`:hover` / `.active` 时**变长到 72px 并变成实色 1.0**，同时分隔条两条边框也转成品牌色。下方停靠时整根条是竖的，胶囊跟着转成 `4×44`（hover `4×68`）——**提示的方向始终和拖动方向一致**。

**本地验证**：`node --check` 通过；静态校验 **40/40**（标题行无 `border-bottom`、覆盖规则含 `border-bottom: none` + `margin-bottom: 6px` + 不透明底色、分隔条恢复底色与上下边框且仍是 `row-resize`、胶囊 `48×5` / 全圆角 / 品牌色 / `.45` / 有过渡、hover 变 72px 变实、热区仍在、下方停靠旋转、v42 的黑白写死不回潮、四档配色仍在、左右拖柄仍只在下方面板渲染、下边界拖柄仍只在右侧、174/174 词典一致）；桩渲染 **14/14**（真实铺开组件树后：`.elr-col-head.elr-card-head` 与 `.elr-side-body` 是并列节点、`.elr-splitter` 在树上、根节点带 `elr-tone-amber`、右侧停靠时**没有任何** `is-left`/`is-right` 而只有 `is-bottom`）。live smoke（`http://127.0.0.1:55989`，已 disable→enable 重载）：`/meta` 200（112 B）、`pdf.min.js` 320004 B、`pdf_viewer.js` 233111 B（`DEFAULT_CACHE_SIZE = 40` 仍在）、`pdf_viewer.css` 56588 B、`katex.min.js` 277038 B 全部 `?v=1.0.46` 200、`nope.txt` 404、`POST /translate` 200（2936 ms）。

### v42 · 1.0.45

**① 内联翻译浮层的中文区域配色跟随主题，不再固定黑底白字（v42 #1）**

- 现象：不管选哪档界面配色，浮层里的中文译文永远是一块纯黑底 + 白字。
- 原因：v23 #5 为了对抗宿主深色主题，用四条规则把颜色**写死**了 —— `background: #000000` / `color: #ffffff`，而且这四条只认「宿主是不是深色」，完全不看 `uiTone`。所以只要宿主是深色，任何配色档都被涂成黑块。
- 改法：把这四条换成 token —— 中文块底改成 `color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1))`，左边框用品牌色，文字用 `var(--dsw-alias-label-primary)`，标签和空态用 `label-secondary`。于是**浅色档是淡品牌色底 + 深色字，深色档是深底 + 近白字，品牌色始终保留**，一个 token 同时解决「跟随配色」和「深浅可读」两件事。

**② 界面配色新增淡黄色 / 深蓝色（v42 #2）**

- 沿用 v40 的机制：一档配色 = 一条规则里重新声明那 10 个 `--dsw-alias-*` token，因为阅读器所有界面元素本来就只消费这些 token，所以改一条就能整体换色。
- `.elr-tone-amber`：暖白纸感（底色 `#fdf6e0`，卡片 `#fdfaf0`，边框 `#e6d9ad`，品牌色 `#9a6b12`，文字 `#2f2713`）。
- `.elr-tone-navy`：**深色档**（底色 `#16263a`，卡片 `#1c3049` / `#223a58`，边框 `#2e4a6b`，品牌色 `#6fb0ee`，文字 `#e6eefb` / `#a8bcd6`）。**文字必须一起换成近白色**，否则会变成「深底 + 宿主深色主题的浅底黑字」这种自相矛盾的结果。
- 校验/归一化同步扩到四档（`blue / green / amber / navy`，其它值一律回落 `default`，避免存了个无法识别的值导致整块样式不生效），两个下拉框（PDF 模式与文本模式）都加了这两个选项。

**③ 右侧停靠时去掉卡片左右拖柄，并去掉功能栏下方那条横线（v42 #3）**

- 左右拖柄：右侧停靠时一张卡片本来就占满整列，所以那两条「左右边界」实际改的是**整列宽度**，但鼠标停在上面显示的是 `col-resize`，看起来像在拖这张卡片——**承诺与行为不一致**，而且两条 7px 的透明带正好压在卡片文字的左右边缘上。现在只有在**下方停靠**时才渲染左右拖柄；右侧停靠只保留 v38 的下边界拖柄（改卡片高度）。
- 横线：`.elr-splitter` 原来是 `background: bg-layer-2` + 上下各一条 1px 边框，6px 宽的一条带子带两道线，看起来就是功能栏下方多出来的一根横线。现在改成 `background: transparent; border: none;`，**只保留 6px 的拖拽热区和 hover/active 时的品牌色高亮**（热区仍靠 `::before` 向外扩 5px），所以依然好找、但不再是一条装饰线。下方停靠时那条分隔线仍由 `.elr-body.dock-bottom .elr-side .elr-splitter` 自己绘制，没有受影响。

**本地验证**：`node --check` 通过（`client.js` / `index.js`）；静态校验 **39/39**（无写死黑/白规则、浮层四条规则改用 token、两档新配色各含 9 个 token、深蓝色确实是深底 + 近白字、淡黄色是暖浅底、归一化与 `toneCls` 都认这两档、两个下拉框各有这两个选项、五个 portal 仍带 `toneCls`、左右拖柄只在下方停靠渲染、下边界拖柄仍只在右侧停靠、splitter 无边框无底色但仍保留 `row-resize` 与 6px 热区、174-174 词典一致、版本号）；桩渲染 **16/16** + 停靠断言（右侧：只有 `is-bottom`，无 `is-left`/`is-right`；下方：有 `is-left`/`is-right`，无 `is-bottom`；根部 tone 类与所选档一致）。live smoke：`/meta` 200（112 B）、`pdf.min.js` 320004 B、`pdf_viewer.js` 233111 B、`pdf_viewer.css` 56588 B、`katex.min.js` 277038 B 全部 `?v=1.0.45` 200、`nope.txt` 404、`POST /translate` 200（1824 ms）。

### v41 · 1.0.44

**「高亮与批注」卡片里「全部 / 仅高亮 / 仅批注」这一行不再和卡片顶栏挤在一起（v41 #1）**

- 现象：「高亮与批注」卡片顶部那条标题栏下面，紧贴着就是三态筛选行，两者毫无间隙，看起来像**一个被压扁的整体**。
- **原因有两条，缺一不可**：
  1. 筛选条是 `margin: 0 10px 8px` —— **上边距是 0**，所以它直接顶到标题栏的 `border-bottom` 上。
  2. 里面的三个分段按钮用的是通用 `.elr-seg`，而它带 `background: var(--dsw-alias-bg-layer-2)` —— 和标题栏 `.elr-marks-head` 的底色**是同一个 token**，于是标题栏 + 筛选条连成一片实色块，视觉上完全分不开。
- **改法：把筛选行做成一条独立的小托盘。**
  - `.elr-marks-filter` 改成 `margin: 8px 10px; padding: 3px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-base);` ——上下各留 8px，底色换成比标题栏**更浅**的 `bg-base`（标题栏是 `bg-layer-2`），于是一眼能看出「标题栏 / 筛选托盘 / 列表」是三行。
  - 托盘里的分段按钮 `background: transparent; border-radius: 6px;`，只有选中态才填充（`color-mix` 把品牌色按 20% 混进 `bg-layer-1`，文字用品牌色加粗）。通用 `.elr-seg + .elr-seg` 的左侧分隔线在托盘里去掉（那条规则本来是给工具栏那种「连体分段」用的）。
  - 另外三个分段现在用 `flex: 1 1 0` **等分托盘宽度**，所以功能栏拉宽 / 压窄时这行也一起跟着变，不会一边空一边挤。
- **顺手修掉一个显示逻辑**：筛选行原来不管卡片是展开还是折叠都会渲染。折叠状态下卡片本应只剩一行标题栏，结果筛选托盘还挂在那儿，看起来就像标题栏变厚了。现在它包在 `marksOpen ? … : null` 里，**折叠时不渲染**，展开才出现。

**本地验证**：`node --check` 通过；静态校验 **33/33**（版本号 / 筛选托盘规则（有 8px 上下边距、`bg-base` 底色、3px 内边距与间隙）/ 分段透明 + 等分 / 分隔线移除 / 选中态品牌色 / 折叠门控 / 标题栏 `bg-layer-2` + 下边框 + 琥珀色左边条均未被破坏 / 172-172 词典一致）；桩渲染 **15/15**，含真实行为用例——默认展开时托盘存在且三个分段中「全部」选中、点标题栏折叠后托盘消失、再点一次展开后托盘回来。live smoke：`/meta` 200（112 B）、`pdf.min.js` 320004 B、`pdf_viewer.js` 233111 B、`pdf_viewer.css` 56588 B、`katex.min.js` 277038 B 全部 `?v=1.0.44` 200、`nope.txt` 404、`POST /translate` 200（3024 ms）。

### v40 · 1.0.43

**新增两套整体界面配色：淡蓝色 / 淡绿色（v40 #1）**

- 现象需要：原来的「阅读配色」只改**纸面**（默认 / 纸张纹理 / 护眼黄），工具栏、功能卡片、右侧栏一直是宿主那套灰白；想整套界面换个色调只能改系统主题。
- **配色分两层，互不干扰**：工具栏上现在是两个下拉框——**「页面配色」**（纸张，改的是渲染出来的 PDF 页）与新增的**「界面配色」**（默认 / 淡蓝色 / 淡绿色，改的是阅读器自己的外壳）。选「淡蓝色 + 纸张纹理」这类组合是允许的，两种偏好各存各的字段（`theme` / `uiTone`）。
- **不是逐条重写样式，而是就地重声明宿主 token**：`.elr-tone-blue` / `.elr-tone-green` 这两个类只做一件事——在自身子树里重新声明 `--dsw-alias-bg-base` / `-bg-layer-1` / `-bg-layer-2` / `-bg-overlay` / `-border-l1` / `-border-l2` / `-brand-primary` / `-label-primary` / `-label-secondary` / `--dsw-specific-sidebar-fill`。因为工具栏、功能卡片、卡片标题条、分隔条、状态栏本来就全部消费这几个 token，**一处声明就把整套外壳一起换色**，而且「默认」档一个字节都没变（类名不出现时宿主主题原样生效）。
- **文字色也一起改**：淡色底配上宿主深色主题的近白字会看不清，所以每套配色都是自带前景色的**完整浅色**方案（深蓝灰 / 深绿灰正文 + 相应品牌色）。
- **浮层卡片要单独加类**：内联翻译浮层、公式卡片、批注气泡、右键菜单、拖动拖影都是 `createPortal` 到 `document.body` 的，**不是** `.elr-view` 的后代，继承不到根上的配色类，因此这五个节点各自显式拼上同一个 `toneCls`。
- **脏值兜底**：载入快照时把 `uiTone` 归一为 `default` / `blue` / `green` 三值之一，否则一个拼错的值会让所有 `.elr-tone-*` 规则都不匹配、界面变成没有样式的裸装。
- **渲染出来的 PDF 页面不受影响**：纸面颜色仍由「页面配色」决定，界面配色只涂外壳。

**本地验证**：`node --check` 通过；静态 + 桩渲染校验 **67/67**（字段 / 归一化 / 选择器 / 根类 / 五个 portal 节点 / 两条 CSS / 四个双语词条 / 172-172 词典一致），含真实行为用例——「默认档不出现任何 `elr-tone-` 类」「选淡蓝色后根节点带上 `elr-tone-blue`」「再选淡绿色换成 `elr-tone-green`」「切回默认后类名消失」。live smoke：`/meta` 200、四个 vendor 资源 `?v=1.0.43` 全部 200（`pdf_viewer.js` 里 `DEFAULT_CACHE_SIZE = 40` 仍在）、`nope.txt` 404、`POST /translate` 200（1906 ms）。

### v39 · 1.0.42

**阅读工具栏里加了「文中搜索」框（v39 #1）**

- 现象需要：读长论文时想找某个词 / 某个实验名，只能一路滚或翻页找，找到还得自己数在第几页。
- **做法：工具栏上一个搜索框 + 命中计数 + 上下切换。**
  - 搜索框放在 PDF 工具栏（拖动漫游按钮之后、阅读配色下拉之前），与缩放框同高 28px、同样式，输入时边框变品牌色、有命中变琥珀色。输入框提示「在论文中搜索」。
  - **回车 = 下一个，Shift+回车 = 上一个，Esc = 清空**；框右侧是 `n / m` 计数与 ▴ / ▾ 两个按钮，走到末尾会**回绕**到第一个。
  - 命中来源与高亮批注**完全同一套索引**（`pageIndexOf`：把每页 `.textLayer span` 的文本去掉空白后拼成 `pageText`，并记下每段的起点与「压缩下标 → 原始下标」映射）。因此搜索对**任何有文字层的页面**都有效，不依赖 pdf.js 的私有 API，而且和批注匹配的是同一批字符串，不会出现「批注找得到、搜索找不到」。
  - 命中以 `{ page, at, len }` 存成页内字符偏移；**矩形在绘制时按当时的 span 实时算**，所以缩放只会重画、不会重新搜索。
  - **跳转沿用 v22 的做法：先设 `currentPageNumber` 再滚动**。pdf.js 只给当前页附近的页面建立 DOM，先滚再切会滚到一个不存在的元素上。`requestAnimationFrame` 里重新查一次这一页的 span，找到包含命中位置的那一段，再 `scrollElementIntoView()`（目标位置落在视口上方 25% 处，不做整页对齐，读起来更连续）。
  - **命中叠在自己的 canvas 层上**（`.elr-find-overlay`，`z-index: 4`、`multiply`），和批注的 `.elr-hl-overlay` 是两个类——批注那一趟在重画时会 `clearPageOverlay()` 清掉自己那层，如果共用同一个 canvas 槽位，搜索命中会被批注顺手删掉。当前命中用更深的橙色、其余用浅橙，同一页有多处命中时**分两层画**，一眼能分清「现在停在哪一处」。缩放 / 换主题会重建页面 canvas，所以 `applyTheme()` 末尾会跟着重画一次命中。
  - **改了查询词就清掉旧命中**：`findSearchedRef` 记住当前结果是哪个词搜出来的，`onChange` 里比对，不一致就立刻把计数归零——否则改一个字母后按回车会沿着**上一个词**的命中跳，计数还显示成新词的 3/17。
  - 上限 `MAX_FIND_HITS = 600`，避免在几百页的大部头里把命中数组撑爆。

**本地验证**：`node --check` 通过；静态校验 **47/47**（常量 / 五个函数 / 独立 overlay 类 / 工具栏接线 / 8 条 CSS / 6 个双语词条 / 168-168 词典一致）；桩渲染 harness **24/24**，含真实行为用例——「在两页里搜 `sparse gating` 得到 2 处命中共显示 `1/2`」「点 ▾ 走到 `2/2`、再点回绕到 `1/2`」「点 ▴ 反向回绕到 `2/2`」「改查询词后计数立刻变 `0/0`」。live smoke：`/meta` 200、四个 vendor 资源 `?v=1.0.42` 全部 200、`nope.txt` 404、`POST /translate` 200。

### v38 · 1.0.41

**右侧停靠时，每张卡片可以拖下边界单独改高度（v38 #1）**

- 现象：功能栏停靠在右侧时，卡片只能**平分**功能栏高度（v37 的行为），想把「选中翻译」拉高一点、把「术语解释」压扁一点都做不到——找不到任何可以拉的地方。
- **根因：v37 让几张卡片平分高度，却没有地方记住「这一张要高一点」。** `.elr-side-body > .elr-sec { flex: 1 1 auto }` 的意思是「大家一起分」，每次布局都会重新算，所以即使临时改一下高度也会被下一次布局抹平。要打破平分，就得有一张卡片退出这个分配（`flex: 0 0 auto` + 明确的像素高度）。
- **做法：新增「每卡高度」记忆 + 卡片下边界拖柄。**
  - 快照新增 `cardHeights: {}`（与 `cardWidths` 对称）：缺省表示「照旧平分」，某个键有值表示「这张卡片固定这么高」。读入时按 `已知卡片 + 有限数值 + ≥ 84` 过滤，脏数据直接丢弃，不会渲染出一张零高度的卡片。
  - 卡片下方的 7px 横条 `.elr-card-rz.is-bottom`（`cursor: row-resize`）**只在右侧停靠、且卡片未折叠时渲染**——下方停靠时几张卡片横向并排，它们的高度由整行决定，给单张卡片设高度只会得到一个内容没变的更高的空盒子。
  - 手势沿用 v34 的规矩：`pointermove` 期间只往 DOM 写 `style.height`（`frameWriter` 每帧一次），松手才 `setCardHeights` 提交一次，因此拖动过程中不会触发 React 重渲染。
  - 上下限：`CARD_MIN_H = 84`（与 CSS 的 `min-height: 84px` 保持一致，避免「拖到 60 但看起来停在 84」的错位）；上限是「列高 − 84」，不让一张卡片把整列吃光。
  - **双击下边界可以「取消固定」**，卡片回到平分状态——否则一旦拖过就再也回不到自动布局了。
  - 折叠状态下不渲染这个拖柄、也不套用存下来的高度（折叠卡片只有标题条，`is-collapsed` 已经把它踢出了高度分配）。
- 顺带把两处 `setState` 改成函数式更新（`setCardWidths((prev) => …)` / `setCardHeights((prev) => …)`）：闭包里捕获的 `cardWidths` 可能已经过期，连拖两张卡片时会用旧对象覆盖掉上一张的结果。

**本地验证**：`node --check` 通过；静态校验 **30/30**（快照字段 + 过滤器 + 手势 + 渲染条件 + CSS + 双语词条 `card.resizeH` + 162/162 词典一致）；桩渲染 harness **39/39**——含「拖动下边界 120px 后 DOM 即时变高、松手才写进 `localStorage`」「低于下限夹到 84」「超过列高夹到 816」「折叠卡片没有下边界拖柄」「双击取消固定」等真实手势用例。live smoke 见下方运行记录（`?v=1.0.41`）。

### v37 · 1.0.40

**卡片内部内容跟随功能栏大小自适应（v37 #1）**

- 现象：把功能栏拉高（右侧停靠）或拉宽（下方停靠）以后，**卡片只是变大，里面的内容不动**——译文、近期阅读、术语表、批注列表都停在原来的高度，多出来的空间变成一条空白；反过来把功能栏缩小，内容就被卡片直接裁掉，看不到滚动条。
- **根因：三类列表都写着写死的像素上限，卡片本身也不参与高度分配。**
  - `.elr-recent-list { max-height: 168px }`、`.elr-marks-list { max-height: 200px }`、`.elr-terms-list { max-height: 200px }`——**像素上限是绝对值**，卡片再高列表也不长。
  - 右侧停靠时 `.elr-side-body > .elr-sec` 是 `flex: 0 0 auto`（按内容高度），所以卡片永远只有自然高度，功能栏多出来的高度没人用。
  - 卡片内部的 `.elr-recent` / `.elr-marks` / `.elr-terms` 都不是 flex 容器，即使外层给了高度也无法传给下面的列表。
- **修复：让高度从功能栏一路传到列表，列表自己滚动。**
  - `.elr-sec` 改为 `display: flex; flex-direction: column; min-height: 0`——卡片成为能装高度的竖列。
  - 新增 `.elr-side-body > .elr-sec { flex: 1 1 auto; min-height: 84px; }`：右侧停靠时几张卡片**平分**功能栏高度，拉高一起变高、压矮一起变矮，84px 是下限（不会压成只剩标题条）。
  - 新增 `.elr-side-body > .elr-sec > * { flex: 1 1 auto; min-height: 0; }`：把高度交给卡片内部根节点。
  - `.elr-recent` / `.elr-marks` / `.elr-terms` 与 `.elr-sel-card` 都改为 `flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column`。
  - 三个列表的长度上限换成 `flex: 1 1 auto; min-height: 0; overflow: auto`：**空间有多大就长多大，装不下就在卡片内部滚动**。
  - 选中翻译卡片里，标题行与英文编辑框保持原高度（`flex: 0 0 auto`），只有译文框吃剩余空间，所以译文框会随着功能栏一起变大变小；用户自己拖过的 `selEditH` / `selResultH` 仍然记着，只是会被 `max-height: 100%` 兜住。
- **折叠的卡片不吃高度**：`.elr-side-body > .elr-sec.is-collapsed { flex: 0 0 auto; min-height: 0 }`，收起来的卡片只剩标题条，不会留一个空盒子占着一份高度（渲染时按 `recentOpen` / `marksOpen` / `termsOpen` 打上 `is-collapsed` 类）。
- **两处故意保留的上限**：`.elr-term-body { max-height: 320px }`（术语解释正文）和 `.elr-mark-text { max-height: 48px }`（列表里每条批注的摘要）是**列表内部**的二级滚动区，配合外面已经在自适应的列表使用，不做改动——否则一条很长的术语解释会把整个术语表撑爆。
- **踩到的坑（已修）**：改 CSS 时一度把 `flex: 0 0 auto` 写成一条**独立**的 `.elr-marks-head { flex: 0 0 auto; }` 规则。同等特异度下后写的规则覆盖前者，会把已经合并到主规则里的 `display: flex` / 内边距 / 背景色全部复位，标题条会变成一行普通文字。现已合并进主规则并加了一条静态断言（`no stray marks-head reset`）防止复现。

**本地验证**：`node --check` 通过；静态校验 40/40（卡片竖列、三条 `flex` 规则、三种列表无 `max-height`、两处二级滚动区保留、标题条 chrome 未被复位、`is-collapsed` 已接上）；桩渲染 harness 23/23——6 个 slot 注册、渲染出 133 个节点且包含 `elr-side-top` / `elr-side-body` / `elr-sec` / `elr-terms` / `elr-marks` / `elr-recent` / `elr-sel-card`、八条卡片拖柄、inline 词典 161/161 与 `locale/*.json` 一致（本次无新增文案，无需新增 key）。live smoke：`/meta` 200、四个 vendor 资源 `?v=1.0.40` 全部 200（320004 / 233111 / 56588 / 277038 字节）、`nope.txt` 404、`POST /translate` 200（3238 ms）。

### v36 · 1.0.39

**拖动卡片换位置时「位置没有交换」（v36 #1）**

- 现象：把第一张 / 第二张卡片的标题条拖到**最右边那张卡片**上松手，顺序没有变化（往左拖却正常）。
- **根因：插在哪一侧是按「鼠标落在目标卡片的哪一半」判断的，而落点语义并不是这样的。**
  - v32 给 `moveSection()` 加的规则是「`pos === 'below'` 就插到目标之后」，`pos` 由 `onDragOver` 里 `e.clientX > rect.left + rect.width / 2` 算出——也就是**鼠标在目标卡片右半边**才算「之后」。
  - 从左边往右拖时，鼠标自然停在目标卡片的**左半边**，于是 `pos = 'above'`，被拖的卡片插到了目标的**前面**；而目标本来就是最右那张，插到它前面 = 目标仍然在最右，看起来就是「没动」。
  - 往左拖之所以正常，是因为落点在目标的右半边（`pos = 'below'`）恰好等于「插到目标后面」，视觉上确实交换了。这就是「只有左→右失效」这种不对称的来源。
- **修复：落点改成「被拖的卡片占据目标卡片的槽位」，方向只由**出发位置与目标的先后**决定。**
  - `moveSection` 签名从 `(from, to, pos)` 改为 `(from, to)`，内部 `const after = fromAt !== -1 && toAt !== -1 && fromAt < toAt;` 再 `splice(after ? at + 1 : at, 0, from)`：从左边来的落到目标之后，从右边来的落到目标之前。
  - 这是所有列表拖拽的通用语义，也是用户说的「交换」：**拖到哪张卡片上，就站到它那个位置上**，目标被顶到相邻的一侧。
  - `onDragOver` 不再读任何 `getBoundingClientRect()` / `clientX`，只用 `sectionOrder` 里两者的先后算 `pos`，因此**鼠标停在目标卡片的左半还是右半完全不影响结果**；`onDrop` 也不再读 `overPos`。
- **顺带修掉一个隐患**：`onDrop` 以前依赖 `overPos` 这个 React 状态。若浏览器没有先派发 `dragover`（快速拖动、从卡片边缘直接松手、离开再进入子元素导致 `onDragLeave` 清了 `overPos`），`overPos` 就是空串，只能退回方向兜底。现在落点不再依赖任何状态，**有没有 dragover 都得到同一个结果**。
- **指示条同步改成横向**：底部停靠时卡片是一排，原来的 `.over-above::before` / `.over-below::after` 却把 3px 高亮条画在**上下边缘**，等于提示了一条不会发生的结果。现在底部停靠下改成画在**左右边缘**（`.elr-body.dock-bottom .elr-sec.over-above::before { left: 0 }` / `.elr-body.dock-bottom .elr-sec.over-below::after { right: 0 }`），右侧停靠（纵向堆叠）仍保留上下边缘。

**本地验证**：用一个桩渲染 harness 真正调用卡片的 `onDragStart` / `onDragOver` / `onDrop`，读回 `localStorage['elr.snapshot'].sectionOrder`。截图里那份配置（三张卡片 `selection / marks / recent`）的 **18 种组合**现在都得到正确结果，且「鼠标在左半 / 右半」「有没有先 dragover」三种情形**完全一致**：`drag 0 -> 2` → `marks,recent,selection,terms`（被拖的卡片确实落到了最右），`drag 1 -> 2` → `selection,recent,marks,terms`，`drag 2 -> 0` → `recent,selection,marks,terms`。静态校验 25/25、`node --check` 通过、inline 词典 161/161 与 `locale/*.json` 一一对应（本次无新增文案）。

### v35 · 1.0.38

**新增：专业名词解释卡片（v35 #1）**

- **入口**：在 PDF（或「文本」模式）里选中一个词 / 短语 → 右键 →「解释术语」。菜单项排在「解释公式」之后，因为它同样针对「选中的一小段文本」，放在一起符合直觉。
- **Host `POST /term`**（`index.js`）：`term` 限制 200 字符、`context` 限制 40000 字符，另有一个 v35 新增的可选字段 `surrounding`（该名词所在的原句，限制 2000 字符）。
  - **为什么要把原句单独发一份**：只给一个词，模型只能给通用释义；把这句原文单拎出来一起发，它才能锁定这个词**在这篇论文里**的那层含义（哪个模块、哪个量、哪个任务），这也正是「根据上下文和论文专业领域解释」的字面要求。
  - `TERM_SYSTEM` 提示词固定输出四段中文 Markdown：`## 术语含义` / `## 在本论文中的含义` / `## 所属领域与相关概念` / `## 理解要点`。规则里写明：先展开缩写并给出英文全称与标准中文译名；「在本论文中的含义」必须落到具体组件 / 量 / 任务 / 数据集上，文中没写就写「文中未明确说明」；「所属领域与相关概念」要点名领域与 2–4 个易混概念及其区别；「理解要点」用大白话给直觉与注意事项；**禁止编造定义、引用与数字**。
- **收录成术语表**：解释返回后自动写入新增的「术语解释」卡片（`localStorage['elr.terms.<paperId>']`，记录 `{id, term, body, surrounding, at}`）。
  - **为什么不复用「高亮与批注」的记录**：标注记录要靠文本去匹配 PDF 里的 span 才能在页面上画出来，而术语表是按名字索引的词典，两者生命周期与查找方式完全不同；混在一起会让「重新解释同一个词」变成一堆重复标注。
  - `addTerm()` 按术语名（忽略大小写）去重，**同一个词再解释一次是替换**，不会堆重复条目。
  - 术语表按论文分别保存，关掉文献、切走标签页、刷新浏览器都还在；`removeTerm()` 单独删除一条。
- **卡片 UI**：`.elr-terms` / `.elr-terms-head` / `.elr-terms-list` / `.elr-term-item`，标题条与其它卡片同一套 chrome，左侧强调条用品牌蓝；标题右侧在解释进行中显示 `term.runningShort`，平时显示条目数。点条目名展开 / 收起，展开后先回显 `term-quote`（那句原文），再用 `renderMarkdown()` 渲染解释正文（正文区 `max-height: 320px` 内部滚动）。空状态显示 `term.empty`。
- **与既有机制的接线**：`CARD_KEYS`、`cardLabel()`、`DEFAULT_SHARED.cards` / `.sectionOrder`、`cardWidths` 清洗、`moveSection()`、`nodes` 渲染表全部加上 `terms`，因此新卡片**一开始就和其他卡片完全等价**——可关闭、可在 ⚙ 里重新启用、可拖动排序、可拖左右边界改宽、停靠下方时同样参与横向排布。旧快照里没有 `terms` 的数组会在载入时被 migration 补齐（插在 `recent` 之后）。
- **选中态修复**：右键菜单的 `setMenu` 现在两处都带上 `surrounding`——命中已标注语句时取那条记录的文本，自由选区时用新增的 `sentenceAround(raw, term)` 从全文里切出该词所在的整句（向前找到 `[.!?;]` 之后的边界，向后找到 `[.!?]`，最多 600 字符）。

**本地验证**：静态/渲染双检全部通过（6 个 slot 注册、167 个节点、四张卡片与左右两条拖柄共 8 个 `.elr-card-rz`、inline 词典 161/161 且与 `locale/*.json` 一一对应、Host `/term` 路由与四段标题齐备）。实际接口冒烟：`POST /term`（`{term:"sparse gating", context, surrounding}`）返回 200、耗时 14312 ms，正文首段为 `## 术语含义`，「在本论文中的含义」正确落到 feed-forward 块与可学习门上，文中没给的细节写成了「文中未明确说明」。

**文案**：两种语言各新增 9 个键（`term.cardTitle` / `term.explain` / `term.running` / `term.runningShort` / `term.failed` / `term.empty` / `term.toggle` / `term.remove` / `term.needPaper`），inline 词典与 `locale/en.json` + `locale/zh.json` 同步更新，共 161 个键。

### v34 · 1.0.37

**1. 选中翻译卡片里，中文译文超出时现在能滚动（v34 #1）**

- 现象：译文长起来以后，文字被卡片下边缘直接切掉，既看不到剩下的内容，也没有滚动条。
- **根因**：`.elr-sel-text` 本身有 `overflow: auto`，但它同时被写死了一个**固定高度** `selResultH`（默认 150px），并且内联样式还带着 `max-height: none`。卡片里「英文明文框 96px + 译文框 150px + 两个拖柄 + 标题条」的自然高度约 300px，一旦卡片（尤其下方停靠时）比这个矮，**被裁掉的是卡片 `overflow: hidden` 的边框盒**，里面的文字框根本没拿到「自己的高度小于内容高度」这个条件，于是永远不出现滚动条——看起来就是「文字超出就没了」。
- **修复**：让译文框的高度变成 `min(用户拖出来的高度, 卡片实际给得起的空间)`：
  - `.elr-sel-result-wrap` 变成 `display: flex; flex-direction: column; min-height: 0`，成为真正的高度容器；
  - `.elr-sel-text` 加上 `flex: 1 1 auto; min-height: 0; max-height: 100%; overscroll-behavior: contain`，于是它永远不超过父容器，超出部分在**它自己身上**滚动；
  - 内联 `maxHeight: 'none'` 删除，`.elr-sel-card` 补上 `overflow: hidden`，把「裁切」责任交给卡片、把「滚动」责任交给文字框。
- 现有的竖向拖柄（`hlineGrip`）逻辑完全不变：空间够时可以照样把译文框拖高，只是拖到超过卡片时不再「溢出被切」，而是卡在卡片高度并滚动。

**2. 拖动功能栏 / 分隔条 / 卡片边界的卡顿（v34 #2）**

- 现象：v32 已经改成「拖动时不 setState、松手才提交」，但拖起来仍然明显掉帧，尤其是功能栏右侧停靠、PDF 已经整篇预渲染的情况下。
- **根因**（v32 只解决了一半）：
  1. **每个 `pointermove` 都写一次 DOM 样式**。`pointermove` 不是按刷新率触发的：普通鼠标 ~125Hz，高回报率鼠标可达 1000Hz。而每一次写 `width` / `height` 都会让浏览器重新布局整个阅读区——PDF 每一页都是 `margin: 1px auto` 的居中盒子，宽度一变，**所有已渲染的页面都要重新算位置并重绘 canvas**。写 1000 次就重排 1000 次，可屏幕只刷了 60 帧。
  2. **`.elr-pdf-container` 没有布局隔离**。pdf.js 的 `ResizeObserver` 盯着这个容器，容器尺寸一变就 `docStyle.setProperty('--viewer-container-height', …)`；再加上没有任何 `contain`，内部重排会向上冒泡，牵连整棵树。
  3. **手势期间仍挂着过渡动画与命中测试**：每张卡片都有 `border-color / box-shadow` 的 0.12s transition，鼠标移到 PDF 区域还会触发文本层/选区的命中测试。
- **修复**：
  - 新增 `frameWriter(paint)`：把待写入的值存成「最新值」，用 `requestAnimationFrame` 合并，**一帧最多写一次 DOM**（`setTimeout(run, 16)` 兜底）。所有手势都改用同一个书写器。
  - 迁移到 `frameWriter` 的手势共 **10 处**：① 功能栏外侧分隔条（改宽度/高度）；② 功能栏内部那根分隔条（改高度/宽度）；③ 卡片左右边界（`beginCardResize`）；④ 选中翻译卡片的竖向拖柄（`hlineGrip`）；⑤ 浮层八边缩放（`resizeHandles`）；⑥ 浮层标题栏拖动；⑦ 浮层内部「英文框 / 译文框」的比例拖柄（`rebalance`）；⑧ 公式卡片标题栏拖动；⑨ 批注气泡标题栏拖动；⑩ 拖影（v32 已经是 rAF）。
  - 新增 `gestureStart()` / `gestureEnd()`：手势期间在 `<body>` 上挂 `.elr-gesturing`，CSS 里 `body.elr-gesturing * { transition: none !important }`（动画不参与每帧重排）、`.elr-pdf-container { pointer-events: none !important }`（拖动时不跑选区命中测试）、`cursor: grabbing; user-select: none`。松手立刻摘掉，动画恢复正常。
  - `.elr-pdf-container` 加上 `contain: layout paint style`。**刻意不用 `contain: strict`**：它隐含 size containment，会让这个绝对定位的盒子塌成 0 高度（PDF 直接消失）。
  - 所有手势统一「按下 → 每帧写 DOM → `pointerup` 提交一次 state」；`pointercancel` 也一样收尾，不会漏掉拖影或 `userSelect`。

**无新增文案**：两种语言仍各 152 个键，inline 词典与 `locale/*.json` 一一对应。

### v33 · 1.0.36

**1. 功能栏标题行常驻顶端，不再跟着卡片滚走（v33 #1）**

- 现象：卡片一多、功能栏一矮，往上滚时「功能栏」这行标题和右边的 **⚙ 管理功能卡片** 会一起滚出视野，想点 ⚙ 得先滚回顶部。
- **根因**：标题行（`.elr-col-head.elr-card-head`）、⚙ 展开的菜单、以及三张卡片，**是同一个滚动容器 `.elr-side-top` 的三个平级子元素**。滚动条长在它们的共同父级上，标题自然跟着内容一起移动。
- **修复**：把结构拆成「固定头 + 独立滚动体」。外层 `.elr-side-top` 只负责堆叠三行 `[标题行][⚙ 菜单][卡片区]`，`overflow: hidden`、`padding: 0`，不再滚动；卡片移进新的内层 `.elr-side-body`，滚动（`overflow: auto` + `overscroll-behavior: contain`）只发生在这一层。标题行与 ⚙ 因此永远是 `flex: 0 0 auto` 的第一行，卡片怎么滚都不影响它。
- 停靠下方时同理：外层从横排改为**纵向**（标题占第一行），内层 `.elr-side-body` 才是那一行横排卡片并横向滚动。⚙ 菜单也不再靠 `order: -1` 抢位置，改成老老实实待在自己那一行。

**2. 功能卡片的左右边界现在真的能拖（v33 #2）**

- 现象：卡片边缘没有可拖的区域，鼠标上去没有 `col-resize` 光标，拖也拖不动。
- **根因一（致命）**：拖柄只在 `dock === 'bottom'` 时才渲染——默认是右侧停靠，那个分支根本不执行，DOM 里连节点都没有。
- **根因二**：即使在下方停靠，也只有一条 **5px、只贴右边缘**的细条，而且最后一张卡片的拖柄被 `:last-child { display: none }` 隐藏掉了。「左右边界」两边永远有一边（甚至两边）是空的。
- **修复**：每张卡片**无条件**渲染两个拖柄 `.elr-card-rz.is-right` / `.is-left`，各 7px 宽，贴着卡片边框的内侧（`right: 0` / `left: 0`，`z-index: 3` 盖在卡片内容之上），`::before` 画 1px 竖线，只在 hover / 拖动时显示品牌蓝。旧的 `:last-child` 隐藏规则整条删除。
- **为什么不能把拖柄放到边框外面（`right: -3px`）**：卡片 `.elr-sec` 是 `overflow: hidden`（圆角需要），探出边框盒 3px 的部分会被**裁掉**，被裁掉的区域不参与命中测试——拖柄等于还是不存在。所以两个拖柄都落在卡片自己的边框盒内，靠 `z-index` 压在标题条与卡片正文之上，代价是每张卡片左右各让出 7px 的标题栏点击区（卡片头只是文字和 ⚙，不心疼）。
- **两种停靠各自缩放什么**：下方停靠时卡片是横排的，拖左右边界改的是**这张卡片自己**的宽度（写进 `cardWidths`，兄弟们自动重排）；右侧停靠时卡片本来就是满宽，所以左右边界改的是**卡片栏本身的宽度**（也就是 `sideWidth`，和外侧那条分割条同一个值）——这是右栏里「卡片宽度」唯一说得通的含义，总比拖了没反应好。
- **实现细节**：`beginCardResize(key, side)` 用 `side` 决定方向系数（左柄 `-1`，即往左拖变宽），卡片用 `grip.closest('.elr-sec')` 定位（不再依赖 `parentElement` 这种「拖柄必须是直接子元素」的脆弱假设），并补上 `setPointerCapture`、`pointercancel`、`document.body.style.userSelect = 'none'`、只响应左键，以及 `CARD_MIN_W = 140` / `SIDE_MIN` 的上下夹紧。仍然是「拖的时候只写 DOM，松手 commit 一次」的老规矩，拖动过程零重渲染。

**无新增文案**：`card.resize` 复用 v32 的键，两种语言各 152 个键，inline 词典与 `locale/*.json` 一一对应。

### v32 · 1.0.35

**1. 停靠下方时可按卡片单独调宽（v32 #1）**

- 需求：功能栏在下方时，能通过拉侧边单独调整每一张功能卡片的宽度。
- 新增共享字段 `cardWidths`（`{ selection?, recent?, marks? }`，单位 px）。缺省的键表示「没有覆盖值」，该卡片继续 `flex: 1 1 200px` 均分剩余宽度——所以从没拖过的列看起来和以前完全一样。迁移时只保留已知键且 `>= 140` 的值，非法数据直接丢弃。
- 底栏每张卡片右缘渲染一条 `.elr-card-rz`（5px、`cursor: col-resize`，绝对定位 `top:0; right:0; bottom:0`，不占文档流，所以不会抢走正文的 5px）；最后一张卡片不渲染（右边没有下一张可挤）。**（v33 已重做：左右两条 7px 拖柄、两种停靠都生效，见上一条记录。）**
- **为什么要 `draggable: false` 并 `stopPropagation`**：卡片本身是 `draggable="true"` 的排序手柄宿主，其子元素上按下指针会启动浏览器原生拖动，抢走 `pointermove`。把拖柄标成不可拖动并在 `pointerdown` 里阻断冒泡，才能让缩放真正接管。
- 手势规则与两个分割条保持一致：按下时记 `startW` + `startX`，`pointermove` **只写 `card.style.width`**，`pointerup` 才 `setCardWidths(...)` 落库一次；`CARD_MIN_W = 140` 夹紧下限，避免拖成一条看不清内容的窄缝。
- 底栏的 `flex-wrap` 从 `wrap` 改为 `nowrap`：手动定宽只有在「不换行」时才是所见即所得，否则一拖宽就会挤到第二行。放不下时改为横向滚动。

**2. 修复「左侧卡片拖到右侧卡片上不换位」（v32 #2）**

- 现象：右往左拖能换位，左往右拖完全没反应。
- **根因**：`moveSection(from, to)` 一直是「把 `from` 插到 `to` **之前**」——`next.splice(at, 0, from)`。当 `from` 本来就在 `to` 左边时，先 `filter` 掉 `from` 再插回 `to` 之前，结果数组**与拖动前完全一致**，所以看起来什么都没发生；反方向时插入点确实变了，因此「右往左」正常。
- **修复**：`moveSection(from, to, pos)` 增加第三个参数，由落点指示条决定插入在目标之前还是之后：`pos === 'below'` 取之后，`pos === 'above'` 取之前；没有记录到位置时退回「按原索引大小判断方向」。调用点改为 `moveSection(dragKey, key, overPos)`，与用户看到的 3px 插入条严格一致。

**3. 拖动卡片 / 拖动功能栏尺寸明显卡顿（v32 #3）**

- **根因**：两条手势路径都在每个事件里 `setState`。`dragover` 与 `pointermove` 都是 ~60 次/秒，而 `Reader` 的一次渲染要重建 PDF 容器、三张卡片、若干 portal，于是每一帧都在做一次全量 diff——这正是卡顿的来源（不是 CSS 动画的问题）。
- **拖影**：改为**不经 React**。`dragover` 里只记下最后一个坐标，用 `requestAnimationFrame` 合并（一帧最多写一次），直接把 `left`/`top` 写到 `.elr-drag-ghost` 的 DOM 节点（`cardGhostRef`）上。React 状态只保留「拖的是哪张卡、原始尺寸」这类一次拖动内不变的量。
- **两个分割条**：`pointermove` 里只把待定像素值写到 `sideElRef` / `sideTopElRef` 的 `style.width` / `style.height`，松手时才 `setSideWidth` / `setSideHeight` / `setSideTopWidth` / `setSideTopHeight` 并写 `localStorage`。也就是**一次拖动只重渲染一次**，而落库的值与屏幕上看到的完全一致。
- 顺带补上 `setPointerCapture`（指针移出 6px 细条也不断）、`pointercancel`、`document.body.style.userSelect = 'none'`（拖动时不误选文字）、以及只响应左键（`e.button !== 0` 直接返回）。

**新增文案**：`card.resize`（EN `Drag to resize this card` / ZH `拖动可调整这张卡片的宽度`），同时写进 inline 词典与 `locale/en.json`、`locale/zh.json`，两种语言各 152 个键，奇偶校验一致。

**验证**：`node --check` 通过；静态断言 26/26（版本与 `ASSET_V`、`moveSection` 三参签名与 after 分支、`onDrop` 传入 `overPos`、三个新 ref 已挂到 DOM、`rAF` 合并、`dragover` 里不再出现 `setGhost`、两处 `apply()` 只写 style、四处 `pointerup/pointercancel` 落库、`cardWidths` 默认值/迁移/选择器、`CARD_MIN_W`、`.elr-card-rz` 节点与 CSS、底栏 `nowrap`、双语文案）；vm 渲染 7 个注册（`conversation.view` / `shell.overlay` / `main` / `sidebar.panellist` / tab type / `sidebar.right.pane.tab` / `.title`），`conversation.view` 正常渲染出 `elr-view`，注册词典 152 键；重载后线上自测 `/meta` 200、`pdf.min.js` 200、`pdf_viewer.js` 200（`DEFAULT_CACHE_SIZE = 40` 仍在）、`katex.min.js` 200、不存在路径 404、`POST /translate` 200。
### v31 · 1.0.34

本次两项都只动右侧「功能栏」这一列，PDF 阅读区、分析、参考文献都没有改动。

**1. 功能卡片外观重做（v31 #1）**

- 旧结构是 `.elr-side-top` 里直接堆三个 `.elr-sec`，每个只有 `border-bottom`，视觉上是一条被横线切开的连续列表，分不出这是三个独立块。
- 现在 `.elr-side-top` 改成 `display: flex; flex-direction: column; gap: 9px; padding: 9px 10px`，每张卡片自己带 `border: 1px solid border-l1` + `border-radius: 10px` + `background: bg-layer-1` + `overflow: hidden`，并带 0.12s 的 hover 过渡（悬停时边框加深）。
- 卡片标题条（`.elr-sel-title` / `.elr-recent-head` / `.elr-marks-head`）改成 `background: bg-layer-2` + 下边框，字重 600、字号 12px、主文字色，并用 `box-shadow: inset 3px 0 0 <color>` 在左侧画一条 3px 强调条区分三张卡片：选中翻译=品牌蓝、近期阅读=绿色（`state-success-primary`）、高亮与批注=琥珀色（`state-warn-primary`）。
- 卡片内部的根节点（`.elr-sel-card` / `.elr-recent` / `.elr-marks`）去掉了自己的边框和底色，避免出现「卡片里还有一层卡片」的双重边框。

**2. 拖动时的拖影与放置高亮（v31 #2）**

- 以前拖动只有浏览器自带的半透明快照，尺寸和形状都不可控，落点提示只有一条 `inset` 阴影。
- 现在 `dragstart` 会读取源卡片的 `getBoundingClientRect()`，用 `createPortal` 往 `<body>` 里渲染一个 `.elr-drag-ghost` 全尺寸克隆（`position: fixed`、`pointer-events: none`、`z-index: 200`、品牌色描边 + 大阴影 + `scale(1.01)`）。
- **关键点：原生 HTML5 拖动期间浏览器不会派发 `pointermove` / `mousemove`**，所以拖影位置只能靠 `dragover`（在任意元素上持续触发）更新；`dragend` 负责清空。同时用 1×1 的 canvas 调 `setDragImage()` 把浏览器自带快照压掉，避免两个影子叠在一起。
- 落点提示分两级：拖到任意卡片上时该卡片获得 `.over`（品牌色描边 + `color-mix` 10% 品牌色底 + 2px 外环 + 浮起阴影）；再按鼠标在该卡片垂直中点上方还是下方，追加 `.over-above` / `.over-below`，用伪元素在对应边缘画 3px 高的品牌色插入条。
- 拖动期间整列加 `.drag-active`，其余卡片边框临时变成虚线，明确表示「这一列现在可以放」。

**新增文案**：`card.dragHint`（EN `Drop on another card to reorder` / ZH `拖到其他卡片上即可重新排序`），同时写进 inline 词典与 `locale/en.json`、`locale/zh.json`，两种语言各 151 个键，奇偶校验一致。

**验证**：`node --check` 通过；静态断言 30/30（卡片框、拖影、over/above/below、三处 `beginCardDrag`/`endCardDrag` 接线、三条强调条、`dragHint` 双语文案、无残留 `elr-side-cols`）；vm 渲染 13/13（7 个 slot 注册、`conversation.view` 正常渲染 `elr-view`、词典 151 键）；重载后线上自测 `/meta` 200、`pdf.min.js` 200（319989 B）、`pdf_viewer.js` 200（232603 B，`DEFAULT_CACHE_SIZE = 40` 仍在）、`katex.min.js` 200（277038 B）、不存在路径 404、`POST /translate` 200（1909 ms）。

### v30 · 1.0.33

1. **预设列表宽度与百分比控件一致、选项数字居中**（需求：缩放百分比的下拉列表宽度和百分比按钮的宽度保持一致，且下拉列表里的每个选项内的数字都保持居中显示）。
   - **根因**：`.elr-zoom-menu` 是 `right: -1px` + `min-width: 92px` 的绝对定位盒——左边不定位，宽度取「92px」与「内容宽度」的较大值，于是展开后的列表比上面的输入框更宽或更窄，视觉上像个错位的弹层。
   - **修复**：改为**左右同时贴边**（`left: -1px; right: -1px`，-1px 正好对齐容器自己的 1px 边框），再加 `box-sizing: border-box`，宽度就完全由容器决定——无论输入框是 46px 还是换成别的宽度，列表永远与它等宽；`min-width: 92px` 已删除。
   - **数字居中**：`.elr-zoom-item` 从 `text-align: left; padding: 4px 8px` 改为 `text-align: center; padding: 4px 0`，每一档百分比在列中水平居中，整列数字形成一条竖直中线；`.active` 的加粗不会让文字左右跳动。

### v30 · 1.0.32

1. **修复「论文分析与下面的分界线间距不对」**（反馈：论文分析参考文件和下面的线的间距有问题）。
   - **根因**：`.elr-tabs`（承载「论文分析 / 参考文献（N）」两个分段按钮的那一行）原来是 `padding: 7px 12px 0`——**底部内边距是 0**。分段按钮组 `.elr-segment` 自己带 1px 边框和 8px 圆角，而这一行又有自己的 `border-bottom: 1px solid`，两者之间零间距，于是渲染出来像一条**双线**，按钮的下圆角也被贴着线「切」掉，看起来就是间距错乱。
   - **修复**：改为 `padding: 8px 12px`，上下对称留出 8px；`.elr-tabs` 依旧是 `display: flex; align-items: center; gap: 4px`，所以按钮组的圆角完整露出，与下面的分界线之间也是一条干净的单线。

2. **修复「缩放百分比控件比旁边按钮矮、内部间距不均」**（反馈：缩放百分比窗口的高度和旁边按钮保持一致，缩放按钮内部的间距也有问题）。
   - **根因**：`.elr-zoom` 只有边框没有高度，实际高度由子元素撑出来——输入框 `padding: 3px` 约 22px，插入符 `padding: 4px 5px` + 9px 字形约 17px，取较大者仍是 **22px 左右**；而旁边的 `.elr-btn` 是 `padding: 6px 12px` + 1px 边框 + 12px 文字，约 **28px**。两者并排就明显一高一矮。内部间距也不均：输入框左 7px、右 0，所以数字贴着 `%`，右边又被插入符挤。
   - **修复**：容器定高 `height: 28px` + `box-sizing: border-box`，子元素一律 `align-items: stretch` / `height: 100%`，三段（输入框 / `%` / ▾）成为一个等高整体；输入框改 `padding: 0 1px 0 8px`（右留 1px 给 `%`，左留 8px 给数字）、`width: 46px`；`%` 用 `display: flex; align-items: center` 垂直居中并去掉多余右距；插入符 `padding: 0 7px` + `border-radius: 0 6px 6px 0`，两侧等距、悬停底色不会顶破容器圆角。

### v29 · 1.0.31

1. **修复「功能栏与论文分析之间的分界线无法上下拖动」**（反馈：截图里红框标出的那条边界拖不动）。
   - **根因**：这是一次 v18 引入的回归，不是样式问题。分界线只在**有论文打开时**才渲染（`hasPaper ? (sideTop, splitter, sideCol) : <空白提示>`），但给分界线绑定拖动事件的 `useEffect` 依赖数组是 `[mode, dock]`。冷启动时还没有打开论文，`splitRef.current` 是 `null`，effect 提前 `return`；等用户打开论文、分界线真正挂载之后，`mode` 和 `dock` 都没变，**effect 不会重新执行**，于是这条线看起来存在、`cursor: row-resize` 也有，却没有任何 pointerdown 监听——完全拖不动。
   - **修复**：把 `hasPaper` 提升到该 effect 之前声明（否则依赖数组里引用它会撞上 TDZ），并把依赖改成 `[mode, dock, hasPaper]`。论文打开的那一刻 `hasPaper` 从 `false` 变 `true`，effect 重新运行，这次 `splitRef.current` 已经有值，监听器才真正装上。
   - **顺带加固**：6px 的分界线太细，加了 `position: relative` + `::before` 把**抓取区**上下各扩 5px（视觉粗细不变，底部横向停靠时该伪元素旋转为左右各 5px）；`touch-action: none` 防止触屏把拖动当成滚动；`pointerdown` 时 `setPointerCapture(e.pointerId)`，鼠标移出 6px 细线也不会中断拖动；拖动期间给 `document.body` 置 `user-select: none` 避免顺带选中文字；只响应左键（`e.button !== 0` 直接返回）；松手时把尺寸写进快照（`writeStore(SNAP_KEY, shared)`），刷新后保持。

### v28 · 1.0.30

1. **缩放百分比输入框合并进下拉**（需求：上方缩放百分比输入栏合并到下拉栏里，也就是下拉列表栏中可以直接手动输入更改百分比）。
   - **问题**：1.0.28 的工具栏上并排着**两个**控件——`<input type="number">` 和 `<select class="elr-zoom-select">`。手输要进左边，选档要进右边，占地方且容易混淆；而 v25 那个 `<datalist>` 方案箭头在深色主题下又几乎看不见，所以不能退回 datalist。
   - **为什么不能直接用 `<select>`**：`<select>` 的 `value` 只能是它的某个 `<option>`，天然无法接受「输入一个不在选项里的值」。所以这里手写了一个组合控件：一个可输入的百分比框 + 右侧 ▾ 展开的预设菜单。
   - **实现**：`.elr-zoom`（`position: relative` + 边框/圆角的容器）里放 `input.elr-zoom-input`（`type="number"`，25–600，回车或失焦提交、Esc 取消、`ArrowDown` 展开菜单）+ `span.elr-zoom-suffix`（`%`）+ `button.elr-zoom-caret`（▾ / ▴），展开时在容器内绝对定位渲染 `.elr-zoom-menu`，逐项为 `.elr-zoom-item`（当前比例加 `.active` 高亮）。点某一档执行 `setZoomDraft(null); applyZoomPct(p); setZoomMenuOpen(false);`。
   - **关闭行为**：菜单打开时才挂 `document` 上的 `mousedown`（捕获阶段，点容器外即关）和 `keydown`（Esc 关）两个监听，卸载时立刻移除——不打开菜单就不占全局事件。
   - **原生微调箭头**：仍然用 `appearance: textfield` + `::-webkit-inner/outer-spin-button { -webkit-appearance: none; margin: 0 }` 关掉，理由同 1.0.28（和左边的缩小 / 放大重复）。
   - **结果**：工具栏上只剩一个控件，输入与选档是同一处；`zoomPct` 仍由 pdf.js 的 `scalechanging` 事件同步，所以 Ctrl+滚轮或 ± 按钮改完缩放，框里的百分比也是对的。

### v28 · 1.0.29

1. **功能栏标题改名**（需求：把「功能区域的选中翻译」改名为「功能栏」）。
   - **问题**：卡片列的标题行复用了 `t('selection.title')`（「选中翻译」），于是这一栏的总标题和第一张卡片的标题同名，看上去像是第一张卡片的标题而不是整栏的标题。
   - **修复**：新增独立键 `cards.title`（英文 `Cards`、中文 `功能栏`）专供这一栏使用；`selection.title` 保持不变，仍然是「选中翻译」卡片的标题、也仍然是卡片管理器里那一行的名字（`cardLabel('selection')`）。只改一处引用，不牵连其它文案。
2. **论文分析与参考文献改为切换显示**（需求：两者是切换显示、选中哪个显示哪个，不要并列）。
   - **问题**：v21 起参考文献是渲染在 `.elr-out` 分析滚动框里的**第二个子元素**（`.elr-col` 是 `flex: 1 1 0; overflow: hidden`，做兄弟节点会被裁掉），参考文献一长就把正文顶下去；1.0.28 先改成左右两栏各占 42% / 58%，但两栏都很窄、长标题和长地址挤成多行，观感差。
   - **修复**：改成**同一栏内的视图切换**。新增共享字段 `analysisTab`（`'summary'` | `'references'`，非法值回落 `'summary'`），右侧栏顶部用一个 `.elr-segment` 分段控件（复用 v1 就有的 `.elr-seg` 样式）在「论文分析」和「参考文献（N）」之间切换——**一次只挂载一个面板**，所以选中的那个总是拿满整栏宽度，不再有 42% 的窄条。参考文献标题里的条目数直接进了切换按钮，省一行空间。
   - **清理**：删掉 `.elr-side-cols` / `.elr-refs-col` 规则与底部停靠时对应的 `flex` 规则（切换式没有横向容器了）；`referencesPanel` 和 `summaryPanel` 现在是两个并列的可选面板，共用 `.elr-tabs` 下的分段控件与右侧的忙碌指示。新增键 `references.run`（「整理参考文献」/`Collect references`），用于还没查过时按钮的文案。
3. **缩放控件去箭头 + 恢复可见的常用比例下拉**（需求：百分比框的上下箭头和左边的缩小 / 放大重复，取消箭头，加入下拉列表的常用百分比）。
   - **问题**：`<input type="number">` 自带上下微调箭头，紧挨着「缩小 / 放大」两个按钮，功能完全重复且容易误点；v25 把常用档位做成了 `<datalist>`，箭头在深色主题下几乎看不见，用户实际找不到预设。
   - **修复**：CSS 关掉原生微调器（`appearance: textfield` + `::-webkit-inner-spin-button/::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0 }`）；旁边新增真正的 `<select class="elr-zoom-select">`，列出 `ZOOM_PRESETS`（50/75/100/125/150/200/300/400），选中即调用 `applyZoomPct()`，当前比例不在档位里时临时插入一项显示实际值，避免下拉显示空白。输入框仍然可以手输任意百分比（25–600），回车或失焦生效、Esc 取消。**（1.0.30 已按后续反馈把这一个 `<select>` 和输入框合并成同一个控件，此处保留为历史记录。）**
4. **「停靠：」改名「功能栏停靠：」**（需求：上端的停靠标签改名）。
   - 这个按钮移动的正是左侧那列功能卡片，所以两个标签改为「功能栏停靠：右侧 / 功能栏停靠：下方」（英文 `Card column: right` / `Card column: bottom`），内联词典与 `locale/*.json` 同步更新。

### v28 · 1.0.28

1. **功能栏标题改名**：卡片列标题行不再复用 `selection.title`，改用新键 `cards.title`（`功能栏` / `Cards`）。
2. **参考文献移到「论文分析」右侧**：先做过一版左右并排（`.elr-side-cols` + 参考文献 `flex: 0 0 42%`），因两栏都太窄，1.0.29 改为切换显示。
3. **缩放控件去箭头 + 恢复可见的常用比例下拉**：关掉原生微调器，恢复 `<select class="elr-zoom-select">` 常用档位。
4. **「停靠：」改名「功能栏停靠：」**。

### v27 · 1.0.27

1. **功能卡片可关闭 + 新增卡片管理入口**（需求：把「选中翻译 / 高亮与批注 / 近期阅读」称作功能卡片，卡片能关闭，并增加一个统一的管理入口）。
   - **设计**：新增共享字段 `cards`（启用集合）与既有的 `sectionOrder`（显示顺序）**分开保存**。如果只用一个数组，关闭一张卡片就得把它从数组里删掉，再启用时只能追加到末尾——用户辛苦拖出来的顺序会被悄悄改掉。两个字段各管一件事：`cards` 决定「显不显示」，`sectionOrder` 决定「排第几」。快照里缺 `cards`（老版本）或值非法时回落到三张全开；`cards: []` 是**合法**状态（全关），不会被当成缺失而自动打开。
   - **关闭入口**：三张卡片的标题行各加一个 `×`（`.elr-card-x`），点击只把该 key 从 `cards` 里移除，**不动任何数据**——高亮、批注、近期阅读记录、选区原文都照旧。`×` 上用 `stopPropagation`，所以点它不会顺带折叠这张卡片。
   - **管理入口**：卡片列标题行右侧新增 **⚙**（`t('card.manage')`），点开内联面板（不是浮层，随列一起滚动），三行复选框对应三张卡片，勾选状态由 `cards` 派生；面板底部有一句说明「取消勾选的卡片会从这一栏移除，内容不会被删除」。三张全关时该区域显示 `card.none` 文案，避免出现一片空白。
   - **渲染**：`sideTop` 现在按 `order.filter(key => enabledCards.includes(key))` 渲染，因此关掉的卡片既不占高度也不参与拖拽落点；`moveSection` 仍作用在完整的 `sectionOrder` 上，恢复后位置不变。
   - **停靠下方的适配**：v25 起 `.elr-side-top > .elr-col-head` 在底部停靠时是 `display: none`，那会把 `⚙` 一起藏掉。v27 给卡片列标题加了 `.elr-card-head` 例外（`flex: 1 1 100%; order: -1`，改为常显），并把管理面板在底部停靠时改为横向铺开的一行，保证宽而矮的空间里入口仍然可点。

### v26 · 1.0.26

1. **右侧「开始」面板里的「文献阅读器」入口消失**（现象：罗盘图标那一列只剩「工作区文件 / 新建终端 / 浏览器 / 桌宠对话 / 更多工具」五项，右下角胶囊按钮还在）。
   - **根因**：v21 的入口注册在 `apply(ctx)` **最开头**就去读 `ctx.get('sidebarRightTabs')` 拿到服务再注册。但这个服务是 `@deepseek-ai/dsh-client-ui-sidebar-right` 在**它自己的** `apply` 里用 `ctx.reflect.provide('sidebarRightTabs', tabs)`（`…/dsh-client-ui-sidebar-right/src/client/index.ts:182`）发布的，插件之间的 `apply` 顺序并不保证。于是我们读到的常常是 `undefined`，整段 `if (sidebarRightTabs && …)` 被跳过，**指南胶囊**和 `sidebar.right.pane.tab` 的**页面主体**双双没注册——只看得到 `conversation.view`（它注册得更晚，那时服务已经就绪）。用 `cordis_inspect_query`（client / `Slots` / `listSubTree`，`{"root":"sidebar.right.pane.tab"}`）可以证实：占位里完全没有 `english-lit-reader`，而 `{"root":"conversation.view"}` 里有 `{"id":"english-lit-reader","order":20,"active":true}`。
   - **修复**：把服务查找挪进 `ctx.effect` 的运行时，并改成**带期限的重试**——`installGuide()` 每 120 ms 试一次、最多 12 次（约 1.4 s）；拿不到就把注册推迟，拿到后立刻完成三步（`tabs.register` 指南胶囊 + `sidebar.right.pane.tab` 主体 + `.title` 标签名）。重试用 `disposeGuideTab !== NOOP` 做幂等判断，不会重复注册；12 次仍失败只打印一条 `console.warn`，阅读器本身仍可从「文献阅读」标签页 / 左侧栏入口 / 右下角胶囊进入。
   - **验证**：桩环境三组用例——服务立即可用（一次即注册成功、胶囊 `order: 20`、`kind === id`、主体与标题槽位都在）、服务第 3 次才出现（前两次不注册，重试两轮后成功）、服务永不出现（不崩溃、不注册、其余槽位照常注册且只警告一次）。
   - 参考实现：`dsh-pet` 的 `registerPetChatTab()` 也是在 `ctx.effect` 里才 `ctx.get?.('sidebarRightTabs')`，所以它一直正常。

### v25 · 1.0.25

1. **移除阅读区顶部那行 `PDF` / `文本` 标题条**：`.elr-main` 的第一个子元素（`.elr-col-head`，内容只有 `PDF` 或 `文本`）整行删除——它占一行高度却没有任何可操作内容。工具条上新增 **「关闭文献」** 按钮（`pdf.close`，PDF 与文本模式各一个），点击后走 `closePaper()`：清掉待执行的装饰定时器、自增 `eagerRunRef` 让预渲染循环立即退出、`disposeViewer()`、销毁 `pdfDocRef`、释放原生预览 URL，再重置 `hasPdf` / `pdfName` / `pageCount` / `pageNum` / `text` / `summary` / `references` / 选区 / 浮层 / `paperId`，回到空白投放界面。当既没有 PDF 也没有文本时按钮是禁用的，不会看起来像坏掉的控件。
2. **缩放百分比两栏合并为一栏**：原来紧跟放大 / 缩小按钮的是一个 `<select class="elr-zoom-select">`（预设档位）**加**一个 `<input class="elr-zoom-input">`（手动输入），两个控件并排、语义重复。现在只保留**一个** `<input type="number" list="elr-zoom-presets">`，预设档位由紧跟其后的 `<datalist id="elr-zoom-presets">` 提供，浏览器原生下拉里就是那 8 个常用比例——点选即缩放，直接输入即自定义（25–600，回车 / 失焦生效，Esc 取消）。`.elr-zoom-select` 样式与节点一并删除，输入框右侧补了一个 `%` 后缀（`.elr-zoom-suffix`）补足可读性。
3. **右侧栏停靠下方时改为横向排布**：`.elr-body.dock-bottom .elr-side` 从 `flex-direction: column` 改为 `row`，于是宽而矮的底部停靠里，左侧三段（选中翻译 / 近期阅读 / 高亮与批注）与右侧论文分析并排成列，而不是三条又矮又长的竖条。
   - 论文分析（标签头 + 正文）包进新的 `.elr-side-col`，保证它在横向容器里仍然是自己内部的竖向列，标签头不会被挤成旁边的一条。
   - `.elr-side-top` 内部也改为 `flex-direction: row; flex-wrap: wrap`，三段以 `flex: 1 1 200px` 分享宽度；底部分隔条变成 `col-resize` 的**竖**分隔条，拖的是 `.elr-side-top` 的**宽度**。因此新增共享状态 `sideTopWidth`（默认 380，写入快照），分隔条按 `dockRef.current` 选轴：停靠右侧拖高度、停靠下方拖宽度。
   - 三段之间的分隔线从「下边框」改为「右边框」，`.elr-side-top` 原来的 `height: sideTopHeight` 内联样式在停靠下方时改写成 `width: sideTopWidth`。
   - 屏幕很窄时三段会换行回竖向堆叠（`flex-wrap: wrap` + `min-width: 200px`），不会被压成三条 60px 的窄缝。

### v24 · 1.0.24

- **近期阅读列表挪到你指的位置，且双击真的能打开** —— 两个独立缺陷。
  - **看不见**：v18 #1 的「没打开论文时隐藏右栏」用 `hasPaper` 一整片替换掉了右栏（`.elr-pane-empty`），而「近期阅读」恰好住在右栏的 `sideTop` 里，于是空状态下它根本无法触达。现在空白投放区改为 `.elr-drop-col` 竖排，投放卡片下面直接渲染「近期阅读」列表（`.elr-drop-recent`），不需要先打开任何论文。**没有改回 `hasPaper` 门控**：右栏的分析区在无文献时依然保持隐藏，避免又变回 v18 之前那种「什么都没有却显示两个空框」。
  - **打不开**：PDF 字节此前只存在于模块级 `fileCache = new Map()`，刷新页面即失效，于是 `openRecent()` 一路走到 `notify(t('recent.missing')); pdfFileRef.current.click()`——看起来就是「双击又弹出文件选择框」。现在字节落 **IndexedDB**（库 `english-lit-reader` / 表 `files`，单文件上限 60 MB），`handleFile()` 在打开时 fire-and-forget 写入，`openRecent()` 先查内存、再查 IndexedDB、只有两者都没有才回落文件选择框；页面重挂载时也会从 IndexedDB 自动恢复上次的文献。
  - 关键细节：`reviveStoredFile()` 重建 `File` 时必须沿用**原始** `name` / `size` / `lastModified`。近期列表的去重键 `identity = 文件名 + 大小 + 修改时间` 正是由它们拼成，若用 `Date.now()` 当时间戳，每打开一次就会多出一条重复记录。
- **高亮 / 批注三态筛选 + 按文中顺序排列** —— 列表此前永远按「最后添加的在最前」渲染，`marks.map(...)` 直接铺开，既无法只看一种，也不反映阅读顺序。
  - 顶部新增 `.elr-marks-filter` 分段按钮（复用已有的 `.elr-seg`）：**全部 / 仅高亮 / 仅批注**，选择写入 `localStorage['elr.markFilter']`，下次打开依旧生效。点筛选按钮会 `stopPropagation()`，不会误触发分区折叠。
  - 「全部」模式下按**该句在文中出现的位置**排序：新增 `locateMark(mark)`，用 `pageIndexOf()` 的页内扁平文本算出 `{ page, offset }`（1 基页码 + 页内字符偏移），排序键 `(page, offset, 原序号)`；找不到的记录排在最后并保持原有先后。
  - `locateMark()` 同时被 `jumpToMark()` 复用——以前「点击跳转」和「排序」会各写一份扫描逻辑，现在只有一份，两处行为天然一致。
  - 排序只在「全部」+ 至少两条 + 分区展开时才做：`locateMark()` 要遍历全文文字层，折叠状态下不该白付这份代价。
- 新增 5 条语言键：`recent.loading` / `mark.filter.all` / `mark.filter.hl` / `mark.filter.note` / `mark.filterEmpty`（内联字典与 `locale/*.json` 同步，142 键、双向零差异）。

### v23 · 1.0.23（热修复）

- **修复：界面把语言键原样显示成 `mark.badgeNote` / `mark.removeNote`** —— 截图里的批注卡片把徽标和删除按钮显示成了键名本身。这两个键恰好是 v23 新加的，而同一张卡片上 v22 就有的文案显示正常，说明**新代码在跑，只是字典没生效**。
  - 根因在 `locale.register()` 的语义：`@deepseek-ai/dsh-client-locale` 的 `register(ns, locale, dict)` 在同一命名空间**已经有该语言的字典**时会直接 **throw**（`locale namespace "<ns>" already has locale "<locale>"`）。插件原先写的是 `try { locale.register(NS, dictionaries) } catch (_) {}`——同一个页面会话里重新启用插件、或热重载后，上一轮的注册仍然驻留，这次注册必然抛错，而空 `catch` 把它吞掉了。
  - 注册失败后 `locale.bind(NS)` 仍然返回**旧字典**的翻译函数，`translate()` 末尾是 `?? key`，于是新键一路回落成键名本身。所以「旧键正常、新键变键名」正是这个 bug 的指纹。
  - 修法分两层：① 注册改成**按语言逐个注册**（`for (const [code, dict] of Object.entries(dictionaries))`），任一语言失败不会带掉另一种，返回的 disposer 也逐个收集成链；② `t()` 变成包装函数——先问 locale 服务，若拿到 `undefined` 或**拿回来的就是键名本身**（即服务没命中），再查内联字典（按当前语言，缺则回落英文），最后才原样返回键名。这样即使宿主的注册表脏了，界面也不会再出现裸键。
  - 行为校验用真实故障场景复现：构造一个「已注册但缺 v23 键」的陈旧 locale 服务，验证 `mark.badgeNote` 得到 `批注`、`mark.removeNote` 得到 `删除批注`、`mark.removeHl2` 得到 `移除高亮`，而旧键 `launcher` 仍走服务返回 `打开阅读器`；切到 `en` 得到 `Note` / `Delete note`；参数占位符 `{n}` 在内联回落路径上同样能替换。**25 项断言全过**，随后删除 harness。
  - 附带好处：`t()` 现在对内联字典的依赖使「新增语言键忘了同步 `locale/*.json`」不再表现为界面破图，而是照常显示中文/英文文案。

### v23 · 1.0.22

- **修复：高亮与批注互相绑定** —— 旧数据模型里一条标注就是 `{id, text, note, hl}`，`hl` 与 `note` 挤在同一条记录上：`addNote()` 建的是 `hl:false` 的记录、`removeHighlight()` 遇到有批注的记录只是把 `hl` 改成 `false`、`clearNote()` 又会在同一条上清空 `note`，结果「取消高亮」看起来像删批注、「清除批注」又顺手动了高亮。现在**每条记录多一个 `kind` 字段**（`'hl'` 或 `'note'`），表示它是哪一种标注；`normalizeMark()` 按 `kind` 归一（旧数据缺 `kind` 时按「有批注文字就算批注，否则算高亮」回填），`hl` / `note` 退化为该 `kind` 的派生素材。
  - `addHighlight()` / `addNote()` 各自只看自己那一种记录，同句已有高亮时再加高亮是空操作，**永远不会改写同句的批注记录**；`removeHighlight()` / `clearNote()` 都先校验 `markKind(target)` 再删，删掉的只有自己那一条。
  - `applyHighlights()` 的 span 标记从「单个 id」升级为**空格分隔的 id 列表**（`data-elr-mark="hlId noteId"`），因为同一句现在可能同时挂在两条记录上；右键时按 `kind` 解析成 `markId` / `noteId` 两个，菜单再据此分别渲染「取消高亮」与「编辑批注 / 清除批注」。
  - 右侧列表每条前面加了 `高亮` / `批注` 徽标与左侧色条（`.elr-mark-item.is-hl` 黄色、`.is-note` 品牌色），删除按钮文案也分成「移除高亮」/「删除批注」。新增 4 条语言键 `mark.badgeHl` / `mark.badgeNote` / `mark.removeHl2` / `mark.removeNote`。
- **修复：全文翻译已移除但提示里还留着字样** —— 用户看到的左下角提示来自 `extractText()` 结束后的 `pdf.textReady`：`'已提取全文——可进行全文翻译与论文分析。'`。v20 删功能时只删了 UI，漏了这句文案。现在改为 `'已提取全文——可进行论文分析。'`（英文 `'Full text extracted — paper analysis is available.'`），`extractText()` 里扫描版 PDF 的兜底提示也从「如需全文翻译或分析」改成「如需论文分析」。`package.json` 的 `description` 同样清掉 full-text translation 说法。全仓 `全文翻译` 归零，`client.js` 里剩下的 `full-text translation` 只出现在 5 处解释性的**代码注释**中。
- **改进：翻译按钮移到内联浮层标题栏** —— 之前「翻译」按钮在英文卡片底部的 `.elr-popup-actions` 行里，选中长段落时它被推到滚动区下方，必须往下滚才能点到。现在按钮移进标题栏、位置在 **`A−` 左边**（即「最上方调整字号按钮的左边」），并被染成品牌色作为卡片的主操作；`.elr-popup-actions` 整行删除。
- **新增：内联浮层按选中文字长度自动定初始尺寸** —— 新增 `popupSizeFor(value)`：取字符数的平方根做缩放（`w = 280 + √len × 14`、`h = 130 + √len × 16`），夹在 300–620 × 170–560 之间；短句得到小卡片、整段 Abstract 得到宽而高的卡片。**只在「新选区」时生效**（写在 `stageRef.current` 里），点「重新翻译」以及任何一次重排都不会覆盖用户手动调过的尺寸与位置——`translateRef.current` 完全不碰 `w`/`h`，`x`/`y` 仍沿用拖动后的坐标。同时按新宽度重新夹取 `x`，浮层不会因为变宽而溢出屏幕右侧。
- **新增：深色主题下译文框黑底白字** —— 内联浮层是 `createPortal` 到 `document.body` 的，**在阅读器 DOM 之外**，所以插件自己容器上的 class 传不进去，必须用模块级的明暗状态。
  - `apply(ctx)` 里读 Harness 的 `theme` 服务：`ctx.get('theme').getTheme().active.colorScheme` 即 `'light' | 'dark'`，并订阅 `theme/change` 事件实时跟随；服务不可用或快照缺字段时回落到 `readSchemeFromCss()`（读 `--dsw-alias-bg-base` 的 RGB 并算亮度），再用一个 `MutationObserver` 监听 `documentElement` 的 `class`/`style`/`data-theme` 兜底。
  - 状态经 `setHostScheme()` + `schemeListeners` 广播给 `useHostScheme()` hook（`useReducer` 强制重渲染），浮层根节点据此加 `elr-popup-dark`。对应样式：译文卡片背景 `#000000`、文字 `#ffffff`、标签 `#b9b9b9`、空态 `#8a8a8a`。
  - 注意这跟随的是 **Harness 全局明暗**，与工具条「阅读配色：默认 / 纸张纹理 / 护眼黄」是两件事——后者只管 PDF 页面底色。
- 校验：`node --check client.js` / `index.js` 通过；桩渲染 harness **64 项断言全过**（含 6 个 slot 注册、guide 标签类型 + 胶囊 `order: 20`、`theme/change` 监听可接收快照、`View()` 根节点为 `.elr-view`），随后删除；内联字典与 `locale/*.json` 各 **137** 非 `meta` 键，双向零差异。

### v22 · 1.0.21

- **新增：点右侧「高亮与批注」里的引文，左侧阅读界面自动定位到该句** —— 需求是「点击批注时阅读界面跳过去」，但批注条目里没有任何坐标信息（`marks` 只存 `{id, text, note, hl}`），刷新页面后更没有保存过的滚动位置。因此定位复用的是**高亮绘制时那条查找路径**：按页重建「去空白 + 字符偏移映射」的文本索引，在整篇文档里找这条 mark 的文本，命中页即目标页。
  - 实现上先把 `applyHighlights()` 里内联的索引构建抽成 `pageIndexOf(pageEl, spans)`，高亮与跳转共用同一份缓存（`pageTextCache` 是 `WeakMap`，按 page 元素缓存），跳转不会额外付一次索引成本。
  - `jumpToMark(mark)` 的步骤：`normText()` 归一化 → 逐页 `cached.pageText.indexOf(needle)` → 用 `starts[i]` / `texts[i].length` 反查命中区间落在哪个 span → **先** `viewer.currentPageNumber = 命中页`（pdf.js 只有当前页才布局，先滚后翻会滚到旧页坐标）**再**用 `requestAnimationFrame` 等一帧让 pdf.js 换页，最后 `scrollElementIntoView()` 把目标 span 滚到容器上方约 1/4 处（`behavior: 'smooth'`）。
  - 文本被截断（选中时按 `MAX_SELECTION` 裁过）导致整串搜不到时，退化用前 24 个字符做前缀匹配；仍然找不到就 `notify(t('mark.locateFailed'))` 提示「在当前页面中找不到该段落——请先打开 PDF 再试」，**不会静默失败**。
  - 交互细节：只有引文本身可点（`.elr-mark-text` 悬停变品牌色 + 下划线，`title` 提示「跳转到该段落」），批注输入框和「移除」按钮都 `stopPropagation()`，因此打字、删除、写批注都不会带动阅读界面。
  - 新增两条语言键 `mark.locate` / `mark.locateFailed`（中英各一份，内联字典与 `locale/*.json` 同步；非 `meta` 键 133 条，双向零差异）。

### v21 · 1.0.20

- **新增：论文分析下方多一栏「参考文献」，点分析时同时查地址** —— 分析列末尾新增 `.elr-refs` 区块，逐条列出英文标题 / 中文标题 / 期刊或会议 + 年份 / 文献地址，查不到地址的显示「未找到」。
  - **Host 侧新增 `POST /plugins/english-lit-reader/references`**：先用 `REFERENCES_SYSTEM` 从论文末尾切出的参考文献正文（`referenceTail()`：优先从最后一个 `References` / `Bibliography` / `参考文献` 标题之后开始，最多 40000 字符）解析成 `{en, zh, venue, year}` 数组，**只要求模型输出标题，绝不要求它输出链接**（提示词第 6 条明确禁止编造 URL）；`parseReferenceArray()` 会剥掉 ``` 围栏、只取第一个 `[` 到最后一个 `]`、丢弃没有 `en` 的条目、上限 80 条。
  - **地址由 Crossref 实时解析**（`crossrefRequest()`，`node:https`，Semantic Scholar 实测返回 429 不可用）：`?rows=5&select=title,DOI,URL,container-title,issued&query.bibliographic=<标题 + 期刊提示>`，对**每个候选**都用 `titleScore()` 打分（忽略大小写与标点、按较短标题的有效词覆盖率、并允许词干前缀匹配），再叠加**年份守卫**（候选年份与解析出的年份相差超过 1 年直接判 0 分），最后要求 `score >= 0.85` 才接受，地址取 `https://doi.org/<DOI>`。
  - **两个真实误判是这样被挡住的**：`rows=1` 且拿整串查询词去比对时，"TimesNet" 会被解析成另一篇 2026 年的论文——改为 `rows=5` + 只比对解析出的标题 + 阈值从 0.6 提到 0.85；"Attention Is All You Need" 会被解析成同名的 2025 年书章——被年份守卫拒绝。因此 ICLR / NeurIPS 这类没有 Crossref DOI 的文献会如实显示「未找到」，而不是给出一个错误链接。
  - 客户端 `doReferences()` 与 `doSummary()` **并行**（`const referencesTask = doReferences();` 在 `/summary` 请求之前启动，`await referencesTask` 在 `finally` 之后），所以分析不会因为查文献而变慢；结果随分析一起存入 `elr.result.<paperId>` 的 `references` 字段，重开论文时直接回填，不会重复请求 Crossref。参考文献区块渲染在 `.elr-out` **内部**（`.elr-col` 是 `flex:1 1 0; overflow:hidden`，放在外面的兄弟节点会被裁掉而不是滚动）。
- **新增：右侧「开始」面板（罗盘图标）里多一个「文献阅读器」入口** —— 那个面板其实是右侧边栏的 **guide 标签页**，它的胶囊按钮来自**标签注册表**而不是某个 slot 列表，因此按 Harness 官方 `files` 类型的两段式注册来实现：
  - `ctx.sidebarRightTabs.register({ id: 'english-lit-reader', kind: 'english-lit-reader', title, guide: [{ id, order: 20, title, description, icon: NavIcon }] })` —— `guide` 里那一项渲染成胶囊，`kind` 决定点开的是哪个页面类型；
  - `sidebar.right.pane.tab`（key 用同一个 id）注册阅读器本体，另注册 `sidebar.right.pane.tab.title` 提供标签名，于是点胶囊后阅读器直接**在右栏内**打开。
  - 这两个服务分属不同包，因此统一走 `ctx.get('sidebarRightTabs')` 读、且**整体做可选保护**（`typeof sidebarRightTabs.register === 'function'` 才注册，并 `try/catch`）：宿主没有右侧栏包时，前三个入口照常工作。`package.json` 的 `dsh.client.inject` 补上了 `@deepseek-ai/dsh-client-ui-sidebar-right` 以保证服务在 `apply` 前就绪。
- 新增文案键（中英各 10 个）：`references.title/placeholder/running/rerun/ready/failed/count/missing/untitled`、`guide.desc`。
- 校验：`node --check client.js` / `index.js` 通过；桩渲染 harness（真正执行 `apply(ctx)` 与 `Reader()`）**70 项断言全过**，随后删除；`locale/en.json` 与 `locale/zh.json` 各 **131** 非 `meta` 键、逐键对齐且都已进 inline 字典。
- 实测（`http://127.0.0.1:58250`）：`/meta` 200；`/vendor/pdf.min.js?v=1.0.20` 200 320004 B；`/vendor/pdf_viewer.js?v=1.0.20` 200 233111 B；`/vendor/katex/katex.min.js?v=1.0.20` 200 277038 B；`/vendor/nope.txt` 404；`POST /references` 200、**5248 ms**、`total=4 resolved=2 missing=2` —— `Deep residual learning` → `https://doi.org/10.1109/cvpr.2016.90`，`BERT` → `https://doi.org/10.18653/v1/n19-1423`，`Attention is all you need`（2017）与一条虚构标题均正确返回「未找到」。

### v20 · 1.0.19

- **删除：全文翻译、译文覆盖，以及三栏布局** —— 按需求彻底移除三个功能，右侧栏收敛为「选中翻译 / 近期阅读 / 高亮与批注 + 论文分析」一条分析列。
  - `DEFAULT_SHARED` 去掉 `tab` / `translation` / `threeCol` / `overlayMode` 四个字段；载入旧快照时执行 `delete shared.threeCol; delete shared.overlayMode; delete shared.translation; delete shared.tab;`，避免历史快照把已删除的功能复活。
  - 整块删除 v19 的译文覆盖实现（137 行：`ovCache` / `overlayModeRef` / `clearOverlayLayers()` / `applyOverlay()` / `applyOverlayRef`），以及 `doFullTranslate()`、`translateCol` 中列、`translationRef`、`translationBusy`、`useShared('translation'|'tab'|'threeCol'|'overlayMode')`、`applyTheme()` 末尾的 `applyOverlayRef.current()` 调用和 `[overlayMode, translation, dropSeq]` 这个 effect。
  - 原来的「全文翻译 / 论文分析」两个标签 + `reanalyze`（原本是 `Promise.all([doFullTranslate(), doSummary()])`）替换为**单一分析列**：列头是 `t('tab.summary')`，工具条里是「生成分析 / 重新分析」按钮（直接调 `doSummary`），下面 `renderMarkdown(summary)`。
  - 一并删除对应 CSS（`.elr-translate-col`、`.elr-body.elr-3col .elr-main/.elr-side`、`.elr-ov-layer`、`.elr-ov-line`、`.elr-ov-busy`）与文案键（`tab.translate`、`translate.run/running/rerun/copy/placeholder/timeout`、`three.on`、`three.label`、`overlay.on`、`overlay.label`、`overlay.needText`、`col.translate`）。
- **修复：三页布局放大后三页互相覆盖** —— 根因是 `.elr-three` 用 `grid-template-columns: repeat(3, minmax(0, 1fr))`，它只约束**列**，而 `.pdfViewer .page` 自己的宽度来自 pdf.js 的 `--scale-factor`（`vendor/pdf_viewer.css` 里是 `width: 816px`），缩放变大后页面直接溢出所在列、压到邻居身上。改为**列宽跟着页面实际宽度走**：`grid-template-columns: repeat(3, max-content)` + `column-gap: 12px` + `justify-content: start` + `width: max-content`，三页挤不下时容器改横向滚动（与 pdf.js 自己的双页行为一致），任何缩放比例下都不会重叠。
- **新增：缩放百分比显示 + 常用比例下拉 + 手动输入** —— 放大 / 缩小按钮右侧加了 `.elr-zoom-select` 下拉（`ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300, 400]`）与 `.elr-zoom-input` 数字框。
  - `applyZoomPct(pct)` 把输入夹到 `ZOOM_MIN*100`–`ZOOM_MAX*100`（25–600）后写 `viewer.currentScale = pct / 100`；当前比例不在预设里时，下拉会临时插入一个 `当前 xx%` 选项，避免显示空白。
  - 数字框用 `zoomDraft` 草稿态：输入过程中不立刻缩放（否则先输入「1」会瞬间跳到 25%），回车（`if (e.key === 'Enter')`）或失焦才提交，Esc 放弃。
  - `ensureViewer()` 里订阅 pdf.js 的 `scalechanging` 事件回写 `setZoomPct`，因此 **Ctrl+滚轮** 和 ± 按钮改变缩放时读数是同步的。
- **修复：鼠标停在选中区上不动也会弹翻译浮层** —— 根因是选区变化后有一个 350ms 的防抖定时器，只要期间选区没再变，即使鼠标**还按着**也会触发 `commitSelection` + `stageRef.current`。现在用**真正松开鼠标**作为触发条件：`document.addEventListener('mousedown', onDown, true)` 记下按下状态，防抖回调里 `if (down) return;` 直接放弃；`document.addEventListener('mouseup', onUp, true)` 松开时才清定时器并以 30ms 的短延时调 `stageFromSelection()`（让浏览器先把最终选区结算完）。这样拖选过程中、以及松手前的停顿都不会再弹浮层。
  - **不误伤浮层自身操作**：全局 `mouseup` 也会在拖动浮层、在浮层文本框里选字时触发，那会把浮层重新拉回选区锚点。所以加了 `inOwnCard(target)` 判断——命中 `.elr-popup` / `.elr-formula-card` / `.elr-note-bubble` / `.elr-menu` 时用 `skipUp` 标记跳过本次抬起（`onDown` 里置位、`onUp` 里清位并复位 `down`），拖动浮层和编辑文本都不会再重算选区。

- 校验：`node --check client.js` / `index.js` 通过；桩渲染 harness（真正执行 `Reader()` 与 `apply(ctx)`）46 项断言全过，随后删除；`locale/en.json` 与 `locale/zh.json` 各 121 非 `meta` 键、逐键对齐且都已进 inline 字典。
- 实测（`http://127.0.0.1:58250`）：`/meta` 200、`/vendor/pdf.min.js?v=1.0.19` 200 319989 B、`/vendor/pdf_viewer.js?v=1.0.19` 200 且 `DEFAULT_CACHE_SIZE = 40` 仍在、`/vendor/katex/katex.min.js?v=1.0.19` 200、`/vendor/nope.txt` 404；`POST /translate` 200 `chunks=1 failed=0` →「我们提出一种三页布局，带有缩放百分比控件，以及仅在鼠标按键释放后才显示的选择弹窗。」

### v19 · 1.0.18

- **新增：内联翻译浮层里的两个框会跟随外框一起变大，且各自可拉边缘调高** —— 旧实现给英文框 / 译文框各自写死像素高度（`selEditH`、`selResultH` 那套思路），所以把浮层拉大时两个框纹丝不动。现在两框改用 **flex 权重** `popup.ow` / `popup.rw`：`.elr-popup-body` 是 `display:flex; flex-direction:column`，两个 `.elr-popup-block` 是 `display:flex; flex-direction:column; min-height:52px; overflow:hidden` 的 flex 子项，文本框与译文框各自 `flex:1 1 0; min-height:0`。于是**外框改高 → 两框按同一比例一起变大**；每块底部新增 `.elr-popup-grip`（9px、`ns-resize`、淡渐变线），拖动它只**重分配两框的比例**（`rebalance(selfKey, otherKey, sign)` 按容器高度把像素位移换算回权重，下限 0.15）。原先的 `resize: vertical` 已移除——原生拖柄写的是像素高度，反而会锁死「跟随外框」的行为。
- **优化：打开 PDF 后一次性把整篇渲染完，滚动不再卡顿** —— 根因是 pdf.js 只渲染**可见页**，每滚一页都要现场渲染；同时它的页面缓存默认只有 10 页（`DEFAULT_CACHE_SIZE = 10`），20 页以上的论文滚到后面，前面的页会被 `destroy()` 掉，回头再看又要重画。两处一起改：
  - `vendor/pdf_viewer.js`：`DEFAULT_CACHE_SIZE` 由 10 提到 40（带注释说明是本插件的改动）。
  - `client.js` 新增 `async function eagerRenderAll(state)`：在 `pagesinit` 之后遍历 `0..viewer.pagesCount-1`，逐页 `getPageView(i)`，缺页先 `viewer.pdfDocument.getPage(pv.id)` + `pv.setPdfPage()`，然后交给**渲染队列** `viewer.renderingQueue.renderView(pv)`（不能直接 `pv.draw()`：`draw()` 里的 `renderContinueCallback` 会在页面不是 `highestPriorityPage` 时把自己**暂停**，一页都画不完），等该页 `renderTask.promise` 结束再 `setTimeout(0)` 让出主线程进入下一页。整篇跑完后滚动只是重绘已完成的 canvas。安全性：用 `eagerRunRef` 递增序号 + `pdfStateRef.current === state` 双保险，换文档 / 关闭时立即中止；不修改 `currentPageNumber`，因此阅读位置不会被抢走。
- **修复：拖动右侧功能栏的 `⠿` 抓手上左阅读区错误弹出「松开即可打开 PDF」** —— 根因是浮层根节点 `.elr-view` 的 `onDragOver` 无条件 `preventDefault()` 并 `setDragOver(true)`，而侧栏三段的排序用的是 HTML5 拖放，`dragover` 会**冒泡到根节点**，于是被误当成拖文件。新增 `isFileDrag(event)`：只有 `event.dataTransfer.types` 里含 `Files`（或 Firefox 的 `application/x-moz-file`）才算文件拖入。`onDragOver` / `onDragLeave` / `onDrop` 三处都先过这个判断，拖动手柄排序时遮罩不再出现，松开也不会触发「打开文件」。
- **新增：三栏阅读模式**（v20 已按需求移除） —— 工具条新增「三栏」按钮，在 PDF 模式下一行并排三个独立面板：**原文 | 全文翻译 | 论文分析**。中间列 `translateCol` 是完整高度的翻译面板（自带「全文翻译 / 重新翻译 / 复制」按钮与独立滚动），右侧列仍是原来的分析栏。实现上给 `bodyClass` 追加 `elr-3col`，CSS 用 `.elr-body.elr-3col .elr-main/.elr-side { flex: 1 1 0 }` 让三列均分，并用 `width: auto !important` 抵消二栏模式里用户拖出来的固定宽度（否则会把原文列挤没）。只在 `mode === 'pdf'` 时生效。
- **新增：三页并排（每行 3 页）**（v20 修正为 `max-content` 列宽，不再重叠） —— 原来的「单栏 / 双栏」布尔开关改为 **0/1/2 三态循环**（文案「单页 / 双页 / 三页」，`DEFAULT_SHARED.spreadMode` 由布尔改为数字，并写了迁移逻辑：旧快照里的 `false/true` 自动变成 `0/1`）。pdf.js 本身只有 `SpreadMode.NONE/ODD/EVEN`（每行最多 2 页），所以「三页」不是它的模式，而是**我们自己加的 CSS grid**：`spreadMode === 2` 时给容器加 `.elr-three`，`.elr-pdf-container.elr-three .pdfViewer { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); }`。因为**没有改动 DOM 结构**（不重新 parent 页面），pdf.js 的任何 `_updateSpreadMode()` 都不会把它冲掉，页面 canvas 也各自保留自己的缩放。
- **新增：译文覆盖阅读模式**（v20 已按需求移除） —— 工具条「译文覆盖」按钮开启后，用**中文译文覆盖英文原文所在的行**，图片 / 表格 / 公式（它们不是文字层 span）**完全不被遮挡**，页面版式保持原样。实现 `applyOverlay()`：
  - 只有文字层 span 会被覆盖：按 `Math.round((span.top - wrapper.top) / 3)` 把同一视觉行的 span 聚成一条线（`lines[]`，含 `top/left/right/height/chars`）；
  - 译文按 `\n\n` 切段，再按**每页英文文字量占比**分配到各页（`weights[]` / `pageSegs[]`），保证第 N 页显示的是属于第 N 页的那部分译文；
  - 页内再按**每行文字量占比**把该页译文切片贴到对应行；行框宽高直接取自 span 的 `getBoundingClientRect()`，字号 `line.height * 0.78`（夹在 6–22px），超长自动 `text-overflow: ellipsis`；
  - 覆盖层 `.elr-ov-layer` / `.elr-ov-line` 是 `pointer-events:none`，所以仍可正常选中、高亮、右键。每页结果缓存进 `ovCache`（WeakMap，签名 `译文长度:段数@页码`），滚动时命中缓存直接跳过；`applyOverlay()` 挂在统一的装饰流程里（`applyTheme()` 末尾），因此**滚动 / 缩放 / 翻译完成 / 切换主题**都只重绘一次。还没做全文翻译时点按钮会提示「请先完成全文翻译，再开启译文覆盖」。
- `ASSET_V` → `?v=1.0.18`，`package.json` → `1.0.18`；新增 10 个文案键（`spread.one/two/three` / `spread.label` / `three.on` / `three.label` / `overlay.on` / `overlay.label` / `overlay.needText` / `col.translate`），中英文各 132 个非 `meta` 键（`locale/*.json` 另含 `meta` 块，共 133 项）。
- 校验：`node --check client.js` / `index.js` 通过；`locale/en.json` 与 `locale/zh.json` 各 132 非 `meta` 键、逐键对齐且都已进 inline 字典；桩渲染 harness **62 项断言全过**（静态：`ASSET_V` / `eagerRenderAll` / `renderView` / 双保险中止 / `DEFAULT_CACHE_SIZE = 40` / `.elr-three` grid / 三态循环 / `.elr-translate-col` / `threeColOn` 门控 / `applyOverlay` / `ovCache` / `translationRef` / 10 个新键；字典：inline 中英各 132 且对齐；渲染：4 个 slot 注册、`conversation.view` 的 `order: 20`、`View()` 真执行并产出 `.elr-view`）。

### v18 · 1.0.17

- **新增：没打开论文时右侧栏不再显示空的分析 / 翻译面板** —— 侧栏改为按 `hasPaper = Boolean(hasPdf) || Boolean(String(text || '').trim())` 判断：没有论文时整列换成居中提示（`.elr-pane-empty`，标题「尚未打开论文」+ 说明「在左侧打开或拖入一个 PDF，选中翻译与论文分析就会显示在这里。」），并给侧栏加 `.is-idle` 让标签行半透明；有论文时立刻恢复原布局。第一次实现用了数组当 children（`hasPaper ? [...] : ...`），已改成 `React.Fragment` 包裹，保证子节点位置稳定不重新挂载。
- **修复：滚动 PDF 仍明显卡顿** —— 根因是 `applyHighlights()` 每次（`pagerendered` / `textlayerrendered` / `pagesloaded` / `pagesinit` 都会触发，160 ms 去抖）都在**整个文档**上做三件 O(n) 的事：`container.querySelectorAll('.textLayer span')` 全量清 `elr-hl-note` 与 `dataset.elrMark`、`clearHlOverlays()` 全量删 canvas、再对**每一个** `.pdfViewer .page` 重建文字索引并跑 `document.createRange()` + `getClientRects()`。改为**增量 + 分页缓存**：
  - 新增 `pageTextCache = new WeakMap()`（每页缓存 `spanCount / texts / starts / maps / pageText / sig / canvas`）与 `hlTagsRef`；页内 span 数量没变就直接复用索引，不再重建。
  - 计算 `pageSig = marksSignature + '#' + 该页 glyph canvas 的像素尺寸`；`cached.sig === pageSig && cached.canvas.isConnected` 时**整页跳过**（滚动时绝大多数页因此不再做任何测量）。
  - 清理改成**只清当前页**：新增 `clearPageOverlay(pageEl)` 替代文档级的 `clearHlOverlays()`；标签复位也只在该页的 spans 上做。
  - `paintPageHighlights()` 改为**返回**它创建的 canvas，交给缓存持有，页面重绘时可直接复用判断。
  - 无标注时走快路径：只有当 `hlTagsRef.current` 为真才做一次全量清理，否则直接返回。
- **新增：所有浮窗都能直接拉边缘改大小** —— 旧的 `.elr-resizable { resize: both }` 只有右下角一个原生抓手，方向受限、且 `<textarea>` 内部还有自己的 `resize` 相互抢事件。现在移除原生 `resize`（`.elr-resizable` 只剩 `overflow: hidden`），新增模块级 `RESIZE_EDGES = ['n','s','e','w','ne','nw','se','sw']` 与 `resizeHandles(onPatch, box, minW, minH)`：给卡片渲染 8 条 `.elr-rz` 透明热区（四边 6px、四角 14px，各自 `ns/ew/nesw/nwse-resize` 光标），`pointerdown` 记下 `getBoundingClientRect()`，`pointermove` 里按边计算 `{w,h,x,y}`——拉左边时同时缩宽度并右移 `x`，拉上边时同时缩高度并下移 `y`，都带 `minW/minH` 夹紧。**选中翻译浮层、公式卡片、批注气泡**三处全部接入（浮层宽度/高度写入 `popup.w` / `popup.h`），拖动标题栏仍只改位置，两者互不干扰。
- **修复：内联英文栏编辑后右侧翻译栏不同步** —— 根因是**两份独立状态**：浮层里的英文/译文只存在 `popup.text` / `popup.translated`（Reader 的局部 state），侧栏卡片用的是共享的 `selection` / `selectionResult`，两边谁也看不到谁。现在英文原文只有**一份**：`DEFAULT_SHARED` 新增 `selectionEdit`，浮层 `<textarea>` 与侧栏 `<textarea>` 都是 `value={selectionEdit}` + `onChange={e => setSelectionEdit(e.target.value)}`，于是任一处输入另一处**立刻同步**（不需要任何事件转发）；译文同理改为两侧共读 `selectionResult`，翻译中状态共读 `selectionBusy`。`translateRef` 也不再往 `popup` 里写 `text` / `translated`，只负责 busy/pending。新增 `commitSelection(value)` 统一「新选区同时刷新 `selection` 与 `selectionEdit`」，已接到右键菜单（两条路径）、`selectionchange`、文本框选中、以及「清除」按钮。
- **新增：右侧英文栏同样可编辑、可单独调高** —— 侧栏原本只读的 `.elr-sel-original` 换成受控 `<textarea class="elr-sel-edit">`，高度由共享字段 `selEditH`（默认 96，最小 48）控制；译文框高度由 `selResultH`（默认 150，最小 56）控制。两者各带一根 `hlineGrip()` 拖柄（`.elr-hz` + `.elr-hz-grip`，9px 高、`ns-resize`、淡渐变线条）：**英文框拉高不会改变译文框高度**，且两份高度都写进 `localStorage` 快照，重开仍保留。侧栏「翻译」按钮同样改为读 `selectionEdit` 并发起翻译。
- `ASSET_V` → `?v=1.0.17`，`package.json` → `1.0.17`；新增 3 个文案键（`pane.emptyTitle` / `pane.emptyHint` / `box.editHint`），中英文各 123 keys（inline 字典各 122 keys，`locale/*.json` 另含 `meta` 块）。
- 校验：`node --check` 两文件通过；`locale/en.json` 与 `locale/zh.json` 各 123 keys 且 inline 字典与之逐键一致（排除 `meta`）；桩渲染 harness 34 项断言全过（静态：`selectionEdit` / `selEditH` / `selResultH` / `commitSelection` / `resizeHandles` / `RESIZE_EDGES` / `hlineGrip` / 8 条 `.elr-rz` 规则 / 三处 `.elr-hz` / 原生 `resize: both` 已移除 / 浮层 textarea 绑定 `selectionEdit` / 增量高亮缓存 / 空闲面板判定；渲染：4 个 slot 注册，`conversation.view` 的 id 与 `order: 20`，`View()` 真正执行并产出 `.elr-view` 根节点）。

### v17 · 1.0.16

- **优化：选中翻译的英文框与译文框大小可以独立调节** —— 旧版把原文和译文塞进同一个可滚动 `.elr-popup-body`，只有整卡右下角一个 `resize: both`，改大小只能一起变。现在原文 `<textarea>` 保留原生 `resize: vertical`（`min-height: 52px; max-height: 60vh`，自带 `overflow: auto` + `overscroll-behavior: contain`），译文框新增 `.elr-popup-result-box`（`min-height: 56px; max-height: 50vh; overflow: auto; resize: vertical`）——**两块各自有独立的竖向拖柄和滚动条**，把英文框拉高不会挤压译文框，反之亦然。整卡仍可拖右下角统一缩放。
- **修复：论文分析版块无法独立滚动** —— `.elr-col` 原来是 `flex: 1 1 auto; min-height: 120px`，固定的 120px 下限让「翻译 / 分析」这一列**比侧栏剩余空间还高**，于是内容被 `.elr-side` 的 `overflow: hidden` 直接裁掉，看起来像是"不滚动"或"跟着别处滚"。改为 `flex: 1 1 0; min-height: 0`：这一列严格等于标签行下方剩余高度，`.elr-out` 的 `overflow: auto` 因此真正生效，分析长文本只在自己内部滚动，不牵动 PDF 也不牵动上方选中卡片。
- **新增：选中后先显示原文，点击「翻译」才发起翻译** —— 新增 `stageRef.current(value, rect)`：`selectionchange` 与文本框选中的处理函数不再调用 `translateRef.current(...)`，而是把选中的英文写进 `popup.text` 并置 `pending: true`（**不调用模型**）。浮层原文框下方新增「翻译」按钮（`popup.translate`），右侧「选中翻译」卡片标题栏也新增「翻译」按钮（`selection.translate`），两者都显式调用 `translateRef.current(...)`；译文框在未翻译时显示 `selection.pending`（「已选中文本，点击「翻译」后再开始翻译。」）。仍保留「重新翻译」按钮用于**编辑原文后**重跑，且不带锚点，弹窗停在用户拖动后的位置。
- `ASSET_V` → `?v=1.0.16`，`package.json` → `1.0.16`；新增 3 个文案键（`selection.pending` / `selection.translate` / `popup.translate`），中英文各 120 keys。
- 校验：`node --check` 两文件通过；桩渲染 harness 29 项断言全过（含 `stageRef` 只置 pending 不调模型、选区路径不再直连 `translateRef`、两个 `resize: vertical` 规则、`.elr-col` 的 `flex: 1 1 0`、三处新文案键与中英文全量键对齐）；插件重载后 `/meta`、`/vendor/pdf.min.js?v=1.0.16` 均 200，`/vendor/nope.txt` 404。

### v16 · 1.0.15

- **修复：中文译文里出现大量换行、读起来不连贯** —— 根因不在拼接，而在**模型被提示词要求照抄换行**：`TRANSLATE_SYSTEM` 第 (4) 条原文是 `keep the original paragraph and line structure`，于是模型几乎在每个源句 / 子句边界处都回一个换行。pdf.js 的文字层每**视觉行**一个 `\n`（用户那段的英文本身就带 `thebatch`、`thenumber`、`anearly` 这类行尾粘连），所以译文里"几乎每句一个换行"本质上是排版痕迹被当成了结构。
  - **提示词收紧**：第 (4) 条改为要求「每一段写成一段连续的行文，句子或子句之间绝不换行，源文换行只是排版产物」；新增第 (5) 条「段落之间用**一个空行**分隔，且只在原文真实分段处」；原「只输出译文」变成第 (6) 条。
  - **Host 侧加译文回流后处理** `joinTranslatedLines(value)`（`index.js`，`CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/`）：先把 `\r\n?` 归一，按 `\n{2,}` 切段，每段内逐行 `trim()` 后合并——**相邻两侧有中日韩字符时不补空格**（避免"在训练过程中， 训练轮数"这种空档），两侧都是拉丁字符时补一个空格（保护英文术语 / 公式 / 表格行不被粘连），最后用 `\n\n` 重新连接段落。空段直接丢弃。
  - **接线位置**：`translateChunk()` 里 `const cleaned = joinTranslatedLines(first); if (cleaned) return cleaned;`——**每个分段**（选中翻译、全文翻译、拆半重试的每一半）的输出都先过这道回流，因此任何模型、任何档位都不会再把碎换行漏到界面上。
  - 单元测试（`.unit.cjs`，测后已删除）11 项全过：用户报告的那段"每句一换行"原文 → **0 个换行**，`在训练过程中，训练轮数` 与 `所有数据集的输入长度` 正确粘连，`S 从集合` 保留空格；真实段落分隔 → 恰好 `\n\n` 且各段内已合并；纯拉丁两行 → 补空格合并；`\r\n`、空串、纯空行均正确。
- `ASSET_V` → `?v=1.0.15`，`package.json` → `1.0.15`；本版未新增文案键（中英文仍各 117 keys）。

### v15 · 1.0.14

- **新增：选中翻译的英文原文可直接编辑、重新翻译** —— 弹窗里的英文原文区改为受控 `<textarea>`（`popup.text`），改完点右下角「重新翻译」按钮即以编辑后的文本重跑翻译。重新翻译**不带锚点**（`rect === null`），弹窗保持在用户拖动后的位置不动。
- **优化：原文区与译文区背景明显区分** —— 原文区（可编辑）放在 `--dsw-alias-bg-layer-1` 中性底 + 灰色左侧色条的卡片里，标头「英文原文（可编辑）」；译文区放在品牌色 9% 淡染底 + 品牌色左侧色条的卡片里，标头「中文译文」。两块各有圆角边框与独立标签，颜色全部来自宿主主题 token，深浅主题下均可读。
- **修复：翻译结果出来后弹窗跳回初始位置** —— 旧版结果到达时用 `setPopup({ text, translated, x: pos.x, y: pos.y })` 整体重建弹窗，`pos` 还是选区坐标，把用户拖到的位置直接抹掉。现在结果只**合并**进现有弹窗（`writeResult({ translated, busy })` 只改这两个字段，`x/y` 原样保留）；只有全新选区才带新锚点。失败 / 超时分支同样只合并。
- **修复：滚动论文时右侧分析栏跟着滚动** —— `.elr-view` / `.elr-body` / `.elr-main` 补上 `overflow: hidden`（此前高出面板的 PDF 会让祖先盒子出现滚动条，把右栏一起拖走），并在 `.elr-pdf-container` / `.elr-side` / `.elr-side-top` / `.elr-out` / `.elr-popup-body` 加 `overscroll-behavior: contain`，滚轮手势到达容器边界后被消费，不再链到外层框架。
- `ASSET_V` → `?v=1.0.14`，`package.json` → `1.0.14`；新增 3 个文案键（`popup.original` / `popup.translation` / `popup.retranslate`），中英文各 117 keys。

### v14 · 1.0.13

- **修复：选中翻译的中文译文断层 / 不连贯 / 缺失** —— 用户给出的整段 Abstract（约 1500 字符）被旧版按 `TRANSLATE_CHUNK_CHARS = 700` 从**句子中间**切成 3 片，每片单独翻译后又一律用 `"\n\n"` 拼接，于是出现「…为了高效地」这种半截句、凭空多出的空行、重复翻译的中段和孤立的尾巴。BEFORE 实测 7426 ms、3 个分段、3 段断开的中文，与用户粘贴完全一致。
  - Host 新增 `SELECTION_UNIT_CHARS = 2400` 与 `planSelection(text, maxChars)`：**选中文本（`full:false`）不再按字符数硬切**，而是按完整句子成组（句子边界正则带 lookbehind，`e.g., local weather` 这类缩写不会被误切），只有超过 2400 字符才在词边界拆，并且拆出的续片 `sep` 为空；`\n\n` 只在原文**真实段落**处出现。返回的每个单元带 `{ text, sep }`，`sep` 是这段译文之前应补的输出分隔符。
  - `/translate` 用 `planned` 取代原来的 `parts.join("\n\n")`：按记录的 `sep` 重新拼装，连续选区全是 `sep:""` → 一段不断开的中文；重试拆半也改用空分隔符（`retrySep`），超时不会再把断层带回来。`chunks` 改取 `results.length`（修掉一处引用已删除 `parts` 的笔误）。`full:true` 全文翻译仍走 v12 已验证的 700 字符分段，未改动。
  - Client `selectionToText()` 把多个 Range 的拼接由 `"\n\n"` 改成 `"\n"`：`cleanSelectionText()` 会把单个换行变成空格，因此跨页 / 多 Range 的连续选区不会再被凭空插进段落分隔符。单元测试：1502 字符 Abstract → **1 个单元、无分隔符、原文逐词可还原**；两段文字 → 2 单元且第二段才带 `\n\n`；3500 字符长句 → 7 单元全部 `sep=""`。
- **修复：调整窗口大小字体不变 → 改为独立字号按钮** —— v13 的 `clamp(11px, 3.2cqw, 20px)` 在用户的 Electron 构建里被静默丢弃（`cqw` 不受支持时整个 `clamp()` 声明无效；受支持时子元素字号又会覆盖继承值），实测拖动角柄字号没有任何变化。本版**删除** `container-type: inline-size`、`cqw`、`popupCardRef` 和整个 `ResizeObserver` 自动缩放 effect；改为在弹窗标题栏放 **`A−` / `A+`** 两个按钮（`popup.fontDec` / `popup.fontInc`），字号状态 `popupFont` 存于 `localStorage['elr.popupFont']`，默认 13px、范围 10–24px，作为内联 `fontSize` 写在卡片根节点，由 `.elr-popup-original/.elr-popup-text { font-size: inherit }` 继承。按钮不会触发标题栏拖动（拖动手柄本来就会跳过 `button`）。
- `ASSET_V` → `?v=1.0.13`，`package.json` → `1.0.13`；新增 2 个文案键，中英文各 114 keys。

### v13 · 1.0.12

- **优化：加载 PDF 经常卡顿** —— 根因是 pdf.js 每渲染一页就派发一次 `textlayerrendered` / `pagerendered`，而旧代码每个事件都跑一次**全文档** `applyHighlights()`（遍历所有页的所有 span、建 Range 矩形、重画主题 canvas），30 页论文等于连做 60+ 次重活；主题切换的 `viewer.refresh()` 又会重绘每一页 canvas、再引爆一轮 `pagerendered`；`extractText()` 还在首页渲染的同时抢主线程。
  - 新增 `DECORATE_DEBOUNCE_MS = 160` 合并器 `scheduleDecorate()`：一整串逐页事件只触发**一次** `applyThemeRef.current()`（`applyTheme()` 本身末尾会再跑一次 `applyHighlights()`，所以一次调用恰好是一次完整装饰，不会重复两遍）。`textlayerrendered` / `pagesloaded` / `pagesinit` / `pagerendered` 全部改走它；标记、主题、双栏三个 effect 也统一改走它。
  - 主题 effect 删掉 `viewer.refresh()`：主题现在只是纯 CSS 换类，不需要重绘任何 canvas。
  - `extractText(pdf)` 延后到 320 ms 再启动，并把让出事件循环的频率从每 10 页改成每 3 页（`setTimeout(r, 0)` 宏任务），让渲染 / 滚动能插空。
  - 切文档时先 `clearTimeout(decorateTimerRef.current)`，避免上一篇文章挂起的装饰任务打到已销毁的 DOM。
- **修复：内联翻译浮层缩放后英文不同步（v14 已改为手动字号按钮）** —— 旧样式把正文写死 `font-size: 12px`，而卡片是 `resize: both`。v13 曾改用 `.elr-popup-body { container-type: inline-size }` + `font-size: clamp(11px, 3.2cqw, 20px)` 与 `ResizeObserver` 自动缩放，但用户实测无效，v14 已全部移除，改为标题栏 `A−` / `A+` 按钮。
- **修复：选中文本翻译结果格式乱** —— pdf.js 文字层每个视觉行尾都有硬换行，词常被行尾连字符拆开（`remark-\nable`），还混有软连字符、连字（ﬁ/ﬂ/ﬀ）、不间断空格。新增 `cleanSelectionText()`：`\r\n` 归一、剔除软连字符 / 零宽字符 / BOM、NBSP 转空格、连字展开、`([A-Za-z])-\n([a-z])` 去断词连字符、**单个换行变空格、2+ 换行变一个段落分隔符**、合并多余空白、逐段 trim。右键菜单、`selectionchange`、文本框选区三处入口统一走它，模型拿到的是真正的段落而不是每行断开的碎片。
- **修复：选两段文字翻译缺后半段** —— 旧代码用 `sel.toString()` 且硬裁 `MAX_SELECTION = 1500`。新增 `selectionToText(sel)` 遍历 `sel.rangeCount` 的**每一个 Range**（Ctrl 多选、跨 pdf.js 页边界都覆盖），用 `\n\n` 拼接后统一清洗；Client `MAX_SELECTION` 与 Host `MAX_SELECTION_CHARS` 一起提到 `6000`。Host 的 `splitIntoChunks()` 本来就按 `\n\n` 切段，所以两段选区变成两个分段，输出保留段落间隔；快模型下这些分段按 `TRANSLATE_CONCURRENCY = 4` 并行，不再一段一段串行等。
- `ASSET_V` → `?v=1.0.12`，`package.json` → `1.0.12`；本版只改 CSS / JS / 常量，未新增文案，中英文仍为 112 keys。

### v12 · 1.0.11

- **修复：全文翻译失败** —— profile 的 agent 默认模型切到了 `workbuddy/hy4free`（慢推理模型，只提供 `high` 档），而 `TRANSLATE_CHUNK_CHARS = 1200` / `MODEL_TIMEOUT_MS = 120000` 是当初在快模型上标定的；实测 `hy4free` 上 1200 字符会超过 120 s 并报 `model call aborted (timeout)`，加上 `CONCURRENCY = 1` 串行，一篇 60000 字符论文要跑数小时，Client 的 `post()` 又没有超时，浏览器会挂约 9 分钟后从 `failedChunks` 提示里看到「全文翻译失败」。
  - **Host**：`TRANSLATE_CHUNK_CHARS` 降到 `700`；新增 `TRANSLATE_CONCURRENCY = 4`（仅在判定为快模型时启用，慢推理模型并行会被限流，实测 3 路里有 1 路直接超时，因此仍保持串行）；`runModel()` 支持按调用传入 `timeoutMs`（全文翻译 90 s，其余沿用 120 s）；失败分段先 `splitIntoChunks` 拆成两半各重试一次，仍失败才写入 `[本段翻译失败: …]`，可同时兜住超时与 `Stream ended without finish_reason`。
  - **快模型自动兜底**：`FAST_MODEL_CANDIDATES` 列出 6 个实测快的 flash / pro 模型，`pickFastModel()` 用 `llm.listModels()` 校验目录里确实存在后取第一个（结果缓存 10 分钟）。`resolveEffectiveModel()` 只在 Client 带了 `fastModel: true` 时替换 provider / model，并把 `reasoningEffort` 清空（慢模型的档位在快模型上常不支持，直接传会报 `UNSUPPORTED_REASONING_EFFORT`）；响应新增 `fast` 字段说明本次是否走了快模型。
  - **Client**：因为 `modelBody()` 总会把自动填充的 `provider` / `model` 一起发出去，Host 无法靠「字段是否存在」区分用户是否真的选过；新增持久化标记 `localStorage['elr.modelPicked']`，只有用户动过服务商 / 模型 / 推理强度下拉或点过「手动输入」才置为 `true`。未显式选择时 `modelBody()` 带 `fastModel: true`，显式选择时该标记缺省，用户的模型始终优先。
  - **不再无限等待**：`post()` 加 `AbortController`（默认 300 s，全文翻译给 600 s），超时抛带 `timeout` 标记的 `ELR_TIMEOUT`，界面显示「翻译超时，请重试或在模型栏中选择更快的模型。」而不是一直转圈。
- `ASSET_V` → `?v=1.0.11`，`package.json` → `1.0.11`，中英文各新增 `translate.timeout` 文案（112 keys）。

### v11 · 1.0.10

- **修复：全屏浮层顶部和 Harness 顶栏重叠** —— 浮层是 `position: fixed` 且 portal 到 `<body>`，原来的 `inset: 0` 会把 Harness 自己的窗口控制栏一起盖住，于是两排按钮糊在一起。现在改为 `top: var(--dsh-frame-chrome-top, var(--dsh-frame-top-clearance, 0px)); bottom/left/right: 0`：`@deepseek-ai/dsh-client-ui-layout` 在 `html[data-windows-titlebar]` 上把 `--dsh-frame-chrome-top` 设成标题栏高度、在 macOS 上把 `--dsh-frame-top-clearance` 设成 48px，全屏时这些变量会塌缩为 `0`，因此浮层在三种情况下都能正好贴在顶栏下沿（浏览器里没有这些变量，`inset` 退回 0，仍贴边铺满）。先取 `chrome-top` 再退回 `top-clearance`，是因为全屏时变成 `0px` 的正是 `chrome-top`。
- **新增：集成到左侧边栏工具栏** —— 新增一对槽位：`sidebar.panellist`（`id: english-lit-reader-panel`、`order: 4`、`label: () => t('launcher')`）提供左侧工具栏里的文件夹图标，`main`（`key: english-lit-reader-panel`）提供点击后整页渲染的中央面板。组件 `NavIcon` 按 owner 传入的 `size` 绘制内联 SVG 并用 `currentColor` 跟主题；`Panel` 只是把同一个 `Reader` 包进 `.elr-panel`（`flex:1 1 auto; min-width:0; min-height:0`，并让内部 `.elr-view` 的 `min-height` 归零），所以侧栏面板里排版与标签页一致。
  - 卸载时先 `layout.selectPanel(null)` 复位当前面板，再注销两个槽位，避免中央面板停在一个已注销的键上。
  - `package.json` 的 `dsh.client.inject` 补入 `@deepseek-ai/dsh-client-ui-layout` 与 `@deepseek-ai/dsh-client-ui-sidebar`，保证这两个包提供的槽位在 `apply()` 之前已声明。

### v10 · 1.0.9

- **新增：内联翻译浮层可拖动** —— `.elr-popup-head` 加上 `cursor: move; user-select: none;`，并绑定 `onPointerDown`：按下时记录起点与 `popup.x/y`，`pointermove` 时按窗口尺寸夹取 `nx/ny` 写回 `setPopup`，松手移除监听；点到按钮不触发拖动。**只写位置、不写宽高**，所以和 v9 的右下角缩放可以同时使用（写宽高会和浏览器原生 resize 打架）。
- **修复：公式卡片正文里的行内公式仍显示为源码** —— 根因是 v9 的 `INLINE_MATH_RE` 用 `\\\([^)]*?\\\)` 匹配 `\(…\)`，**字符类 `[^)]` 排除了右括号**，而模型给出的 `\(X_{(T+1):(T+S)} = F(X_{1:T}, E_{1:T}) \in \mathbb{R}^{M \times S}\)` 里本身就带右括号，于是永远匹配不到收尾的 `\)`，整段回落成纯文本。改为惰性任意字符 `\\\([\s\S]*?\\\)`（并对 `$$…$$` / `\[…\]` / `$…$` 同样处理，display 形式排在单 `$` 之前，否则内层一对会被先吃掉、外层定界符原样漏出）。
- **新增：公式容错 `normalizeTex()`** —— 模型偶尔会吐 KaTeX 不认的命令，`renderMath()` 先按原文排版，失败则用 `normalizeTex()` 归一化后重试（`\mathbbm`→`\mathbb`、`\bm{`→`\boldsymbol{`、`\operatorname*{`→`\operatorname{`，剥离 `\label`/`\tag`/`\hspace*`/`\phantom`/`\eqref`/`\nonumber`/`\notag`/`\displaystyle`/`\textstyle`，`\mbox{`→`\text{`，丢弃 `figure`/`table`/`tabular`/`center`/`flushleft`/`flushright` 环境）。因为 `throwOnError: false` 只会返回一个带 `katex-error` 类的错误节点而**不会抛异常**，所以用 `KATEX_FAILED_RE = /class="[^"]*\bkatex-error\b/` 判定失败，两次都失败才退回等宽源码。
- **修复：全屏浮层四周的灰色区域和 Harness 页面打架** —— 右下角胶囊打开的全屏浮层原先用 `background: var(--dsw-alias-bg-overlay)` + `padding: 22px`，这圈 22px 半透明留白会把底下的 Harness 页面透出来。现在 `.elr-overlay` 改为 `position: fixed; inset: 0; background: var(--dsw-alias-bg-base); padding: 0; overflow: hidden`（完全不透明、贴边铺满），`.elr-overlay-inner` 去掉边框 / 圆角 / 阴影，并新增 `.elr-overlay .elr-view { min-height: 0; height: 100%; }` 抵消标签视图的 `min-height: 360px`；浮层打开时同时锁住 `document.body` 的滚动（关闭时还原）。浮层的 `z-index: 90` 仍低于各个悬浮卡片（浮层 120 / 气泡 125 / 公式卡 126 / 右键菜单 130），因为那些卡片是 portal 到 `body` 的。

### v9 · 1.0.8

- **新增：内联翻译浮层 / 公式详解卡片可调整大小** —— 两者都加 `.elr-resizable`（`resize: both`），右下角画一个小三角抓手 `.elr-grip-corner`；浮层宽度按挂载时写入一次，用户拖出来的尺寸不会被重渲染覆盖；`.elr-popup-body` / `.elr-formula-body` 改为 `flex:1 1 auto; min-height:0` 以便随卡片一起伸缩。
- **修复：公式显示成 `$$…$$` 源码看不懂** —— 分三层解决：① 内置 **KaTeX 0.16.9**（`vendor/katex/`，21 个 woff2 字体，Host 的 vendor 路由按扩展名发 `font/woff2`），完全离线可用；② `renderMarkdown()` 取代旧的 `simpleMarkdown()`，支持 `$$…$$` / `\[…\]` 块级公式、`$…$` / `\(…\)` 行内公式、以及 GitHub 管道表格（渲染成 `.elr-md-table`，带表头底色与斑马纹）；③ 新增 `renderFormulaPreview()` 处理 PDF 里复制出来的**裸 TeX**（无 `$` 定界符、可能跨行）：折叠换行后直接作为 display math 交给 KaTeX。KaTeX 首次需要时才懒加载，`useKatexReady()` 在加载完成后触发重渲染，已经打开的卡片会自动从源码升级为排版结果。
- **修复：只选两个词却把整行高亮** —— pdf.js 常把一整行渲染成**一个** `.textLayer span`，按 span 包围盒填色自然就涂满整行。改为 `rectsForSpanRange()` 用 `document.createRange()` 精确框住命中的字符并取 `range.getClientRects()`（跨行时返回多块），只填这些块；`applyHighlights()` 额外维护 `maps[i]` 把「去空白后的下标」映射回「span 原始字符下标」，否则 Range 会偏移。`paintPageHighlights()` 相应改为接收**已测量的矩形数组**而不是 span 元素。
- **重命名：所有旧措辞统一为「高亮」** —— 内联 `dictionaries.zh` 与 `locale/zh.json` 的 `mark.add` / `mark.title` / `mark.empty` / `mark.saved` 全部改用「高亮」措辞，代码与文档里不再出现旧名。
- **修复：右键已标注语句要求先重新选中** —— `onContextMenu` 现在**先**处理「点在已有标注上」这一支：`closest('.textLayer span[data-elr-mark]')` 命中后直接 `setMenu({ markId })` 并 `return`，完全不需要选区；`applyHighlights()` 也随之给**每个**被命中的 span 打 `data-elr-mark`（此前只给带批注的 span 打），所以纯高亮的句子也能被右键识别。原有的「有选区」分支保留在后面，用于首次添加标注。

### v8 · 1.0.7

- **新增：批注气泡可拖动** —— 气泡标题栏改为 `cursor: move`，`pointerdown` 后跟随指针移动并按窗口尺寸夹取边界，松手移除监听；点到按钮时不触发拖动。
- **重构：高亮与批注彻底解耦** —— 标注数据结构从「有批注 = 有高亮」改为 `{ id, text, note, hl }` 两条独立字段（`normalizeMark()` 统一补齐旧数据）。新增 `addHighlight()` / `addNote()` / `removeHighlight()` / `clearNote()` 四个语义明确的动作：加批注不再自动高亮，取消高亮保留批注虚线，清除批注保留淡黄底色。渲染侧 `applyHighlights()` 分别收集 `hits`（`hl` 为真）与 `noted`（有批注文字），二者互不依赖。
- **新增：公式详解** —— Host 新增 `POST /formula`（`FORMULA_SYSTEM` 固定四段式输出），Client 右键菜单新增「解释公式」，弹出可拖动、可滚动的 `.elr-formula-card`，并把全文作为上下文一起提交。
- **移除：深色模式** —— 删除 `invertAchromatic` / `applyThemeToPages` / `THEME_CANVAS` 等全部逐像素反相逻辑、`.elr-theme-dark` 样式与下拉项；配色只剩「默认 / 纸张纹理 / 护眼黄」，旧快照的 `theme: 'dark'` 自动回落「默认」。
- **新增：Ctrl + 左键拖动** —— 拖动漫游不再强制先开开关：`canPan` 为 `panMode || ctrl || e.ctrlKey || e.metaKey`，并用 `keydown`/`keyup`/`blur` 跟踪 Ctrl 状态；拖动开始时清掉文本选区。
- **修复：右侧栏比例无法调节** —— `.elr-sel-card` 原先写死 `max-height: 42%`，且三段之间没有可拖动的分隔条。现在 `.elr-side-top` 使用显式高度（`sideTopHeight`，默认 220px，最小 90px），与下方标签区之间插入 `.elr-splitter`，拖动即改比例并持久化。
- **新增：右侧功能栏自由排序** —— 三段包在 `.elr-sec` 容器里，按 `sectionOrder`（默认 `['selection','recent','marks']`）渲染；每段标题前的 `⠿` 抓手支持 HTML5 拖放，`moveSection()` 把被拖段插入目标段之前，顺序持久化到 `elr.snapshot`。
- 本地化：两种语言各新增 `formula.explain` / `formula.title` / `formula.working` / `formula.empty` / `formula.failed` / `section.drag` / `resize.split`，移除 `theme.dark`；`locale/*.json` 与内联字典各 110 项且完全对齐。

### v7 · 1.0.6

- **修复：从近期阅读切换 PDF 报错、打不开** —— `Cannot read properties of null (reading 'destroy')` 来自 pdf.js 拆卸旧文档时对已释放的 annotation editor 层重复 `destroy()`。两处修复：换文档前用 `disposeViewer()` 彻底销毁当前 viewer，再**新建** `PDFViewer` 加载新文档；`vendor/pdf_viewer.js` 的 `AnnotationEditorLayerBuilder.cancel()` 改为幂等判空。
- **修复：切换后单双栏失效** —— pdf.js `_resetView()` 会把 `_spreadMode` 复位并清空 `_pages`，而页面视图要到 `setDocument()` 的异步分支才建立；原代码在 `setDocument()` 后同步调用 `applySpread()`，打在空数组上无效。改为在 `pagesinit` 事件中应用。
- **修复：高亮与批注虚线错位** —— 叠加层改锚定 `.canvasWrapper`（glyph canvas 所在盒子）并用它的 rect 计算坐标。`.page` 带 9px 透明边框，既偏移绝对定位子元素、又让测量框偏大 18px。
- **修复：取消批注不应影响高亮** —— 新增右键菜单「清除批注」（`mark.clearNote`），只清空批注文字并重绘，淡黄高亮保留；整条删除仍走「取消高亮」。

### v6 · 1.0.5

- **修复：高亮看不清 / 异常高亮** —— pdf.js 的 `.textLayer` 本身 `opacity: .25` 且字形 `color: transparent`，任何 span 背景都会被按 25% 合成而糊住字形。改为在页面 canvas 之上、文字之下画一块 `<canvas class="elr-hl-overlay">`（`mix-blend-mode: multiply`），字形仍是黑色、纸面染成淡黄；匹配也改为**按页拼接 span 文本并记录偏移**后精确定位，只有与命中区间重叠的 span 才着色，从而消除「其他单词异常高亮」。
- **修复：深色下图表变色 / 粉色色块** —— 不再对 canvas 用 CSS `invert(1) hue-rotate(180deg)`（它会把彩色插图反成粉色）。改为把每页 canvas 复制一份，逐像素仅在 `max-min <= 26`（无彩色）时反相，彩色像素原样保留。
- **新增：阅读配色下拉** —— 工具条按钮改为「默认 / 深色 / 纸张纹理 / 护眼黄」下拉。
- **修复：右键菜单** —— 右键已标注语句时额外显示「取消高亮」「编辑批注」。
- **修复：近期阅读重复 / 双击打不开** —— 载入时按「文件名 + 大小」补齐旧记录 identity 并去重回写；条目自身绑定双击，另加 `▸` 打开按钮；PDF 字节不在 `localStorage` 时提示并直接唤起文件选择框。
