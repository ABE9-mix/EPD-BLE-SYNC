"""把方舟像素 12px 字体生成 ESP32 用的点阵字库（C 数组）。

为什么必须这么做：
    ESP32 没有系统字体，墨水屏上要显示中文只能预先点阵化、烧进固件。
    本脚本直接读取 advice.py 的字符表，保证"生成的字库"恰好覆盖
    "程序会说的话"，不会出现方框。

输出：
    font_zh12.h  —— 字库数据（PROGMEM）
用法：
    python gen_font.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent
FONT_PATH = BASE.parent / "assets" / "ark12" / "ark-pixel-12px-monospaced-zh_hans.ms.bitmap.ttf"
OUT_PATH = BASE / "font_zh12.h"

# 12px 方舟像素：汉字 12x12，ASCII 半宽 6x10（等宽版英文是整个 12 格里的左 6 格）
CELL_W = 12
CELL_H = 12
FONT_SIZE = 12

sys.path.insert(0, str(BASE))
import advice  # noqa: E402


def render_char(font: ImageFont.FreeTypeFont, ch: str) -> list[int]:
    """把单个字符渲染成 CELL_W*CELL_H 位的行位图（每行 2 字节，共 12 行）。"""
    img = Image.new("1", (CELL_W, CELL_H), 0)
    d = ImageDraw.Draw(img)
    # 用 anchor="ls" 之类的对齐方式容易错位，这里直接按 bbox 顶部对齐
    bbox = d.textbbox((0, 0), ch, font=font)
    ox, oy = 0, 0
    if bbox:
        # 垂直居中到 12px 格子里（像素字体 bbox 高度通常 10~12）
        h = bbox[3] - bbox[1]
        oy = max(0, (CELL_H - h) // 2) - bbox[1]
    d.text((ox, oy), ch, font=font, fill=1)

    rows = []
    for y in range(CELL_H):
        bits = 0
        for x in range(CELL_W):
            if img.getpixel((x, y)):
                bits |= 1 << (CELL_W - 1 - x)
        rows.append(bits)
    return rows


def main() -> int:
    if not FONT_PATH.exists():
        print(f"字体不存在: {FONT_PATH}", file=sys.stderr)
        return 1

    font = ImageFont.truetype(str(FONT_PATH), FONT_SIZE)
    chars = advice.charset()

    # 只保留实际能渲染出内容的字符（空格也要保留，用于断词）
    entries = []
    for ch in chars:
        if ch == "\n":
            continue
        rows = render_char(font, ch)
        entries.append((ch, rows))

    # ---- 写头文件 ----
    total_bytes = len(entries) * CELL_H * 2
    lines = []
    lines.append("// 由 gen_font.py 自动生成，请勿手改")
    lines.append(f"// 字体: 方舟像素 12px (Ark Pixel Font, OFL-1.1)")
    lines.append(f"// 字符数: {len(entries)}  单字 {CELL_W}x{CELL_H} ({CELL_H * 2} 字节)")
    lines.append(f"// 数据总量: {total_bytes} 字节")
    lines.append("#pragma once")
    lines.append("#include <Arduino.h>")
    lines.append("")
    lines.append(f"#define ZH_CELL_W {CELL_W}")
    lines.append(f"#define ZH_CELL_H {CELL_H}")
    lines.append(f"#define ZH_GLYPH_BYTES {CELL_H * 2}")
    lines.append(f"#define ZH_COUNT {len(entries)}")
    lines.append("")
    lines.append("struct ZhGlyph {")
    lines.append("  uint32_t cp;   // Unicode 码位")
    lines.append("  uint8_t  bits[ZH_GLYPH_BYTES];  // 每行 2 字节，高位在前")
    lines.append("};")
    lines.append("")
    lines.append("static const ZhGlyph ZH_GLYPHS[ZH_COUNT] PROGMEM = {")
    for ch, rows in entries:
        cp = ord(ch)
        # 每行一个 16 位值，拆成高字节在前、低字节在后
        bs = ",".join(f"0x{(r >> 8) & 0xFF:02X},0x{r & 0xFF:02X}" for r in rows)
        lines.append(f"  {{0x{cp:04X}, {{{bs}}}}},   // {ch if ch != ' ' else '(space)'}")
    lines.append("};")
    lines.append("")

    OUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"已生成: {OUT_PATH}")
    print(f"字符数: {len(entries)}  数据: {total_bytes} 字节 ({total_bytes/1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
