'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createPackManager,loadLibrary}=require('../app/character-packs.cjs');
const {MAGIC,readHeader}=require('../app/pack-format.cjs');
const {configure,defaults}=require('../app/model.cjs');
const IMAGE=Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQvPJUq/+BiOh/AAA=','base64');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const filename=`frames/${sha(IMAGE)}.webp`;
function manifest(id){
  const actions=['idle','grab','drop','wave'].map(kind=>({id:`${id}-${kind}`,title:kind,role:kind==='idle'?'idle':kind==='wave'?'action':'interaction',width:2,height:3,poster:filename,
    frames:[{file:filename,sha256:sha(IMAGE),durationMs:50},{file:filename,sha256:sha(IMAGE),durationMs:50}]}));
  return {version:3,frameVariant:'cleaned-v1',defaultCharacter:id,characters:[{id,name:id,actions:actions.map(a=>a.id),interactions:{grab:`${id}-grab`,drop:`${id}-drop`}}],actions};
}
function pack(change=()=>{}){
  const header={format:'qingzhu-character-v1',id:'remote',manifest:manifest('remote'),files:[{path:filename,sha256:sha(IMAGE),bytes:IMAGE.length}]};change(header);
  const json=Buffer.from(JSON.stringify(header)),length=Buffer.alloc(4);length.writeUInt32LE(json.length);
  return Buffer.concat([MAGIC,length,json,IMAGE]);
}
function fixture(t,bytes=pack(),fetch){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qz-pack-test-')),assets=path.join(root,'assets'),data=path.join(root,'data');
  t.after(()=>{assert.ok(root.startsWith(path.join(os.tmpdir(),'qz-pack-test-')));fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(assets,'frames'),{recursive:true});fs.writeFileSync(path.join(assets,filename),IMAGE);
  fs.writeFileSync(path.join(assets,'manifest.json'),JSON.stringify(manifest('builtin')));
  const entry={id:'remote',name:'Remote',sha256:sha(bytes),bytes:bytes.length,url:'https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/test/remote.qzpet'};
  fs.writeFileSync(path.join(assets,'character-packs.json'),JSON.stringify({packs:[entry]}));
  const manager=createPackManager({root,data,fetch:fetch||(async()=>({ok:true,body:[bytes]}))});
  return {root,data,assets,manager,bytes};
}
test('download installs only the selected cleaned character, survives restart and deletes partial downloads',async t=>{
  const f=fixture(t);assert.deepEqual(f.manager.load().manifest.characters.map(c=>c.id),['builtin']);
  await f.manager.install('remote');assert.equal(f.manager.list().entries[0].installed,true);
  const library=loadLibrary(f.root,f.data);assert.deepEqual(library.manifest.characters.map(c=>c.id),['builtin','remote']);
  assert.ok(library.manifest.actions.every(a=>a.frames.every(f=>!f.cleanedFile)));
  const a=library.manifest.actions.find(a=>a.id==='remote-idle');assert.deepEqual(fs.readFileSync(path.join(a.assetsRoot,a.frames[0].file)),IMAGE);
  assert.deepEqual(fs.readdirSync(path.join(f.data,'downloads')),[]);
});
test('corrupt downloaded content leaves installed characters intact and can be retried',async t=>{
  const expected=pack(),bad=Buffer.from(expected);bad[bad.length-1]^=1;let response=bad;
  const f=fixture(t,expected,async()=>({ok:true,body:[response]}));
  await assert.rejects(f.manager.install('remote'),/校验失败/);
  assert.equal(f.manager.list().entries[0].installed,false);assert.deepEqual(f.manager.load().manifest.characters.map(c=>c.id),['builtin']);
  response=expected;await f.manager.install('remote');assert.equal(f.manager.list().entries[0].installed,true);
});
test('truncated download cannot commit an installation',async t=>{
  const bytes=pack(),f=fixture(t,bytes,async()=>({ok:true,body:[bytes.subarray(0,40)]}));
  await assert.rejects(f.manager.install('remote'),/不完整/);assert.equal(f.manager.load().installed.has('remote'),false);
  assert.deepEqual(fs.readdirSync(path.join(f.data,'downloads')),[]);
  assert.equal(f.manager.list().transfer.manualDownload,true);assert.match(f.manager.list().transfer.message,/手动下载.*导入/);
});
test('cancelling a download removes partial content and keeps the default usable',async t=>{
  const bytes=pack(),f=fixture(t,bytes,async()=>({ok:true,body:(async function*(){yield bytes.subarray(0,10);await new Promise(r=>setTimeout(r,30));yield bytes.subarray(10);})()}));
  const pending=f.manager.install('remote');await new Promise(r=>setTimeout(r,10));f.manager.cancel();
  await assert.rejects(pending,/取消/);assert.equal(f.manager.load().installed.has('builtin'),true);assert.equal(f.manager.load().installed.has('remote'),false);
  assert.equal(f.manager.list().transfer.manualDownload,false);
  assert.deepEqual(fs.readdirSync(path.join(f.data,'downloads')),[]);
});
test('a malicious archive path is rejected before resources can escape the install directory',async t=>{
  const f=fixture(t,pack(h=>h.files[0].path='../escape.webp'));
  const local=path.join(f.root,'malicious.qzpet');fs.writeFileSync(local,f.bytes);
  await assert.rejects(f.manager.importFile(local),/非法文件路径/);assert.equal(fs.existsSync(path.join(f.root,'escape.webp')),false);
});
test('installed character with missing files is isolated and can be reinstalled',async t=>{
  const f=fixture(t);await f.manager.install('remote');const a=f.manager.load().manifest.actions.find(a=>a.id==='remote-idle');
  fs.unlinkSync(path.join(a.assetsRoot,a.frames[0].file));const broken=loadLibrary(f.root,f.data);
  assert.equal(broken.installed.has('remote'),false);assert.equal(broken.warnings.length,1);assert.equal(broken.installed.has('builtin'),true);
  const repaired=createPackManager({root:f.root,data:f.data,fetch:async()=>({ok:true,body:[f.bytes]})});await repaired.install('remote');assert.equal(repaired.load().installed.has('remote'),true);
});
test('oversized pack header is rejected before allocation',async t=>{
  const f=fixture(t),length=Buffer.alloc(4);length.writeUInt32LE(4*1024*1024+1);
  const file=path.join(f.root,'oversized.qzpet');fs.writeFileSync(file,Buffer.concat([MAGIC,length]));
  await assert.rejects(readHeader(file),/头过大/);
});
test('old disabled purification settings and new toggle patches cannot select original frames',()=>{
  const actions=manifest('builtin').actions;
  const migrated=configure({...defaults(),cleanNoise:false},{cleanNoise:false},actions);
  assert.equal('cleanNoise' in migrated,false);assert.equal('cleanNoise' in defaults(),false);
});
test('removing an installed package deletes only its resources, protects builtin and permits reinstall',async t=>{
  const f=fixture(t);await f.manager.install('remote');
  const folder=f.manager.load().manifest.actions.find(a=>a.id==='remote-idle').assetsRoot;
  assert.equal(f.manager.list().entries[0].removable,true);
  await assert.rejects(f.manager.remove('builtin'),/内置/);
  await f.manager.remove('remote');assert.equal(fs.existsSync(folder),false);
  assert.equal(f.manager.list().entries[0].installed,false);assert.equal(f.manager.list().entries[0].removable,false);
  assert.deepEqual(loadLibrary(f.root,f.data).manifest.characters.map(c=>c.id),['builtin']);
  assert.deepEqual(fs.readFileSync(path.join(f.assets,filename)),IMAGE);
  await f.manager.install('remote');assert.equal(f.manager.list().entries[0].installed,true);
});
test('removal rejects escaped index paths and restores resources when index commit fails',async t=>{
  const f=fixture(t);await f.manager.install('remote');
  const file=path.join(f.data,'characters/index.json'),original=fs.readFileSync(file),index=JSON.parse(original);
  for(const directory of ['../assets','remote/../../assets','remote/../other/package']){
    index.installed.remote.directory=directory;fs.writeFileSync(file,JSON.stringify(index));
    await assert.rejects(f.manager.remove('remote'),/路径/);
  }
  fs.writeFileSync(file,original);const folder=f.manager.load().manifest.actions.find(a=>a.id==='remote-idle').assetsRoot;
  const rename=fs.renameSync;let failed=false;
  t.mock.method(fs,'renameSync',(from,to)=>{if(to===file&&!failed){failed=true;throw Error('index write failed');}return rename(from,to);});
  await assert.rejects(f.manager.remove('remote'),/index write/);
  assert.deepEqual(fs.readFileSync(file),original);assert.deepEqual(fs.readFileSync(path.join(folder,filename)),IMAGE);
  assert.equal(f.manager.load().installed.has('remote'),true);
});

test('development can import an unpublished character; release builds reject it',async t=>{
 const f=fixture(t),bytes=pack(h=>{h.id='new-person';h.manifest=manifest('new-person');}),file=path.join(f.root,'new-person.qzpet');fs.writeFileSync(file,bytes);
 await assert.rejects(f.manager.importFile(file),/人物不存在/);
 const developer=createPackManager({root:f.root,data:f.data,allowUnlistedImport:true});
 await developer.importFile(file);assert.equal(developer.load().installed.has('new-person'),true);
 assert.equal(developer.list().entries.find(p=>p.id==='new-person').installed,true);
});

test('remote updates survive restart, keep the old installed folder and leave catalog intact on failure',async t=>{
 const f=fixture(t);await f.manager.install('remote');
 const original=f.manager.load().manifest.actions.find(a=>a.id==='remote-idle').assetsRoot;
 const nextBytes=pack(h=>{h.manifest.actions[0].frames[0].durationMs=80;});
 const catalog=JSON.parse(fs.readFileSync(path.join(f.assets,'character-packs.json')));
 catalog.packs[0]={...catalog.packs[0],sha256:sha(nextBytes),bytes:nextBytes.length,url:'https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/new/remote.qzpet'};
 let offline=false;
 const manager=createPackManager({root:f.root,data:f.data,fetch:async()=>({ok:true,body:[nextBytes]}),catalogFetch:async()=>{if(offline)throw Error('offline');return {ok:true,body:[Buffer.from(JSON.stringify(catalog))]};}});
 await manager.checkUpdates();assert.equal(manager.list().entries[0].updateAvailable,true);
 const restarted=createPackManager({root:f.root,data:f.data});assert.equal(restarted.list().entries[0].updateAvailable,true);
 await manager.install('remote');assert.equal(manager.list().entries[0].updateAvailable,false);assert.ok(fs.existsSync(original));
 assert.notEqual(manager.load().manifest.actions.find(a=>a.id==='remote-idle').assetsRoot,original);
 const cache=fs.readFileSync(path.join(f.data,'character-catalog.json'));offline=true;await assert.rejects(manager.checkUpdates(),/offline/);
 assert.deepEqual(fs.readFileSync(path.join(f.data,'character-catalog.json')),cache);
});

test('installed builds update builtin via data overlay, include new actions and leave bundled files untouched',async t=>{
 const f=fixture(t),original=fs.readFileSync(path.join(f.assets,'manifest.json'));
 const bytes=pack(h=>{h.id='builtin';h.manifest=manifest('builtin');const a=structuredClone(h.manifest.actions[3]);a.id='builtin-new-action';h.manifest.actions.push(a);h.manifest.characters[0].actions.push(a.id);});
 const catalog={version:1,packs:[{id:'builtin',name:'Builtin',bytes:bytes.length,sha256:sha(bytes),url:'https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/new/builtin.qzpet'}]};
 const manager=createPackManager({root:f.root,data:f.data,allowBuiltinUpdates:true,fetch:async()=>new Response(bytes),catalogFetch:async()=>new Response(JSON.stringify(catalog))});
 await manager.checkUpdates();await manager.install('builtin');const lib=manager.load();assert.equal(lib.manifest.characters.length,1);assert.ok(lib.manifest.actions.some(a=>a.id==='builtin-new-action'));assert.deepEqual(fs.readFileSync(path.join(f.assets,'manifest.json')),original);
 const restarted=createPackManager({root:f.root,data:f.data,allowBuiltinUpdates:true});assert.ok(restarted.load().manifest.actions.some(a=>a.id==='builtin-new-action'));
});

test('incompatible manifests and conflicting action IDs never replace an installed index',async t=>{
 const f=fixture(t);await f.manager.install('remote');const indexFile=path.join(f.data,'characters/index.json'),original=fs.readFileSync(indexFile);
 for(const change of [h=>{h.manifest.minAppVersion='999.0.0';},h=>{h.manifest.actions[3].id='builtin-wave';h.manifest.characters[0].actions[3]='builtin-wave';}]){
  const bytes=pack(change),catalog={version:1,packs:[{id:'remote',name:'Remote',bytes:bytes.length,sha256:sha(bytes),url:'https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/new/remote.qzpet'}]};
  const manager=createPackManager({root:f.root,data:f.data,appVersion:'0.3.0',fetch:async()=>new Response(bytes),catalogFetch:async()=>new Response(JSON.stringify(catalog))});
  await manager.checkUpdates();await assert.rejects(manager.install('remote'));assert.deepEqual(fs.readFileSync(indexFile),original);assert.ok(manager.load().installed.has('remote'));
 }
});

test('catalog minimum version and unknown pack formats are shown as incompatible',async t=>{
 const f=fixture(t),catalog=JSON.parse(fs.readFileSync(path.join(f.assets,'character-packs.json')));catalog.packs[0].minAppVersion='0.10.0';
 const manager=createPackManager({root:f.root,data:f.data,appVersion:'0.9.0',catalogFetch:async()=>new Response(JSON.stringify(catalog))});await manager.checkUpdates();assert.equal(manager.list().entries[0].compatible,false);await assert.rejects(manager.install('remote'),/先更新软件/);
 delete catalog.packs[0].minAppVersion;catalog.packs[0].packFormat='future-v2';await manager.checkUpdates();assert.equal(manager.list().entries[0].compatible,false);
});

test('temporary Windows file locks are retried before committing a character update',async t=>{
 const f=fixture(t),rename=fs.promises.rename;let blocked=0;
 t.mock.method(fs.promises,'rename',async(from,to)=>{if(from.includes('.staging')&&blocked++<2)throw Object.assign(Error('scanner lock'),{code:'EPERM'});return rename(from,to);});
 await f.manager.install('remote');assert.ok(f.manager.load().installed.has('remote'));assert.ok(blocked>=3);
});

test('index commit failure retains the old package and removes uncommitted replacement',async t=>{
 const f=fixture(t);await f.manager.install('remote');const indexFile=path.join(f.data,'characters/index.json'),before=fs.readFileSync(indexFile),folders=fs.readdirSync(path.join(f.data,'characters/remote'));
 const bytes=pack(h=>{h.manifest.actions[0].frames[0].durationMs=70;}),catalog=JSON.parse(fs.readFileSync(path.join(f.assets,'character-packs.json')));catalog.packs[0].sha256=sha(bytes);catalog.packs[0].bytes=bytes.length;
 const manager=createPackManager({root:f.root,data:f.data,fetch:async()=>new Response(bytes),catalogFetch:async()=>new Response(JSON.stringify(catalog))});await manager.checkUpdates();
 const rename=fs.promises.rename;t.mock.method(fs.promises,'rename',async(from,to)=>{if(to===indexFile)throw Object.assign(Error('disk full'),{code:'ENOSPC'});return rename(from,to);});
 await assert.rejects(manager.install('remote'),/disk full/);assert.deepEqual(fs.readFileSync(indexFile),before);assert.deepEqual(fs.readdirSync(path.join(f.data,'characters/remote')),folders);assert.equal(fs.existsSync(indexFile+'.tmp'),false);
});

test('development compares actual content instead of stale install hashes and can pull over local edits',async t=>{
 const {buildCharacter,scanCharacters}=require('../developer/pack-builder.cjs'),f=fixture(t);await f.manager.install('remote');
 const directory=path.join(f.data,'characters'),built=await buildCharacter(directory,'remote'),catalog={version:1,packs:[{...built.entry,url:'https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/test/remote.qzpet'}]};
 const indexFile=path.join(directory,'index.json'),before=fs.readFileSync(indexFile);
 const manager=createPackManager({root:f.root,data:f.data,fetch:async()=>new Response(built.bytes),catalogFetch:async()=>new Response(JSON.stringify(catalog)),inspectInstalled:entries=>scanCharacters(directory,{packs:entries},new Set(['builtin']))});
 assert.equal(manager.list().entries[0].updateAvailable,false);await manager.checkUpdates();assert.equal(manager.list().entries[0].updateAvailable,false);assert.deepEqual(fs.readFileSync(indexFile),before);
 const index=JSON.parse(before);index.installed.remote.sha256=built.entry.sha256;fs.writeFileSync(indexFile,JSON.stringify(index));
 const manifestFile=path.join(directory,index.installed.remote.directory,'manifest.json'),local=JSON.parse(fs.readFileSync(manifestFile));local.actions[0].frames[0].durationMs=90;fs.writeFileSync(manifestFile,JSON.stringify(local));
 await manager.checkUpdates();assert.equal(manager.list().entries[0].updateAvailable,true);
 await manager.install('remote');assert.equal(manager.load().manifest.actions.find(a=>a.id==='remote-idle').frames[0].durationMs,50);
});
