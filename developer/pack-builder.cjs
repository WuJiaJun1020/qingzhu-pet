'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {MAGIC,validateHeader,MAX_BYTES}=require('../app/pack-format.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function contained(base,relative){
  const root=await fs.realpath(base),file=await fs.realpath(path.resolve(root,relative));
  if(!file.startsWith(root+path.sep))throw Error('人物资源路径越界');
  return file;
}
// Normalize repaired filenames back to content addresses. This is the same
// package format as pack_characters.py; no image is encoded or changed here.
async function buildCharacter(directory,id){
  const index=JSON.parse(await fs.readFile(path.join(directory,'index.json'),'utf8'));
  const record=index.installed?.[id];if(!record)throw Error('未安装人物：'+id);
  const folder=await contained(directory,record.directory);
  const manifestPath=await contained(folder,'manifest.json');
  const source=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  if(source.frameVariant!=='cleaned-v1'||source.characters?.length!==1||source.characters[0].id!==id)throw Error('人物清单不一致');
  const character=source.characters[0],actions=new Map(source.actions.map(a=>[a.id,a])),files=new Map();
  const manifest={version:3,name:character.name,frameVariant:'cleaned-v1',defaultCharacter:id,characters:[structuredClone(character)],actions:[]};
  if(source.minAppVersion)manifest.minAppVersion=source.minAppVersion;
  let total=0;const readFiles=new Map();
  async function frameFile(relative,expected){
    const name='frames/'+expected+'.webp';
    let cached=readFiles.get(relative);
    if(!cached){
      const file=await fs.realpath(path.resolve(folder,relative));
      if(!file.startsWith(folder+path.sep))throw Error('人物资源路径越界');
      const bytes=await fs.readFile(file);
      if(path.extname(file)!=='.webp')throw Error('只支持 WebP 帧');
      cached={bytes,sha256:hash(bytes)};readFiles.set(relative,cached);
    }
    if(cached.sha256!==expected)throw Error('帧校验失败：'+id+' / '+relative);
    if(!files.has(name)){files.set(name,cached.bytes);total+=cached.bytes.length;if(total>MAX_BYTES)throw Error('人物包过大');}
    return name;
  }
  for(const aid of character.actions){
    const action=structuredClone(actions.get(aid));if(!action)throw Error('缺少动作：'+aid);
    delete action.source;delete action.processedOutput;
    for(let i=0;i<action.frames.length;i++){
      const f=action.frames[i],sha=f.cleanedSha256||f.sha256;
      const output={file:await frameFile(f.cleanedFile||f.file,sha),sha256:sha,durationMs:f.durationMs};
      if(f.edgeMaskFile){output.edgeMaskFile=await frameFile(f.edgeMaskFile,f.edgeMaskSha256);output.edgeMaskSha256=f.edgeMaskSha256;}
      action.frames[i]=output;
    }
    action.poster=action.frames[0].file;manifest.actions.push(action);
  }
  const records=[...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:hash(bytes)}));
  const header={format:'qingzhu-character-v1',id,manifest,files:records};validateHeader(header);
  const encoded=Buffer.from(JSON.stringify(header)),length=Buffer.alloc(4);length.writeUInt32LE(encoded.length);
  if(encoded.length>4*1024**2)throw Error('人物包清单过大');
  const bytes=Buffer.concat([MAGIC,length,encoded,...records.map(r=>files.get(r.path))]);
  if(bytes.length>MAX_BYTES)throw Error('人物包过大');
  const sha256=hash(bytes);
  return {bytes,entry:{id,name:character.name,sha256,bytes:bytes.length,packFormat:'qingzhu-character-v1',...(manifest.minAppVersion?{minAppVersion:manifest.minAppVersion}:{}),actions:manifest.actions.map(a=>({id:a.id,title:a.title,role:a.role,frames:a.frames.length}))}};
}
async function scanCharacters(directory,catalog,builtinIds,onProgress=()=>{}){
  const index=JSON.parse(await fs.readFile(path.join(directory,'index.json'),'utf8')),rows=[];
  for(const id of Object.keys(index.installed||{})){
    if(builtinIds.has(id))continue;
    const p=catalog.packs.find(p=>p.id===id);
    onProgress('检查 '+(p?.name||id));
    try{const built=await buildCharacter(directory,id);rows.push({...built.entry,previousSha:p?.sha256||null,isNew:!p,changed:built.entry.sha256!==p?.sha256});}
    catch(error){rows.push({id,name:p?.name||id,error:error.message,changed:false});}
  }
  return rows;
}
module.exports={buildCharacter,scanCharacters,hash};
