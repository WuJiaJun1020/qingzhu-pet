"""Retain the first N frames of an action, archiving removed resources for recovery."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--id', default='idle')
    parser.add_argument('--keep', type=int, required=True)
    args = parser.parse_args()
    manifest_path = ROOT / 'assets' / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    action = next(a for a in manifest['actions'] if a['id'] == args.id)
    if not 1 <= args.keep <= len(action['frames']):
        parser.error('keep must be between 1 and the existing frame count')
    removed = action['frames'][args.keep:]
    if not removed:
        print('Already trimmed; no changes needed')
        return
    assets = (ROOT / 'assets').resolve(strict=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    archive = ROOT / '历史素材' / ('呼吸眨眼裁剪前-' + stamp)
    paths = []
    # Lossless assets may be shared by posters and other characters. Archive
    # only files no longer referenced anywhere in the resulting manifest.
    kept_paths = {a['poster'] for a in manifest['actions'] if a.get('poster')}
    kept_paths.update(f[k] for a in manifest['actions']
                      for f in (a['frames'][:args.keep] if a is action else a['frames'])
                      for k in ['file','cleanedFile','edgeMaskFile'] if f.get(k))
    for name in sorted({f[k] for f in removed for k in ['file','cleanedFile','edgeMaskFile'] if f.get(k)} - kept_paths):
        source = (assets / name).resolve(strict=True)
        source.relative_to(assets)
        destination = archive / 'assets' / source.relative_to(assets)
        destination.resolve().relative_to(archive.resolve())
        paths.append((source, destination))
    archive.mkdir(parents=True)
    shutil.copy2(manifest_path, archive / 'manifest-before.json')
    for source, destination in paths:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(destination))
    previous_count = len(action['frames'])
    action['frames'] = action['frames'][:args.keep]
    temporary = manifest_path.with_name('manifest.trim.partial.json')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(manifest_path)
    report = {'id':args.id, 'before':previous_count, 'kept':args.keep,
              'removed_frames':len(removed), 'archived_files':len(paths),
              'duration_seconds':sum(f['durationMs'] for f in action['frames'])/1000,
              'archive':str(archive)}
    (archive / '裁剪记录.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=True))


if __name__ == '__main__':
    main()
