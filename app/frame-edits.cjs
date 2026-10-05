'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const zlib=require('node:zlib');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const MAX_PIXELS=4194304;
function identity(action,index){
  if(!/^[a-z0-9][a-z0-9-]{0,99}$/.test(action.id)||!Number.isInteger(index)||index<0||index>=action.frames.length)throw Error('动画或帧编号不合法');
  if(!Number.isInteger(action.width)||!Number.isInteger(action.height)||action.width<1||action.height<1||action.width*action.height>MAX_PIXELS)throw Error('素材尺寸不支持');
  const frame=action.frames[index];if(!/^[a-f0-9]{64}$/.test(frame.sha256))throw Error('原帧校验信息缺失');
  return {key:hash(action.id+':'+index),baseSha256:frame.sha256,width:action.width,height:action.height};
}
function createFrameEdits(data,encodeMask){
  const base=path.join(data,'frame-edits'),records=path.join(base,'records'),masks=path.join(base,'masks'),saved=new Map();
  fs.mkdirSync(records,{recursive:true});fs.mkdirSync(masks,{recursive:true});
  for(const file of fs.readdirSync(records))if(/^[a-f0-9]{64}\.json$/.test(file))try{
    const r=JSON.parse(fs.readFileSync(path.join(records,file),'utf8'));
    if(r.version===1||r.version===2)saved.set(file.slice(0,-5),r);
  }catch{/* A corrupt local correction never prevents the original from playing. */}
  function read(action,index){
    const id=identity(action,index),r=saved.get(id.key),empty=()=>({erased:new Uint8Array(id.width*id.height),maskFile:null});
    if(!r||r.actionId!==action.id||r.index!==index||r.baseSha256!==id.baseSha256||r.width!==id.width||r.height!==id.height)return empty();
    if(r.erased==='')return empty();
    if(typeof r.erased!=='string'||r.erased.length>Math.ceil(MAX_PIXELS*4/3)+4||!/^[a-f0-9]{64}\.png$/.test(r.maskFile||''))return empty();
    let bits;
    try{const bytes=Buffer.from(r.erased,'base64');bits=r.encoding==='deflate-raw'?zlib.inflateRawSync(bytes,{maxOutputLength:id.width*id.height}):bytes;}catch{return empty();}
    if(bits.length!==id.width*id.height||(r.version===1&&bits.some(v=>v>1))||!fs.existsSync(path.join(masks,r.maskFile)))return empty();
    return {erased:Uint8Array.from(bits,v=>r.version===1?v*255:v),maskFile:path.join(masks,r.maskFile)};
  }
  function validate(action,index,expectedSha,erased){
    const id=identity(action,index);
    if(expectedSha!==id.baseSha256)throw Error('原帧已更新，请重新打开修补工具');
    if(!(erased instanceof Uint8Array)||erased.length!==id.width*id.height)throw Error('修补像素数据不合法');
    if(hash(fs.readFileSync(path.resolve(action.assetsRoot,action.frames[index].file)))!==id.baseSha256)throw Error('原帧校验失败，停止保存');
    return id;
  }
  function persist(action,index,erased,id){
    let maskFile=null;
    if(erased.some(Boolean)){
      const png=encodeMask(id.width,id.height,erased);maskFile=hash(png)+'.png';
      const destination=path.join(masks,maskFile);if(!fs.existsSync(destination))fs.writeFileSync(destination,png,{flag:'wx'});
    }
    const record={version:2,actionId:action.id,index,baseSha256:id.baseSha256,width:id.width,height:id.height,maskFile,encoding:'deflate-raw',erased:maskFile?zlib.deflateRawSync(erased).toString('base64'):''};
    const file=path.join(records,id.key+'.json'),temp=file+'.'+crypto.randomUUID()+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(record));fs.renameSync(temp,file);saved.set(id.key,record);
    return {erasedPixels:erased.reduce((sum,v)=>sum+Number(v>0),0)};
  }
  function save(action,index,expectedSha,erased){return persist(action,index,erased,validate(action,index,expectedSha,erased));}
  function saveBatch(items){
    const seen=new Set();
    const prepared=items.map(item=>{
      const id=validate(item.action,item.index,item.expectedSha,item.erased);
      if(seen.has(id.key))throw Error('本批包含重复帧');seen.add(id.key);
      return {...item,id,previous:saved.get(id.key)};
    });
    try{for(const item of prepared)persist(item.action,item.index,item.erased,item.id);}
    catch(error){
      for(const item of prepared){
        const file=path.join(records,item.id.key+'.json');
        if(item.previous){const temp=file+'.rollback.tmp';fs.writeFileSync(temp,JSON.stringify(item.previous));fs.renameSync(temp,file);saved.set(item.id.key,item.previous);}
        else{fs.rmSync(file,{force:true});saved.delete(item.id.key);}
      }
      throw error;
    }
    return {frames:prepared.length};
  }
  function decorate(action,toUrl){
    const versions=[];
    action.frames.forEach((frame,index)=>{
      delete frame.repairMaskUrl;
      const r=saved.get(hash(action.id+':'+index));if(!r?.maskFile)return;
      const result=read(action,index);
      if(result.maskFile){frame.repairMaskUrl=toUrl(result.maskFile);versions.push(index+':'+path.basename(result.maskFile));}
    });
    return versions.length?':repair-'+hash(versions.join('|')).slice(0,16):'';
  }
  return {read,save,saveBatch,decorate};
}
module.exports={createFrameEdits,identity};
