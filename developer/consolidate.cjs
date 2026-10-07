'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {remoteState}=require('./github.cjs');
const {assetName,packUrl,updateReadme,releaseUrl,currentBody,archiveBody}=require('./resource-pages.cjs');
const store=require('./release-store.cjs');
// Explicit one-time migration; regular publication reuses the saved tags.
async function consolidate({api,currentTag,archiveTag,output,onProgress=()=>{}}){
 if(currentTag===archiveTag)throw Error('最新版与归档不能使用同一个页面');
 const initial=await remoteState(api),current=await store.getRelease(api,currentTag),archive=await store.getRelease(api,archiveTag);
 await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'before.json'),JSON.stringify({state:initial,current,archive},null,2));
 const catalog=structuredClone(initial.catalog);
 catalog.releaseTag=currentTag;catalog.resourceReleaseTag=currentTag;catalog.archiveReleaseTag=archiveTag;
 for(const p of catalog.packs){
  const name=assetName(p),present=(await store.listAssets(api,current)).find(a=>a.name===name);
  if(present){if(present.digest!=='sha256:'+p.sha256||present.size!==p.bytes)throw Error('最新版附件不一致：'+p.name);}
  else{
    onProgress('合并最新版：'+p.name);
    const source=await store.getRelease(api,decodeURIComponent(new URL(p.url).pathname.split('/').at(-2)));
    const asset=(await store.listAssets(api,source)).find(a=>a.name===name);
    if(!asset||asset.digest!=='sha256:'+p.sha256||asset.size!==p.bytes)throw Error('源包校验不一致：'+p.name);
    await store.copyAsset(api,asset,current);
  }
  p.url=packUrl(currentTag,name);
 }
 const wanted=new Set(catalog.packs.map(assetName));
 for(const asset of (await store.listAssets(api,current)).filter(a=>a.name.endsWith('.qzpet')&&!wanted.has(a.name))){onProgress('保存历史包：'+asset.name);await store.copyAsset(api,asset,archive);}
 const preview={current:{name:'人物资源 · 最新版',body:currentBody(catalog)},archive:{name:'人物资源 · 历史归档',body:archiveBody(catalog,(await store.listAssets(api,archive)).filter(a=>!wanted.has(a.name)))},catalog};
 await fs.writeFile(path.join(output,'preview.json'),JSON.stringify(preview,null,2));
 const latest=await remoteState(api);if(latest.head!==initial.head)throw Error('迁移期间仓库已更新；已复制的包保留，请重新整理');
 onProgress('更新下载清单与 README');
 const commit=await store.commitCatalog(api,latest,catalog,updateReadme(latest.readme,catalog),'Consolidate current character packs and archive previous versions');
 await fs.writeFile(path.join(output,'commit.json'),JSON.stringify({commit}));
 await store.finalize(api,current,archive,catalog);
 const currentAssets=await store.listAssets(api,current),historyAssets=await store.listAssets(api,archive);
 const result={commit,current:releaseUrl(currentTag),history:releaseUrl(archiveTag),characters:catalog.packs.length,currentPackages:currentAssets.filter(a=>a.name.endsWith('.qzpet')).length,historyPackages:historyAssets.filter(a=>a.name.endsWith('.qzpet')).length,unchangedAssetIds:current.assets.filter(a=>wanted.has(a.name)).map(a=>({id:a.id,name:a.name,before:a.download_count,after:currentAssets.find(b=>b.id===a.id)?.download_count}))};
 if(result.currentPackages!==result.characters||result.unchangedAssetIds.some(a=>a.after===undefined||a.after<a.before))throw Error('整理后的包数或原附件计数不一致');
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));return result;
}
module.exports={consolidate};
