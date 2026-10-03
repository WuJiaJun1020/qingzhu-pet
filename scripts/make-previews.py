"""Generate README GIFs from current assets without modifying source PNGs."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def render(action, frame):
    source = ROOT / 'assets' / frame.get('cleanedFile', frame['file'])
    rgba = np.array(Image.open(source).convert('RGBA'))
    h, w = rgba.shape[:2]
    yy, xx = np.mgrid[:h, :w]
    band = min(h, w) * .08
    horizontal = np.clip(np.minimum(xx + .5, w - xx - .5) / band, 0, 1)
    vertical = np.clip(np.minimum(yy + .5, h - yy - .5) / band, 0, 1)
    alpha = rgba[..., 3:4] / 255 * (horizontal * vertical)[..., None]
    rgb = np.rint(rgba[..., :3] * alpha + np.array([32, 37, 34]) * (1 - alpha)).astype('uint8')
    image = Image.fromarray(rgb)
    return image.resize((180, round(180 * h / w)), Image.Resampling.LANCZOS)


def main():
    manifest = json.loads((ROOT / 'assets/manifest.json').read_text(encoding='utf-8-sig'))
    output = ROOT / 'docs/previews'
    output.mkdir(parents=True, exist_ok=True)
    for action in manifest['actions']:
        # Select every second frame; retain total clip duration for the preview.
        images, durations = [], []
        for index in range(0, len(action['frames']), 2):
            images.append(render(action, action['frames'][index]))
            duration = sum(f['durationMs'] for f in action['frames'][index:index+2])
            durations.append(duration)
        samples = images[::max(1, len(images) // 20)]
        sheet = Image.new('RGB', (180 * len(samples), images[0].height))
        for i, sample in enumerate(samples):
            sheet.paste(sample, (180 * i, 0))
        palette = sheet.quantize(colors=256)
        images = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
        # GIF uses 10 ms units. Quantize cumulative time to avoid drift.
        gif_durations, total, previous = [], 0, 0
        for duration in durations:
            total += duration
            current = round(total / 10) * 10
            gif_durations.append(max(10, current - previous))
            previous = current
        target = output / (action['id'] + '.gif')
        images[0].save(target, save_all=True, append_images=images[1:],
                       duration=gif_durations, loop=0, disposal=2, optimize=False)
        print(f'{action["id"]}: {len(images)} preview frames, {target.stat().st_size} bytes', flush=True)


if __name__ == '__main__':
    main()
