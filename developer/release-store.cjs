'use strict';
const {hash}=require('./pack-builder.cjs');
const {assetName,packUrl,currentBody,archiveBody}=require('./resource-pages.cjs');
async function listAssets(api,release){const all=[];for(let page=1;;page++){const batch=await api.request('/releases/'+release.id+'/assets?per_page=100&page='+page);all.push(...batch);if(batch.length<100)return all;}}
async function getRelease(api,tag){return api.request('/releases/tags/'+encodeURIComponent(tag));}
async function ensureRelease(api,tag,head,name){try{return await getRelease(api,tag);}catch(e){if(e.status!==404)throw e;return api.request('/releases',{method:'POST',body:{tag_name:tag,target_commitish:head,name,draft:true,make_latest:'false'}});}}
function matches(asset,bytes){return asset?.state==='uploaded'&&asset.size===bytes.length&&asset.digest==='sha256:'+hash(bytes);}
async function upload(api,release,name,bytes){
 let existing=(await listAssets(api,release)).find(a=>a.name===name);
 if(existing){if(matches(existing,bytes))return existing;throw Error('已有同名附件校验不一致：'+name);}
 const result=await api.request(release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(name),{method:'POST',bytes,upload:true});
 if(!matches(result,bytes))throw Error('GitHub 附件校验失败：'+name);return result;
}
async function checkedDownload(api,asset){const bytes=await api.download(asset.id);if(!matches(asset,bytes))throw Error('归档源文件校验失败：'+asset.name);return bytes;}
async function copyAsset(api,asset,target){
 const existing=(await listAssets(api,target)).find(a=>a.name===asset.name);
 if(existing){if(existing.state==='uploaded'&&existing.size===asset.size&&existing.digest===asset.digest)return existing;throw Error('归档附件冲突：'+asset.name);}
 return upload(api,target,asset.name,await checkedDownload(api,asset));
}
async function replaceMetadata(api,release,name,bytes){
 const old=(await listAssets(api,release)).find(a=>a.name===name);if(old&&matches(old,bytes))return;
 const staged=await upload(api,release,'.publishing-'+name+'-'+hash(bytes).slice(0,16),bytes);
 if(old)await api.request('/releases/assets/'+old.id,{method:'DELETE'});
 await api.request('/releases/assets/'+staged.id,{method:'PATCH',body:{name}});
}
async function archiveEntries(api,history,entries){
 for(const p of entries){const tag=decodeURIComponent(new URL(p.url).pathname.split('/').at(-2));const release=await getRelease(api,tag);
  const asset=(await listAssets(api,release)).find(a=>a.name===assetName(p));
  if(!asset||asset.size!==p.bytes||asset.digest!=='sha256:'+p.sha256)throw Error('无法核对旧包：'+p.name);
  await copyAsset(api,asset,history);
 }
}
// Run only after the repository catalog switched successfully. Never delete a
// package until an identical, verified copy is present in the other release.
async function finalize(api,current,history,catalog){
 const wanted=new Map(catalog.packs.map(p=>[assetName(p),p]));
 let assets=await listAssets(api,current);
 for(const [name,p] of wanted){const a=assets.find(a=>a.name===name);if(!a||a.state!=='uploaded'||a.size!==p.bytes||a.digest!=='sha256:'+p.sha256)throw Error('最新版附件缺失或校验不符：'+name);}
 const obsolete=assets.filter(a=>a.name.endsWith('.qzpet')&&!wanted.has(a.name));
 for(const asset of obsolete)await copyAsset(api,asset,history);
 await api.request('/releases/'+history.id,{method:'PATCH',body:{name:'人物资源 · 历史归档',body:archiveBody(catalog,await listAssets(api,history)),draft:false,make_latest:'false'}});
 for(const asset of obsolete)await api.request('/releases/assets/'+asset.id,{method:'DELETE'});
 // Migration may reuse a release containing copies of the current versions.
 for(const asset of (await listAssets(api,history)).filter(a=>wanted.has(a.name))){const p=wanted.get(asset.name);if(asset.digest==='sha256:'+p.sha256&&asset.size===p.bytes)await api.request('/releases/assets/'+asset.id,{method:'DELETE'});}
 await replaceMetadata(api,current,'character-packs.json',Buffer.from(JSON.stringify(catalog,null,2)+'\n'));
 await replaceMetadata(api,current,'SHA256SUMS.txt',Buffer.from(catalog.packs.map(p=>p.sha256+'  '+assetName(p)).join('\n')+'\n'));
 for(const asset of await listAssets(api,history))if(['character-packs.json','SHA256SUMS.txt'].includes(asset.name))await api.request('/releases/assets/'+asset.id,{method:'DELETE'});
 await api.request('/releases/'+history.id,{method:'PATCH',body:{name:'人物资源 · 历史归档',body:archiveBody(catalog,await listAssets(api,history)),draft:false,make_latest:'false'}});
 await api.request('/releases/'+current.id,{method:'PATCH',body:{name:'人物资源 · 最新版',body:currentBody(catalog),draft:false,make_latest:'false'}});
}
async function commitCatalog(api,state,catalog,readme,message){
 const tree=await api.request('/git/trees',{method:'POST',body:{base_tree:state.tree,tree:[{path:'assets/character-packs.json',mode:'100644',type:'blob',content:JSON.stringify(catalog,null,2)+'\n'},{path:'README.md',mode:'100644',type:'blob',content:readme}]}});
 const commit=await api.request('/git/commits',{method:'POST',body:{message,tree:tree.sha,parents:[state.head]}});
 await api.request('/git/refs/heads/main',{method:'PATCH',body:{sha:commit.sha,force:false}});return commit.sha;
}
module.exports={listAssets,getRelease,ensureRelease,upload,copyAsset,checkedDownload,archiveEntries,finalize,commitCatalog,packUrl};
