'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('node:module').createRequire(path.join(__dirname,'../app/main.cjs'))('sharp');
const {createFrameWriter}=require('../app/frame-writer.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(t,shared=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qingzhu-direct-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const assets=path.join(root,'pack');fs.mkdirSync(assets);
 const bytes=await sharp(Buffer.from([100,120,140,255,50,80,90,200]),{raw:{width:2,height:1,channels:4}}).webp({lossless:true}).toBuffer();
 fs.writeFileSync(path.join(assets,'a.webp'),bytes);fs.writeFileSync(path.join(assets,'b.webp'),bytes);
 const manifest={actions:[{id:'idle',width:2,height:1,frames:[{file:'a.webp',sha256:hash(bytes)},{file:shared?'a.webp':'b.webp',sha256:hash(bytes)}]}]};
 const file=path.join(assets,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest));
 const action={...manifest.actions[0],assetsRoot:assets},data=path.join(root,'data'),writer=createFrameWriter({data,roots:[assets]});
 const item=(index,erased=[128,0])=>({action,index,expectedSha:action.frames[index].sha256,erased:new Uint8Array(erased)});
 return {root,assets,bytes,file,action,data,writer,item};
}
test('direct save replaces WebP losslessly, updates manifest, and makes new bytes the next baseline',async t=>{
 const f=await fixture(t),other=fs.readFileSync(path.join(f.assets,'b.webp'));
 await f.writer.saveBatch([f.item(0)]);
 const first=fs.readFileSync(path.join(f.assets,'a.webp')),m=JSON.parse(fs.readFileSync(f.file));
 assert.notEqual(hash(first),hash(f.bytes));assert.equal(m.actions[0].frames[0].sha256,hash(first));
 const pixels=await sharp(first).ensureAlpha().raw().toBuffer();assert.equal(pixels[3],127);assert.equal(pixels[7],200);assert.deepEqual([...pixels.slice(0,3)],[100,120,140]);
 assert.deepEqual(fs.readFileSync(path.join(f.assets,'b.webp')),other);
 assert.equal(fs.existsSync(path.join(f.data,'frame-edits')),false);
 const reopened=createFrameWriter({data:f.data,roots:[f.assets]}),action={...m.actions[0],assetsRoot:f.assets};
 await reopened.saveBatch([{action,index:0,expectedSha:hash(first),erased:new Uint8Array([128,0])}]);
 assert.equal((await sharp(fs.readFileSync(path.join(f.assets,'a.webp'))).ensureAlpha().raw().toBuffer())[3],63);
});
test('shared source frames split only selected positions, including two distinct edits in one batch',async t=>{
 const f=await fixture(t,true);await f.writer.saveBatch([f.item(0),f.item(1,[0,128])]);
 const frames=JSON.parse(fs.readFileSync(f.file)).actions[0].frames;
 assert.notEqual(frames[0].file,frames[1].file);assert.deepEqual(fs.readFileSync(path.join(f.assets,'a.webp')),f.bytes);
 for(const frame of frames)assert.equal(hash(fs.readFileSync(path.join(f.assets,frame.file))),frame.sha256);
});
test('invalid later frame, stale hashes, duplicate frames and path escapes cannot partially save',async t=>{
 const f=await fixture(t),before=fs.readFileSync(f.file);
 for(const items of [[f.item(0),{...f.item(1),expectedSha:'bad'}],[f.item(0),f.item(0)],[{...f.item(0),erased:new Uint8Array(1)}]])await assert.rejects(f.writer.saveBatch(items));
 assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(path.join(f.assets,'a.webp')),f.bytes);
 const m=JSON.parse(before);m.actions[0].frames[0].file='../outside.webp';fs.writeFileSync(f.file,JSON.stringify(m));
 await assert.rejects(f.writer.saveBatch([f.item(0)]),/路径/);
});
test('a failed manifest commit rolls back all replaced frame bytes',async t=>{
 const f=await fixture(t),before=fs.readFileSync(f.file),rename=fs.renameSync;let failed=false;
 t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.file&&!failed){failed=true;throw Error('simulated write failure');}return rename(from,to);});
 await assert.rejects(f.writer.saveBatch([f.item(0),f.item(1)]),/simulated/);
 assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(path.join(f.assets,'a.webp')),f.bytes);assert.deepEqual(fs.readFileSync(path.join(f.assets,'b.webp')),f.bytes);
});
test('startup recovers a pending transaction before loading resources',async t=>{
 const f=await fixture(t),folder=path.join(f.data,'frame-writes','interrupted');fs.mkdirSync(folder);
 fs.writeFileSync(path.join(folder,'0.before'),f.bytes);const target=path.join(f.assets,'a.webp');fs.writeFileSync(target,'partial');
 fs.writeFileSync(path.join(folder,'journal.json'),JSON.stringify({state:'pending',entries:[{file:target,existed:true,backup:'0.before'}]}));
 createFrameWriter({data:f.data,roots:[f.assets]});assert.deepEqual(fs.readFileSync(target),f.bytes);
});
