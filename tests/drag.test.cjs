'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDragController } = require('../app/drag-controller.cjs');
test('native drag follows latest cursor at 8 ms, coalesces idle moves and flushes release', () => {
  let point = { x: 100, y: 50 }, tick, interval, cleared = 0, ended = 0;
  const moves = [];
  const drag = createDragController({
    getCursor: () => point, getBounds: () => ({ x: 200, y: 300, width: 100, height: 150 }),
    clamp: (x,y) => ({ x: Math.min(350,x), y }),
    move: (x,y) => moves.push({ x,y }), onEnd: () => ended++,
    setTimer: (fn,ms) => { tick = fn; interval = ms; return 1; }, clearTimer: () => cleared++
  });
  drag.start(); assert.equal(interval,8);
  tick(); assert.equal(moves.length,0);
  point = { x:120,y:70 }; tick(); tick(); assert.deepEqual(moves,[{x:220,y:320}]);
  point = { x:150,y:80 }; drag.stop(); assert.deepEqual(moves.at(-1),{x:250,y:330});
  assert.equal(ended,1); assert.equal(cleared,1); assert.equal(drag.active,false);
  tick(); drag.stop(); assert.equal(ended,1);
  drag.start(); point = { x:500,y:80 }; tick(); assert.equal(moves.at(-1).x,350);
  drag.dispose(); const count = moves.length; tick(); assert.equal(moves.length,count); assert.equal(drag.active,false);
});

test('high resolution is enabled only during drag and balanced on release or dispose', () => {
  let tick,started=0,stopped=0,ended=0;
  const drag=createDragController({getCursor:()=>({x:0,y:0}),getBounds:()=>({x:0,y:0,width:1,height:1}),clamp:(x,y)=>({x,y}),move:()=>{},onEnd:()=>ended++,onStart:()=>started++,onStop:()=>stopped++,setTimer:fn=>{tick=fn;return 1;},clearTimer:()=>{}});
  drag.start();drag.start();assert.equal(started,1);drag.stop();drag.stop();assert.equal(stopped,1);assert.equal(ended,1);
  drag.start();drag.dispose();drag.dispose();tick();assert.equal(started,2);assert.equal(stopped,2);assert.equal(ended,1);
});
test('native movement converts DIP, preserves size and focus, and releases timer precision', () => {
  const {createWindowMover}=require('../app/window-mover.cjs');
  const calls=[];let begin=0,end=0;
  const win={getNativeWindowHandle:()=>Buffer.from([1,0,0,0,0,0,0,0]),setBounds:()=>{throw Error('native movement must not resize')}};
  const native={position:(...args)=>{calls.push(args);return 1},rectangle:(_,r)=>{Object.assign(r,{left:10,top:20,right:110,bottom:170});return 1;},begin:()=>{begin++;return 0},end:()=>end++};
  const mover=createWindowMover(win,{dipToScreenPoint:p=>({x:Math.round(p.x*1.5),y:Math.round(p.y*1.5)})},native);
  mover.move(10,20,{width:100,height:150});
  assert.deepEqual(calls[0],[1n,0n,15,30,0,0,0x15]);assert.deepEqual(mover.nativeBounds(),{x:10,y:20,width:100,height:150});
  mover.beginDrag();mover.beginDrag();mover.endDrag();mover.endDrag();assert.equal(begin,1);assert.equal(end,1);
});
