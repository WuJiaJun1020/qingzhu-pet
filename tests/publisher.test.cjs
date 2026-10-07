'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {buildCharacter,scanCharacters,hash}=require('../developer/pack-builder.cjs');
const {createPublisher,mergePublication}=require('../developer/publisher.cjs');
const {fetchCatalog,validateCatalog}=require('../app/remote-catalog.cjs');
const IMAGE=Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQvPJUq/+BiOh/AAA=','base64');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'qz-publisher-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'characters'),folder=path.join(directory,'remote/v1');await fs.mkdir(folder,{recursive:true});
 await fs.writeFile(path.join(directory,'index.json'),JSON.stringify({installed:{remote:{directory:'remote/v1'}}}));
 const frame={file:'edited.webp',sha256:hash(IMAGE),durationMs:50};
 const manifest={version:3,frameVariant:'cleaned-v1',defaultCharacter:'remote',characters:[{id:'remote',name:'人物',actions:['idle','grab','drop'],interactions:{grab:'grab',drop:'drop'}}],actions:['idle','grab','drop'].map(id=>({id,title:id,role:id==='idle'?'idle':'interaction',width:2,height:3,poster:'edited.webp',frames:[structuredClone(frame)]}))};
 await fs.writeFile(path.join(folder,'edited.webp'),IMAGE);await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest));
 const original=await buildCharacter(directory,'remote');
 manifest.actions[0].frames[0].durationMs=80;await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest));
 const built=await buildCharacter(directory,'remote');
 const entry={...original.entry,url:'https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/old/remote.qzpet'};
 const state={head:'head',tree:'tree',catalog:{resourceReleaseTag:'old',archiveReleaseTag:'history',packs:[entry]},readme:'| [人物]('+entry.url+') | other |\n'};
 await fs.mkdir(path.join(root,'assets'));await fs.writeFile(path.join(root,'assets/character-packs.json'),JSON.stringify(state.catalog));await fs.writeFile(path.join(root,'README.md'),state.readme);
 return {root,directory,folder,manifest,built,entry,state,oldBytes:original.bytes,options:{sourceRoot:root,charactersDirectory:directory,data:path.join(root,'data'),builtinIds:new Set(['builtin']),syncRepo:async()=>{}}};
}
test('content scan ignores filenames, detects edits and excludes builtin characters',async t=>{
 const f=await fixture(t),catalog={packs:[{...f.entry,sha256:f.built.entry.sha256}]};
 assert.equal((await scanCharacters(f.directory,catalog,new Set()))[0].changed,false);
 await fs.rename(path.join(f.folder,'edited.webp'),path.join(f.folder,'renamed.webp'));for(const a of f.manifest.actions)a.frames[0].file='renamed.webp';
 await fs.writeFile(path.join(f.folder,'manifest.json'),JSON.stringify(f.manifest));assert.equal((await buildCharacter(f.directory,'remote')).entry.sha256,f.built.entry.sha256);
 f.manifest.actions[0].frames[0].durationMs=90;await fs.writeFile(path.join(f.folder,'manifest.json'),JSON.stringify(f.manifest));
 assert.equal((await scanCharacters(f.directory,catalog,new Set()))[0].changed,true);
 assert.deepEqual(await scanCharacters(f.directory,catalog,new Set(['remote'])),[]);
 f.manifest.actions[0].frames[0].file='../../outside.webp';await fs.writeFile(path.join(f.directory,'outside.webp'),IMAGE);await fs.writeFile(path.join(f.folder,'manifest.json'),JSON.stringify(f.manifest));
 await assert.rejects(buildCharacter(f.directory,'remote'),/越界/);
});
test('preview validates package and prohibits live publication in verification mode',async t=>{
 const f=await fixture(t),publisher=createPublisher({...f.options,verifying:true});
 assert.equal((await publisher.scan()).characters[0].changed,true);
 const plan=await publisher.prepare(['remote']);assert.equal(plan.characters.length,1);assert.equal(plan.dryRun,true);
 await assert.rejects(publisher.publish(plan.id),/禁止/);
 f.manifest.actions[0].frames[0].durationMs=100;await fs.writeFile(path.join(f.folder,'manifest.json'),JSON.stringify(f.manifest));
 await assert.rejects(publisher.prepare(['remote']),/又被修改/);
});
function fakeGitHub(f){
 let serial=20,state=structuredClone(f.state),pending,ref;
 const calls=[],bytes=new Map([[1,f.oldBytes]]),releases=[{id:7,tag_name:'old'},{id:8,tag_name:'history'}].map(r=>({...r,draft:false,upload_url:'https://uploads.github.com/repos/WuJiaJun1020/qingzhu-pet/releases/'+r.id+'/assets{?name}',html_url:'https://github.com/release/'+r.id}));
 const assets=[{id:1,release:7,name:'remote.qzpet',size:f.oldBytes.length,digest:'sha256:'+hash(f.oldBytes),state:'uploaded'}];
 let fail=false;
 const api={download:async id=>bytes.get(id),request:async(route,o={})=>{
   calls.push({route,...o});
   if(route.startsWith('/releases/tags/')){const r=releases.find(r=>r.tag_name===decodeURIComponent(route.slice(15)));if(!r)throw Object.assign(Error('missing'),{status:404});return r;}
   let m=route.match(/^\/releases\/(\d+)\/assets\?/);if(m)return assets.filter(a=>a.release===Number(m[1]));
   if(o.upload){if(fail){fail=false;throw Error('network disconnected');}const url=new URL(route),release=Number(url.pathname.split('/').at(-2)),a={id:serial++,release,name:url.searchParams.get('name'),size:o.bytes.length,digest:'sha256:'+hash(o.bytes),state:'uploaded'};assets.push(a);bytes.set(a.id,o.bytes);return a;}
   m=route.match(/^\/releases\/assets\/(\d+)$/);if(m){const i=assets.findIndex(a=>a.id===Number(m[1]));if(o.method==='DELETE'){assets.splice(i,1);return null;}Object.assign(assets[i],o.body);return assets[i];}
   m=route.match(/^\/releases\/(\d+)$/);if(m){assert.equal(o.body.make_latest,'false');const r=releases.find(r=>r.id===Number(m[1]));Object.assign(r,o.body);return r;}
   if(route==='/git/trees'){pending=o.body.tree;return {sha:'newtree'};}
   if(route==='/git/commits')return {sha:'newcommit'};
   if(route==='/git/refs/heads/main'){ref=o.body;state={...state,head:ref.sha,catalog:JSON.parse(pending[0].content),readme:pending[1].content};return {};}
   throw Error('Unexpected '+route);
 }};
 return {api,assets,calls,readRemote:async()=>state,get ref(){return ref;},failNext:()=>fail=true};
}
test('fixed resource releases archive before removal, retry safely, and keep exactly one latest package',async t=>{
 const f=await fixture(t),fake=fakeGitHub(f),publisher=createPublisher({...f.options,apiFactory:async()=>fake.api,readRemote:fake.readRemote});
 await publisher.scan();const plan=await publisher.prepare(['remote']);assert.equal(plan.tag,'old');fake.failNext();
 await assert.rejects(publisher.publish(plan.id),/network/);assert.equal(fake.ref,undefined);assert.ok(fake.assets.some(a=>a.id===1));
 await publisher.publish(plan.id);assert.deepEqual(fake.ref,{sha:'newcommit',force:false});
 const latest=fake.assets.filter(a=>a.release===7&&a.name.endsWith('.qzpet')),history=fake.assets.filter(a=>a.release===8&&a.name.endsWith('.qzpet'));
 assert.equal(latest.length,1);assert.equal(history.length,1);assert.equal(history[0].digest,'sha256:'+hash(f.oldBytes));
 assert.equal(fake.calls.some(c=>c.route==='/releases'&&c.method==='POST'),false);
 const deletion=fake.calls.findIndex(c=>c.route==='/releases/assets/1'&&c.method==='DELETE'),commit=fake.calls.findIndex(c=>c.route==='/git/refs/heads/main');assert.ok(deletion>commit);
 const trees=fake.calls.filter(c=>c.route==='/git/trees');assert.deepEqual(trees[0].body.tree.map(x=>x.path),['assets/character-packs.json','README.md']);
 await publisher.publish(plan.id);assert.equal(fake.calls.filter(c=>c.route==='/git/trees').length,1,'retry must not make another commit');
 const conflicting=structuredClone(f.state);conflicting.catalog.packs[0].sha256='b'.repeat(64);assert.throws(()=>mergePublication(conflicting,plan.characters,plan.tag),/其他发布/);
});
test('new characters absent from the remote catalog are detected, appended and rendered in three columns',async t=>{
 const f=await fixture(t);const catalog={packs:[]};const rows=await scanCharacters(f.directory,catalog,new Set());assert.equal(rows[0].isNew,true);assert.equal(rows[0].changed,true);
 const incoming={...f.built.entry,id:'new-person',actions:f.built.entry.actions.map(a=>({...a,id:'new-'+a.id})),previousSha:null,url:'https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/old/new-person.qzpet'};
 const merged=mergePublication(f.state,[incoming],'old');assert.equal(merged.catalog.packs.length,2);assert.equal(merged.before.length,0);assert.ok(merged.readme.includes(incoming.url));
 assert.equal(merged.readme.split('\n').find(l=>l.includes('remote.qzpet')).split('|').length,5);
 const more=Array.from({length:29},(_,i)=>({...incoming,id:'new-'+i,actions:incoming.actions.map(a=>({...a,id:a.id+'-'+i})),url:incoming.url.replace('new-person','new-'+i)}));assert.equal(mergePublication(f.state,more,'old').catalog.packs.length,30);
});
test('publishing an entirely new character extends the fixed release without replacing existing characters',async t=>{
 const f=await fixture(t),folder=path.join(f.directory,'new-person/v1');await fs.mkdir(folder,{recursive:true});
 const manifest=structuredClone(f.manifest);manifest.characters[0].id='new-person';manifest.characters[0].name='新人物';
 for(const a of manifest.actions)a.id='new-'+a.id;manifest.characters[0].actions=manifest.actions.map(a=>a.id);manifest.characters[0].interactions={grab:'new-grab',drop:'new-drop'};
 await fs.writeFile(path.join(folder,'edited.webp'),IMAGE);await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest));
 const index=JSON.parse(await fs.readFile(path.join(f.directory,'index.json')));index.installed['new-person']={directory:'new-person/v1'};await fs.writeFile(path.join(f.directory,'index.json'),JSON.stringify(index));
 const fake=fakeGitHub(f),publisher=createPublisher({...f.options,apiFactory:async()=>fake.api,readRemote:fake.readRemote});
 const scan=await publisher.scan();assert.equal(scan.characters.find(p=>p.id==='new-person').isNew,true);
 const plan=await publisher.prepare(['new-person']);await publisher.publish(plan.id);
 assert.equal((await fake.readRemote()).catalog.packs.length,2);assert.ok(fake.assets.some(a=>a.id===1),'unchanged asset ID retained');
 assert.equal(fake.assets.filter(a=>a.release===7&&a.name.endsWith('.qzpet')).length,2);assert.equal(fake.assets.filter(a=>a.release===8&&a.name.endsWith('.qzpet')).length,0);
});
test('remote catalog rejects external links and excessive data before replacing local state',async t=>{
 const f=await fixture(t);assert.equal(validateCatalog(f.state.catalog).size,1);
 const bad=structuredClone(f.state.catalog);bad.packs[0].url='https://evil.example/pkg';assert.throws(()=>validateCatalog(bad),/不合法/);
 await assert.rejects(fetchCatalog(async()=>({ok:true,body:[Buffer.alloc(2*1024**2+1)]})),/过大/);
 await assert.rejects(fetchCatalog(async()=>({ok:false,status:429})),/429/);
});
