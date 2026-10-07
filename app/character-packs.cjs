'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {extractPack,readHeader,validId,MAX_BYTES}=require('./pack-format.cjs');
const {createCharacterCatalog}=require('./characters.cjs');
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
function loadLibrary(root,data,directory=path.join(data,'characters')){
  const builtin=withAssets(JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'),'utf8')),path.join(root,'assets'));
  const result={...builtin,actions:[...builtin.actions],characters:[...builtin.characters]},installed=new Map(),warnings=[];
  for(const c of builtin.characters)installed.set(c.id,builtin.packSha256);
  for(const [id,entry] of Object.entries(readIndex(directory).installed||{})){
    try{
      if(!validId(id)||installed.has(id)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('人物安装记录不合法');
      const folder=inside(directory,entry.directory);
      const manifest=withAssets(JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')),folder);
      if(manifest.characters.length!==1||manifest.characters[0].id!==id)throw new Error('人物安装记录不一致');
      createCharacterCatalog({...result,actions:[...result.actions,...manifest.actions],characters:[...result.characters,...manifest.characters]});
      result.actions.push(...manifest.actions);result.characters.push(...manifest.characters);installed.set(id,entry.sha256);
    }catch(error){warnings.push(`${id}：${error.message}`);}
  }
  return {manifest:result,installed,warnings};
}
function createPackManager({root,data,charactersDirectory=path.join(data,'characters'),fetch,onChange=()=>{}}){
  const builtinIds=new Set(JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'),'utf8')).characters.map(c=>c.id));
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'assets/character-packs.json'),'utf8'));
  const entries=new Map();
  for(const p of catalog.packs){
    const url=new URL(p.url);
    if(!validId(p.id)||entries.has(p.id)||!Number.isInteger(p.bytes)||p.bytes<1||p.bytes>MAX_BYTES||!/^[a-f0-9]{64}$/.test(p.sha256)||url.origin!=='https://github.com'||!url.pathname.startsWith('/WuJiaJun1020/qingzhu-pet/releases/download/'))throw new Error('人物下载清单不合法');
    entries.set(p.id,p);
  }
  let transfer={status:'idle'},controller=null,busy=false,library=loadLibrary(root,data,charactersDirectory);
  const emit=value=>{transfer={...transfer,...value};onChange();};
  const list=()=>{
    return {transfer,warnings:library.warnings,entries:[...entries.values()].map(p=>({...p,installed:library.installed.has(p.id),removable:library.installed.has(p.id)&&!builtinIds.has(p.id),updateAvailable:library.installed.has(p.id)&&library.installed.get(p.id)!==p.sha256}))};
  };
  async function commit(file,p){
    emit({status:'verifying',message:'正在校验人物资源'});
    const base=charactersDirectory,staging=inside(base,'.staging/'+crypto.randomUUID());
    await fsp.mkdir(staging,{recursive:true});
    try{
      emit({status:'installing',message:'正在安装人物'});
      await extractPack(file,staging,p,{signal:controller?.signal});
      if(controller?.signal.aborted)throw new Error('下载已取消');
      const relative=`${p.id}/${p.sha256.slice(0,16)}-${crypto.randomUUID()}`,target=inside(base,relative);
      await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.rename(staging,target);
      const index=readIndex(charactersDirectory);index.installed[p.id]={directory:relative,sha256:p.sha256};
      const temp=path.join(base,'index.json.tmp');await fsp.writeFile(temp,JSON.stringify(index,null,2)+'\n');await fsp.rename(temp,path.join(base,'index.json'));
      library=loadLibrary(root,data,charactersDirectory);
      return p.id;
    }catch(error){await fsp.rm(staging,{recursive:true,force:true});throw error;}
  }
  async function install(id,localFile){
    if(busy)throw new Error('已有一个人物包正在处理');
    const p=entries.get(id);if(!p)throw new Error('人物不存在');
    const installed=library.installed;
    if(installed.get(id)===p.sha256)return id;
    busy=true;controller=new AbortController();emit({id,status:localFile?'verifying':'downloading',received:0,total:p.bytes,message:localFile?'正在读取人物包':'正在下载人物包'});
    let temporary=null,failure=null;
    try{
      if(localFile)return await commit(localFile,p);
      const folder=path.join(data,'downloads');await fsp.mkdir(folder,{recursive:true});temporary=inside(folder,crypto.randomUUID()+'.partial');
      const response=await fetch(p.url,{signal:controller.signal,cache:'no-store'});
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
  async function importFile(file){const {header}=await readHeader(file);return install(header.id,file);}
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
      library=loadLibrary(root,data,charactersDirectory);
      let cleanup='';
      if(moved)try{await fsp.rm(trash,{recursive:true,force:true,maxRetries:8,retryDelay:100});}catch{cleanup='，部分资源文件仍被占用，暂存于 .removed';}
      emit({id,status:cleanup?'error':'idle',message:`${entries.get(id)?.name||id}已删除${cleanup}`,received:0,total:0});
      return id;
    }finally{busy=false;fs.rmSync(temp,{force:true});}
  }
  return {list,install,importFile,remove,cancel:()=>controller?.abort(),load:()=>{library=loadLibrary(root,data,charactersDirectory);return library;}};
}
module.exports={loadLibrary,createPackManager,inside};
