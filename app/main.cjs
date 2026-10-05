'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, net, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { defaults, configure, idleAction, createActionScheduler, frameDisplaySize } = require('./model.cjs');
const { createCharacterCatalog } = require('./characters.cjs');
const { createDragController } = require('./drag-controller.cjs');
const { createDragAnimationController } = require('./drag-animation.cjs');
const { createWindowMover } = require('./window-mover.cjs');
const {createPackManager}=require('./character-packs.cjs');
const {createFrameEdits}=require('./frame-edits.cjs');
const root = path.resolve(__dirname, '..');
const appIcon = path.join(root, 'assets', 'app.ico');
const trayIcon = path.join(root, 'assets', 'app.png');
const verifyEditor=process.argv.includes('--verify-editor');
const verifyPacks=process.argv.includes('--verify-packs');
const verifyCharacters = process.argv.includes('--verify-characters');
const verifyRestore = process.argv.find(arg => arg.startsWith('--verify-restore='))?.slice(17);
const verifying = process.argv.includes('--verify') || verifyPacks || verifyCharacters || !!verifyRestore || verifyEditor;
const verifyInstall=process.argv.find(arg=>arg.startsWith('--verify-install='))?.slice('--verify-install='.length);
// Installed application files are read-only; keep downloads and edits per user.
const data = verifyInstall ? path.resolve(verifyInstall) : verifying ? path.join(root,verifyPacks?'tests/results/fresh-data-'+Date.now():'tests/results/data') : app.isPackaged ? path.join(app.getPath('appData'),'青竹桌宠') : path.join(root,'数据');
fs.mkdirSync(data, { recursive: true });
app.setPath('userData', data);
app.setPath('sessionData', path.join(data, '浏览器缓存'));
app.setName('青竹桌宠');
if (process.platform === 'win32') app.setAppUserModelId('com.qingzhu.pet');
let pet, panel, board, editor, tray, timer, dragControl, windowMover, lastHit = null, polling = false, quitting = false;
let settings = defaults(), savedPosition = null, revision = 0, petSize = null, displaySize = null;
let boardReady = Promise.resolve();
// Keep release downloads compatible with HTTP/1.1 proxies.
app.commandLine.appendSwitch('disable-http2');
const downloadPackage=require('./github-download.cjs').createGitHubDownload((...args)=>net.fetch(...args));
const packs=createPackManager({root,data,fetch:(...args)=>{
  // This fixture route is available only in isolated first-install verification.
  // Normal users always download from the URL in the published catalog.
  if(verifyPacks&&process.argv.includes('--verify-packs-local'))return net.fetch(pathToFileURL(path.join(root,'release/character-packs',new URL(args[0]).pathname.split('/').pop())).href,args[1]);
  return downloadPackage(...args);
},onChange:()=>{if(panel)broadcast();}});
const frameEdits=createFrameEdits(data,(width,height,erased)=>{
  const bitmap=Buffer.alloc(width*height*4,255);
  for(let i=0;i<erased.length;i++)bitmap.fill(255-erased[i],i*4,i*4+4);
  return nativeImage.createFromBitmap(bitmap,{width,height}).toPNG();
});
let manifest,catalog,allActions,variants;
const actionCounts=Object.create(null);
function reloadLibrary(){
  manifest=packs.load().manifest;catalog=createCharacterCatalog(manifest);allActions=manifest.actions;
  for(const a of allActions)for(const f of a.frames){
    const resolved=path.resolve(a.assetsRoot,f.file);
    f.url=pathToFileURL(resolved).href;
    if(f.edgeMaskFile)f.edgeMaskUrl=pathToFileURL(path.resolve(a.assetsRoot,f.edgeMaskFile)).href;
  }
  variants=new Map(allActions.map(a=>{
    const repair=frameEdits.decorate(a,file=>pathToFileURL(file).href);
    const cleaned={...a,variant:'cleaned-v1'+repair};
    const blended=a.frames.every(f=>f.edgeMaskUrl)?{...cleaned,variant:'cleaned-v1:edge-blend-v1'+repair,frames:a.frames.map(f=>({...f,blendMaskUrl:f.edgeMaskUrl}))}:null;
    return [a.id,{cleaned,blended}];
  }));
  for(const a of allActions)if(a.role==='action'&&!(a.id in actionCounts))actionCounts[a.id]=0;
}
reloadLibrary();
let character = catalog.get(catalog.defaultId), actions = character.actions;
let scheduleAction = createActionScheduler(actions);
let dragAnimations = createDragAnimationController(actions, character.interactions);
settings.character = character.id;
function currentAnimation(id = settings.action) {
  const v=variants.get(id);return (settings.edgeBlend&&v.blended)||v.cleaned;
}
function installedLibrary(){
  endDrag();const preferences=dragAnimations.cancel();
  if(preferences)settings={...settings,...preferences};
  reloadLibrary();character=catalog.get(character.id);actions=character.actions;
  scheduleAction=createActionScheduler(actions);
  dragAnimations=createDragAnimationController(actions,character.interactions);
  settings=configure(settings,{},actions);
  revision++;resizePet();broadcast();save();return snapshot();
}
const settingsFile = path.join(data, 'settings.json');
try {
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const selected = (!verifying || verifyRestore) && catalog.has(saved.settings?.character) ? saved.settings.character : catalog.defaultId;
  character = catalog.get(selected); actions = character.actions;
  scheduleAction = createActionScheduler(actions);
  dragAnimations = createDragAnimationController(actions, character.interactions);
  settings.character = character.id;
  settings = configure(settings, { ...saved.settings, character: character.id, action: idleAction(actions).id, autoPlay: true, playing: true, visible: true, frame: 0 }, actions);
  if (Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y)) savedPosition = saved.position;
} catch { /* First launch uses defaults. */ }
function snapshot() {
  return { settings, revision, packs:packs.list(), characters: catalog.list(), character: {id: character.id, name: character.name}, interactions: character.interactions, interactionPhase: dragAnimations.phase, actionCounts: {...actionCounts}, idleId: idleAction(actions).id, starts: actions.map(a => { const v = currentAnimation(a.id); return { id: a.id, variant: v.variant, frame: v.frames[0] }; }), display: displaySize, actions: actions.map(a => ({ id: a.id, title: a.title, role: a.role, width: a.width, height: a.height, count: a.frames.length, duration: a.frames.reduce((s,f) => s + f.durationMs, 0) })), animation: currentAnimation() };
}
function save() {
  const body = { settings, position: savedPosition };
  fs.writeFileSync(settingsFile + '.tmp', JSON.stringify(body, null, 2));
  fs.renameSync(settingsFile + '.tmp', settingsFile);
}
function broadcast() {
  for (const win of [pet, panel]) if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
}
function freePosition(x, y) {
  // Transparent padding may extend beyond the desktop; dragging has no screen clamp.
  return { x: Math.round(x), y: Math.round(y) };
}
function movePet(x, y) {
  // Windows moves the native window without resizing it. The configured
  // dimensions are used only by the fallback on other platforms.
  const size = petSize || pet.getBounds();
  windowMover.move(x,y,size);
}
function resizePet() {
  const a = snapshot().animation;
  const display = petSize ? screen.getDisplayMatching(pet.getBounds()) : screen.getPrimaryDisplay(), area = display.workArea;
  displaySize = frameDisplaySize(a, settings.scale, display);
  const width = Math.max(160, Math.ceil(displaySize.width + 16)), height = Math.ceil(displaySize.height + 42);
  const old = petSize ? pet.getBounds() : savedPosition || { x: area.x + area.width - width - 60, y: area.y + area.height - height - 20 };
  petSize = { width, height };
  const pos = freePosition(old.x, old.y);
  pet.setBounds({ ...pos, width, height });
  savedPosition = pos;
  lastHit = null;
}
function centerOnDesktop() {
  endDrag();
  const area=screen.getPrimaryDisplay().workArea,b=pet.getBounds();
  const pos=freePosition(area.x+(area.width-b.width)/2,area.y+(area.height-b.height)/2);
  movePet(pos.x,pos.y);savedPosition=pos;
  settings.visible=true;pet.showInactive();lastHit=null;broadcast();save();
}

let editorReady;
async function showEditor(){
  endDrag();const preferences=dragAnimations.cancel();
  update({...preferences,autoPlay:false,playing:false});
  if(!editor||editor.isDestroyed()){
    const area=screen.getPrimaryDisplay().workArea;
    editor=new BrowserWindow({width:Math.min(1100,area.width-32),height:Math.min(820,area.height-32),minWidth:720,minHeight:540,title:'青竹桌宠 · 透明帧修补',icon:appIcon,backgroundColor:'#202824',autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    editor.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    editor.webContents.on('will-navigate',e=>e.preventDefault());
    editor.webContents.on('will-prevent-unload',event=>{
      const answer=dialog.showMessageBoxSync(editor,{type:'question',title:'还有未保存的修补',message:'关闭会放弃未保存的帧修补。',buttons:['继续编辑','放弃未保存修改'],defaultId:0,cancelId:0});
      if(answer===1)event.preventDefault();
    });
    editor.on('closed',()=>{editor=null;});
    editorReady=editor.loadFile(path.join(__dirname,'frame-editor.html'));
  }
  await editorReady;editor.show();editor.focus();return {opened:true};
}
function editorOnly(event){if(!editor||event.sender!==editor.webContents)throw Error('请从透明帧修补工具操作');}
function editAction(id){const action=allActions.find(a=>a.id===id);if(!action)throw Error('动画不存在');return action;}

function showPanel() { panel.show(); panel.focus(); }
async function showBoard() {
  if (!board || board.isDestroyed()) {
    const area = screen.getDisplayNearestPoint(panel.getBounds()).workArea;
    const width = Math.min(840, area.width - 32), height = Math.min(760, area.height - 48);
    board = new BrowserWindow({
      width, height, minWidth: Math.min(440,width), minHeight: Math.min(360,height),
      x: area.x + Math.round((area.width-width)/2), y: area.y + Math.round((area.height-height)/2),
      title: '背景检查板', icon:appIcon, backgroundColor:'#d5d5d5', autoHideMenuBar:true, show:false,
      webPreferences: { preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true }
    });
    board.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    board.webContents.on('will-navigate',e => e.preventDefault());
    board.on('close',e => { if(!quitting){e.preventDefault();board.hide();} });
    boardReady=board.loadFile(path.join(__dirname,'board.html'));
  }
  await boardReady;
  if(board.isMinimized()) board.restore();
  board.show(); board.focus();
}
async function placeOnBoard() {
  await showBoard();
  endDrag();
  const rect = await board.webContents.executeJavaScript(`(() => {const r=document.getElementById('surface').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
  const canvas = await pet.webContents.executeJavaScript(`(() => {const r=document.getElementById('canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
  const content = board.getContentBounds();
  // Center the animation itself, excluding the invisible toolbar beneath it.
  const pos = freePosition(content.x+rect.x+rect.width/2-canvas.x-canvas.width/2,content.y+rect.y+rect.height/2-canvas.y-canvas.height/2);
  movePet(pos.x,pos.y); savedPosition=pos;
  settings.visible=true;pet.showInactive();lastHit=null;broadcast();save();
}
function arrangeWindows() {
  const area=screen.getDisplayMatching(board.getBounds()).workArea;
  const b=board.getBounds(),p=panel.getBounds(),gap=16,total=b.width+p.width+gap;
  if(total<=area.width-32) {
    const left=area.x+Math.round((area.width-total)/2);
    board.setBounds({...b,x:left});
    panel.setBounds({...p,x:left+b.width+gap,y:Math.max(area.y,Math.min(b.y,area.y+area.height-p.height))});
  } else {
    panel.setBounds({...p,x:area.x+area.width-p.width-8,y:area.y+8});
  }
}
function update(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置格式不正确');
  const before = settings;
  const beforeClip = allActions.find(a => a.id === before.action);
  const switching = typeof patch.character === 'string' && patch.character !== character.id;
  if (typeof patch.character === 'string' && !catalog.has(patch.character)) throw new Error('角色不存在');
  if (switching) {
    endDrag();
    const preferences = dragAnimations.cancel();
    character = catalog.get(patch.character); actions = character.actions;
    scheduleAction = createActionScheduler(actions);
    dragAnimations = createDragAnimationController(actions, character.interactions);
    settings = {...settings, ...preferences, character: character.id};
    patch = {...patch, action: idleAction(actions).id, frame: 0, autoPlay: true, playing: true};
    lastHit = null;
  }
  settings = configure(settings, patch, actions);
  if (switching || before.action !== settings.action || 'frame' in patch || before.playing !== settings.playing || before.loop !== settings.loop || before.autoPlay !== settings.autoPlay || before.edgeBlend !== settings.edgeBlend) revision++;
  const afterClip = actions.find(a => a.id === settings.action);
  if (before.scale !== settings.scale || beforeClip.width !== afterClip.width || beforeClip.height !== afterClip.height) resizePet();
  if (settings.visible) pet.showInactive(); else pet.hide();
  broadcast(); save(); return snapshot();
}
function endDrag() { dragControl?.stop(); }
function onDragMove() {
  const patch = dragAnimations.moved(settings);
  if (patch) update(patch);
}
function authorized(event) { return [pet, panel, board, editor].some(w => w && !w.isDestroyed() && w.webContents === event.sender); }
function handle(name, fn) { ipcMain.handle(name, (event, ...args) => { if (!authorized(event)) throw new Error('非法调用'); return fn(event, ...args); }); }
if (!app.requestSingleInstanceLock() && !verifying) app.quit();
else {
  app.on('second-instance', () => { if (panel && pet) { centerOnDesktop();showPanel(); } });
  app.whenReady().then(async () => {
    const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };
    panel = new BrowserWindow({ width: 360, height: 800, minWidth: 320, minHeight: 540, title: '青竹桌宠', icon:appIcon, backgroundColor: '#202522', autoHideMenuBar: true, show: false, webPreferences });
    pet = new BrowserWindow({ width: 266, height: 416, icon:appIcon, transparent: true, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, webPreferences });
    pet.setAlwaysOnTop(true, 'screen-saver');
    windowMover = createWindowMover(pet,screen);
    dragControl = createDragController({
      // Verification supplies movement signals without touching the user's cursor.
      getCursor: verifying ? () => ({ x: 0, y: 0 }) : () => screen.getCursorScreenPoint(),
      getBounds: () => pet.getBounds(),
      clamp: freePosition,
      move: movePet,
      onStart: () => {
        windowMover.beginDrag();
        const patch = dragAnimations.begin(settings);
        if (patch) update(patch);
      },
      onStop: () => windowMover.endDrag(),
      onMove: onDragMove,
      onEnd: () => {
        resizePet(); // Apply the destination monitor DPI after a drag.
        const b = pet.getBounds(); savedPosition = { x: b.x, y: b.y };
        pet.webContents.send('drag-end'); lastHit = null;
        const patch = quitting ? null : dragAnimations.release(settings);
        if (patch) update(patch); else save();
      }
    });
    for (const win of [panel, pet]) {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', e => e.preventDefault());
    }
    handle('snapshot', () => snapshot());
    handle('configure', (_, patch) => {
      if (typeof patch?.character === 'string' && !catalog.has(patch.character)) throw new Error('角色不存在');
      if (patch && typeof patch === 'object' && ('action' in patch || 'autoPlay' in patch || 'character' in patch)) {
        endDrag();
        const preferences = dragAnimations.cancel();
        if (preferences) patch = { ...preferences, ...patch };
      }
      return update(patch);
    });

    handle('editor-open',()=>showEditor());
    handle('editor-list',event=>{
      editorOnly(event);return {maskFormat:2,batchSave:true,characters:catalog.list(),character:character.id,action:settings.action,frame:settings.frame,actions:catalog.list().flatMap(c=>catalog.get(c.id).actions.map(a=>({id:a.id,title:a.title,characterId:c.id,width:a.width,height:a.height,count:a.frames.length})))};
    });
    handle('editor-load',(event,id,index)=>{
      editorOnly(event);const action=editAction(id),record=frameEdits.read(action,index);
      return {maskFormat:2,url:action.frames[index].url,baseSha:action.frames[index].sha256,erased:record.erased};
    });
    handle('editor-save-batch',(event,items)=>{
      editorOnly(event);
      if(!Array.isArray(items)||items.length<1||items.length>2048||items.reduce((sum,item)=>sum+(item?.erased?.length||0),0)>134217728)throw Error('本批修补数据过大或格式不正确');
      const result=frameEdits.saveBatch(items.map(item=>({action:editAction(item.actionId),index:item.index,expectedSha:item.baseSha,erased:item.erased})));
      installedLibrary();return result;
    });
    handle('editor-save',(event,id,index,baseSha,erased)=>{
      editorOnly(event);const result=frameEdits.save(editAction(id),index,baseSha,erased);installedLibrary();return result;
    });
    handle('pack-install', async (event,id)=>{
      if(event.sender!==panel.webContents)throw new Error('请从设置面板安装人物');
      await packs.install(id);return installedLibrary();
    });
    handle('pack-import', async event=>{
      if(event.sender!==panel.webContents)throw new Error('请从设置面板导入人物');
      const selected=await dialog.showOpenDialog(panel,{title:'导入人物资源包',properties:['openFile'],filters:[{name:'青竹桌宠人物包',extensions:['qzpet']}]});
      if(selected.canceled)return snapshot();
      await packs.importFile(selected.filePaths[0]);return installedLibrary();
    });
    handle('pack-cancel',()=>packs.cancel());
    handle('panel', () => showPanel());
    handle('board-open', () => showBoard());
    handle('board-close', () => board?.hide());
    handle('board-place', () => placeOnBoard());
    handle('quit', () => app.quit());
    handle('drag-start', event => {
      if (event.sender !== pet.webContents) return;
      dragControl.start();
      pet.setIgnoreMouseEvents(false); lastHit = true;
      return snapshot();
    });
    handle('drag-end', () => endDrag());
    ipcMain.on('progress', (event, frame, rev) => {
      if (event.sender !== pet.webContents || rev !== revision || !Number.isInteger(frame)) return;
      settings.frame = Math.max(0, Math.min(snapshot().animation.frames.length - 1, frame));
      panel.webContents.send('progress', settings.frame);
    });
    handle('ended', (event, rev) => {
      if (event.sender !== pet.webContents || rev !== revision || !settings.playing) return snapshot();
      const resume = dragAnimations.complete(settings);
      if (resume) return update(resume);
      if (settings.autoPlay) {
        const chosen = scheduleAction(settings);
        if (actions.find(a => a.id === settings.action)?.role === 'idle' && chosen in actionCounts) actionCounts[chosen]++;
        return update({ action: chosen, frame: 0, playing: true });
      }
      if (!settings.loop) return update({ playing: false, frame: currentAnimation().frames.length - 1 });
      return snapshot();
    });
    await Promise.all([panel.loadFile(path.join(__dirname, 'panel.html')), pet.loadFile(path.join(__dirname, 'pet.html'))]);
    resizePet(); broadcast();
    pet.showInactive();panel.showInactive();
    const requestedBoard=process.argv.find(arg=>arg.startsWith('--board='))?.slice(8);
    if(['checker','black','dark','white','blue','pink'].includes(requestedBoard)) {
      await showBoard();arrangeWindows();await placeOnBoard();
      await board.webContents.executeJavaScript(`document.querySelector('[data-mode="${requestedBoard}"]').click()`);
    }
    panel.on('close', event => { if (!quitting) { event.preventDefault(); panel.hide(); } });
    pet.on('close', event => { if (!quitting) { event.preventDefault(); update({ visible: false }); showPanel(); } });
    const trayImage = nativeImage.createFromPath(trayIcon);
    if (trayImage.isEmpty()) throw new Error('软件图标无法加载');
    tray = new Tray(trayImage.resize({ width: 20, height: 20 }));
    tray.setToolTip('青竹桌宠 · 双击打开设置');
    tray.on('double-click', showPanel);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开测试面板', click: showPanel }, { label: '打开背景检查板', click: () => showBoard().catch(console.error) }, { label: '找回桌宠（重新居中）', click: centerOnDesktop }, { label: '显示桌宠', click: () => update({ visible: true }) }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]));
    timer = setInterval(async () => {
      if (pet.isDestroyed() || !pet.isVisible()) return;
      if (dragControl.active) return;
      const point = screen.getCursorScreenPoint();
      if (polling) return;
      polling = true;
      try {
        const b = pet.getBounds(), x = point.x - b.x, y = point.y - b.y;
        const hit = x >= 0 && y >= 0 && x < b.width && y < b.height && await pet.webContents.executeJavaScript(`window.hitTest(${x},${y})`);
        if (!dragControl.active && hit !== lastHit) {
          pet.setIgnoreMouseEvents(!hit, { forward: true });
          pet.webContents.send('hover', !!hit); lastHit = hit;
        }
      } catch { /* Window may close during a poll. */ } finally { polling = false; }
    }, 70);
    pet.on('blur', () => { if (!verifying) endDrag(); });
    if(!verifying&&process.argv.includes('--edit-frames'))await showEditor();
    if(verifyInstall)await require('./install-check.cjs')({app,pet,panel,data,root,update,snapshot,showEditor,getEditor:()=>editor,packs});
    if (verifying) await require(verifyEditor ? '../tests/verify-frame-editor.cjs' : verifyRestore ? '../tests/verify-restore.cjs' : verifyPacks ? '../tests/verify-packs.cjs' : verifyCharacters ? '../tests/verify-characters.cjs' : '../tests/verify.cjs')({ app, pet, panel, getBoard: () => board, movePet, update, snapshot, root, data, windowMover, freePosition, onDragMove, verifyRestore, showEditor, getEditor:()=>editor });
  }).catch(error => { fs.writeFileSync(path.join(data, '错误日志.txt'), error.stack || String(error)); console.error(error); app.quit(); });
}
app.on('before-quit', () => { quitting = true; clearInterval(timer); dragControl?.dispose(); if (pet && !pet.isDestroyed()) savedPosition = { x: pet.getBounds().x, y: pet.getBounds().y }; save(); });
app.on('window-all-closed', () => app.quit());
