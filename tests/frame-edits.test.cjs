'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createFrameEdits,identity}=require('../app/frame-edits.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'qingzhu-frame-edits-'));t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
  const base=Buffer.from('immutable original');fs.writeFileSync(path.join(data,'source.webp'),base);
  const action={id:'test-idle',width:3,height:2,assetsRoot:data,frames:[0,1].map(()=>({file:'source.webp',sha256:hash(base)}))};
  const encode=(w,h,bits)=>Buffer.concat([Buffer.from(`${w}:${h}:`),Buffer.from(bits)]),store=createFrameEdits(data,encode);
  return {data,action,base,store,encode};
}
test('a single pixel persists across restart and leaves original bytes unchanged',t=>{
 const {data,action,base,store,encode}=fixture(t),mask=new Uint8Array([0,0,1,0,0,0]);
 assert.deepEqual(store.save(action,0,hash(base),mask),{erasedPixels:1});
 const reopened=createFrameEdits(data,encode);assert.deepEqual(reopened.read(action,0).erased,mask);
 assert.ok(reopened.decorate(action,f=>f).startsWith(':repair-'));assert.ok(action.frames[0].repairMaskUrl);assert.equal(action.frames[1].repairMaskUrl,undefined);
 assert.deepEqual(fs.readFileSync(path.join(data,'source.webp')),base);
});
test('edits are isolated by frame and action even when originals match',t=>{
 const {action,base,store}=fixture(t);store.save(action,0,hash(base),new Uint8Array([1,0,0,0,0,0]));
 assert.equal(store.read(action,1).erased.some(Boolean),false);
 assert.equal(store.read({...action,id:'another-idle'},0).erased.some(Boolean),false);
});
test('stale edits cannot apply to an updated frame and stale writes fail',t=>{
 const {action,base,store}=fixture(t);store.save(action,0,hash(base),new Uint8Array([1,0,0,0,0,0]));
 const updated={...action,frames:action.frames.map(f=>({...f,sha256:hash('new original')}))};
 assert.equal(store.read(updated,0).maskFile,null);
 assert.throws(()=>store.save(updated,0,hash(base),new Uint8Array(6)),/更新/);
 assert.throws(()=>store.save(updated,0,hash('new original'),new Uint8Array(6)),/校验失败/);
});
test('restoring a frame clears the runtime mask and original revision',t=>{
 const {action,base,store}=fixture(t);store.save(action,0,hash(base),new Uint8Array([0,1,0,0,0,0]));store.decorate(action,f=>f);
 store.save(action,0,hash(base),new Uint8Array(6));assert.equal(store.read(action,0).maskFile,null);assert.equal(store.decorate(action,f=>f),'');assert.equal(action.frames[0].repairMaskUrl,undefined);
});
test('invalid identity, oversized data and invalid mask types are rejected',t=>{
 const {action,base,store}=fixture(t);
 for(const index of [-1,2,.5])assert.throws(()=>store.read(action,index));
 assert.throws(()=>identity({...action,id:'../../escape'},0));
 assert.throws(()=>identity({...action,width:3000000},0));
 assert.throws(()=>store.save(action,0,hash(base),new Uint8Array(7)));
 assert.throws(()=>store.save(action,0,hash(base),new Float32Array(6)));
 assert.throws(()=>store.save(action,0,hash(base),[0,0,0,0,0,0]));
});
test('corrupted records and missing masks fall back to original frames',t=>{
 const {data,action,base,store,encode}=fixture(t);store.save(action,0,hash(base),new Uint8Array([0,1,0,0,0,0]));
 fs.unlinkSync(store.read(action,0).maskFile);assert.equal(createFrameEdits(data,encode).read(action,0).maskFile,null);
 fs.writeFileSync(path.join(data,'frame-edits/records',identity(action,0).key+'.json'),'{');
 assert.equal(createFrameEdits(data,encode).read(action,0).erased.some(Boolean),false);
});


test('legacy binary masks migrate to alpha8 without losing erased pixels',t=>{
 const {data,action,base,store,encode}=fixture(t);store.save(action,0,hash(base),new Uint8Array([1,0,0,0,0,0]));
 const file=path.join(data,'frame-edits/records',identity(action,0).key+'.json'),record=JSON.parse(fs.readFileSync(file));record.version=1;fs.writeFileSync(file,JSON.stringify(record));
 assert.deepEqual(createFrameEdits(data,encode).read(action,0).erased,new Uint8Array([255,0,0,0,0,0]));
});
test('partial transparency persists exactly across restart',t=>{
 const {data,action,base,store,encode}=fixture(t),mask=new Uint8Array([0,64,128,200,255,0]);store.save(action,0,hash(base),mask);
 assert.deepEqual(createFrameEdits(data,encode).read(action,0).erased,mask);assert.equal(store.read(action,1).erased.some(Boolean),false);
 assert.deepEqual(fs.readFileSync(path.join(data,'source.webp')),base);
});

test('batch validation is atomic and valid frames persist together',t=>{
 const {action,base,store}=fixture(t),one=new Uint8Array([255,0,0,0,0,0]),two=new Uint8Array([0,128,0,0,0,0]);
 assert.throws(()=>store.saveBatch([{action,index:0,expectedSha:hash(base),erased:one},{action,index:1,expectedSha:hash('stale'),erased:two}]));
 assert.equal(store.read(action,0).maskFile,null);
 assert.deepEqual(store.saveBatch([{action,index:0,expectedSha:hash(base),erased:one},{action,index:1,expectedSha:hash(base),erased:two}]),{frames:2});
 assert.deepEqual(store.read(action,0).erased,one);assert.deepEqual(store.read(action,1).erased,two);
});
