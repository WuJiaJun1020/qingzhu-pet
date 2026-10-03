"""General low-opacity cleanup for transparent animation frames. Originals are read-only."""
from pathlib import Path
import argparse
import hashlib
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
PARAMETERS = {'alpha_floor':12, 'alpha_full':48, 'opaque_seed':230, 'edge_keep_px':1.0, 'edge_fade_px':3.0}

def smoothstep(low, high, x):
    t=np.clip((x-low)/(high-low),0,1)
    return t*t*(3-2*t)

def clean_rgba(rgba):
    """Reduce weak residual alpha; keep original colors and protect nearby opaque edges.

    The same thresholds and distance rule apply to every object and every frame.
    No character positions, frame numbers or semantic color assumptions are used.
    """
    alpha=rgba[...,3].astype(np.float32)
    output=rgba.copy()
    h,w=alpha.shape
    radius=max(1.0,min(h,w)/384.0)
    core=alpha>=PARAMETERS['opaque_seed']
    if core.any():
        distance=cv2.distanceTransform((~core).astype(np.uint8),cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
        protect=1-smoothstep(PARAMETERS['edge_keep_px']*radius,PARAMETERS['edge_fade_px']*radius,distance)
    else:
        protect=np.zeros_like(alpha)
    confidence=smoothstep(PARAMETERS['alpha_floor'],PARAMETERS['alpha_full'],alpha)
    factor=np.maximum(confidence,protect)
    output[...,3]=np.rint(alpha*factor).astype(np.uint8)
    output[output[...,3]==0,:3]=0
    return output

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def composite(rgba,bg=0,gain=1):
    a=rgba[...,3:4].astype(np.float32)/255
    return np.rint(np.clip((rgba[...,:3]*a+bg*(1-a))*gain,0,255)).astype(np.uint8)

def previews(manifest):
    folder=ROOT/'处理工具'/'预览'
    folder.mkdir(exist_ok=True)
    font=ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc',16)
    for action in manifest['actions']:
        indices=np.unique(np.linspace(0,len(action['frames'])-1,7).round().astype(int))
        for index in indices:
            original=np.array(Image.open(ASSETS/action['frames'][index]['file']).convert('RGBA'))
            clean=clean_rgba(original)
            h,w=original.shape[:2]
            image=Image.new('RGB',(w*2,h*2+72),'#202522')
            draw=ImageDraw.Draw(image)
            for row,gain in enumerate([1,5]):
                y=row*(h+36)
                for col,(label,rgba) in enumerate([('原版',original),('杂色净化',clean)]):
                    draw.text((col*w+8,y+7),label+(' · 黑底' if row==0 else ' · 暗部放大5倍检查'),font=font,fill='#eff5ed')
                    image.paste(Image.fromarray(composite(rgba,gain=gain)),(col*w,y+36))
            image.save(folder/f"{action['id']}-{index+1:04}-对照.png")
    print(str(folder),flush=True)

def apply(manifest):
    folder=ASSETS/'cleaned-v1'
    folder.mkdir(exist_ok=True)
    config={'algorithm_sha256':sha(Path(__file__)), 'parameters':PARAMETERS}
    info=folder/'算法.json'
    if info.exists() and json.loads(info.read_text(encoding='utf-8'))!=config:
        raise RuntimeError('Output belongs to a different algorithm. Use a new version directory.')
    info.write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8')
    cv2.setNumThreads(2)
    reports=[]
    for action in manifest['actions']:
        report={'action':action['id'],'frames':len(action['frames']),'pixels_cleared':0,'alpha_changed':0,'protected_pixels':0,'protected_errors':0,'opaque_errors':0,'original_hash_errors':0}
        target=folder/action['id'];target.mkdir(exist_ok=True)
        for index,frame in enumerate(action['frames']):
            source=ASSETS/frame['file']
            if sha(source)!=frame['sha256']:raise RuntimeError(f'Original frame hash changed: {source}')
            rgba=np.array(Image.open(source).convert('RGBA'))
            cleaned=clean_rgba(rgba)
            protect=rgba[...,3]>=PARAMETERS['alpha_full']
            report['protected_pixels']+=int(protect.sum())
            report['protected_errors']+=int(np.any(cleaned[protect]!=rgba[protect],axis=1).sum())
            report['opaque_errors']+=int(np.any(cleaned[rgba[...,3]==255]!=rgba[rgba[...,3]==255],axis=1).sum())
            report['pixels_cleared']+=int(((rgba[...,3]>0)&(cleaned[...,3]==0)).sum())
            report['alpha_changed']+=int((rgba[...,3]!=cleaned[...,3]).sum())
            name=source.name;path=target/name
            Image.fromarray(cleaned).save(path,compress_level=6)
            frame['cleanedFile']=f"cleaned-v1/{action['id']}/{name}"
            frame['cleanedSha256']=sha(path)
            if (index+1)%48==0 or index+1==len(action['frames']):print(f"{action['id']}: {index+1}/{len(action['frames'])}",flush=True)
        if report['protected_errors'] or report['opaque_errors']:raise RuntimeError('Protected foreground changed')
        reports.append(report)
    partial=ASSETS/'manifest.partial.json'
    partial.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    partial.replace(ASSETS/'manifest.json')
    (folder/'验证报告.json').write_text(json.dumps({'parameters':PARAMETERS,'actions':reports},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(reports,ensure_ascii=False),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    manifest=json.loads((ASSETS/'manifest.json').read_text(encoding='utf-8-sig'))
    previews(manifest)
    if args.apply:apply(manifest)
