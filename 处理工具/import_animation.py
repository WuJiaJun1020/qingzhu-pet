"""Import verified video frames as cleaned lossless WebP, without copying raw PNGs."""
import argparse
from datetime import datetime
import hashlib
from io import BytesIO
import json
from pathlib import Path
import shutil
import uuid

import numpy as np
from PIL import Image
from clean_alpha import clean_rgba, PARAMETERS

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def select_manifest(root, character):
    assets = root / 'assets'
    manifest = json.loads((assets / 'manifest.json').read_text(encoding='utf-8-sig'))
    character = character or manifest['defaultCharacter']
    if not any(c['id'] == character for c in manifest['characters']):
        base = (root / '数据/characters').resolve()
        index = json.loads((base / 'index.json').read_text(encoding='utf-8'))
        assets = (base / index['installed'][character]['directory']).resolve(strict=True)
        assert assets.is_relative_to(base), 'Invalid installed character path'
        manifest = json.loads((assets / 'manifest.json').read_text(encoding='utf-8'))
    owners = [c for c in manifest['characters'] if c['id'] == character]
    assert len(owners) == 1, 'Character does not exist'
    assert manifest.get('frameVariant') == 'cleaned-v1', 'Convert legacy resources first'
    return assets, manifest, owners[0]


def import_verified(root, processed, action_id, title, role='action', replace=False, character=None):
    assert action_id and all(c in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in action_id), 'Invalid action ID'
    assert role in ('idle', 'action', 'interaction')
    job = json.loads((processed / '任务信息.json').read_text(encoding='utf-8'))
    report = json.loads((processed / 'render-report.json').read_text(encoding='utf-8'))
    validation = json.loads((processed / '验证结果.json').read_text(encoding='utf-8'))
    source = Path(job['source']).resolve(strict=True)
    assert digest(source) == report['source_sha256'] == job['identity']['sha256'], 'Source identity mismatch'
    assert validation.get('webm_decoded_frames') == report['frames'], 'Frame validation failed'
    assert validation.get('webm_alpha_max_error', 255) <= 1, 'Alpha validation failed'
    assert validation.get('png_archive_verified') is True, 'PNG archive validation failed'
    assert 0 < report['fps'] <= 120 and 0 < report['width'] * report['height'] <= 16_000_000
    paths = sorted((processed / '透明PNG帧').glob('*.png'))
    assert len(paths) == report['frames'] > 0
    assert all(p.name == f'{i+1:06}.png' for i, p in enumerate(paths)), 'Nonsequential frames'
    assets, manifest, owner = select_manifest(root, character)
    matches = [i for i, a in enumerate(manifest['actions']) if a['id'] == action_id]
    assert len(matches) == (1 if replace else 0), 'Use --replace for an existing action'
    assigned = [c for c in manifest['characters'] if action_id in c['actions']]
    assert not assigned or (replace and assigned == [owner]), 'Action belongs to another character'
    # Action IDs must stay unique across builtin and downloaded characters.
    other_manifests = [root / 'assets/manifest.json']
    registry_path = root / '数据/characters/index.json'
    if registry_path.exists():
        base = (root / '数据/characters').resolve()
        registry = json.loads(registry_path.read_text(encoding='utf-8'))
        for entry in registry.get('installed', {}).values():
            folder = (base / entry['directory']).resolve(strict=True)
            assert folder.is_relative_to(base)
            other_manifests.append(folder / 'manifest.json')
    for other in other_manifests:
        if other.resolve() != (assets / 'manifest.json').resolve():
            assert not any(a['id'] == action_id for a in json.loads(other.read_text(encoding='utf-8-sig'))['actions']), 'Action ID belongs to another character'
    frame_folder = assets / ('characters/' + owner['id'] + '/frames' if assets == root / 'assets' else 'frames')
    frame_folder.mkdir(parents=True, exist_ok=True)
    frames, cleared = [], 0
    for i, path in enumerate(paths):
        original_sha = digest(path)
        with Image.open(path) as image:
            rgba = np.array(image.convert('RGBA'))
        assert rgba.shape == (report['height'], report['width'], 4)
        cleaned = clean_rgba(rgba)
        protected = rgba[..., 3] >= PARAMETERS['alpha_full']
        assert np.array_equal(cleaned[protected], rgba[protected]), 'Protected foreground changed'
        cleared += int(((rgba[..., 3] > 0) & (cleaned[..., 3] == 0)).sum())
        encoded = BytesIO()
        Image.fromarray(cleaned).save(encoded, format='WEBP', lossless=True, exact=True, quality=100, method=4)
        content = encoded.getvalue()
        with Image.open(BytesIO(content)) as decoded:
            assert np.array_equal(np.array(decoded.convert('RGBA')), cleaned), 'WebP pixel mismatch'
        sha = hashlib.sha256(content).hexdigest()
        target = frame_folder / (sha + '.webp')
        if target.exists():
            assert digest(target) == sha, 'Existing content-addressed frame is corrupt'
        else:
            temporary = target.with_suffix('.' + uuid.uuid4().hex + '.partial')
            temporary.write_bytes(content)
            temporary.replace(target)
        assert digest(path) == original_sha, 'Source PNG was modified'
        frames.append({'file': target.relative_to(assets).as_posix(), 'sha256': sha, 'durationMs': 1000 / report['fps']})
        if (i+1) % 48 == 0 or i+1 == len(paths):
            print(f'Imported {i+1}/{len(paths)}', flush=True)
    action = {'id': action_id, 'title': title, 'role': role, 'width': report['width'], 'height': report['height'],
              'fps': report['fps'], 'poster': frames[0]['file'], 'frames': frames}
    backup = root / '数据/资源清单备份'
    backup.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    shutil.copy2(assets / 'manifest.json', backup / f'{owner["id"]}-{stamp}.json')
    if replace:
        manifest['actions'][matches[0]] = action
    else:
        manifest['actions'].append(action)
    if action_id not in owner['actions']:
        owner['actions'].append(action_id)
    manifest['version'] = 3
    # Locally edited characters are no longer an exact copy of their release pack.
    manifest.pop('packSha256', None)
    temporary = assets / ('manifest.' + uuid.uuid4().hex + '.partial.json')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(assets / 'manifest.json')
    record = {'action': action_id, 'character': owner['id'], 'frames': len(frames), 'source_sha256': report['source_sha256'],
              'pixels_cleared': cleared, 'protected_pixel_errors': 0, 'lossless_pixel_errors': 0, 'passed': True}
    records = root / '数据/导入记录'
    records.mkdir(parents=True, exist_ok=True)
    (records / f'{action_id}-{stamp}.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('processed', type=Path, help='Verified video_tool output directory')
    parser.add_argument('--id', required=True)
    parser.add_argument('--title', required=True)
    parser.add_argument('--role', choices=['idle', 'action', 'interaction'], default='action')
    parser.add_argument('--replace', action='store_true', help='Replace action while keeping old files and manifest backup')
    parser.add_argument('--character', help='Builtin or installed character ID; defaults to the builtin character')
    args = parser.parse_args()
    print(json.dumps(import_verified(ROOT, args.processed.resolve(strict=True), args.id, args.title, args.role, args.replace, args.character), ensure_ascii=False))


if __name__ == '__main__':
    main()
