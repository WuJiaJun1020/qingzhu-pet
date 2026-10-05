"""Protect shared lossless assets when shortening one animation."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TrimSharedAssetsTests(unittest.TestCase):
    def test_trimming_archives_only_files_unused_by_other_actions_and_posters(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / '处理工具').mkdir()
            tool = root / '处理工具/trim_idle.py'
            shutil.copy2(ROOT / '处理工具/trim_idle.py', tool)
            assets = root / 'assets'
            assets.mkdir()
            for name in ('start.webp', 'shared.webp', 'unused.webp'):
                (assets / name).write_bytes(name.encode())
            manifest = {'actions': [
                {'id': 'idle', 'poster': 'start.webp', 'frames': [
                    {'file': name, 'durationMs': 40} for name in ('start.webp', 'shared.webp', 'unused.webp')]},
                {'id': 'other', 'poster': 'shared.webp', 'frames': [{'file': 'shared.webp', 'durationMs': 40}]}]}
            path = assets / 'manifest.json'
            path.write_text(json.dumps(manifest), encoding='utf-8')
            subprocess.run([sys.executable, str(tool), '--id', 'idle', '--keep', '1'], check=True, capture_output=True)
            self.assertEqual((assets / 'shared.webp').read_bytes(), b'shared.webp')
            self.assertEqual((assets / 'start.webp').read_bytes(), b'start.webp')
            self.assertFalse((assets / 'unused.webp').exists())
            archived = list((root / '历史素材').rglob('unused.webp'))
            self.assertEqual(len(archived), 1)
            self.assertEqual(archived[0].read_bytes(), b'unused.webp')
            self.assertEqual(len(json.loads(path.read_text())['actions'][0]['frames']), 1)


if __name__ == '__main__':
    unittest.main()
