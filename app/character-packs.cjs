'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {extractPack,readHeader,validId,MAX_BYTES}=require('./pack-format.cjs');
const {createCharacterCatalog}=require('./characters.cjs');
const {validateCatalog,fetchCatalog}=require('./remote-catalog.cjs');
const {compareVersions}=require('./versions.cjs');
const {renameWithRetry}=require('./file-operations.cjs');
function inside(base,relative){
  const result=path.resolve(base,relative);
  if(!result.startsWith(path.resolve(base)+path.sep))throw new Error('人物资源路径不合法');
  return result;
}
function withAssets(manifest,assetsRoot){
  if(manifest.frameVariant!=='cleaned-v1')throw new Error('请先转换为仅净化帧资源');
  createCharacterCatalog(manifest);
  for(const a of manifest.actions){
    Object.defineProperty(a,'assetsRoot',{value:assetsRoot});
    for(const f of a.frames){
      if(f.cleanedFile||!fs.existsSync(inside(assetsRoot,f.file)))throw new Error('净化人物资源缺失');
      if(f.edgeMaskFile&&!fs.existsSync(inside(assetsRoot,f.edgeMaskFile)))throw new Error('人物遮罩缺失');
    }
  }
  return manifest;
}
function readIndex(directory){
  try{return JSON.parse(fs.readFileSync(path.join(directory,'index.json'),'utf8'));}catch{return {version:1,installed:{}};}
}
function loadLibrary(root,data,directory=path.join(data,'characters'),{allowBuiltinUpdates=false}={}){
  const builtin=withAssets(JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'),'utf8')),path.join(root,'assets'));
  const result={...builtin,actions:[...builtin.actions],characters:[...builtin.characters]},installed=new Map(),warnings=[];
  for(const c of builtin.characters)installed.set(c.id,builtin.packSha256);
  for(const [id,entry] of Object.entries(readIndex(directory).installed||{})){
    try{
      if(!validId(id)||(installed.has(id)&&!allowBuiltinUpdates)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('人物安装记录不合法');
      const folder=inside(directory,entry.directory);
      const manifest=withAssets(JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')),folder);
      if(manifest.characters.length!==1||manifest.characters[0].id!==id)throw new Error('人物安装记录不一致');
      const previous=new Set(result.characters.find(c=>c.id===id)?.actions||[]),actions=result.actions.filter(a=>!previous.has(a.id)),characters=result.characters.filter(c=>c.id!==id);
      createCharacterCatalog({...result,actions:[...actions,...manifest.actions],characters:[...characters,...manifest.characters]});
      result.actions=[...actions,...manifest.actions];result.characters=[...characters,...manifest.characters];installed.set(id,entry.sha256);
    }catch(error){warnings.push(`${id}：${error.message}`);}
  }
  return {manifest:result,installed,warnings};
}
function createPackManager({root,data,charactersDirectory=path.join(data,'characters'),fetch,catalogFetch=fetch,inspectInstalled,allowUnlistedImport=false,allowBuiltinUpdates=false,appVersion='0.3.0',onChange=()=>{}}){
  const builtinIds=new Set(JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'),'utf8')).characters.map(c=>c.id));
  const bundled=JSON.parse(fs.readFileSync(path.join(root,'assets/character-packs.json'),'utf8'));
  let entries=validateCatalog(bundled);
  const catalogFile=path.join(data,'character-catalog.json');
  const protectBuiltin=next=>{if(!allowBuiltinUpdates)for(const p of bundled.packs)if(builtinIds.has(p.id))next.set(p.id,p);return next;};
  try{entries=protectBuiltin(validateCatalog(JSON.parse(fs.readFileSync(catalogFile,'utf8'))));}catch{/* Offline startup uses the bundled catalog. */}
  const load=()=>loadLibrary(root,data,charactersDirectory,{allowBuiltinUpdates});
  let transfer={status:'idle'},controller=null,busy=false,library=load();
  let inspected=new Map();
  const compatible=p=>(!p.packFormat||p.packFormat==='qingzhu-character-v1')&&(!p.minAppVersion||compareVersions(appVersion,p.minAppVersion)>=0);
  const emit=value=>{transfer={...transfer,...value};onChange();};
  const list=()=>{
    return {transfer,warnings:library.warnings,entries:[...entries.values()].map(p=>({...p,comparisonError:inspected.get(p.id)?.error,compatible:compatible(p),installed:library.installed.has(p.id),removable:library.installed.has(p.id)&&!builtinIds.has(p.id),updateAvailable:(!builtinIds.has(p.id)||allowBuiltinUpdates)&&library.installed.has(p.id)&&(inspectInstalled?!!inspected.get(p.id)?.sha256&&inspected.get(p.id).sha256!==p.sha256:library.installed.get(p.id)!==p.sha256)}))};
  };
  async function commit(file,p){
    emit({status:'verifying',message:'正在校验人物资源'});
    const base=charactersDirectory,staging=inside(base,'.staging/'+crypto.randomUUID());
    await fsp.mkdir(staging,{recursive:true});
    let target;
    try{
      emit({status:'installing',message:'正在安装人物'});
      const incoming=await extractPack(file,staging,p,{signal:controller?.signal});
      if(!compatible({...p,minAppVersion:incoming.minAppVersion||p.minAppVersion}))throw Error('此人物需要较新的软件版本，请先更新软件');
      const previous=new Set(library.manifest.characters.find(c=>c.id===p.id)?.actions||[]);
      createCharacterCatalog({...library.manifest,characters:[...library.manifest.characters.filter(c=>c.id!==p.id),...incoming.characters],actions:[...library.manifest.actions.filter(a=>!previous.has(a.id)),...incoming.actions]});
      if(controller?.signal.aborted)throw new Error('下载已取消');
      const relative=`${p.id}/${p.sha256.slice(0,16)}-${crypto.randomUUID()}`;target=inside(base,relative);
      await fsp.mkdir(path.dirname(target),{recursive:true});await renameWithRetry(staging,target);
      const index=readIndex(charactersDirectory);index.installed[p.id]={directory:relative,sha256:p.sha256};
      const temp=path.join(base,'index.json.tmp');try{await fsp.writeFile(temp,JSON.stringify(index,null,2)+'\n');await renameWithRetry(temp,path.join(base,'index.json'));}finally{await fsp.rm(temp,{force:true});}
      library=load();
      return p.id;
    }catch(error){await fsp.rm(staging,{recursive:true,force:true});if(target&&readIndex(charactersDirectory).installed?.[p.id]?.directory!==path.relative(base,target).replaceAll('\\','/'))await fsp.rm(target,{recursive:true,force:true});throw error;}
  }
  async function install(id,localFile){
    if(busy)throw new Error('已有一个人物包正在处理');
    const p=entries.get(id);if(!p)throw new Error('人物不存在');
    if(!compatible(p))throw Error('此人物需要较新的软件版本，请先更新软件');
    if(builtinIds.has(id)&&!allowBuiltinUpdates&&library.installed.get(id)!==p.sha256)throw Error('开发版不覆盖内置人物');
    const installed=library.installed;
    if(installed.get(id)===p.sha256&&(!inspectInstalled||inspected.get(id)?.sha256===p.sha256))return id;
    busy=true;controller=new AbortController();emit({id,status:localFile?'verifying':'downloading',received:0,total:p.bytes,message:localFile?'正在读取人物包':'正在下载人物包'});
    let temporary=null,failure=null;
    try{
      if(localFile)return await commit(localFile,p);
      const folder=path.join(data,'downloads');await fsp.mkdir(folder,{recursive:true});temporary=inside(folder,crypto.randomUUID()+'.partial');
      const response=await fetch(p.url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20*60*1000)]),cache:'no-store'});
      if(!response.ok)throw new Error(response.status===404?'人物包尚未发布，请稍后重试或从文件导入':`下载失败（HTTP ${response.status}）`);
      if(!response.body)throw new Error('下载响应没有内容');
      const handle=await fsp.open(temporary,'wx');let received=0,last=0;
      try{
        for await(const chunk of response.body){
          if(controller.signal.aborted)throw new Error('下载已取消');
          received+=chunk.byteLength;if(received>p.bytes)throw new Error('下载包大小超过清单');
          await handle.writeFile(chunk);
          if(Date.now()-last>200){emit({received});last=Date.now();}
        }
      }finally{await handle.close();}
      if(received!==p.bytes)throw new Error('下载中断或文件不完整，请重试');
      return await commit(temporary,p);
    }catch(error){failure=controller.signal.aborted?'下载已取消':error.message;throw new Error(failure);}
    finally{
      if(temporary)await fsp.rm(temporary,{force:true});busy=false;controller=null;
      emit(failure?{status:'error',message:failure}:{status:'idle',message:`${p.name}已安装`,received:p.bytes,total:p.bytes});
    }
  }
  async function importFile(file){
    const {header,size}=await readHeader(file);let added=false;
    if(!entries.has(header.id)&&allowUnlistedImport){
      const {fileHash}=require('./pack-format.cjs'),character=header.manifest.characters[0];
      entries.set(header.id,{id:header.id,name:character.name,bytes:size,sha256:await fileHash(file),actions:header.manifest.actions.map(a=>({id:a.id,title:a.title,role:a.role,frames:a.frames.length}))});added=true;
    }
    try{return await install(header.id,file);}catch(error){if(added)entries.delete(header.id);throw error;}
  }
  async function remove(id){
    if(busy)throw Error('已有一个人物包正在处理');
    if(!validId(id)||builtinIds.has(id))throw Error('内置人物不能删除');
    const index=readIndex(charactersDirectory),entry=index.installed?.[id];
    if(!entry)throw Error('人物包尚未安装');
    // Resolve and constrain both paths before any recursive removal or move.
    const relative=entry.directory?.replaceAll('\\','/');
    if(typeof relative!=='string'||!relative.startsWith(id+'/'))throw Error('人物安装路径不合法');
    const ownRoot=inside(charactersDirectory,id),target=inside(ownRoot,relative.slice(id.length+1)),base=fs.realpathSync(charactersDirectory);
    if(fs.existsSync(ownRoot)&&fs.lstatSync(ownRoot).isSymbolicLink())throw Error('人物安装路径不合法');
    if(fs.existsSync(target)&&(!fs.realpathSync(target).startsWith(path.join(base,id)+path.sep)||fs.lstatSync(target).isSymbolicLink()))throw Error('人物安装路径不合法');
    const trash=inside(charactersDirectory,'.removed/'+crypto.randomUUID()),file=path.join(charactersDirectory,'index.json'),temp=file+'.'+crypto.randomUUID()+'.tmp';
    let moved=false;
    busy=true;
    try{
      if(fs.existsSync(target)){fs.mkdirSync(path.dirname(trash),{recursive:true});if(fs.lstatSync(path.dirname(trash)).isSymbolicLink())throw Error('删除暂存路径不合法');for(let attempt=0;;attempt++){try{await fsp.rename(target,trash);break;}catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=12)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}moved=true;}
      delete index.installed[id];
      try{fs.writeFileSync(temp,JSON.stringify(index,null,2)+'\n');fs.renameSync(temp,file);}
      catch(error){if(moved)fs.renameSync(trash,target);throw error;}
      library=load();
      let cleanup='';
      if(moved)try{await fsp.rm(trash,{recursive:true,force:true,maxRetries:8,retryDelay:100});}catch{cleanup='，部分资源文件仍被占用，暂存于 .removed';}
      emit({id,status:cleanup?'error':'idle',message:`${entries.get(id)?.name||id}已删除${cleanup}`,received:0,total:0});
      return id;
    }finally{busy=false;fs.rmSync(temp,{force:true});}
  }
  async function checkUpdates(){
    if(busy)throw Error('已有一个人物包正在处理');
    busy=true;
    try{
      inspected.clear();library=load();
      const catalog=await fetchCatalog(catalogFetch),next=protectBuiltin(validateCatalog(catalog));
      const comparison=inspectInstalled?await inspectInstalled([...next.values()]):[];
      await fsp.mkdir(data,{recursive:true});
      const temporary=catalogFile+'.tmp';
      try{await fsp.writeFile(temporary,JSON.stringify(catalog,null,2)+'\n');await fsp.rename(temporary,catalogFile);}
      finally{await fsp.rm(temporary,{force:true});}
      entries=next;inspected=new Map(comparison.map(p=>[p.id,p]));onChange();return list();
    }finally{busy=false;}
  }
  return {list,install,importFile,remove,checkUpdates,get busy(){return busy;},cancel:()=>controller?.abort(),load:()=>{inspected.clear();library=load();return library;}};
}
module.exports={loadLibrary,createPackManager,inside};
