"""Japanese interview title in gold and deep green; native 1080x1920 overlay.

Supply Dela Gothic One (SIL OFL) and a Japanese bold sans font locally.
The original video's font has not been identified; this is a style approximation.
"""
from pathlib import Path
import argparse
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter


def make_title(display_font, name_font, question='初めてでも大丈夫？',
               answer='基本から、一緒に。', name='日本カジノスクール　校長 大岩根成悦'):
    size = (1080, 1920)
    layer = Image.new('RGBA', size)
    # Cover the source title completely without altering presenter framing.
    bounds = (151, 241, 929, 544)
    shadow = Image.new('RGBA', size)
    ImageDraw.Draw(shadow).rounded_rectangle((151, 250, 929, 553), radius=28, fill=(0, 0, 0, 110))
    layer = Image.alpha_composite(layer, shadow.filter(ImageFilter.GaussianBlur(10)))
    yy = np.arange(1920, dtype=np.float32)
    colors = np.stack([np.interp(yy, [241, 544], [13, 6]),
                       np.interp(yy, [241, 544], [32, 17]),
                       np.interp(yy, [241, 544], [26, 14]), np.full(1920, 255)], axis=1)
    panel = Image.fromarray(np.repeat(colors[:, None, :], 1080, axis=1).astype('uint8'), 'RGBA')
    mask = Image.new('L', size)
    ImageDraw.Draw(mask).rounded_rectangle(bounds, radius=27, fill=255)
    layer.paste(panel, (0, 0), mask)
    d = ImageDraw.Draw(layer)
    gold = (205, 167, 79, 255)
    d.rounded_rectangle(bounds, radius=27, outline=gold, width=4)
    d.rounded_rectangle((159, 249, 921, 536), radius=20, outline=(116, 91, 41, 255), width=1)
    # A gold nameplate echoes the source's colored upper name band.
    plate = Image.new('L', size)
    ImageDraw.Draw(plate).rounded_rectangle((182, 256, 898, 327), radius=13, fill=255)
    foil = np.stack([np.interp(yy, [250, 290, 327], [171, 247, 185]),
                     np.interp(yy, [250, 290, 327], [124, 222, 143]),
                     np.interp(yy, [250, 290, 327], [47, 148, 63]), np.full(1920, 255)], axis=1)
    foil = Image.fromarray(np.repeat(foil[:, None, :], 1080, axis=1).astype('uint8'), 'RGBA')
    layer.paste(foil, (0, 0), plate)
    d = ImageDraw.Draw(layer)
    font_name = ImageFont.truetype(str(name_font), 29, index=0)
    font_q = ImageFont.truetype(str(display_font), 53)
    font_a = ImageFont.truetype(str(display_font), 60)
    for text, font, limit in [(name, font_name, 688), (question, font_q, 710), (answer, font_a, 710)]:
        box = d.textbbox((0, 0), text, font=font)
        if box[2]-box[0] > limit:
            raise ValueError('Title exceeds its measured region: '+text)
    d.text((540, 290), name, font=font_name, fill=(29, 25, 15, 255), anchor='mm')
    d.text((540, 381), question, font=font_q, fill=(252, 248, 230, 255), anchor='mm', stroke_width=1)
    # Stable metallic fill; no moving texture or shimmer around letter edges.
    text_mask = Image.new('L', size)
    ImageDraw.Draw(text_mask).text((540, 467), answer, font=font_a, fill=255, anchor='mm')
    d.text((540, 471), answer, font=font_a, fill=(0, 0, 0, 200), anchor='mm', stroke_width=2)
    gold_text = np.stack([np.interp(yy, [434, 451, 467, 491], [255, 239, 194, 242]),
                         np.interp(yy, [434, 451, 467, 491], [237, 204, 143, 203]),
                         np.interp(yy, [434, 451, 467, 491], [165, 108, 46, 107]), np.full(1920, 255)], axis=1)
    layer.paste(Image.fromarray(np.repeat(gold_text[:, None, :], 1080, axis=1).astype('uint8'), 'RGBA'), (0, 0), text_mask)
    d = ImageDraw.Draw(layer)
    d.line((272, 514, 500, 514), fill=gold, width=2)
    d.line((580, 514, 808, 514), fill=gold, width=2)
    d.polygon([(540, 508), (547, 514), (540, 520), (533, 514)], fill=gold)
    # Japanese-only identification, outside the face and title areas.
    small = ImageFont.truetype(str(name_font), 22, index=0)
    d.rounded_rectangle((151, 193, 297, 229), radius=7, fill=(9, 24, 18, 225))
    d.text((224, 209), '生成映像', font=small, anchor='mm', fill=(240, 213, 145, 255))
    return layer


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--display-font', type=Path, required=True)
    ap.add_argument('--name-font', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    make_title(args.display_font, args.name_font).save(args.out)
