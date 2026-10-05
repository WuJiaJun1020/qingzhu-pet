import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '处理工具'))
spec = importlib.util.spec_from_file_location('import_animation', ROOT / '处理工具/import_animation.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CleanImportTests(unittest.TestCase):
    def fixture(self, root):
        assets = root / 'assets'; assets.mkdir()
        manifest = {'version': 3, 'frameVariant': 'cleaned-v1', 'defaultCharacter': 'hanli',
                    'characters': [{'id': 'hanli', 'name': '韩立', 'actions': ['idle']}],
                    'actions': [{'id': 'idle'}]}
        (assets / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        processed = root / 'processed'; processed.mkdir()
        source = processed / 'source.mp4'; source.write_bytes(b'video fixture')
        sha = hashlib.sha256(source.read_bytes()).hexdigest()
        (processed / '任务信息.json').write_text(json.dumps({'source': str(source), 'identity': {'sha256': sha}}))
        (processed / 'render-report.json').write_text(json.dumps({'source_sha256': sha, 'frames': 2, 'width': 16, 'height': 24, 'fps': 24}))
        (processed / '验证结果.json').write_text(json.dumps({'webm_decoded_frames': 2, 'webm_alpha_max_error': 0, 'png_archive_verified': True}))
        frames = processed / '透明PNG帧'; frames.mkdir()
        image = Image.new('RGBA', (16, 24), (255, 255, 255, 0))
        image.putpixel((8, 12), (100, 150, 200, 255))
        image.putpixel((1, 1), (200, 90, 12, 8))
        for i in (1, 2): image.save(frames / f'{i:06}.png')
        return processed, np.array(image)

    def test_only_cleaned_lossless_frames_deduplicated_and_sources_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); processed, rgba = self.fixture(root)
            before = {p.name: p.read_bytes() for p in (processed / '透明PNG帧').glob('*.png')}
            module.import_verified(root, processed, 'wave', '挥手')
            manifest = json.loads((root / 'assets/manifest.json').read_text(encoding='utf-8'))
            action = manifest['actions'][-1]
            self.assertEqual(manifest['characters'][0]['actions'], ['idle', 'wave'])
            self.assertEqual(len(list((root / 'assets').rglob('*.webp'))), 1)
            self.assertFalse(list((root / 'assets').rglob('*.png')))
            self.assertNotIn('source', action)
            self.assertNotIn('cleanedFile', action['frames'][0])
            decoded = np.array(Image.open(root / 'assets' / action['frames'][0]['file']).convert('RGBA'))
            self.assertTrue(np.array_equal(decoded, module.clean_rgba(rgba)))
            self.assertEqual(before, {p.name: p.read_bytes() for p in (processed / '透明PNG帧').glob('*.png')})

    def test_installed_character_import_does_not_change_builtin(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); processed, _ = self.fixture(root)
            before = (root / 'assets/manifest.json').read_bytes()
            assets = root / '数据/characters/other/version'; assets.mkdir(parents=True)
            manifest = {'version': 3, 'frameVariant': 'cleaned-v1', 'defaultCharacter': 'other',
                        'characters': [{'id': 'other', 'name': '其他', 'actions': ['other-idle']}], 'actions': [{'id': 'other-idle'}]}
            (assets / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            (root / '数据/characters/index.json').write_text(json.dumps({'installed': {'other': {'directory': 'other/version'}}}), encoding='utf-8')
            module.import_verified(root, processed, 'other-wave', '挥手', character='other')
            self.assertEqual((root / 'assets/manifest.json').read_bytes(), before)
            self.assertEqual(json.loads((assets / 'manifest.json').read_text(encoding='utf-8'))['actions'][-1]['id'], 'other-wave')

    def test_bad_source_keeps_manifest_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); processed, _ = self.fixture(root)
            before = (root / 'assets/manifest.json').read_bytes()
            (processed / 'source.mp4').write_bytes(b'changed')
            with self.assertRaisesRegex(AssertionError, 'Source identity'):
                module.import_verified(root, processed, 'wave', '挥手')
            self.assertEqual((root / 'assets/manifest.json').read_bytes(), before)


if __name__ == '__main__': unittest.main()
