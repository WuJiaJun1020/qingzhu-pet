"""Build cleaned-only character packs without changing original animation files.

Each .qzpet is a small JSON header followed by unchanged lossless WebP files.
No archive dependency, re-encoding, runtime model or Python is needed to install.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct
import shutil

MAGIC = b'QZPET1\n'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(source_root, output_root, tag='characters-20261004'):
    source_assets = source_root / 'assets'
    full = json.loads((source_assets / 'manifest.json').read_text(encoding='utf-8-sig'))
    assert full.get('characters')
    source_roots = {a['id']: source_assets for a in full['actions']}
    # Installed characters live outside the bundled assets directory. Authors
    # can still rebuild all locally installed characters through one command.
    index = source_root / '数据/characters/index.json'
    if index.exists():
        registry = json.loads(index.read_text(encoding='utf-8'))
        registered = {c['id'] for c in full['characters']}
        base = (source_root / '数据/characters').resolve()
        for cid, record in registry.get('installed', {}).items():
            if cid in registered:
                continue
            folder = (base / record['directory']).resolve(strict=True)
            assert folder.is_relative_to(base)
            installed = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
            assert installed['frameVariant'] == 'cleaned-v1' and installed['characters'][0]['id'] == cid
            assert not set(source_roots).intersection(a['id'] for a in installed['actions'])
            full['characters'].extend(installed['characters'])
            full['actions'].extend(installed['actions'])
            source_roots.update({a['id']: folder for a in installed['actions']})
            registered.add(cid)
    actions = {a['id']: a for a in full['actions']}
    package_dir = output_root / 'release/character-packs'
    package_dir.mkdir(parents=True, exist_ok=True)
    catalog = {'version': 1, 'releaseTag': tag, 'packs': []}
    built = []
    for character in full['characters']:
        manifest = {'version': 3, 'name': character['name'], 'frameVariant': 'cleaned-v1',
                    'defaultCharacter': character['id'], 'characters': [copy.deepcopy(character)], 'actions': []}
        sources = {}
        for aid in character['actions']:
            action = copy.deepcopy(actions[aid])
            action_assets = source_roots[aid]
            assert full.get('frameVariant') == 'cleaned-v1' or all(f.get('cleanedFile') for f in action['frames'])
            for key in ('source', 'processedOutput'):
                action.pop(key, None)
            for frame in action['frames']:
                original = frame.get('cleanedFile', frame['file'])
                expected = frame.get('cleanedSha256', frame['sha256'])
                path = (action_assets / original).resolve(strict=True)
                assert path.is_relative_to(action_assets.resolve()) and path.suffix == '.webp'
                assert digest(path) == expected
                relative = f'frames/{expected}.webp'
                sources[relative] = path
                duration = frame['durationMs']
                mask = frame.get('edgeMaskFile')
                mask_sha = frame.get('edgeMaskSha256')
                frame.clear()
                frame.update({'file': relative, 'sha256': expected, 'durationMs': duration})
                if mask:
                    path = (action_assets / mask).resolve(strict=True)
                    assert path.is_relative_to(action_assets.resolve()) and digest(path) == mask_sha
                    relative = f'frames/{mask_sha}.webp'
                    sources[relative] = path
                    frame.update({'edgeMaskFile': relative, 'edgeMaskSha256': mask_sha})
            action['poster'] = action['frames'][0]['file']
            manifest['actions'].append(action)
        records = [{'path': relative, 'bytes': path.stat().st_size, 'sha256': digest(path)} for relative, path in sorted(sources.items())]
        header = {'format': 'qingzhu-character-v1', 'id': character['id'], 'manifest': manifest, 'files': records}
        encoded = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode()
        assert len(encoded) <= 4 * 1024**2
        temporary = package_dir / (character['id'] + '.partial')
        with temporary.open('wb') as stream:
            stream.write(MAGIC + struct.pack('<I', len(encoded)) + encoded)
            for record in records:
                with sources[record['path']].open('rb') as image:
                    shutil.copyfileobj(image, stream)
        sha = digest(temporary)
        filename = f"{character['id']}-{sha[:12]}.qzpet"
        package = package_dir / filename
        temporary.replace(package)
        entry = {'id': character['id'], 'name': character['name'], 'sha256': sha, 'bytes': package.stat().st_size,
                 'url': f'https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/{tag}/{filename}',
                 'actions': [{'id': a['id'], 'title': a['title'], 'role': a['role'], 'frames': len(a['frames'])} for a in manifest['actions']]}
        catalog['packs'].append(entry)
        built.append({'entry': entry, 'manifest': manifest, 'sources': sources, 'package': package})
        print(f"{character['id']}: {entry['bytes'] / 1024**2:.2f} MiB", flush=True)
    assets = output_root / 'assets'
    assets.mkdir(parents=True, exist_ok=True)
    default = next(p for p in built if p['entry']['id'] == full.get('defaultCharacter', 'hanli'))
    builtin = copy.deepcopy(default['manifest'])
    builtin['packSha256'] = default['entry']['sha256']
    for action in builtin['actions']:
        action['poster'] = 'characters/' + default['entry']['id'] + '/' + action['poster']
        for f in action['frames']:
            for key in ('file', 'edgeMaskFile'):
                if f.get(key):
                    f[key] = 'characters/' + default['entry']['id'] + '/' + f[key]
    for relative, source in default['sources'].items():
        target = assets / 'characters' / default['entry']['id'] / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for name in ('app.png', 'app.ico'):
        shutil.copy2(source_assets / name, assets / name)
    (assets / 'manifest.json').write_text(json.dumps(builtin, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (assets / 'character-packs.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report = {'characters': len(built), 'actions': len(full['actions']), 'frameFiles': sum(len(p['sources']) for p in built),
              'frameBytes': sum(path.stat().st_size for p in built for path in p['sources'].values()),
              'packBytes': sum(p['entry']['bytes'] for p in built), 'builtinBytes': sum(p.stat().st_size for p in assets.rglob('*') if p.is_file()),
              'defaultCharacter': default['entry']['id']}
    (package_dir / 'build-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--output-root', type=Path, required=True, help='New output directory; source assets remain untouched')
    parser.add_argument('--tag', default='characters-20261004')
    args = parser.parse_args()
    if args.source_root.resolve() == args.output_root.resolve():
        parser.error('Use a separate output directory to preserve source assets')
    build(args.source_root.resolve(), args.output_root.resolve(), args.tag)
