import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('optimize_assets', ROOT / '处理工具/optimize_assets.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LosslessAssetsTests(unittest.TestCase):
    def fixture(self, root):
        assets = root / 'assets'
        assets.mkdir()
        image = Image.new('RGBA', (16, 24), (73, 152, 201, 0))
        image.putpixel((5, 8), (111, 162, 201, 99))
        image.putpixel((9, 12), (200, 80, 9, 255))
        image.save(assets / 'a.png')
        image.save(assets / 'b.png', compress_level=0)
        manifest = {'actions': [{'id': 'idle', 'width': 16, 'height': 24, 'poster': 'b.png',
                                'frames': [{'file': 'a.png', 'cleanedFile': 'b.png', 'durationMs': 41}]}]}
        (assets / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        return assets, image

    def test_hidden_rgb_alpha_and_pixel_dedup_are_exact_and_sources_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets, original = self.fixture(root)
            before = {f.name: f.read_bytes() for f in assets.glob('*.png')}
            report = module.optimize(root, workers=2)
            self.assertEqual(report['uniqueImages'], 1)
            manifest = json.loads((assets / 'manifest.json').read_text())
            action = manifest['actions'][0]
            frame = action['frames'][0]
            self.assertEqual(action['poster'], frame['file'])
            self.assertEqual(frame['file'], frame['cleanedFile'])
            self.assertEqual(frame['durationMs'], 41)
            self.assertEqual(Image.open(assets / frame['file']).convert('RGBA').tobytes(), original.tobytes())
            self.assertEqual(before, {f.name: f.read_bytes() for f in assets.glob('*.png')})
            self.assertEqual(len(list((root / '数据/资源清单备份').glob('*.json'))), 1)
            cached = module.optimize(root)
            self.assertEqual(cached['uniqueImages'], 1)
            self.assertEqual(cached['pixelErrors'], 0)

    def test_missing_or_escaping_assets_cannot_switch_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets, _ = self.fixture(root)
            path = assets / 'manifest.json'
            manifest = json.loads(path.read_text())
            manifest['actions'][0]['frames'][0]['file'] = '../missing.png'
            path.write_text(json.dumps(manifest))
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                module.optimize(root)
            self.assertEqual(path.read_bytes(), before)

    def test_dry_run_leaves_manifest_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets, _ = self.fixture(root)
            before = (assets / 'manifest.json').read_bytes()
            report = module.optimize(root, apply=False)
            self.assertFalse(report['applied'])
            self.assertEqual((assets / 'manifest.json').read_bytes(), before)

    def test_cleanup_of_webp_input_saves_exact_png_without_touching_input(self):
        cleanup_spec = importlib.util.spec_from_file_location('cleanup_webp', ROOT / '处理工具/clean_alpha.py')
        cleanup = importlib.util.module_from_spec(cleanup_spec)
        cleanup_spec.loader.exec_module(cleanup)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets, original = self.fixture(root)
            module.optimize(root)
            manifest = json.loads((assets / 'manifest.json').read_text())
            frame = manifest['actions'][0]['frames'][0]
            source = assets / frame['file']
            before = source.read_bytes()
            cleanup.ROOT, cleanup.ASSETS = root, assets
            cleanup.apply(manifest)
            output = assets / frame['cleanedFile']
            self.assertEqual(output.suffix, '.png')
            with Image.open(output) as image:
                self.assertEqual(image.format, 'PNG')
                self.assertEqual(image.convert('RGBA').tobytes(), cleanup.clean_rgba(np.array(original)).tobytes())
            self.assertEqual(source.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
