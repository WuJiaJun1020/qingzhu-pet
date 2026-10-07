'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults, configure, frameDisplaySize, frameAt, nextAction, createActionScheduler } = require('../app/model.cjs');
const actions = [{ id: 'idle', role: 'idle', frames: Array.from({ length: 362 }, () => ({ durationMs: 1000/24 })) }, { id: 'reading', frames: Array.from({ length: 481 }, () => ({ durationMs: 1000/24 })) }];
test('frame boundaries, looping and end hold at 24 fps', () => {
  const frames = actions[0].frames;
  assert.equal(frameAt(0, frames, true), 0);
  assert.equal(frameAt(100, frames, true), 2);
  assert.equal(frameAt(10001, frames, true), 240);
  const total = frames.reduce((s,f) => s + f.durationMs, 0);
  assert.equal(frameAt(total + 1, frames, true), 0);
  assert.equal(frameAt(total + 1, frames, false), 361);
});
test('invalid values cannot select unknown assets or create invalid frame/size', () => {
  const before = defaults();
  assert.equal(configure(before, { action: '../bad', scale: NaN, frame: -900 }, actions).action, 'idle');
  assert.equal(configure(before, { frame: 9999 }, actions).frame, 361);
  assert.equal(configure(before, { scale: 1000 }, actions).scale, 1);
  assert.equal(configure(before, { scale: -1 }, actions).scale, .1);
  const next = configure({ ...before, frame: 350 }, { action: 'reading' }, actions);
  assert.equal(next.frame, 0); assert.equal(before.frame, 0);
});
test('prefetch cache stays bounded and rejects stale async completion', async () => {
  const { PetFrameCache } = require('../app/frame-cache.js');
  const frames = actions[1].frames.map((_,i) => ({ url: String(i) }));
  const pending = new Map();
  const cache = new PetFrameCache(frames, true, url => new Promise(resolve => pending.set(Number(url), resolve)), e => { throw e; });
  const start = cache.prime(0); await Promise.resolve();
  const end = cache.prime(200); await Promise.resolve();
  pending.get(0)({ index: 0 });
  assert.equal(cache.get(0), undefined);
  for (const resolve of pending.values()) resolve({});
  await Promise.all([...start,...end]);
  assert.equal(cache.size, 14);
  cache.dispose(); assert.equal(cache.size, 0); assert.deepEqual(cache.prime(2), []);
});

test('desktop cache shrink releases bitmaps, including decodes finishing after eviction', async () => {
  const {PetFrameCache}=require('../app/frame-cache.js');
  const pending=new Map(),closed=[];
  const cache=new PetFrameCache(Array.from({length:40},(_,i)=>({url:i})),true,url=>new Promise(resolve=>pending.set(url,resolve)),e=>{throw e;});
  const prime=cache.prime(10);await Promise.resolve();
  for(const i of [10,18])pending.get(i)({close:()=>closed.push(i)});
  await Promise.resolve();await Promise.resolve();
  const small=cache.setWindow(5,0);
  for(const [i,resolve] of pending)resolve({close:()=>closed.push(i)});
  await Promise.all([...prime,...small]);
  assert.equal(cache.size,6);assert.equal(cache.get(18),undefined);
  assert.equal(closed.length,8);assert.equal(new Set(closed).size,8);
  cache.dispose();assert.equal(closed.length,14);
});

test('default automatic idle and 30 percent, bounded persisted probability', () => {
  const d = defaults();
  assert.equal(d.autoPlay, true); assert.equal(d.action, 'idle'); assert.equal(d.actionProbability, 30);
  assert.equal(configure(d, {actionProbability: -1}, actions).actionProbability, 0);
  assert.equal(configure(d, {actionProbability: 200}, actions).actionProbability, 100);
  assert.equal(configure(d, {actionProbability: NaN}, actions).actionProbability, 30);
  assert.equal(configure({...d, action: 'removed-old-action'}, {}, actions).action, 'idle');
});
test('idle boundary draws once, uniform special choices, each special returns to idle', () => {
  const clips = [...actions, {id:'bottle',frames:[{durationMs:42}]}];
  const d=defaults(); let calls=0;
  assert.equal(nextAction(d, clips, () => {calls++;return .3;}), 'idle'); assert.equal(calls, 1);
  for (const [choice,expected] of [[0,'reading'],[.999,'bottle']]) {
    const draws=[.299,choice]; assert.equal(nextAction(d, clips, () => draws.shift()), expected); assert.equal(draws.length,0);
  }
  assert.equal(nextAction({...d,actionProbability:0},clips,()=>{throw Error('unexpected draw')}),'idle');
  assert.equal(nextAction({...d,actionProbability:100},clips,()=>.99),'bottle');
  for(const id of ['reading','bottle']) assert.equal(nextAction({...d,action:id},clips,()=>{throw Error('special chain')}),'idle');
  assert.equal(nextAction(d,[clips[0]],()=>{throw Error('no specials')}),'idle');
});

test('shuffled rounds cover all specials and avoid repeats even with a biased random stream', () => {
  const clips=[...actions,{id:'bottle',frames:[{durationMs:42}]}];
  for(const value of [0,.1,.49,.99]) {
    const schedule=createActionScheduler(clips,()=>value);
    const settings={...defaults(),actionProbability:100};
    const chosen=Array.from({length:20},()=>schedule(settings));
    for(let i=0;i<chosen.length;i+=2) assert.deepEqual([...chosen.slice(i,i+2)].sort(),['bottle','reading']);
    for(let i=1;i<chosen.length;i++) assert.notEqual(chosen[i],chosen[i-1]);
  }
});
test('idle misses, pause/resume and special completion do not consume the pending queue', () => {
  const clips=[...actions,{id:'bottle',frames:[{durationMs:42}]}];
  const schedule=createActionScheduler(clips,()=>.1),s={...defaults(),actionProbability:100};
  const first=schedule(s);
  assert.equal(schedule({...s,actionProbability:0}),'idle');
  assert.equal(schedule({...s,actionProbability:5}),'idle');
  assert.equal(schedule({...s,action:first}),'idle');
  assert.notEqual(schedule(s),first);
  const single=createActionScheduler(actions,()=>.1);
  assert.equal(single(s),'reading');assert.equal(single(s),'reading');
});
test('three-action shuffled rounds cover every action once without boundary repeats', () => {
  const clips=[...actions,{id:'bottle',frames:[{}]},{id:'extra',frames:[{}]}];
  const schedule=createActionScheduler(clips),s={...defaults(),actionProbability:100};
  const chosen=Array.from({length:300},()=>schedule(s));
  for(let i=0;i<chosen.length;i+=3) assert.deepEqual([...chosen.slice(i,i+3)].sort(),['bottle','extra','reading']);
  for(let i=1;i<chosen.length;i++) assert.notEqual(chosen[i],chosen[i-1]);
});

test('three idle clips rotate at zero probability and never consume the special queue', () => {
  const clips = [...actions, {id:'idle-shake',role:'idle',frames:[{}]}, {id:'idle-think',role:'idle',frames:[{}]}, {id:'bottle',frames:[{}]}];
  const schedule = createActionScheduler(clips, () => .2);
  let state = {...defaults(),actionProbability:0};
  const chosen = [];
  for(let i=0;i<12;i++) {const id=schedule(state);assert.notEqual(id,state.action);chosen.push(id);state={...state,action:id};}
  for(let i=0;i<chosen.length;i+=3) assert.deepEqual(chosen.slice(i,i+3).sort(), ['idle','idle-shake','idle-think']);
  state.actionProbability=100;
  const first=schedule(state);assert.ok(['reading','bottle'].includes(first));
  state.action=schedule({...state,action:first});assert.ok(clips.find(a=>a.id===state.action).role==='idle');
  assert.notEqual(schedule(state),first);
});

test('each idle can trigger specials, special completion always selects an idle', () => {
  const clips = [...actions, {id:'idle-shake',role:'idle',frames:[{}]}, {id:'idle-think',role:'idle',frames:[{}]}];
  for(const id of ['idle','idle-shake','idle-think']) {
    assert.equal(nextAction({...defaults(),action:id,actionProbability:100},clips,()=>0),'reading');
    assert.ok(['idle','idle-shake','idle-think'].includes(nextAction({...defaults(),action:id,actionProbability:30},clips,()=>.9)));
  }
  const schedule=createActionScheduler(clips,()=>.4);
  const returns=Array.from({length:6},()=>schedule({...defaults(),action:'reading',actionProbability:100}));
  for(let i=0;i<returns.length;i+=3) assert.deepEqual(returns.slice(i,i+3).sort(),['idle','idle-shake','idle-think']);
});

test('saved oversize settings migrate to 100 percent and source pixels stay 1:1 at different display DPIs', () => {
  assert.equal(configure({...defaults(),scale:1.5},{},actions).scale,1);
  assert.equal(configure({...defaults(),scale:NaN},{},actions).scale,defaults().scale);
  for(const scaleFactor of [1,1.25,2]) {
    const display={scaleFactor,workArea:{width:1200,height:900}};
    const full=frameDisplaySize({width:384,height:576},1,display);
    assert.equal(full.width*scaleFactor,384);assert.equal(full.height*scaleFactor,576);
    const half=frameDisplaySize({width:384,height:576},.5,display);
    assert.equal(half.width*scaleFactor,192);assert.equal(half.height*scaleFactor,288);
  }
});


test('fractional frame timings seek to every exact frame boundary', () => {
  const timings = [[124,5000],[56,2000],[39,1000],[107,4000]];
  const clips = timings.map(([count,total]) => Array.from({length:count}, () => ({durationMs:total/count})));
  clips.push(Array.from({length:80}, (_,i) => ({durationMs:i%2 ? 37.7 : 30.1})));
  for (const frames of clips) {
    let elapsed = 0;
    for (let i = 0; i < frames.length; i++) {
      assert.equal(frameAt(elapsed,frames,false),i);
      assert.equal(frameAt(elapsed,frames,true),i);
      if(i) assert.equal(frameAt(elapsed-1e-7,frames,false),i-1);
      elapsed += frames[i].durationMs;
    }
    assert.equal(frameAt(elapsed,frames,false),frames.length-1);
    assert.equal(frameAt(elapsed,frames,true),0);
  }
});
