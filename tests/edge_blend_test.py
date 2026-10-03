"""Generic edge-blend tests: thin props, image boundaries and empty masks."""
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '处理工具'))
from blend_edges import edge_weight, apply_weight


class EdgeBlendTests(unittest.TestCase):
    def test_subject_touching_border_is_preserved_in_every_direction(self):
        subject = np.zeros((80, 120), dtype=np.float32)
        subject[30:45, :45] = 1
        subject[10:65, 35:38] = .7
        rgba = np.full((80, 120, 4), [40, 100, 130, 219], dtype=np.uint8)
        for flips in [(), (0,), (1,), (0, 1)]:
            mask = np.flip(subject, axis=flips) if flips else subject
            weight = edge_weight(mask)
            result = apply_weight(rgba, weight)
            np.testing.assert_array_equal(result[mask >= .5], rgba[mask >= .5])
            self.assertTrue((weight[mask >= .5] == 255).all())

    def test_empty_mask_fades_all_four_borders_and_keeps_the_interior(self):
        weight = edge_weight(np.zeros((160, 100), dtype=np.float32))
        self.assertTrue((weight[[0, -1], :] == 0).all())
        self.assertTrue((weight[:, [0, -1]] == 0).all())
        self.assertEqual(weight[80, 50], 255)
        self.assertTrue((np.diff(weight[80, :21].astype(int)) >= 0).all())
        self.assertGreater(len(np.unique(weight[80, :21])), 10)

    def test_render_mask_only_changes_alpha_and_clears_invisible_rgb(self):
        rng = np.random.default_rng(1)
        rgba = rng.integers(0, 256, (110, 70, 4), dtype=np.uint8)
        original = rgba.copy()
        weight = edge_weight(np.zeros((110, 70), dtype=np.float32))
        result = apply_weight(rgba, weight)
        np.testing.assert_array_equal(rgba, original)
        visible = result[..., 3] > 0
        np.testing.assert_array_equal(result[visible, :3], rgba[visible, :3])
        self.assertTrue((result[~visible, :3] == 0).all())
        self.assertTrue((result[..., 3] <= rgba[..., 3]).all())


if __name__ == '__main__':
    unittest.main()
