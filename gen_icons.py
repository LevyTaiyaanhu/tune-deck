from PIL import Image, ImageDraw
import math

BG = (11, 11, 18, 255)
PINK = (255, 61, 129, 255)
CYAN = (51, 230, 255, 255)

def draw_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = size * (0.22 if maskable else 0.14)
    cx, cy = size / 2, size / 2 - size * 0.02

    band_w = size * 0.06
    d.arc([pad, pad * 0.6, size - pad, size - pad * 0.2], start=200, end=340, fill=CYAN, width=int(band_w))

    ear_r = size * 0.12
    left_x = pad + band_w * 0.3
    right_x = size - pad - band_w * 0.3
    ear_y = size * 0.62
    d.ellipse([left_x - ear_r, ear_y - ear_r, left_x + ear_r, ear_y + ear_r], fill=PINK)
    d.ellipse([right_x - ear_r, ear_y - ear_r, right_x + ear_r, ear_y + ear_r], fill=PINK)

    bar_w = size * 0.045
    gap = size * 0.03
    heights = [0.14, 0.24, 0.10, 0.30, 0.16]
    total_w = len(heights) * bar_w + (len(heights) - 1) * gap
    start_x = cx - total_w / 2
    base_y = size * 0.86
    for i, h in enumerate(heights):
        bx = start_x + i * (bar_w + gap)
        bh = size * h
        d.rounded_rectangle([bx, base_y - bh, bx + bar_w, base_y], radius=bar_w / 2, fill=CYAN if i % 2 else PINK)

    return img

draw_icon(192).save("public/icons/icon-192.png")
draw_icon(512).save("public/icons/icon-512.png")
draw_icon(512, maskable=True).save("public/icons/icon-512-maskable.png")
draw_icon(180).save("public/icons/apple-touch-icon.png")
print("done")
