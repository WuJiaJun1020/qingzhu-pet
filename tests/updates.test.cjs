'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {findRelease,createSoftwareUpdater}=require('../app/software-updater.cjs');
const {createUpdateService}=require('../app/update-service.cjs');
const bytes=Buffer.from('MZ update fixture'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function release(version='0.4.0'){const name=`qingzhu-pet-${version}-windows-x64-setup.exe`;return {tag_name:'v'+version,assets:[{name,state:'uploaded',size:bytes.length,digest:'sha256:'+sha(bytes),browser_download_url:`https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/v${version}/${name}`}]};}
function folder(t){const data=fs.mkdtempSync(path.join(os.tmpdir(),'qingzhu-updates-'));t.after(()=>{assert.ok(data.startsWith(path.join(os.tmpdir(),'qingzhu-updates-')));fs.rmSync(data,{force:true,recursive:true});});return data;}
test('software selects the highest stable semantic version and ignores resource releases',()=>{
 const beta={...release('2.0.0'),prerelease:true},draft={...release('3.0.0'),draft:true};
 assert.equal(findRelease([release('0.9.0'),{tag_name:'characters-20261007'},release('0.10.0'),beta,draft],'0.3.0').version,'0.10.0');
 assert.equal(findRelease([release('0.3.0')],'0.3.0'),null);
 const bad=release();bad.assets[0].browser_download_url='https://example.com/setup.exe';assert.throws(()=>findRelease([bad],'0.3.0'),/不合法/);
});
test('software downloads verified bytes and rechecks them before allowing installation',async t=>{
 const data=folder(t),up=createSoftwareUpdater({data,version:'0.3.0',installed:true,fetch:async()=>new Response(JSON.stringify([release()])),downloadFetch:async()=>new Response(bytes)});
 await up.check();assert.equal(up.snapshot().status,'available');await up.download();assert.equal(up.snapshot().status,'ready');
 const file=await up.prepareInstall();assert.deepEqual(fs.readFileSync(file),bytes);fs.writeFileSync(file,Buffer.alloc(bytes.length));await assert.rejects(up.prepareInstall(),/校验失败/);
 assert.equal(up.snapshot().status,'error');
});
test('software rejects truncated/corrupt data and cleans partial downloads',async t=>{
 for(const bad of [bytes.subarray(0,4),Buffer.alloc(bytes.length)]){
  const data=folder(t),up=createSoftwareUpdater({data,version:'0.3.0',installed:true,fetch:async()=>new Response(JSON.stringify([release()])),downloadFetch:async()=>new Response(bad)});
  await up.check();await assert.rejects(up.download(),/校验失败/);assert.deepEqual(fs.readdirSync(path.join(data,'software-updates')),[]);await assert.rejects(up.prepareInstall(),/尚未就绪/);
 }
});
test('software supports checksums fallback and refuses unsigned metadata without checksums',async t=>{
 const row=release();delete row.assets[0].digest;
 const up=createSoftwareUpdater({data:folder(t),version:'0.3.0',installed:true,fetch:async()=>new Response(JSON.stringify([row])),downloadFetch:async()=>new Response(sha(bytes)+'  '+row.assets[0].name)});
 await assert.rejects(up.check(),/缺少 SHA-256/);
 row.assets.push({name:'SHA256SUMS.txt',browser_download_url:'https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/v0.4.0/SHA256SUMS.txt'});
 await up.check();assert.equal(up.snapshot().status,'available');
});
test('software cancellation leaves no partial executable',async t=>{
 let up;
 up=createSoftwareUpdater({data:folder(t),version:'0.3.0',installed:true,fetch:async()=>new Response(JSON.stringify([release()])),downloadFetch:async()=>({ok:true,body:(async function*(){yield bytes.subarray(0,2);up.cancel();yield bytes.subarray(2);})()})});
 await up.check();await assert.rejects(up.download(),/取消/);assert.equal(up.snapshot().message,'下载已取消');
});
test('successful installed-version startup removes only completed current/older cached installers',async t=>{
 const data=folder(t),cache=path.join(data,'software-updates');fs.mkdirSync(cache);
 const old='qingzhu-pet-0.3.3-windows-x64-setup.exe',current='qingzhu-pet-0.3.4-windows-x64-setup.exe',future='qingzhu-pet-0.10.0-windows-x64-setup.exe';
 const preserved=[future,'notes.txt','setup.exe',old+'.download.partial','qingzhu-pet-9007199254740992.0.0-windows-x64-setup.exe'];
 for(const name of [old,current,...preserved])fs.writeFileSync(path.join(cache,name),bytes);
 const directory='qingzhu-pet-0.1.0-windows-x64-setup.exe';fs.mkdirSync(path.join(cache,directory));fs.writeFileSync(path.join(cache,directory,'keep.txt'),'keep');
 const up=createSoftwareUpdater({data,version:'0.3.4',installed:true});
 assert.equal(await up.cleanupInstalledDownloads(),false);assert.deepEqual(fs.readdirSync(cache).sort(),[...preserved,directory].sort());
 assert.equal(await up.cleanupInstalledDownloads(),false);assert.equal(up.snapshot().status,'idle');
 const absent=createSoftwareUpdater({data:folder(t),version:'0.3.4',installed:true});assert.equal(await absent.cleanupInstalledDownloads(),false);
});
test('development retains update cache and installed cleanup runs even when automatic checks are disabled',async t=>{
 const data=folder(t),cache=path.join(data,'software-updates');fs.mkdirSync(cache);const file=path.join(cache,'qingzhu-pet-0.3.3-windows-x64-setup.exe');fs.writeFileSync(file,bytes);
 const dev=createSoftwareUpdater({data,version:'0.3.4',installed:false});assert.equal(await dev.cleanupInstalledDownloads(),false);assert.ok(fs.existsSync(file));
 const timers=[],service=createUpdateService({data,version:'0.3.4',installed:true,packs:packsFixture(),fetch:()=>{throw Error('must not fetch');},setTimeoutFn:(fn,delay)=>{const timer={fn,delay,unref(){}};timers.push(timer);return timer;},clearTimeoutFn:()=>{}});
 service.configure({autoCharacters:false,autoSoftware:false});service.start();await timers.find(timer=>timer.delay===0).fn();assert.equal(fs.existsSync(file),false);
 await timers.find(timer=>timer.delay===15000).fn();service.stop();
});
test('occupied update-cache files are retried later and cleanup retries stop with the service',async t=>{
 const data=folder(t),timers=[],cleared=[],service=createUpdateService({data,version:'0.3.4',installed:true,packs:packsFixture(),setTimeoutFn:(fn,delay)=>{const timer={fn,delay,unref(){}};timers.push(timer);return timer;},clearTimeoutFn:timer=>cleared.push(timer)});
 let attempts=0;service.software.cleanupInstalledDownloads=async()=>++attempts===1;
 service.start();await timers.find(timer=>timer.delay===0).fn();const retry=timers.find(timer=>timer.delay===60000);assert.ok(retry);await retry.fn();assert.equal(attempts,2);assert.equal(timers.filter(timer=>timer.delay===60000).length,1);
 service.stop();assert.ok(cleared.includes(retry));await retry.fn();assert.equal(attempts,2);
});
test('GitHub API rate limits fall back to the public latest software release and verified checksum',async t=>{
 const row=release(),calls=[];
 const up=createSoftwareUpdater({data:folder(t),version:'0.3.0',installed:true,fetch:async(url,options)=>{calls.push(url);if(url.startsWith('https://api.github.com/'))return new Response('',{status:403});assert.equal(options.method,'HEAD');return url.endsWith('/latest')?{ok:true,url:'https://github.com/WuJiaJun1020/qingzhu-pet/releases/tag/v0.4.0'}:{ok:true,headers:new Headers({'content-length':String(bytes.length)})};},downloadFetch:async url=>new Response(url.endsWith('SHA256SUMS.txt')?sha(bytes)+'  '+row.assets[0].name:bytes)});
 await up.check();await up.download();assert.equal(up.snapshot().status,'ready');assert.equal(calls.length,3);
});
function packsFixture(){let entries=[{id:'old',name:'已有',installed:true,updateAvailable:false}],calls=[];return {calls,list:()=>({entries}),checkUpdates:async()=>{entries[0].updateAvailable=true;if(entries.length===1)entries.push({id:'new',name:'新增',installed:false,updateAvailable:false});},install:async id=>{calls.push(id);entries.find(p=>p.id===id).updateAvailable=false;},cancel:()=>{}};}

test('Electron empty redirected URL reads the public release metadata and validates the checksum',async t=>{
 const up=createSoftwareUpdater({data:folder(t),version:'0.3.1',installed:true,fetch:async(url,options)=>{
  if(url.startsWith('https://api.github.com/'))return new Response('',{status:403});
  if(url.endsWith('/latest'))return options.method==='HEAD'?{ok:true,url:''}:new Response('<meta property="og:url" content="/WuJiaJun1020/qingzhu-pet/releases/tag/v0.3.2" />');
  return {ok:true,headers:new Headers({'content-length':String(bytes.length)})};
 },downloadFetch:async()=>new Response(sha(bytes)+'  qingzhu-pet-0.3.2-windows-x64-setup.exe')});
 await up.check();assert.equal(up.snapshot().availableVersion,'0.3.2');assert.equal(up.snapshot().status,'available');
});

test('public page fallback rejects unrelated, oversized and nonsoftware release metadata',async t=>{
 for(const html of ['<meta property="og:url" content="https://example.com/releases/tag/v9.0.0">','<meta property="og:url" content="/WuJiaJun1020/qingzhu-pet/releases/tag/characters-20261005">','x'.repeat(2*1024**2+1)]){
  const up=createSoftwareUpdater({data:folder(t),version:'0.3.1',installed:true,fetch:async(url,options)=>url.startsWith('https://api.github.com/')?new Response('',{status:403}):options.method==='HEAD'?{ok:true,url:''}:new Response(html)});
  await assert.rejects(up.check(),/版本|过大/);assert.equal(up.snapshot().manualDownload,true);await assert.rejects(up.download(),/先检查/);
 }
});
test('installed service updates only installed characters, announces new people, persists preferences',async t=>{
 const packs=packsFixture(),data=folder(t),reloaded=[];
 const service=createUpdateService({data,installed:true,version:'0.3.0',packs,onInstalled:id=>reloaded.push(id)});
 await service.checkCharacters();assert.deepEqual(packs.calls,['old']);assert.deepEqual(reloaded,['old']);assert.deepEqual(service.snapshot().characters.added,['新增']);
 service.configure({autoCharacters:false});const next=createUpdateService({data,installed:true,version:'0.3.0',packs});assert.deepEqual(next.snapshot().preferences,{autoCharacters:false,autoSoftware:true});
});
test('development never automatically overwrites frames or fetches software installers',async t=>{
 const packs=packsFixture(),service=createUpdateService({data:folder(t),installed:false,version:'0.3.0',packs,fetch:()=>{throw Error('must not fetch');}});
 service.configure({autoCharacters:true,autoSoftware:true});assert.deepEqual(service.snapshot().preferences,{autoCharacters:false,autoSoftware:false});
 await service.checkCharacters();assert.deepEqual(packs.calls,[]);await service.software.check();await assert.rejects(service.software.download(),/开发版/);
});
test('automatic checks use startup/periodic timers and defer while editing, then resume',async t=>{
 const packs=packsFixture(),timers=[];let editing=true;
 const service=createUpdateService({data:folder(t),installed:true,version:'0.3.0',packs,fetch:async()=>new Response('[]'),canUpdate:()=>!editing,setTimeoutFn:(fn,delay)=>{const t={fn,delay,unref(){}};timers.push(t);return t;},clearTimeoutFn:()=>{}});
 service.start();assert.equal(timers[0].delay,15000);await timers[0].fn();assert.deepEqual(packs.calls,[]);assert.equal(service.snapshot().characters.status,'deferred');assert.ok(timers.some(t=>t.delay===21600000));
 editing=false;timers.find(t=>t.delay===60000).fn();await new Promise(r=>setImmediate(r));assert.deepEqual(packs.calls,['old']);service.stop();
});
test('one failed character does not block other updates and minimum-version packages are skipped',async t=>{
 const entries=[{id:'bad',name:'失败',installed:true,updateAvailable:true},{id:'good',name:'成功',installed:true,updateAvailable:true},{id:'future',name:'未来',installed:true,updateAvailable:true,compatible:false}],calls=[];
 const packs={list:()=>({entries}),checkUpdates:async()=>{},cancel(){},install:async id=>{calls.push(id);if(id==='bad')throw Error('网络中断');entries.find(p=>p.id===id).updateAvailable=false;}};
 const service=createUpdateService({data:folder(t),installed:true,version:'0.3.0',packs});await service.checkCharacters();assert.deepEqual(calls,['bad','good']);assert.equal(service.snapshot().characters.status,'error');assert.match(service.snapshot().characters.message,/先更新软件/);
});
