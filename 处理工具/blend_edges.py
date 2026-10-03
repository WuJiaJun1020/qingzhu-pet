"""Build portable subject-protected edge masks. Never overwrite source frames."""
from pathlib import Path
import argparse
import hashlib
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PARAMETERS = {'margin_ratio': 0.20, 'subject_threshold': 0.50,
              'keep_radius_ratio': 1.5 / 384, 'fade_radius_ratio': 5.0 / 384}


def smoothstep(x):
    t = np.clip(x, 0, 1)
    return t * t * (3 - 2 * t)


def edge_weight(subject):
    """Protect semantic foreground and feather only the surrounding scenery.

    All radii scale with image dimensions. No object coordinates, frame numbers,
    clothing colors or scene-specific rules are used.
    """
    subject = np.clip(np.asarray(subject, dtype=np.float32), 0, 1)
    if subject.ndim != 2 or min(subject.shape) < 2:
        raise ValueError('Subject mask must be a two-dimensional image of size >= 2.')
    h, w = subject.shape
    margin = max(1., min(h, w) * PARAMETERS['margin_ratio'])
    yy, xx = np.mgrid[:h, :w]
    horizontal = smoothstep(np.minimum(xx, w - 1 - xx) / margin)
    vertical = smoothstep(np.minimum(yy, h - 1 - yy) / margin)
    environment = horizontal * vertical
    core = subject >= PARAMETERS['subject_threshold']
    if core.any():
        distance = cv2.distanceTransform((~core).astype(np.uint8), cv2.DIST_L2,
                                        cv2.DIST_MASK_PRECISE)
        keep = max(1., min(h, w) * PARAMETERS['keep_radius_ratio'])
        fade = max(keep + 1., min(h, w) * PARAMETERS['fade_radius_ratio'])
        protect = 1 - smoothstep((distance - keep) / (fade - keep))
    else:
        protect = np.zeros_like(subject)
    return np.rint(np.maximum(protect, environment) * 255).astype(np.uint8)


def apply_weight(rgba, weight):
    output = rgba.copy()
    output[..., 3] = np.rint(rgba[..., 3].astype(np.float32) * weight / 255).astype(np.uint8)
    output[output[..., 3] == 0, :3] = 0
    return output


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_mask(path):
    im = Image.open(path)
    raw = np.array(im)
    if raw.ndim != 2:
        raise ValueError(f'Mask must be grayscale: {path}')
    divisor = 65535 if im.mode in ('I;16', 'I') else 255
    return raw.astype(np.float32) / divisor


def preview(manifest):
    folder = ROOT / '处理工具' / '边缘预览'
    folder.mkdir(exist_ok=True)
    font = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 16)
    for action in manifest['actions']:
        for index in np.unique(np.linspace(0, len(action['frames']) - 1, 7).round().astype(int)):
            frame = action['frames'][index]
            rgba = np.array(Image.open(ROOT / 'assets' / frame.get('cleanedFile', frame['file'])).convert('RGBA'))
            weight = np.array(Image.open(ROOT / 'assets' / frame['edgeMaskFile']))[..., 3]
            blended = apply_weight(rgba, weight)
            h, w = rgba.shape[:2]
            canvas = Image.new('RGB', (w * 2, (h + 34) * 2), '#202522')
            draw = ImageDraw.Draw(canvas)
            for row, bg in enumerate([(22, 27, 25), (204, 167, 185)]):
                for col, arr in enumerate([rgba, blended]):
                    a = arr[..., 3:4].astype(np.float32) / 255
                    comp = np.rint(arr[..., :3] * a + np.array(bg) * (1 - a)).astype(np.uint8)
                    canvas.paste(Image.fromarray(comp), (col * w, row * (h + 34) + 34))
                    draw.text((col * w + 8, row * (h + 34) + 6),
                              f'第{index + 1}帧 · ' + ('原环境' if col == 0 else '环境渐隐 / 主体保留'),
                              font=font, fill='white')
            canvas.save(folder / f'{action["id"]}-{index + 1:04}-对照.png')


def run(mask_args):
    assets = ROOT / 'assets'
    manifest_path = assets / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    sources = {}
    for arg in mask_args:
        action, folder = arg.split('=', 1)
        sources.setdefault(action, []).append(Path(folder).resolve())
    report = {'algorithm': PARAMETERS, 'actions': [], 'source_frames_unchanged': True}
    for action in manifest['actions']:
        folders = sources.get(action['id'], [])
        owned = assets / 'edge-blend-v1' / action['id']
        owned.mkdir(parents=True, exist_ok=True)
        stats = {'id': action['id'], 'frames': 0, 'protected_pixels': 0,
                 'protected_alpha_errors': 0, 'faded_pixels': 0, 'edge_pixels_removed': 0}
        for index, frame in enumerate(action['frames']):
            original = assets / frame['file']
            if sha(original) != frame['sha256']:
                raise ValueError(f'Original frame hash mismatch: {original}')
            original_rgba = np.array(Image.open(original).convert('RGBA'))
            subject_path = owned / f'{index + 1:04}-subject.png'
            if folders:
                subject = np.maximum.reduce([load_mask(folder / f'{index:06}.png') for folder in folders])
                if subject.shape != original_rgba.shape[:2]:
                    raise ValueError(f'Image and mask dimensions differ for {original}')
                Image.fromarray(np.rint(np.clip(subject, 0, 1) * 65535).astype(np.uint16)).save(subject_path)
            else:
                subject = load_mask(subject_path)
            weight = edge_weight(subject)
            rgba_mask = np.full((*weight.shape, 4), 255, dtype=np.uint8)
            rgba_mask[..., 3] = weight
            destination = owned / f'{index + 1:04}-edge.png'
            Image.fromarray(rgba_mask).save(destination)
            frame['subjectMaskFile'] = subject_path.relative_to(assets).as_posix()
            frame['edgeMaskFile'] = destination.relative_to(assets).as_posix()
            frame['edgeMaskSha256'] = sha(destination)
            for filename in [frame['file'], frame.get('cleanedFile')]:
                if not filename:
                    continue
                rgba = np.array(Image.open(assets / filename).convert('RGBA'))
                after = apply_weight(rgba, weight)
                core = subject >= PARAMETERS['subject_threshold']
                stats['protected_alpha_errors'] += int(np.count_nonzero(after[core] != rgba[core]))
            stats['frames'] += 1
            stats['protected_pixels'] += int(core.sum())
            stats['faded_pixels'] += int(((weight < 255) & (original_rgba[..., 3] > 0)).sum())
            border = np.zeros_like(weight, dtype=bool)
            border[[0, -1], :] = True
            border[:, [0, -1]] = True
            stats['edge_pixels_removed'] += int((border & (weight == 0) & (original_rgba[..., 3] > 0)).sum())
            if index % 80 == 0:
                print(f'{action["id"]}: {index + 1}/{len(action["frames"])}', flush=True)
        if stats['protected_alpha_errors']:
            raise AssertionError(stats)
        report['actions'].append(stats)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    report_path = assets / 'edge-blend-v1' / '验证报告.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    preview(manifest)
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mask', action='append', default=[], metavar='ACTION=FOLDER',
                        help='Zero-based PNG mask folder; may repeat to union independent predictions. '
                             'Omit to rebuild from the portable subject masks already in assets.')
    args = parser.parse_args()
    run(args.mask)
