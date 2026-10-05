"""Losslessly compress only manifest-referenced assets; preserve all source files.

Usage: python optimize_assets.py --root . --workers 4
Re-running verifies and reuses content-addressed output. The manifest is switched
only after every image has been decoded and checked against its source RGBA.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse
import copy
import hashlib
import io
import json
import os
import time
import threading
from PIL import Image

_image_locks = {}
_locks_guard = threading.Lock()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def referenced_images(manifest):
    refs = set()
    for action in manifest['actions']:
        refs.add(action['poster'])
        for frame in action['frames']:
            refs.update(frame[key] for key in ('file', 'cleanedFile', 'edgeMaskFile') if frame.get(key))
    return refs


def safe_path(assets, relative):
    path = (assets / relative).resolve()
    if not path.is_relative_to(assets.resolve()):
        raise ValueError('Asset escapes assets directory: ' + relative)
    return path


def compress_one(assets, relative):
    source = safe_path(assets, relative)
    original = source.read_bytes()
    with Image.open(io.BytesIO(original)) as image:
        rgba = image.convert('RGBA')
    pixels = rgba.tobytes()
    identity = sha(f'{rgba.width}x{rgba.height}:RGBA:'.encode() + pixels)
    destination = f'lossless-v1/{identity[:2]}/{identity}.webp'
    target = safe_path(assets, destination)
    with _locks_guard:
        lock = _image_locks.setdefault(identity, threading.Lock())
    # The same pixels can be referenced by a poster and multiple frames. A
    # per-image lock also prevents Windows readers from blocking replacement.
    with lock:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            encoded = target.read_bytes()
        else:
            stream = io.BytesIO()
            rgba.save(stream, format='WEBP', lossless=True, quality=100, method=4, exact=True)
            encoded = stream.getvalue()
        with Image.open(io.BytesIO(encoded)) as image:
            decoded = image.convert('RGBA')
            if decoded.size != rgba.size or decoded.tobytes() != pixels:
                raise ValueError('Lossless verification failed: ' + relative)
        if not target.exists():
            temporary = target.with_name(target.name + f'.{os.getpid()}.{time.time_ns()}.tmp')
            temporary.write_bytes(encoded)
            temporary.replace(target)
    return relative, {'file': destination, 'sha256': sha(encoded),
                      'sourceSha256': sha(original), 'pixelSha256': identity,
                      'sourceBytes': len(original), 'bytes': len(encoded), 'pixelErrors': 0}


def optimize(root, workers=4, apply=True):
    assets = root.resolve() / 'assets'
    manifest_path = assets / 'manifest.json'
    original_bytes = manifest_path.read_bytes()
    manifest = json.loads(original_bytes)
    refs = referenced_images(manifest)
    mapping = {}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        jobs = [executor.submit(compress_one, assets, relative) for relative in sorted(refs)]
        for index, job in enumerate(as_completed(jobs), 1):
            relative, record = job.result()
            mapping[relative] = record
            if index % 128 == 0 or index == len(jobs):
                print(f'Checked {index}/{len(jobs)} images', flush=True)
    optimized = copy.deepcopy(manifest)
    for action in optimized['actions']:
        action['poster'] = mapping[action['poster']]['file']
        for frame in action['frames']:
            for key, hash_key in (('file', 'sha256'), ('cleanedFile', 'cleanedSha256'),
                                  ('edgeMaskFile', 'edgeMaskSha256')):
                if frame.get(key):
                    converted = mapping[frame[key]]
                    frame[key] = converted['file']
                    frame[hash_key] = converted['sha256']
    # Include icons and manifests when reporting the effective resource size.
    extras = sum((assets / name).stat().st_size for name in ('app.png', 'app.ico') if (assets / name).exists())
    new_bytes = (json.dumps(optimized, ensure_ascii=False, indent=2) + '\n').encode()
    unique = {entry['file']: entry for entry in mapping.values()}
    report = {'version': 1, 'format': 'lossless WebP', 'sourceManifestSha256': sha(original_bytes),
              'actions': len(manifest['actions']), 'referencedImages': len(refs), 'uniqueImages': len(unique),
              'beforeBytes': sum(e['sourceBytes'] for e in mapping.values()) + extras + len(original_bytes),
              'afterBytes': sum(e['bytes'] for e in unique.values()) + extras + len(new_bytes),
              'pixelErrors': 0, 'sourcesPreserved': True, 'applied': apply, 'images': mapping}
    results = root / 'tests/results/space-optimization'
    results.mkdir(parents=True, exist_ok=True)
    (results / 'optimized-manifest.json').write_bytes(new_bytes)
    (results / 'lossless-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if apply:
        if manifest_path.read_bytes() != original_bytes:
            raise RuntimeError('Manifest changed during compression; leave it unchanged and rerun.')
        backup_dir = root / '数据/资源清单备份'
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / ('lossless-before-' + sha(original_bytes)[:12] + '.json')
        if not backup.exists():
            backup.write_bytes(original_bytes)
        temporary = manifest_path.with_suffix('.partial.json')
        temporary.write_bytes(new_bytes)
        temporary.replace(manifest_path)
    print(json.dumps({k: v for k, v in report.items() if k != 'images'}, ensure_ascii=False), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--no-apply', action='store_true', help='Generate and verify assets without switching the manifest')
    args = parser.parse_args()
    if not 1 <= args.workers <= 16:
        parser.error('--workers must be between 1 and 16')
    optimize(args.root, args.workers, not args.no_apply)
