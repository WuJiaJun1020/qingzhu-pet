'use strict';
const {validId,MAX_BYTES}=require('./pack-format.cjs');
const {validVersion}=require('./versions.cjs');
const CATALOG_URL='https://raw.githubusercontent.com/WuJiaJun1020/qingzhu-pet/main/assets/character-packs.json';
function validateCatalog(catalog){
  if(catalog?.version!==undefined&&catalog.version!==1)throw Error('人物清单需要较新的软件版本，请先更新软件');
  if(!Array.isArray(catalog?.packs)||!catalog.packs.length||catalog.packs.length>128)throw Error('人物下载清单格式不正确');
  const entries=new Map();
  for(const p of catalog.packs){
    const url=new URL(p.url);
    if(p.minAppVersion!==undefined&&!validVersion(p.minAppVersion))throw Error('人物最低软件版本不合法');
    if(!validId(p.id)||entries.has(p.id)||typeof p.name!=='string'||!Number.isInteger(p.bytes)||p.bytes<1||p.bytes>MAX_BYTES||!/^[a-f0-9]{64}$/.test(p.sha256)||url.origin!=='https://github.com'||!url.pathname.startsWith('/WuJiaJun1020/qingzhu-pet/releases/download/'))throw Error('人物下载清单不合法');
    entries.set(p.id,p);
  }
  return entries;
}
async function fetchCatalog(fetch){
  const response=await fetch(CATALOG_URL,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('检查人物更新失败（HTTP '+response.status+'）');
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>2*1024**2)throw Error('人物清单过大');parts.push(Buffer.from(part));}
  const catalog=JSON.parse(Buffer.concat(parts).toString('utf8'));validateCatalog(catalog);return catalog;
}
module.exports={CATALOG_URL,validateCatalog,fetchCatalog};
