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
});
test('cancelling a download removes partial content and keeps the default usable',async t=>{
  const bytes=pack(),f=fixture(t,bytes,async()=>({ok:true,body:(async function*(){yield bytes.subarray(0,10);await new Promise(r=>setTimeout(r,30));yield bytes.subarray(10);})()}));
  const pending=f.manager.install('remote');await new Promise(r=>setTimeout(r,10));f.manager.cancel();
  await assert.rejects(pending,/取消/);assert.equal(f.manager.load().installed.has('builtin'),true);assert.equal(f.manager.load().installed.has('remote'),false);
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
