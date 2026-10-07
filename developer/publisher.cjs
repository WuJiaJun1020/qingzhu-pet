'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {buildCharacter,scanCharacters,hash}=require('./pack-builder.cjs');
const {connect,remoteState,git,REPOSITORY}=require('./github.cjs');
const {extractPack}=require('../app/pack-format.cjs');
const {validateCatalog}=require('../app/remote-catalog.cjs');
const store=require('./release-store.cjs');
const {assetName,packUrl,releaseUrl,updateReadme}=require('./resource-pages.cjs');
function mergePublication(state,changes,tag,archiveTag=state.catalog.archiveReleaseTag||'characters-history'){
  const catalog=structuredClone(state.catalog),before=[];
  for(const entry of changes){
    const index=catalog.packs.findIndex(p=>p.id===entry.id),previous=catalog.packs[index];
    if(previous){
      if(previous.sha256!==entry.previousSha&&previous.sha256!==entry.sha256)throw Error(entry.name+' 已被其他发布更新，请重新扫描');
      if(previous.sha256===entry.sha256&&previous.url===entry.url)continue;
      before.push(previous);
    }else if(entry.previousSha)throw Error('远程清单缺少人物：'+entry.name);
    const next={...previous,...entry};delete next.previousSha;delete next.file;delete next.isNew;
    if(index<0)catalog.packs.push(next);else catalog.packs[index]=next;
  }
  catalog.releaseTag=tag;catalog.resourceReleaseTag=tag;catalog.archiveReleaseTag=archiveTag;
  validateCatalog(catalog);
  const actionIds=new Set();for(const p of catalog.packs)for(const action of p.actions||[]){if(actionIds.has(action.id))throw Error('人物动作编号与已有角色重复：'+action.id);actionIds.add(action.id);}
  return {catalog,readme:updateReadme(state.readme,catalog),before};
}
function createPublisher({sourceRoot,charactersDirectory,data,builtinIds,fetch,verifying=false,onProgress=()=>{},apiFactory=()=>connect(sourceRoot,fetch),readRemote=remoteState,syncRepo=async()=>{
  await git(sourceRoot,['fetch','origin','main']);
  await git(sourceRoot,['merge','--ff-only','origin/main']);
}}){
  let busy=false,scanState=null,rows=[],plan=null;
  const folder=path.join(data,'publisher');
  async function exclusive(fn){if(busy)throw Error('人物发布工具正在处理');busy=true;try{return await fn();}finally{busy=false;}}
  const publicPlan=()=>({id:plan.id,tag:plan.tag,characters:plan.entries.map(({file,...entry})=>entry),totalBytes:plan.entries.reduce((n,p)=>n+p.bytes,0),dryRun:verifying});
  async function scan(){return exclusive(async()=>{
    onProgress('读取发布清单');
    if(verifying)scanState={catalog:JSON.parse(await fs.readFile(path.join(sourceRoot,'assets/character-packs.json'),'utf8')),readme:await fs.readFile(path.join(sourceRoot,'README.md'),'utf8')};
    else scanState=await readRemote(await apiFactory());
    validateCatalog(scanState.catalog);
    rows=await scanCharacters(charactersDirectory,scanState.catalog,builtinIds,onProgress);plan=null;
    return {characters:rows,dryRun:verifying,repository:REPOSITORY};
  });}
  async function prepare(ids){return exclusive(async()=>{
    if(!scanState||!Array.isArray(ids)||!ids.length||ids.length>rows.length||new Set(ids).size!==ids.length)throw Error('请先扫描并选择有变化的人物');
    const id=crypto.randomUUID(),tag=scanState.catalog.resourceReleaseTag||'characters-latest';
    const archiveTag=scanState.catalog.archiveReleaseTag||'characters-history';
    const output=path.join(folder,id);await fs.mkdir(output,{recursive:true});
    const entries=[];
    for(const cid of ids){
      const row=rows.find(p=>p.id===cid);
      if(!row?.changed||row.error||builtinIds.has(cid))throw Error('只能发布扫描出的非内置变更人物');
      onProgress('打包并校验 '+row.name);
      const built=await buildCharacter(charactersDirectory,cid);
      if(built.entry.sha256!==row.sha256)throw Error(row.name+' 在扫描后又被修改，请重新扫描');
      const filename=cid+'-'+built.entry.sha256.slice(0,12)+'.qzpet',file=path.join(output,filename);
      await fs.writeFile(file,built.bytes,{flag:'wx'});
      // Validate lossless image dimensions and every file exactly like installation.
      const validation=path.join(output,'validate-'+cid);
      try{await extractPack(file,validation,built.entry);}finally{await fs.rm(validation,{recursive:true,force:true});}
      entries.push({...built.entry,previousSha:row.previousSha,isNew:row.isNew,file,url:'https://github.com/'+REPOSITORY+'/releases/download/'+tag+'/'+filename});
    }
    plan={id,tag,archiveTag,output,entries};mergePublication(scanState,entries,tag,archiveTag);
    await fs.writeFile(path.join(output,'plan.json'),JSON.stringify(publicPlan(),null,2));
    return publicPlan();
  });}
  async function publish(id){return exclusive(async()=>{
    if(verifying)throw Error('自动验收仅预览，禁止向 GitHub 发布');
    if(!plan||plan.id!==id)throw Error('发布预览已失效，请重新准备');
    const api=await apiFactory(),state=await readRemote(api);
    let merged=mergePublication(state,plan.entries,plan.tag,plan.archiveTag);
    const current=await store.ensureRelease(api,plan.tag,state.head,'人物资源 · 最新版');
    const history=await store.ensureRelease(api,plan.archiveTag,state.head,'人物资源 · 历史归档');
    if(plan.entries.some(p=>state.catalog.packs.find(old=>old.id===p.id)?.sha256!==p.sha256)){
      for(const p of plan.entries)if(hash(await fs.readFile(p.file))!==p.sha256)throw Error('待上传包已改变，请重新准备');
      onProgress('归档被替换的旧包');await store.archiveEntries(api,history,merged.before);
      for(const p of plan.entries){onProgress('上传 '+p.name);await store.upload(api,current,path.basename(p.file),await fs.readFile(p.file));}
      // Fresh deployments must have the complete catalog in the same release.
      for(const p of state.catalog.packs){
        if(plan.entries.some(e=>e.id===p.id))continue;
        const source=await store.getRelease(api,decodeURIComponent(new URL(p.url).pathname.split('/').at(-2)));
        const asset=(await store.listAssets(api,source)).find(a=>a.name===assetName(p));
        if(!asset||asset.digest!=='sha256:'+p.sha256)throw Error('无法核对人物包：'+p.name);
        if(source.id!==current.id)await store.copyAsset(api,asset,current);
      }
      if(current.draft)await api.request('/releases/'+current.id,{method:'PATCH',body:{draft:false,make_latest:'false'}});
      const latest=await readRemote(api);merged=mergePublication(latest,plan.entries,plan.tag,plan.archiveTag);
      for(const p of merged.catalog.packs)p.url=packUrl(plan.tag,assetName(p));
      const ready=await store.listAssets(api,current);
      for(const p of merged.catalog.packs){const a=ready.find(a=>a.name===assetName(p));if(!a||a.size!==p.bytes||a.digest!=='sha256:'+p.sha256)throw Error('最新版附件尚未准备完整：'+p.name);}
      merged.readme=updateReadme(latest.readme,merged.catalog);
      onProgress('更新下载清单和 README');
      await store.commitCatalog(api,latest,merged.catalog,merged.readme,'Update character packs: '+plan.entries.map(p=>p.name).join(', '));
    }
    // Retrying after a metadata commit finishes the archive cleanup as well.
    const committed=await readRemote(api);
    if(committed.catalog.resourceReleaseTag!==plan.tag)throw Error('远程资源入口已变化，请重新扫描');
    onProgress('整理最新版和历史归档');await store.finalize(api,current,history,committed.catalog);
    let warning='';try{await syncRepo();}catch{warning='GitHub 已发布；本地仓库存在未同步变更，请先处理后同步 main。';}
    onProgress('发布完成');
    return {url:releaseUrl(plan.tag),warning,characters:plan.entries.map(p=>p.name)};
  });}
  return {scan,prepare,publish,get busy(){return busy;}};
}
module.exports={createPublisher,mergePublication};
