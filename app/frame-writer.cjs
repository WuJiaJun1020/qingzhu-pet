'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inside(root,relative){
  const file=path.resolve(root,relative);
  if(!file.startsWith(path.resolve(root)+path.sep))throw Error('帧路径不合法');
  return file;
}
function atomic(file,bytes){
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,bytes);fs.renameSync(temporary,file);}
  finally{fs.rmSync(temporary,{force:true});}
}
function createFrameWriter({data,roots}){
  const transactions=path.join(data,'frame-writes');fs.mkdirSync(transactions,{recursive:true});
  const allowed=file=>roots.some(root=>path.resolve(file).startsWith(path.resolve(root)+path.sep));
  function rollback(folder,entries){
    for(const entry of [...entries].reverse()){
      if(!allowed(entry.file))throw Error('修补恢复路径不合法');
      if(entry.existed)atomic(entry.file,fs.readFileSync(inside(folder,entry.backup)));
      else fs.rmSync(entry.file,{force:true});
    }
  }
  // An interrupted save is rolled back before any manifest is loaded.
  for(const name of fs.readdirSync(transactions)){
    const folder=inside(transactions,name),journal=path.join(folder,'journal.json');
    if(!fs.existsSync(journal))continue;
    const record=JSON.parse(fs.readFileSync(journal,'utf8'));
    if(record.state==='pending'){rollback(folder,record.entries);atomic(journal,JSON.stringify({...record,state:'rolled-back'}));}
  }
  let busy=false;
  async function saveBatch(items){
    if(busy)throw Error('正在保存修补，请稍候');
    if(!Array.isArray(items)||!items.length||items.length>2048||items.reduce((n,i)=>n+(i?.erased?.length||0),0)>134217728)throw Error('修补数据过大或格式不正确');
    busy=true;
    try{
      const sharp=require('sharp');
      const manifests=new Map(),writes=new Map(),seen=new Set(),updated=[];
      for(const {action,index,expectedSha,erased} of items){
        if(!action||!Number.isInteger(index)||index<0||index>=action.frames.length)throw Error('帧编号不合法');
        const manifestFile=path.join(action.assetsRoot,'manifest.json');
        if(!allowed(manifestFile))throw Error('人物资源目录不合法');
        let group=manifests.get(manifestFile);
        if(!group){const original=fs.readFileSync(manifestFile);group={original,manifest:JSON.parse(original),root:action.assetsRoot};manifests.set(manifestFile,group);}
        const originalManifest=JSON.parse(group.original),clip=group.manifest.actions.find(a=>a.id===action.id),frame=clip?.frames[index];
        const key=manifestFile+':'+action.id+':'+index;
        if(seen.has(key))throw Error('本批包含重复帧');seen.add(key);
        if(!frame||frame.sha256!==expectedSha||action.frames[index].sha256!==expectedSha)throw Error('原帧已更新，请重新打开修补工具');
        if(!Number.isInteger(clip.width)||!Number.isInteger(clip.height)||clip.width*clip.height>4194304||!(erased instanceof Uint8Array)||erased.length!==clip.width*clip.height)throw Error('修补像素数据不合法');
        const source=inside(group.root,frame.file);
        if(path.extname(source).toLowerCase()!=='.webp')throw Error('只能修补人物包中的 WebP 帧');
        const before=fs.readFileSync(source);
        if(hash(before)!==expectedSha)throw Error('原帧校验失败，停止保存');
        const {data:pixels,info}=await sharp(before).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        if(info.width!==clip.width||info.height!==clip.height||info.channels!==4)throw Error('原帧尺寸不匹配');
        let changed=false;
        for(let p=0;p<erased.length;p++){const alpha=Math.round(pixels[p*4+3]*(255-erased[p])/255);changed||=alpha!==pixels[p*4+3];pixels[p*4+3]=alpha;}
        if(!changed){updated.push({actionId:action.id,index,sha256:expectedSha});continue;}
        const encoded=await sharp(pixels,{raw:info}).webp({lossless:true,effort:4}).toBuffer();
        const sha256=hash(encoded);
        // Content-deduplicated frames may be shared by other animation positions.
        const shared=originalManifest.actions.reduce((n,a)=>n+a.frames.filter(f=>f.file===frame.file).length,0)>1;
        const destination=shared?inside(group.root,path.join(path.dirname(frame.file),'edited-'+crypto.randomUUID()+'.webp')):source;
        writes.set(destination,{bytes:encoded,before:destination===source?before:null});
        frame.file=path.relative(group.root,destination).split(path.sep).join('/');frame.sha256=sha256;
        updated.push({actionId:action.id,index,sha256});
      }
      if(!writes.size)return {frames:items.length,updated};
      for(const [file,group] of manifests)writes.set(file,{bytes:Buffer.from(JSON.stringify(group.manifest,null,2)+'\n'),before:group.original});
      // Recheck after async encoding; never overwrite a concurrently changed file.
      for(const [file,item] of writes){
        if(item.before&&!fs.readFileSync(file).equals(item.before))throw Error('资源在保存期间发生变化，请重新打开修补工具');
        if(!item.before&&fs.existsSync(file))throw Error('新帧路径已存在');
      }
      const folder=path.join(transactions,crypto.randomUUID());fs.mkdirSync(folder);
      const entries=[...writes].map(([file,item],i)=>{
        const backup=i+'.before';if(item.before)fs.writeFileSync(path.join(folder,backup),item.before);
        return {file,existed:!!item.before,backup};
      });
      const journal=path.join(folder,'journal.json');atomic(journal,JSON.stringify({state:'pending',entries}));
      try{
        for(const [file,item] of writes)atomic(file,item.bytes);
        atomic(journal,JSON.stringify({state:'committed',entries}));
      }catch(error){rollback(folder,entries);atomic(journal,JSON.stringify({state:'rolled-back',entries}));throw error;}
      return {frames:items.length,updated};
    }finally{busy=false;}
  }
  return {saveBatch,get busy(){return busy;}};
}
module.exports={createFrameWriter};
