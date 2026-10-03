"""Import verified transparent video output into the standalone desktop pet."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "处理工具"))
from clean_alpha import clean_rgba, PARAMETERS


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("processed", type=Path, help="video_tool output directory")
    parser.add_argument("--id", required=True, help="Unique ASCII action ID")
    parser.add_argument("--title", required=True)
    parser.add_argument("--replace", action="store_true", help="Replace an existing action; retain its old assets and manifest backup")
    args = parser.parse_args()
    if not args.id or not all(c in "abcdefghijklmnopqrstuvwxyz0123456789-_" for c in args.id):
        parser.error("Use an ASCII lowercase action ID, digits, dash or underscore.")
    processed = args.processed.resolve(strict=True)
    job = json.loads((processed / "任务信息.json").read_text(encoding="utf-8"))
    report = json.loads((processed / "render-report.json").read_text(encoding="utf-8"))
    validation = json.loads((processed / "验证结果.json").read_text(encoding="utf-8"))
    source = Path(job["source"]).resolve(strict=True)
    assert digest(source) == report["source_sha256"] == job["identity"]["sha256"], "Source identity mismatch"
    assert validation.get("webm_decoded_frames") == report["frames"], "Transparent video frame validation did not pass"
    assert validation.get("webm_alpha_max_error", 255) <= 1, "Transparent video alpha validation did not pass"
    assert validation.get("png_archive_verified") is True, "PNG archive validation did not pass"
    paths = sorted((processed / "透明PNG帧").glob("*.png"))
    assert len(paths) == report["frames"] > 0
    manifest_path = ROOT / "assets" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    matches = [i for i, action in enumerate(manifest["actions"]) if action["id"] == args.id]
    assert len(matches) == (1 if args.replace else 0), "Use --replace for an existing action ID"
    assert all(path.name == f"{i+1:06}.png" for i, path in enumerate(paths))
    resource_id = f"{args.id}-{report['source_sha256'][:12]}" if args.replace else args.id
    folder = ROOT / "assets" / resource_id
    clean_folder = ROOT / "assets" / "cleaned-v1" / resource_id
    assert not folder.exists() and not clean_folder.exists(), "Asset directory already exists"
    folder.mkdir()
    clean_folder.mkdir()
    frames, cleared = [], 0
    for index, path in enumerate(paths):
        target, cleaned_target = folder / path.name, clean_folder / path.name
        shutil.copy2(path, target)
        assert digest(path) == digest(target), "Original transparent frame changed"
        rgba = np.array(Image.open(target).convert("RGBA"))
        assert rgba.shape == (report["height"], report["width"], 4)
        cleaned = clean_rgba(rgba)
        protected = rgba[..., 3] >= PARAMETERS["alpha_full"]
        assert np.array_equal(cleaned[protected], rgba[protected]), "Protected pixels changed"
        cleared += int(((rgba[..., 3] > 0) & (cleaned[..., 3] == 0)).sum())
        Image.fromarray(cleaned).save(cleaned_target, compress_level=6)
        with Image.open(cleaned_target) as saved:
            assert np.array_equal(np.array(saved), cleaned)
        frames.append({"file": f"{resource_id}/{path.name}", "durationMs": 1000 / report["fps"],
                       "sha256": digest(target), "cleanedFile": f"cleaned-v1/{resource_id}/{path.name}",
                       "cleanedSha256": digest(cleaned_target)})
        if (index+1) % 48 == 0 or index+1 == len(paths):
            print(f"Imported {index+1}/{len(paths)}", flush=True)
    shutil.copy2(folder / paths[0].name, folder / "poster.png")
    action = {"id": args.id, "title": args.title, "role": "action", "width": report["width"],
              "height": report["height"], "fps": report["fps"], "poster": f"{resource_id}/poster.png",
              "sourceName": source.name, "sourceSha256": report['source_sha256'], "frames": frames}
    record = {"action": args.id, "frames": len(frames), "width": report["width"], "height": report["height"],
              "fps": report["fps"], "duration": len(frames)/report["fps"], "source_sha256": report["source_sha256"],
              "protected_pixel_errors": 0, "original_frame_errors": 0, "pixels_cleared": cleared,
              "parameters": PARAMETERS, "video_validation": validation, "passed": True}
    (folder / "导入记录.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    backup = ROOT / "数据" / "资源清单备份"
    backup.mkdir(parents=True, exist_ok=True)
    shutil.copy2(manifest_path, backup / ("manifest-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".json"))
    if args.replace:
        manifest["actions"][matches[0]] = action
    else:
        manifest["actions"].append(action)
    temporary = manifest_path.with_name("manifest.import.partial.json")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(manifest_path)
    print(json.dumps({"action": args.id, "frames": len(frames), "passed": True}, ensure_ascii=True))


if __name__ == "__main__":
    main()
