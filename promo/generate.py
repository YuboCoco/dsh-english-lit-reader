# -*- coding: utf-8 -*-
"""Generate the promotional artwork for dsh-english-lit-reader.

Everything is drawn from geometry so the images stay crisp and depend on no
external assets. Colours for the tone / paper swatches are copied from the
plugin's real CSS values, so the pictures cannot drift from the product.

Run with a Python that has Pillow:
    python promo/generate.py
"""

import os
import re
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = "C:/Windows/Fonts/"

INK = (15, 23, 42, 255)
SUB = (71, 84, 103, 255)
MUTE = (148, 163, 184, 255)
LINE = (226, 232, 240, 255)
WHITE = (255, 255, 255, 255)
BRAND = (47, 111, 235, 255)
WARM = (240, 178, 60, 255)


def font(size, bold=False):
    return ImageFont.truetype(FONT_DIR + ("msyhbd.ttc" if bold else "msyh.ttc"), size)


def mono(size, bold=False):
    return ImageFont.truetype(FONT_DIR + ("consolab.ttf" if bold else "consola.ttf"), size)


def tw(draw, text, f):
    return draw.textlength(text, font=f)


NO_LINE_START = "。，、；：？！）】》」』”’%…·"


def wrap(draw, text, f, maxw):
    """CJK-aware wrapping: keep latin words whole, never orphan closing marks."""
    out = []
    for para in text.split("\n"):
        cur = ""
        for tok in re.findall(r"[A-Za-z0-9\-_./@:+]+|\s+|.", para):
            cand = cur + tok
            if tw(draw, cand, f) <= maxw or not cur.strip():
                cur = cand
            else:
                out.append(cur.rstrip())
                cur = "" if tok.isspace() else tok
        out.append(cur.rstrip())

    # a line must not open with closing punctuation — pull it back onto the
    # previous line instead of leaving a lone 「。」 hanging at the margin
    for i in range(1, len(out)):
        while out[i] and out[i][0] in NO_LINE_START and out[i - 1]:
            out[i - 1] += out[i][0]
            out[i] = out[i][1:].lstrip()
    return [ln for ln in out if ln]


def vgrad(w, h, top, bottom):
    g = Image.new("RGB", (1, h))
    px = g.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return g.resize((w, h), Image.BILINEAR).convert("RGBA")


def glow(size, cx, cy, r, color, alpha=54):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(r * 0.55))


def shadow(img, box, radius=16, dy=10, blur=18, alpha=34):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    d.rounded_rectangle((x0, y0 + dy, x1, y1 + dy), radius=radius, fill=(15, 23, 42, alpha))
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def card(img, box, radius=16, fill=WHITE, outline=LINE, sh=True, dy=10, alpha=34):
    if sh:
        shadow(img, box, radius=radius, dy=dy, alpha=alpha)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius=radius, fill=fill)
    if outline:
        d.rounded_rectangle(box, radius=radius, outline=outline, width=1)


def bars(d, box, rows, color=(203, 213, 225, 255), h=6, gap=12, radius=3, widths=None):
    """Draw placeholder text lines; `widths` gives each row's fill fraction."""
    x0, y0, x1, y1 = box
    widths = widths or [1.0] * rows
    span = x1 - x0
    y = y0
    for i in range(rows):
        w = span * widths[i % len(widths)]
        d.rounded_rectangle((x0, y, x0 + w, y + h), radius=radius, fill=color)
        y += h + gap


def arrow(d, x0, y, x1, color=BRAND, w=3, head=9):
    d.line((x0, y, x1 - head, y), fill=color, width=w)
    d.polygon([(x1, y), (x1 - head, y - head * 0.72), (x1 - head, y + head * 0.72)], fill=color)


# --------------------------------------------------------------------------- cover
def build_cover(w=1280, h=640, path="01-cover.png"):
    img = vgrad(w, h, (255, 255, 255), (238, 244, 252))
    img.alpha_composite(glow((w, h), 1040, 150, 300, (76, 141, 240), 44))
    img.alpha_composite(glow((w, h), 700, 560, 260, (126, 200, 168), 26))

    d = ImageDraw.Draw(img)

    # badge
    bx0, by0 = 72, 84
    f_badge = font(15)
    label = "DeepSeek Harness 插件"
    bw = tw(d, label, f_badge)
    d.rounded_rectangle((bx0, by0, bx0 + bw + 44, by0 + 32), radius=16, fill=(233, 241, 254, 255))
    d.ellipse((bx0 + 14, by0 + 12, bx0 + 22, by0 + 20), fill=BRAND)
    d.text((bx0 + 30, by0 + 7), label, font=f_badge, fill=(28, 78, 168, 255))

    # title
    f_title = font(58, True)
    d.text((72, 132), "英文文献阅读器", font=f_title, fill=INK)
    d.text((74, 208), "dsh-english-lit-reader", font=mono(21), fill=MUTE)

    # rule
    d.rounded_rectangle((74, 254, 146, 258), radius=2, fill=(160, 190, 235, 255))

    # tagline
    f_tag = font(25)
    for i, t in enumerate(["选中句子，译文就落在旁边；", "创新点、技术方案、术语与公式，一次读完。"]):
        d.text((74, 286 + i * 44), t, font=f_tag, fill=(51, 65, 85, 255))

    # chips
    chips = ["选中翻译", "论文分析", "参考文献", "术语解释", "文内搜索"]
    f_chip = font(14)
    x = 74
    y = 410
    for c in chips:
        cw = tw(d, c, f_chip)
        d.rounded_rectangle((x, y, x + cw + 26, y + 32), radius=16, fill=WHITE, outline=(214, 226, 242, 255))
        d.text((x + 13, y + 7), c, font=f_chip, fill=(51, 65, 85, 255))
        x += cw + 38

    # ---- window mockup on the right
    wx0, wy0, wx1, wy1 = 706, 96, 1214, 552
    card(img, (wx0, wy0, wx1, wy1), radius=18, outline=(222, 231, 244, 255), dy=14, alpha=42)
    d = ImageDraw.Draw(img)

    # title bar
    d.rounded_rectangle((wx0, wy0, wx1, wy0 + 40), radius=18, fill=(248, 250, 253, 255))
    d.rectangle((wx0, wy0 + 26, wx1, wy0 + 40), fill=(248, 250, 253, 255))
    d.line((wx0, wy0 + 40, wx1, wy0 + 40), fill=(226, 234, 245, 255), width=1)
    for i, col in enumerate([(255, 128, 122), (255, 197, 96), (150, 214, 148)]):
        d.ellipse((wx0 + 16 + i * 18, wy0 + 15, wx0 + 26 + i * 18, wy0 + 25), fill=col)

    # toolbar strip
    d.rounded_rectangle((wx0 + 14, wy0 + 50, wx1 - 14, wy0 + 78), radius=8, fill=(243, 246, 251, 255))
    tx = wx0 + 26
    for i in range(5):
        d.rounded_rectangle((tx, wy0 + 58, tx + 34, wy0 + 70), radius=5, fill=(216, 224, 236, 255))
        tx += 42
    d.rounded_rectangle((tx + 4, wy0 + 58, tx + 92, wy0 + 70), radius=5, fill=(226, 236, 251, 255))

    # page area
    d.rounded_rectangle((wx0 + 14, wy0 + 90, wx0 + 316, wy1 - 14), radius=10, fill=(233, 238, 246, 255))
    px0, py0, px1, py1 = wx0 + 40, wy0 + 104, wx0 + 290, wy1 - 30
    d.rounded_rectangle((px0, py0, px1, py1), radius=4, fill=WHITE, outline=(226, 232, 240, 255))

    # page header + body text
    d.rounded_rectangle((px0 + 18, py0 + 18, px1 - 60, py0 + 32), radius=4, fill=(148, 163, 184, 255))
    row_y = py0 + 50
    rows = [(1.0, 0), (0.94, 0), (0.98, 0), (0.7, 1), (1.0, 0), (0.9, 0), (0.55, 0)]
    for frac, hl in rows:
        wpx = (px1 - px0 - 36) * frac
        if hl:
            d.rounded_rectangle((px0 + 18, row_y - 3, px0 + 18 + wpx, row_y + 11), radius=3, fill=(255, 222, 74, 255))
        d.rounded_rectangle((px0 + 18, row_y, px0 + 18 + wpx, row_y + 8), radius=3, fill=(203, 213, 225, 255))
        row_y += 22

    # figure block (colours preserved)
    d.rounded_rectangle((px0 + 18, row_y + 8, px0 + 128, row_y + 78), radius=3, fill=(219, 236, 255, 255))
    for i, col in enumerate([(96, 150, 224), (126, 200, 168), (240, 178, 60)]):
        d.rectangle((px0 + 26 + i * 30, row_y + 62 - i * 14, px0 + 48 + i * 30, row_y + 70), fill=col + (255,))
    d.rounded_rectangle((px0 + 140, row_y + 8, px1 - 18, row_y + 78), radius=3, fill=(243, 246, 251, 255))
    bars(d, (px0 + 148, row_y + 18, px1 - 26, row_y + 68), 3, color=(214, 223, 236, 255), h=5, gap=10)

    # right column cards
    cx0, cx1 = wx0 + 330, wx1 - 14
    card(img, (cx0, wy0 + 90, cx1, wy0 + 236), radius=10, outline=(226, 232, 240, 255), sh=False)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((cx0 + 1, wy0 + 91, cx1 - 1, wy0 + 118), radius=9, fill=(240, 244, 250, 255))
    d.rectangle((cx0 + 1, wy0 + 110, cx1 - 1, wy0 + 118), fill=(240, 244, 250, 255))
    bars(d, (cx0 + 12, wy0 + 100, cx0 + 76, wy0 + 110), 1, color=(148, 163, 184, 255), h=7)
    bars(d, (cx0 + 12, wy0 + 130, cx1 - 14, wy0 + 226), 5, widths=[1.0, 0.92, 0.98, 0.68, 0.44])

    card(img, (cx0, wy0 + 248, cx1, wy0 + 384), radius=10, outline=(226, 232, 240, 255), sh=False)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((cx0 + 1, wy0 + 249, cx1 - 1, wy0 + 276), radius=9, fill=(240, 244, 250, 255))
    d.rectangle((cx0 + 1, wy0 + 268, cx1 - 1, wy0 + 276), fill=(240, 244, 250, 255))
    bars(d, (cx0 + 12, wy0 + 258, cx0 + 92, wy0 + 268), 1, color=(148, 163, 184, 255), h=7)
    for i in range(3):
        yy = wy0 + 288 + i * 30
        d.rounded_rectangle((cx0 + 12, yy, cx0 + 66, yy + 18), radius=5, fill=(232, 238, 248, 255))
        bars(d, (cx0 + 76, yy + 5, cx1 - 14, yy + 13), 1, color=(210, 220, 233, 255), h=6)

    img.convert("RGB").save(os.path.join(HERE, path), optimize=True)
    return os.path.join(HERE, path)


# ------------------------------------------------------------------------ features
ICON_BG = [
    (233, 241, 254, 255),
    (233, 248, 240, 255),
    (253, 243, 226, 255),
    (240, 236, 254, 255),
    (253, 236, 242, 255),
    (255, 248, 214, 255),
    (232, 244, 250, 255),
    (236, 240, 246, 255),
]
ICON_FG = [
    (37, 99, 235, 255),
    (22, 138, 92, 255),
    (176, 116, 16, 255),
    (109, 82, 214, 255),
    (190, 62, 104, 255),
    (154, 116, 12, 255),
    (18, 116, 148, 255),
    (71, 84, 103, 255),
]


def icon(d, kind, cx, cy, col):
    """24x24 geometric glyph centred on (cx, cy)."""
    s = 11
    x, y = cx - s, cy - s
    if kind == 0:      # translate: two blocks + arrow
        d.rounded_rectangle((x, y + 2, x + 12, y + 20), radius=3, outline=col, width=2)
        d.rounded_rectangle((x + 18, y + 6, x + 28, y + 24), radius=3, fill=col)
        d.line((x + 5, y + 8, x + 12, y + 8), fill=col, width=2)
        d.line((x + 5, y + 13, x + 10, y + 13), fill=col, width=2)
    elif kind == 1:    # analysis: bullets
        for i in range(3):
            yy = y + 4 + i * 8
            d.ellipse((x + 2, yy, x + 7, yy + 5), fill=col)
            d.rounded_rectangle((x + 11, yy + 1, x + 24, yy + 4), radius=2, fill=col)
    elif kind == 2:    # references: two linked squares
        d.rounded_rectangle((x + 1, y + 1, x + 15, y + 15), radius=4, outline=col, width=2)
        d.rounded_rectangle((x + 10, y + 10, x + 24, y + 24), radius=4, fill=col)
    elif kind == 3:    # formula
        d.line((x + 3, y + 4, x + 12, y + 4), fill=col, width=2)
        d.line((x + 3, y + 20, x + 12, y + 20), fill=col, width=2)
        d.line((x + 4, y + 4, x + 13, y + 20), fill=col, width=2)
        d.line((x + 18, y + 8, x + 25, y + 8), fill=col, width=2)
        d.line((x + 18, y + 16, x + 25, y + 16), fill=col, width=2)
    elif kind == 4:    # glossary: tag
        d.rounded_rectangle((x + 2, y + 4, x + 22, y + 22), radius=4, outline=col, width=2)
        d.ellipse((x + 7, y + 9, x + 12, y + 14), fill=col)
        d.line((x + 15, y + 12, x + 18, y + 12), fill=col, width=2)
        d.line((x + 15, y + 17, x + 19, y + 17), fill=col, width=2)
    elif kind == 5:    # highlight
        d.rounded_rectangle((x + 2, y + 10, x + 22, y + 18), radius=3, fill=col)
        d.line((x + 2, y + 4, x + 16, y + 4), fill=col, width=2)
        d.line((x + 2, y + 22, x + 12, y + 22), fill=col, width=2)
    elif kind == 6:    # search
        d.ellipse((x + 3, y + 3, x + 19, y + 19), outline=col, width=2)
        d.line((x + 17, y + 17, x + 24, y + 24), fill=col, width=3)
    else:              # layout
        d.rounded_rectangle((x + 1, y + 3, x + 12, y + 21), radius=2, outline=col, width=2)
        d.rounded_rectangle((x + 15, y + 3, x + 26, y + 21), radius=2, fill=col)


def build_features(w=1280, h=940, path="02-features.png"):
    img = vgrad(w, h, (255, 255, 255), (244, 248, 253))
    img.alpha_composite(glow((w, h), 150, 60, 240, (120, 170, 245), 30))
    img.alpha_composite(glow((w, h), 1150, 880, 260, (140, 210, 180), 24))
    d = ImageDraw.Draw(img)

    d.text((72, 62), "九个功能，一条阅读动线", font=font(40, True), fill=INK)
    d.text((72, 120), "所有能力都长在同一个界面上——不用切窗口、不用复制粘贴、不用另开对话。",
           font=font(19), fill=SUB)

    items = [
        ("选中翻译", "选中句子点一下才调用模型，选中本身不计费。", 0),
        ("论文分析", "背景 / 创新点 / 技术方案 / 实验 / 局限五段结构。", 1),
        ("参考文献", "逐条查 Crossref 拿 DOI，查不到就写「未找到」。", 2),
        ("公式详解", "KaTeX 真排版回显，符号逐个进表格解释。", 3),
        ("术语解释", "结合所在原句与全文解释，并自动成术语表。", 4),
        ("高亮与批注", "淡黄高亮与蓝色批注是两条独立记录，可筛选可跳转。", 5),
        ("文内搜索", "回车跳到首命中，再用上/下箭头在命中之间切换。", 6),
        ("阅读控制", "单页 / 双页 / 三页、缩放、双向拖动、近期阅读。", 7),
        ("显示设置", "页面配色、界面配色、停靠、浮层，收在一个面板里。", 8),
    ]

    cols, gap = 3, 26
    cw = (w - 144 - gap * (cols - 1)) // cols
    ch = 180
    f_card = font(15)
    for i, (title, desc, kind) in enumerate(items):
        r, c = divmod(i, cols)
        x0 = 72 + c * (cw + gap)
        y0 = 196 + r * (ch + gap)
        card(img, (x0, y0, x0 + cw, y0 + ch), radius=16, outline=(229, 234, 243, 255), dy=8, alpha=26)
        d = ImageDraw.Draw(img)
        d.ellipse((x0 + 22, y0 + 22, x0 + 66, y0 + 66), fill=ICON_BG[kind % len(ICON_BG)])
        icon(d, kind, x0 + 44, y0 + 44, ICON_FG[kind % len(ICON_FG)])
        d.text((x0 + 22, y0 + 80), title, font=font(21, True), fill=INK)
        for k, ln in enumerate(wrap(d, desc, f_card, cw - 44)[:3]):
            d.text((x0 + 22, y0 + 116 + k * 25), ln, font=f_card, fill=SUB)

    d.text((72, h - 56), "示意图：按插件真实布局绘制，非界面截图。", font=font(14), fill=MUTE)
    img.convert("RGB").save(os.path.join(HERE, path), optimize=True)
    return os.path.join(HERE, path)


# ---------------------------------------------------------------------------- tones
TONES = [
    ("默认", "跟随 Harness 主题", "#ffffff", "#f7f9fc", "#eef1f6", "#d9dfe8", "#3f6ea8", False),
    ("淡蓝", "blue", "#eaf3fc", "#f5fafe", "#dfeefa", "#c9dcf0", "#2f74b8", False),
    ("淡绿", "green", "#eaf7ee", "#f5fcf7", "#dff1e5", "#c6e3ce", "#2f8555", False),
    ("淡黄", "amber", "#fdf6e0", "#fdfaf0", "#f7ecc9", "#e6d9ad", "#9a6b12", False),
    ("深蓝", "navy", "#16263a", "#1c3049", "#223a58", "#2e4a6b", "#6fb0ee", True),
    ("淡粉", "pink", "#fdeef3", "#fff6f9", "#f9dfe8", "#f0cddb", "#c2456f", False),
]

PAPERS = [
    ("默认", "纯白纸面", "#ffffff", "#e5e7eb", False, False),
    ("纸张纹理", "暖白 + 三层纤维纹理", "#f7f1e3", "#e4d9c3", True, False),
    ("护眼黄", "更淡的纸黄，久看不刺眼", "#fdf8e2", "#f0e9c4", True, True),
]


def hx(v):
    v = v.lstrip("#")
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def blend(fg, bg, alpha):
    """Opaque equivalent of fg@alpha over bg.

    ImageDraw on an RGBA canvas REPLACES pixels instead of blending them, so a
    translucent fill would export as a transparent hole and then composite to
    black in the saved RGB. Every overlay colour is pre-blended here instead.
    """
    fg = fg if len(fg) == 4 else fg + (255,)
    bg = bg if len(bg) == 4 else bg + (255,)
    return tuple(int(round(bg[i] * (1 - alpha) + fg[i] * alpha)) for i in range(3)) + (255,)


def mini_ui(img, box, base, layer1, layer2, border, brand, dark):
    x0, y0, x1, y1 = box
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius=10, fill=hx(base))
    # header
    d.rounded_rectangle((x0, y0, x1, y0 + 26), radius=10, fill=hx(layer2))
    d.rectangle((x0, y0 + 16, x1, y0 + 26), fill=hx(layer2))
    d.rounded_rectangle((x0 + 10, y0 + 9, x0 + 42, y0 + 17), radius=4, fill=hx(brand))
    d.rounded_rectangle((x1 - 26, y0 + 9, x1 - 12, y0 + 17), radius=4, fill=hx(border))
    # two cards
    cw = (x1 - x0 - 24) // 2
    card_bg = hx(layer1)
    body = blend(hx(border), card_bg, 0.75)
    for i in range(2):
        cx = x0 + 8 + i * (cw + 8)
        d.rounded_rectangle((cx, y0 + 34, cx + cw, y1 - 8), radius=7, fill=card_bg, outline=hx(border), width=1)
        d.rounded_rectangle((cx + 1, y0 + 35, cx + cw - 1, y0 + 48), radius=6, fill=hx(layer2))
        d.rectangle((cx + 1, y0 + 44, cx + cw - 1, y0 + 48), fill=hx(layer2))
        for k in range(3):
            ww = [0.78, 0.92, 0.6][k]
            d.rounded_rectangle((cx + 8, y0 + 56 + k * 13, cx + 8 + int((cw - 16) * ww), y0 + 62 + k * 13),
                                radius=3, fill=body)


def build_tones(w=1280, h=940, path="03-tones.png"):
    img = vgrad(w, h, (255, 255, 255), (245, 249, 253))
    img.alpha_composite(glow((w, h), 1080, 120, 260, (150, 190, 245), 28))
    d = ImageDraw.Draw(img)

    d.text((72, 56), "六套界面配色", font=font(34, True), fill=INK)
    d.text((72, 104), "只换界面自身的颜色——工具栏、功能卡片、浮动面板一起变，PDF 内容不受影响。",
           font=font(17), fill=SUB)

    n = len(TONES)
    gap = 16
    cw = (w - 144 - gap * (n - 1)) // n
    for i, (name, en, base, layer1, layer2, border, brand, dark) in enumerate(TONES):
        x0 = 72 + i * (cw + gap)
        y0, y1 = 156, 336
        shadow(img, (x0, y0, x0 + cw, y1), radius=12, dy=6, alpha=26, blur=12)
        d = ImageDraw.Draw(img)
        mini_ui(img, (x0, y0, x0 + cw, y1), base, layer1, layer2, border, brand, dark)
        d.text((x0 + 2, y1 + 14), name, font=font(16, True), fill=INK)
        d.text((x0 + 2, y1 + 40), en, font=font(12), fill=MUTE)

    # ---- paper section
    d.text((72, 408), "三套页面配色", font=font(34, True), fill=INK)
    d.text((72, 456), "只把 PDF 的白纸换成纸色。文字仍是纯黑，图片与表格颜色原样不动。",
           font=font(17), fill=SUB)

    pw = 300
    pgap = 42
    for i, (name, desc, pagebg, edge, texture, eye) in enumerate(PAPERS):
        x0 = 72 + i * (pw + pgap)
        y0, y1 = 512, 806
        shadow(img, (x0, y0, x0 + pw, y1), radius=12, dy=8, alpha=28, blur=14)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((x0, y0, x0 + pw, y1), radius=12, fill=hx("#dfe5ee"))
        px0, py0, px1, py1 = x0 + 14, y0 + 14, x0 + pw - 14, y1 - 14
        d.rounded_rectangle((px0, py0, px1, py1), radius=3, fill=hx(pagebg), outline=hx(edge), width=1)

        if texture:
            # three-direction fibre. ImageDraw REPLACES pixels, so this layer is
            # composited with alpha_composite (which honours the per-pixel alpha)
            # instead of paste(); pasting with a binary mask would stamp the
            # fibre colour at full strength and turn the page into a dark grid.
            lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            dl = ImageDraw.Draw(lay)
            yy = py0
            while yy < py1:
                dl.line((px0, yy, px1, yy), fill=(122, 98, 62, 34), width=1)
                yy += 4
            xx = px0
            while xx < px1:
                dl.line((xx, py0, xx, py1), fill=(122, 98, 62, 22), width=1)
                xx += 5
            k = -py1
            while k < px1:
                dl.line((px0 + k, py1, px0 + k + (py1 - py0), py0), fill=(112, 90, 58, 14), width=1)
                k += 9
            img.alpha_composite(lay)
            d = ImageDraw.Draw(img)

        # page content: heading, lines, a colour figure (proves colours survive)
        d.rounded_rectangle((px0 + 22, py0 + 22, px1 - 70, py0 + 34), radius=3, fill=(17, 24, 39, 255))
        yy = py0 + 50
        for frac in (0.95, 0.88, 0.96, 0.62, 0.92, 0.85):
            d.rounded_rectangle((px0 + 22, yy, px0 + 22 + int((px1 - px0 - 44) * frac), yy + 7),
                                radius=3, fill=(90, 96, 110, 255))
            yy += 20
        yy += 8
        d.rounded_rectangle((px0 + 22, yy, px1 - 22, yy + 104), radius=4, fill=(255, 255, 255, 255))
        for j, col in enumerate([(96, 150, 224), (126, 200, 168), (240, 178, 60), (214, 96, 120)]):
            bx = px0 + 40 + j * 37
            d.rectangle((bx, yy + 78 - j * 16, bx + 22, yy + 92), fill=col + (255,))
        d.line((px0 + 22, yy + 96, px1 - 22, yy + 96), fill=(180, 186, 198, 255), width=1)

        d.text((x0 + 2, y1 + 14), name, font=font(17, True), fill=INK)
        d.text((x0 + 2, y1 + 42), desc, font=font(13), fill=MUTE)

    d.text((72, h - 44), "色值取自插件 CSS；界面配色卡为结构示意，非界面截图。", font=font(13), fill=MUTE)
    img.convert("RGB").save(os.path.join(HERE, path), optimize=True)
    return os.path.join(HERE, path)


# ------------------------------------------------------------------------- workflow
def build_workflow(w=1280, h=470, path="04-workflow.png"):
    img = vgrad(w, h, (250, 252, 255), (255, 255, 255))
    img.alpha_composite(glow((w, h), 640, 620, 320, (140, 180, 245), 26))
    d = ImageDraw.Draw(img)

    d.text((72, 56), "从拖进 PDF 到留下批注，五步", font=font(34, True), fill=INK)
    d.text((72, 104), "前三步你会一直停在同一个界面里。", font=font(17), fill=SUB)

    steps = [
        ("拖入 PDF", "直接拖到阅读区，或从「近期阅读」双击打开。"),
        ("选中一句", "在页面上划一句话，右侧卡片立刻出原文。"),
        ("点「翻译」", "只在这一下调用模型；译文按句成组回流成中文段落。"),
        ("顺手多用", "同一份全文养出总结、参考文献、术语表和公式详解。"),
        ("留下痕迹", "高亮、批注、术语都按论文保存，下次打开还在。"),
    ]
    n = len(steps)
    gap = 18
    cw = (w - 144 - gap * (n - 1)) // n
    ch = 196
    for i, (title, desc) in enumerate(steps):
        x0 = 72 + i * (cw + gap)
        y0, y1 = 164, 164 + ch
        card(img, (x0, y0, x0 + cw, y1), radius=16, outline=(229, 234, 243, 255), dy=8, alpha=24)
        d = ImageDraw.Draw(img)
        d.ellipse((x0 + 20, y0 + 20, x0 + 62, y0 + 62), fill=(233, 241, 254, 255))
        d.text((x0 + 36, y0 + 28), str(i + 1), font=font(24, True), fill=BRAND)
        d.text((x0 + 20, y0 + 78), title, font=font(19, True), fill=INK)
        f_desc = font(14)
        for k, ln in enumerate(wrap(d, desc, f_desc, cw - 40)[:5]):
            d.text((x0 + 20, y0 + 112 + k * 23), ln, font=f_desc, fill=SUB)
        if i < n - 1:
            arrow(d, x0 + cw + 3, y0 + 42, x0 + cw + gap - 3, color=(176, 197, 232, 255), w=2, head=7)

    d.text((72, 164 + ch + 26), "1 次拖入  ·  1 次选中  ·  1 次点击 = 一次完整的精读。", font=font(19, True), fill=(51, 65, 85, 255))
    d.text((72, h - 46), "示意图：按插件真实交互流程绘制。", font=font(13), fill=MUTE)
    img.convert("RGB").save(os.path.join(HERE, path), optimize=True)
    return os.path.join(HERE, path)


# --------------------------------------------------------------------------- square
def build_square(w=1080, h=1080, path="05-square.png"):
    img = vgrad(w, h, (255, 255, 255), (237, 243, 252))
    img.alpha_composite(glow((w, h), 880, 170, 300, (120, 170, 245), 40))
    img.alpha_composite(glow((w, h), 180, 900, 280, (140, 210, 180), 24))
    d = ImageDraw.Draw(img)

    label = "DeepSeek Harness 插件"
    fb = font(18)
    bw = tw(d, label, fb)
    d.rounded_rectangle((80, 88, 80 + bw + 52, 88 + 40), radius=20, fill=(233, 241, 254, 255))
    d.ellipse((80 + 18, 104, 80 + 28, 114), fill=BRAND)
    d.text((80 + 36, 93), label, font=fb, fill=(28, 78, 168, 255))

    d.text((78, 168), "英文文献阅读器", font=font(76, True), fill=INK)
    d.text((80, 272), "dsh-english-lit-reader", font=mono(26), fill=MUTE)
    for i, t in enumerate(["选中句子，译文就在旁边。", "创新点与技术方案，五段结构读完。", "术语、公式、参考文献，顺手全有。"]):
        d.text((80, 336 + i * 48), t, font=font(27), fill=(51, 65, 85, 255))

    # compact window
    wx0, wy0, wx1, wy1 = 80, 560, 1000, 946
    card(img, (wx0, wy0, wx1, wy1), radius=18, outline=(222, 231, 244, 255), dy=14, alpha=40)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((wx0, wy0, wx1, wy0 + 42), radius=18, fill=(248, 250, 253, 255))
    d.rectangle((wx0, wy0 + 28, wx1, wy0 + 42), fill=(248, 250, 253, 255))
    d.line((wx0, wy0 + 42, wx1, wy0 + 42), fill=(226, 234, 245, 255), width=1)
    for i, col in enumerate([(255, 128, 122), (255, 197, 96), (150, 214, 148)]):
        d.ellipse((wx0 + 18 + i * 20, wy0 + 16, wx0 + 30 + i * 20, wy0 + 28), fill=col)

    d.rounded_rectangle((wx0 + 16, wy0 + 56, wx0 + 560, wy1 - 16), radius=10, fill=(233, 238, 246, 255))
    px0, py0, px1, py1 = wx0 + 44, wy0 + 76, wx0 + 532, wy1 - 40
    d.rounded_rectangle((px0, py0, px1, py1), radius=4, fill=WHITE, outline=(226, 232, 240, 255))
    d.rounded_rectangle((px0 + 22, py0 + 24, px1 - 80, py0 + 40), radius=4, fill=(148, 163, 184, 255))
    row_y = py0 + 62
    for frac, hl in [(1.0, 0), (0.92, 0), (0.97, 1), (0.66, 0), (1.0, 0), (0.88, 0), (0.6, 0), (0.95, 0)]:
        wpx = (px1 - px0 - 44) * frac
        if hl:
            d.rounded_rectangle((px0 + 22, row_y - 4, px0 + 22 + wpx, row_y + 12), radius=3, fill=(255, 222, 74, 255))
        d.rounded_rectangle((px0 + 22, row_y, px0 + 22 + wpx, row_y + 8), radius=3, fill=(203, 213, 225, 255))
        row_y += 24

    cx0, cx1 = wx0 + 578, wx1 - 16
    for i, (hh) in enumerate([180, 130]):
        cy = wy0 + 56 + (i * 196)
        card(img, (cx0, cy, cx1, cy + hh), radius=10, outline=(226, 232, 240, 255), sh=False)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((cx0 + 1, cy + 1, cx1 - 1, cy + 32), radius=9, fill=(240, 244, 250, 255))
        d.rectangle((cx0 + 1, cy + 24, cx1 - 1, cy + 32), fill=(240, 244, 250, 255))
        bars(d, (cx0 + 14, cy + 12, cx0 + 100, cy + 22), 1, color=(148, 163, 184, 255), h=8)
        bars(d, (cx0 + 14, cy + 46, cx1 - 18, cy + hh - 18), 5, widths=[1.0, 0.9, 0.96, 0.64, 0.4])

    img.convert("RGB").save(os.path.join(HERE, path), optimize=True)
    return os.path.join(HERE, path)


if __name__ == "__main__":
    made = [
        build_cover(),
        build_features(),
        build_tones(),
        build_workflow(),
        build_square(),
    ]
    for p in made:
        print("%-40s %8d bytes" % (os.path.basename(p), os.path.getsize(p)))
