'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),brush=require('../app/frame-brush.js');
test('automatic color removal samples colored pixels and respects tolerance, connectivity, radius and transparency',()=>{
 const rgba=new Uint8ClampedArray([20,50,180,255,24,52,182,128,220,20,20,255,20,50,180,255]),mask=new Uint8Array(4);
 assert.deepEqual(brush.sampleColor(rgba,mask,4,1,0,0),[20,50,180]);
 assert.deepEqual([...brush.colorRegion(rgba,mask,4,1,0,0,{radius:4,tolerance:5})],[255,255,0,0]);
 assert.deepEqual([...brush.colorRegion(rgba,mask,4,1,0,0,{tolerance:0})],[255,0,0,0]);
 mask[0]=255;assert.equal(brush.sampleColor(rgba,mask,4,1,0,0),null);assert.equal(brush.count(brush.colorRegion(rgba,mask,4,1,0,0)),0);
 assert.equal(brush.sampleColor(rgba,mask,4,1,-1,0),null);
});
test('soft brush clears its center and grades adjacent pixels; precise brush remains exact',()=>{
 const soft=new Uint8Array(49);brush.footprint(7,7,3,3,3,true,(p,v)=>soft[p]=v);
 assert.equal(soft[24],255);assert.ok(soft[25]>0&&soft[25]<255);assert.equal(soft[26],0);
 const hard=new Uint8Array(49);brush.footprint(7,7,3,3,1,false,(p,v)=>hard[p]=v);assert.equal(brush.count(hard),1);assert.equal(hard[24],255);
 assert.equal(brush.alpha(200,128),100);
});
test('feathering only softens pixels adjacent to erased areas and is idempotent',()=>{
 const mask=new Uint8Array(49);mask[24]=255;
 const result=brush.feather(mask,7,7,1);assert.equal(result[24],255);assert.equal(result[25],128);assert.equal(result[26],0);assert.equal(mask[25],0);
 assert.deepEqual(brush.feather(result,7,7,1),result);
});
test('white-region selection respects connectivity, seed tolerance, radius and dark clothing',()=>{
 const w=9,h=7,rgba=new Uint8ClampedArray(w*h*4),mask=new Uint8Array(w*h);
 for(let p=0;p<w*h;p++){rgba[p*4]=50;rgba[p*4+1]=90;rgba[p*4+2]=70;rgba[p*4+3]=255;}
 for(let y=1;y<6;y++)for(let x=1;x<4;x++)rgba.set([248,247,245,255],(y*w+x)*4);
 rgba.set([249,249,249,255],(3*w+7)*4);
 const found=brush.whiteRegion(rgba,mask,w,h,2,3,{radius:2,tolerance:12});
 assert.equal(found[3*w+2],255);assert.equal(found[3*w+7],0);assert.equal(found[3*w+4],0);assert.equal(found[0],0);
 assert.equal(brush.count(brush.whiteRegion(rgba,mask,w,h,4,3)),0);
 const small=brush.whiteRegion(rgba,mask,w,h,2,3,{radius:1,edge:0});assert.ok(brush.count(small)<brush.count(found));
 mask[3*w+2]=255;assert.equal(brush.count(brush.whiteRegion(rgba,mask,w,h,2,3)),0);
});
