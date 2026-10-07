'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {EventEmitter} = require('node:events');
const {panelBounds, createPanelWindowState} = require('../app/panel-window.cjs');
const primary = {workArea:{x:0,y:0,width:1536,height:824}};
const secondary = {workArea:{x:-1920,y:0,width:1920,height:1040}};
test('panel defaults to 900 × 600 DIP and restores saved dimensions on a connected monitor', () => {
  const initial = panelBounds(null,[primary],primary);
  assert.equal(initial.width,900); assert.equal(initial.height,600);
  const saved = {bounds:{x:-1700,y:50,width:1100,height:700}};
  const restored = panelBounds(saved,[primary,secondary],primary);
  for(const key of ['x','y','width','height'])assert.equal(restored[key],saved.bounds[key]);
});
test('unplugged monitors, changed work areas and corrupt dimensions cannot restore a window off screen', () => {
  const restored = panelBounds({bounds:{x:-1700,y:50,width:2400,height:1300}},[primary],primary);
  assert.ok(restored.x>=0&&restored.y>=0);
  assert.ok(restored.x+restored.width<=1536&&restored.y+restored.height<=824);
  assert.equal(panelBounds({bounds:{x:NaN,y:0,width:900,height:600}},[primary],primary).width,900);
  const small={workArea:{x:0,y:0,width:800,height:600}};
  const fit=panelBounds(null,[small],small);
  assert.ok(fit.width<=800&&fit.height<=600);assert.ok(fit.minWidth<=fit.width&&fit.minHeight<=fit.height);
});
test('normal size and maximized state persist separately, including quitting while minimized', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qingzhu-panel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'panel.json');
  const screen={getAllDisplays:()=>[primary],getPrimaryDisplay:()=>primary};
  const window=new EventEmitter();let maximized=false,minimized=false;
  window.isDestroyed=()=>false;window.isMaximized=()=>maximized;window.isMinimized=()=>minimized;
  window.getNormalBounds=()=>({x:40,y:30,width:1050,height:720});window.maximize=()=>{maximized=true;};
  const state=createPanelWindowState({file,screen});state.attach(window);state.flush();
  maximized=true;state.flush();minimized=true;maximized=false;state.dispose();
  const persisted=JSON.parse(fs.readFileSync(file));assert.equal(persisted.maximized,true);assert.equal(persisted.bounds.width,1050);
  minimized=false;const restored=createPanelWindowState({file,screen});assert.equal(restored.options.width,1050);
  restored.attach(window);assert.equal(maximized,true);restored.dispose();
});
