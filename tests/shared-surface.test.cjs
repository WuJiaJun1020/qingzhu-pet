'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSharedSurface}=require('../app/shared-surface.cjs');
function fixture(){
  const parent=()=>({children:[],addChildView(view){if(view.parent)view.parent.children=[];this.children=[view];view.parent=this;}});
  const desktop={contentView:parent(),hide(){this.hidden=true;},getBounds:()=>({x:1200,y:300,width:240,height:350})};
  const panel={contentView:parent(),getContentBounds:()=>({x:120,y:80,width:900,height:600})};
  const messages=[],view={webContents:{id:7,send:(...args)=>messages.push(args)},setBackgroundColor(){},setVisible(value){this.visible=value;},getBounds(){return this.bounds||{};},setBounds(value){this.bounds=value;}};
  const surface=createSharedSurface({desktop,panel,view});
  surface.setRegion({x:240,y:110,width:380,height:410});surface.setSize({width:200,height:300});
  return {surface,view,panel,desktop,messages};
}
test('one view moves between hosts without reloading, rebuilding or hiding its renderer',()=>{
  const {surface,view,panel,desktop,messages}=fixture();
  surface.attach();assert.equal(panel.contentView.children[0],view);assert.equal(desktop.contentView.children.length,0);assert.equal(view.visible,true);
  assert.deepEqual(surface.bounds(),{x:450,y:300,width:200,height:300});
  surface.detach();assert.equal(desktop.contentView.children[0],view);assert.equal(panel.contentView.children.length,0);assert.equal(view.webContents.id,7);
  assert.deepEqual(messages.filter(([name])=>name==='player-host'),[['player-host','panel'],['player-host','desktop']]);
});
test('panel viewport clips partial overflow at all four edges without moving itself',()=>{
  const {surface,view,panel}=fixture();surface.attach();const viewport={...view.getBounds()};
  const origin=panel.getContentBounds();
  surface.move(-9999,-9999);let b=surface.bounds();
  assert.equal(b.x-origin.x+b.width/2,viewport.x);assert.equal(b.y-origin.y+b.height/2,viewport.y);
  surface.move(9999,9999);b=surface.bounds();
  assert.equal(b.x-origin.x+b.width/2,viewport.x+viewport.width);assert.equal(b.y-origin.y+b.height/2,viewport.y+viewport.height);
  assert.deepEqual(view.getBounds(),viewport);
  surface.detach();assert.deepEqual(surface.clamp(-300,4000),{x:-300,y:4000});
});
test('region changes preserve position when possible and keep a reachable portion on shrink',()=>{
  const {surface,view,panel}=fixture();surface.attach();const before=surface.bounds();
  surface.setRegion({x:8,y:70,width:884,height:522});assert.deepEqual(surface.bounds(),before);
  surface.move(99999,99999);surface.setRegion({x:240,y:110,width:380,height:410});
  const b=surface.bounds(),r=view.getBounds(),origin=panel.getContentBounds();
  assert.equal(b.x-origin.x+b.width/2,r.x+r.width);assert.equal(b.y-origin.y+b.height/2,r.y+r.height);
});
test('repeated same-size updates at a clipped edge do not reanchor or resend placement',()=>{
  const {surface,messages}=fixture();surface.attach();surface.move(99999,99999);
  const before=surface.bounds(),count=messages.length;
  for(let i=0;i<250;i++)surface.setSize({width:200,height:300});
  assert.deepEqual(surface.bounds(),before);assert.equal(messages.length,count);
});
test('scale changes keep the canvas center fixed and host transfers retain panel placement',()=>{
  const {surface,panel}=fixture();surface.attach();surface.move(99999,99999);
  const before=surface.bounds();surface.setSize({width:100,height:150});const smaller=surface.bounds();
  assert.equal(smaller.x+50,before.x+100);assert.equal(smaller.y+75,before.y+150);
  surface.detach();surface.attach();assert.deepEqual(surface.bounds(),smaller);
});
