'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createCharacterCatalog} = require('../app/characters.cjs');
const {createActionScheduler, configure, defaults} = require('../app/model.cjs');
const {createDragAnimationController} = require('../app/drag-animation.cjs');
function fixture() {
  return {
    defaultCharacter:'a',
    actions:['a','b'].flatMap(id=>['idle','special','grab','drop'].map(kind=>({
      id:`${id}-${kind}`,role:kind==='idle'?'idle':kind==='special'?'action':'interaction',
      frames:Array.from({length:4},()=>({durationMs:100}))
    }))),
    characters:['a','b'].map(id=>({id,name:id,actions:['idle','special','grab','drop'].map(k=>`${id}-${k}`),
      interactions:{grab:`${id}-grab`,drop:`${id}-drop`}}))
  };
}
test('character catalogs isolate idle and special pools even at 100 percent probability',()=>{
  const catalog=createCharacterCatalog(fixture());
  assert.equal(catalog.defaultId,'a');assert.equal(catalog.list().length,2);
  for(const id of ['a','b']) {
    const c=catalog.get(id),next=createActionScheduler(c.actions,()=>0);
    let state={...defaults(),action:`${id}-idle`,actionProbability:100};
    for(let i=0;i<20;i++) {
      state={...state,action:next(state)};
      assert.ok(state.action===`${id}-idle`||state.action===`${id}-special`);
    }
    assert.equal(configure(state,{action:`${id==='a'?'b':'a'}-idle`},c.actions).action,state.action);
  }
});
test('each character uses its own grab/drop and resumes its own idle',()=>{
  const catalog=createCharacterCatalog(fixture());
  for(const id of ['a','b']) {
    const c=catalog.get(id),drag=createDragAnimationController(c.actions,c.interactions);
    let state={...defaults(),action:`${id}-idle`};
    state={...state,...drag.begin(state)};assert.equal(state.action,`${id}-grab`);
    state={...state,...drag.moved(state)};assert.equal(state.playing,true);
    state={...state,...drag.complete(state)};assert.equal(state.frame,3);assert.equal(state.playing,false);
    state={...state,...drag.release(state)};assert.equal(state.action,`${id}-drop`);
    state={...state,...drag.complete(state)};assert.equal(state.action,`${id}-idle`);
    assert.equal(state.autoPlay,true);
  }
});
test('old one-character manifests remain compatible',()=>{
  const m=fixture();m.actions=m.actions.slice(0,4);m.interactions=m.characters[0].interactions;
  delete m.characters;delete m.defaultCharacter;
  const c=createCharacterCatalog(m);assert.equal(c.defaultId,'hanli');assert.equal(c.get('hanli').actions.length,4);
});
test('catalog rejects missing, duplicate, cross-owned, unassigned or wrong-role resources',()=>{
  const mutations=[
    m=>m.actions.push(m.actions[0]),
    m=>m.characters[1].actions[0]='a-idle',
    m=>m.characters[0].actions[0]='missing',
    m=>m.characters[0].actions.pop(),
    m=>m.characters[0].interactions.grab='b-grab',
    m=>m.characters[0].interactions.grab='a-special',
    m=>m.characters[0].actions=m.characters[0].actions.filter(id=>id!=='a-idle'),
    m=>m.characters[1].id='a',
    m=>m.defaultCharacter='missing'
  ];
  for(const mutate of mutations) {const m=fixture();mutate(m);assert.throws(()=>createCharacterCatalog(m));}
});
