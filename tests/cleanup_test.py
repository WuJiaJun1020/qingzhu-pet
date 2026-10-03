import importlib.util
from pathlib import Path
import unittest
import numpy as np

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cleanup',root/'处理工具'/'clean_alpha.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class CleanupTests(unittest.TestCase):
    def test_foreground_and_effects_preserved(self):
        rng=np.random.default_rng(31)
        source=rng.integers(0,256,(40,40,4),dtype=np.uint8)
        out=module.clean_rgba(source)
        high=source[...,3]>=48
        np.testing.assert_array_equal(out[high],source[high])
        self.assertTrue(np.all(out[...,3]<=source[...,3]))
    def test_weak_isolated_noise_and_edge_protection(self):
        source=np.zeros((40,40,4),dtype=np.uint8)
        source[2:5,2:5]=[60,120,40,10]
        source[15:25,15:25]=[220,180,170,255]
        source[14,20]=[90,60,20,10]
        source[30:33,30:33]=[10,150,80,70]
        out=module.clean_rgba(source)
        self.assertEqual(int(out[3,3,3]),0)
        np.testing.assert_array_equal(out[14,20],source[14,20])
        np.testing.assert_array_equal(out[31,31],source[31,31])
    def test_soft_knee_has_no_hard_alpha_jump(self):
        source=np.zeros((16,256,4),dtype=np.uint8)
        source[...,:3]=[10,100,20];source[...,3]=np.arange(256,dtype=np.uint8)
        out=module.clean_rgba(source)
        alpha=out[0,:,3].astype(int)
        self.assertTrue(np.all(np.diff(alpha)>=0))
        self.assertLessEqual(int(np.diff(alpha).max()),3)

if __name__=='__main__':unittest.main()
