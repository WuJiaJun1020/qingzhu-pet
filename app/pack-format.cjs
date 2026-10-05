'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createCharacterCatalog}=require('./characters.cjs');
const MAGIC=Buffer.from('QZPET1\n'),MAX_BYTES=512*1024*1024,MAX_HEADER=4*1024*1024;
const validId=id=>typeof id==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(id);
function relativeFile(name){
  if(typeof name!=='string'||!/^frames\/[a-f0-9]{64}\.webp$/.test(name))throw new Error('人物包包含非法文件路径');
  return name;
}
function imageSize(bytes){
  if(bytes.length<25||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw new Error('人物包必须使用无损 WebP');
  for(let offset=12;offset+8<=bytes.length;){
    const length=bytes.readUInt32LE(offset+4),data=offset+8;
    if(data+length>bytes.length)throw new Error('图片数据不完整');
    if(bytes.toString('ascii',offset,offset+4)==='VP8L'){
      if(length<5||bytes[data]!==0x2f)throw new Error('无损图片头不合法');
      const bits=bytes.readUInt32LE(data+1);return [(bits&0x3fff)+1,((bits>>>14)&0x3fff)+1];
    }
    offset=data+length+(length%2);
  }
  throw new Error('人物包包含有损图片');
}
function validateHeader(header){
  if(header?.format!=='qingzhu-character-v1'||!validId(header.id)||!Array.isArray(header.files)||!header.files.length||header.files.length>20000)throw new Error('人物包格式不正确');
  const m=header.manifest;
  if(m?.frameVariant!=='cleaned-v1'||m.characters?.length!==1||m.characters[0].id!==header.id||m.defaultCharacter!==header.id)throw new Error('人物包不是净化版或人物编号不一致');
  createCharacterCatalog(m);
  const files=new Map();let total=0;
  for(const f of header.files){
    relativeFile(f.path);
    if(files.has(f.path)||!Number.isInteger(f.bytes)||f.bytes<25||f.bytes>32*1024*1024||!/^[a-f0-9]{64}$/.test(f.sha256)||f.path!==`frames/${f.sha256}.webp`)throw new Error('人物包的文件清单不合法');
    files.set(f.path,f);total+=f.bytes;
  }
  if(total>MAX_BYTES)throw new Error('人物包超出大小限制');
  const referenced=new Set();let frames=0;
  for(const a of m.actions){
    if(!Number.isInteger(a.width)||!Number.isInteger(a.height)||a.width<1||a.height<1||a.width*a.height>16*1024*1024||!a.frames.length)throw new Error('人物动画尺寸不合法');
    relativeFile(a.poster);if(!files.has(a.poster))throw new Error('缺少人物预览');referenced.add(a.poster);
    for(const f of a.frames){
      if(f.cleanedFile||f.cleanedSha256||f.cleanedUrl||!Number.isFinite(f.durationMs)||f.durationMs<=0||f.durationMs>60000)throw new Error('人物包不能包含原始/净化对照版本');
      relativeFile(f.file);if(files.get(f.file)?.sha256!==f.sha256)throw new Error('帧文件与清单不一致');referenced.add(f.file);
      if(f.edgeMaskFile){relativeFile(f.edgeMaskFile);if(files.get(f.edgeMaskFile)?.sha256!==f.edgeMaskSha256)throw new Error('遮罩文件与清单不一致');referenced.add(f.edgeMaskFile);}
      frames++;
    }
  }
  if(frames>20000||referenced.size!==files.size)throw new Error('人物包存在未引用文件或帧数过多');
  return header;
}
async function readExact(handle,size,position){
  const buffer=Buffer.alloc(size);let read=0;
  while(read<size){const {bytesRead}=await handle.read(buffer,read,size-read,position+read);if(!bytesRead)throw new Error('人物包不完整');read+=bytesRead;}
  return buffer;
}
async function readHeader(file){
  const handle=await fs.open(file,'r');
  try{
    const head=await readExact(handle,MAGIC.length+4,0);
    if(!head.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('不是青竹桌宠人物包');
    const length=head.readUInt32LE(MAGIC.length);
    if(length<1||length>MAX_HEADER)throw new Error('人物包头过大');
    const header=validateHeader(JSON.parse((await readExact(handle,length,head.length)).toString('utf8')));
    const offset=head.length+length,size=(await handle.stat()).size;
    if(size>MAX_BYTES||offset+header.files.reduce((s,f)=>s+f.bytes,0)!==size)throw new Error('人物包大小不一致');
    return {header,offset,size};
  }finally{await handle.close();}
}
async function fileHash(file){
  const hash=crypto.createHash('sha256');for await(const chunk of require('node:fs').createReadStream(file))hash.update(chunk);return hash.digest('hex');
}
async function extractPack(file,directory,expected,{signal}={}){
  const cancelled=()=>{if(signal?.aborted)throw new Error('下载已取消');};
  cancelled();
  const {header,offset,size}=await readHeader(file);
  if(header.id!==expected.id||size!==expected.bytes||await fileHash(file)!==expected.sha256)throw new Error('人物包校验失败，请重新下载');
  const handle=await fs.open(file,'r');let position=offset;
  try{
    for(const record of header.files){
      cancelled();
      const bytes=await readExact(handle,record.bytes,position);position+=record.bytes;
      if(crypto.createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw new Error('帧校验失败');
      const size=imageSize(bytes);
      for(const action of header.manifest.actions){
        if(action.poster===record.path||action.frames.some(f=>f.file===record.path||f.edgeMaskFile===record.path))
          if(size[0]!==action.width||size[1]!==action.height)throw new Error('帧尺寸与动画不一致');
      }
      const target=path.resolve(directory,relativeFile(record.path));
      if(!target.startsWith(path.resolve(directory)+path.sep))throw new Error('非法资源路径');
      await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});
    }
    cancelled();
    await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(header.manifest,null,2)+'\n',{flag:'wx'});
    return header.manifest;
  }finally{await handle.close();}
}
module.exports={MAGIC,MAX_BYTES,validId,relativeFile,imageSize,validateHeader,readHeader,fileHash,extractPack};
