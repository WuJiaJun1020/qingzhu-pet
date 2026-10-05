'use strict';
const {nativeImage}=require('electron');
const {pathToFileURL}=require('node:url');

// Electron nativeImage accepts PNG/JPEG, while Chromium additionally supports
// WebP. Use Chromium's decoder for those files, then nativeImage for bitmap QA.
module.exports=async (webContents,file)=>{
  const native=nativeImage.createFromPath(file);
  if(!native.isEmpty())return native.toBitmap();
  const url=pathToFileURL(file).href;
  const png=await webContents.executeJavaScript(`(async()=>{
    const image=new Image();image.src=${JSON.stringify(url)};await image.decode();
    const canvas=new OffscreenCanvas(image.naturalWidth,image.naturalHeight);
    canvas.getContext('2d').drawImage(image,0,0);
    const blob=await canvas.convertToBlob({type:'image/png'});
    return await new Promise((resolve,reject)=>{const r=new FileReader();
      r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
  })()`);
  const decoded=nativeImage.createFromDataURL(png);
  if(decoded.isEmpty())throw new Error('Unable to decode image: '+file);
  return decoded.toBitmap();
};
