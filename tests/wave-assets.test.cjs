const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createActionScheduler,defaults}=require('../app/model.cjs');
const packs=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/character-packs.json'),'utf8')).packs;
test('each downloadable greeting belongs to its character and its action pool remains isolated',()=>{
  const greetings=packs.filter(p=>p.actions.some(a=>a.id.endsWith('-wave')));assert.deepEqual(greetings.map(p=>p.id).sort(),packs.filter(p=>p.id!=='hanli').map(p=>p.id).sort());
  for(const p of greetings){
    assert.ok(p.actions.every(a=>a.id.startsWith(p.id+'-')));
    const actions=p.actions.map(a=>({...a,frames:Array.from({length:2},()=>({durationMs:50}))}));
    const idle=actions.find(a=>a.role==='idle'),wave=actions.find(a=>a.id===p.id+'-wave');assert.equal(wave.role,'action');
    const schedule=createActionScheduler(actions,()=>.25),s={...defaults(),action:idle.id,actionProbability:0};
    assert.equal(schedule(s),idle.id);s.actionProbability=100;s.action=schedule(s);assert.equal(s.action,wave.id);
    s.action=schedule(s);assert.equal(s.action,idle.id);
  }
});
