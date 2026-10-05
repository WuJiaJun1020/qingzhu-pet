'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../assets');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));

function dimensions(bytes){
  if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')
    return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.equal(bytes.readUInt32LE(4)+8,bytes.length);
  for(let offset=12;offset+8<=bytes.length;){
    const kind=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),data=offset+8;
    assert.ok(data+length<=bytes.length);
    if(kind==='VP8L'){
      assert.equal(bytes[data],0x2f);
      const bits=bytes.readUInt32LE(data+1);
      return [(bits&0x3fff)+1,((bits>>>14)&0x3fff)+1];
    }
    offset=data+length+(length%2);
  }
  throw new Error('Expected a lossless WebP image');
}

test('published manifest is portable; all frames, masks and posters match dimensions and hashes',()=>{
  const ids=new Set(),checked=new Map();
  assert.ok(manifest.actions.some(a=>a.role==='idle'));
  assert.equal(manifest.frameVariant,'cleaned-v1');
  assert.deepEqual(manifest.characters.map(c=>c.id),['hanli']);
  assert.ok(manifest.actions.every(a=>a.frames.every(f=>!f.cleanedFile&&!f.cleanedSha256)));
  function check(file,hash,width,height){
    const resolved=path.resolve(root,file);
    assert.ok(resolved.startsWith(root+path.sep),'Asset escapes assets');
    if(!checked.has(file)){
      const bytes=fs.readFileSync(resolved);
      checked.set(file,{hash:crypto.createHash('sha256').update(bytes).digest('hex'),size:dimensions(bytes)});
    }
    const item=checked.get(file);
    if(hash)assert.equal(item.hash,hash,file);
    assert.deepEqual(item.size,[width,height],file);
  }
  for(const a of manifest.actions){
    assert.ok(!ids.has(a.id));ids.add(a.id);
    assert.ok(!a.source&&!a.processedOutput,'Do not publish local source paths');
    assert.ok(a.width>0&&a.height>0&&a.frames.length>0);
    check(a.poster,null,a.width,a.height);
    for(const f of a.frames){
      assert.ok(Number.isFinite(f.durationMs)&&f.durationMs>0);
      for(const [key,hash] of [['file','sha256'],['cleanedFile','cleanedSha256'],['edgeMaskFile','edgeMaskSha256']])
        if(f[key])check(f[key],f[hash],a.width,a.height);
    }
  }
});
