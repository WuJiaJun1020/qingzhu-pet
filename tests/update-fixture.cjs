'use strict';
// Used only by --verify-client --verify-installed in the current test client.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {MAGIC}=require('../app/pack-format.cjs');
const {CATALOG_URL}=require('../app/remote-catalog.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
module.exports=({root,charactersDirectory})=>{
 const index=JSON.parse(fs.readFileSync(path.join(charactersDirectory,'index.json')));
 const folder=path.join(charactersDirectory,index.installed.meining.directory),source=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
 const idle=source.actions.find(a=>a.role==='idle'),frame=idle.frames[0],image=fs.readFileSync(path.join(folder,frame.file)),file='frames/'+sha(image)+'.webp';
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'assets/character-packs.json'))),downloads=new Map();
 for(const p of catalog.packs)if(index.installed[p.id])p.sha256=index.installed[p.id].sha256;
 function make(id,name){
  const actions=['idle','grab','drop','update-test'].map(kind=>({id:id+'-'+kind,title:kind==='update-test'?'更新新增动作':kind,role:kind==='idle'?'idle':['grab','drop'].includes(kind)?'interaction':'action',width:idle.width,height:idle.height,poster:file,frames:[{file,sha256:sha(image),durationMs:100},{file,sha256:sha(image),durationMs:100}]}));
  const manifest={version:3,frameVariant:'cleaned-v1',defaultCharacter:id,characters:[{id,name,actions:actions.map(a=>a.id),interactions:{grab:id+'-grab',drop:id+'-drop'}}],actions};
  const header=Buffer.from(JSON.stringify({format:'qingzhu-character-v1',id,manifest,files:[{path:file,sha256:sha(image),bytes:image.length}]})),size=Buffer.alloc(4);size.writeUInt32LE(header.length);
  const bytes=Buffer.concat([MAGIC,size,header,image]),url='https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/update-fixture/'+id+'.qzpet';
  downloads.set(url,bytes);return {id,name,url,sha256:sha(bytes),bytes:bytes.length,actions:actions.map(a=>({id:a.id,title:a.title,role:a.role,frames:2}))};
 }
 catalog.packs[catalog.packs.findIndex(p=>p.id==='meining')]=make('meining','梅凝');catalog.packs.push(make('update-demo','更新验收新人物'));
 const installer=Buffer.from('MZ -- non-executable update verification fixture --'),name='qingzhu-pet-999.0.0-windows-x64-setup.exe',url='https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/v999.0.0/'+name;
 downloads.set(url,installer);
 const releases=[{tag_name:'characters-20990101',assets:[]},{tag_name:'v999.0.0',draft:false,prerelease:false,assets:[{name,state:'uploaded',browser_download_url:url,size:installer.length,digest:'sha256:'+sha(installer)}]}];
 const failedOnce=new Set();
 return {fetch:async url=>{if(url===CATALOG_URL)return new Response(JSON.stringify(catalog));if(url.startsWith('https://api.github.com/repos/WuJiaJun1020/qingzhu-pet/releases?'))return new Response(JSON.stringify(releases));throw Error('验收禁止真实联网：'+url);},download:async url=>{
  if(!downloads.has(url))throw Error('验收缺少下载样本：'+url);
  if((url.endsWith('update-demo.qzpet')||url.endsWith('.exe'))&&!failedOnce.has(url)){failedOnce.add(url);throw Error('GitHub 暂时限流，请稍后手动重试');}
  return new Response(downloads.get(url));
 }};
};
