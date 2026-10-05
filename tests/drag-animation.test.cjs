'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDragAnimationController } = require('../app/drag-animation.cjs');
const { createActionScheduler, defaults } = require('../app/model.cjs');
const actions = [{id:'idle',role:'idle'},{id:'reading',role:'action'},
  {id:'grab',role:'interaction',frames:Array.from({length:56},()=>({}))},{id:'drop',role:'interaction'}];
test('drag displays the first frame, movement plays once, holding keeps the tail, then drop restores idle', () => {
  const controller=createDragAnimationController(actions);
  let settings={...defaults(),action:'reading',frame:200};
  settings={...settings,...controller.begin(settings)};
  assert.equal(settings.action,'grab');assert.equal(settings.frame,0);
  assert.equal(settings.playing,false);assert.equal(settings.loop,false);assert.equal(settings.autoPlay,false);
  assert.equal(controller.begin(settings),null);
  settings={...settings,...controller.moved(settings)};
  assert.equal(settings.playing,true);assert.equal(settings.frame,0);
  settings.frame=20;
  assert.equal(controller.moved(settings),null);
  settings={...settings,...controller.complete(settings)};
  assert.equal(settings.playing,false);assert.equal(settings.frame,55);assert.equal(controller.phase,'grab');
  settings={...settings,...controller.moved(settings)};
  assert.equal(settings.playing,true);assert.equal(settings.frame,0);
  settings={...settings,...controller.release(settings)};
  assert.equal(settings.action,'drop');assert.equal(settings.loop,false);assert.equal(settings.frame,0);
  assert.equal(controller.moved(settings),null);
  settings={...settings,...controller.complete(settings)};
  assert.equal(settings.action,'idle');assert.equal(settings.autoPlay,true);assert.equal(settings.loop,true);
  assert.equal(controller.complete(settings),null);
});

test('only actual changed drag positions replay a finished grab; stationary ticks and ongoing motion do not rewind', () => {
  const {createDragController}=require('../app/drag-controller.cjs');
  const animations=createDragAnimationController(actions);
  let settings=defaults(),point={x:0,y:0},tick,replays=0;
  const drag=createDragController({
    getCursor:()=>point,getBounds:()=>({x:0,y:0,width:384,height:576}),clamp:(x,y)=>({x,y}),move:()=>{},
    onStart:()=>{settings={...settings,...animations.begin(settings)};},
    onMove:()=>{const patch=animations.moved(settings);if(patch){settings={...settings,...patch};replays++;}},
    onEnd:()=>{settings={...settings,...animations.release(settings)};},
    setTimer:fn=>{tick=fn;return 1;},clearTimer:()=>{}
  });
  drag.start();tick();assert.equal(replays,0);assert.equal(settings.playing,false);
  point={x:5,y:0};tick();assert.equal(replays,1);assert.equal(settings.playing,true);
  settings.frame=25;
  point={x:10,y:0};tick();assert.equal(settings.frame,25);assert.equal(replays,1);
  settings={...settings,...animations.complete(settings)};
  for(let i=0;i<20;i++) tick();assert.equal(settings.frame,55);assert.equal(replays,1);
  point={x:11,y:0};tick();assert.equal(settings.frame,0);assert.equal(replays,2);
  drag.stop();assert.equal(settings.action,'drop');assert.equal(settings.loop,false);
});
test('re-grabbing during descent restarts grab without overwriting paused manual preferences', () => {
  const controller=createDragAnimationController(actions);
  let settings={...defaults(),autoPlay:false,playing:false,loop:false};
  settings={...settings,...controller.begin(settings)};
  settings={...settings,...controller.release(settings)};
  settings={...settings,frame:10};
  settings={...settings,...controller.begin(settings)};
  assert.equal(settings.action,'grab');assert.equal(settings.frame,0);
  assert.equal(controller.complete({...settings,action:'drop'}),null);
  settings={...settings,...controller.release(settings)};
  settings={...settings,...controller.complete(settings)};
  assert.equal(settings.action,'idle');assert.equal(settings.autoPlay,false);
  assert.equal(settings.playing,false);assert.equal(settings.loop,false);
});
test('cancellation and missing resources do not create an orphaned interaction', () => {
  const controller=createDragAnimationController(actions);
  assert.equal(controller.release(defaults()),null);
  controller.begin(defaults());
  assert.deepEqual(controller.cancel(),{autoPlay:true,loop:true,playing:true});
  assert.equal(controller.phase,'none');assert.equal(controller.complete({action:'drop'}),null);
  const unavailable=createDragAnimationController(actions.slice(0,3));
  assert.equal(unavailable.begin(defaults()),null);assert.equal(unavailable.phase,'none');
});
test('grab and drop are excluded from automatic random actions at every probability', () => {
  for(const value of [0,.2,.99]) {
    const scheduler=createActionScheduler(actions,()=>value);
    for(let i=0;i<20;i++) assert.equal(scheduler({...defaults(),actionProbability:100}),'reading');
    assert.equal(scheduler({...defaults(),action:'drop'}),'idle');
  }
});
