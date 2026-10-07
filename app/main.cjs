'use strict';
const { app, BrowserWindow, BaseWindow, WebContentsView, ipcMain, screen, Tray, Menu, nativeImage, net, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { defaults, configure, idleAction, createActionScheduler, frameDisplaySize } = require('./model.cjs');
const { createCharacterCatalog } = require('./characters.cjs');
const { createDragController } = require('./drag-controller.cjs');
const { createDragAnimationController } = require('./drag-animation.cjs');
const { createWindowMover } = require('./window-mover.cjs');
const { createPanelWindowState } = require('./panel-window.cjs');
const { createSharedSurface } = require('./shared-surface.cjs');
const { characterDirectory, isPackagedRuntime } = require('./development-paths.cjs');
const {createPackManager}=require('./character-packs.cjs');
const {createFrameWriter}=require('./frame-writer.cjs');
const {createHash}=require('node:crypto');
const root = path.resolve(__dirname, '..');
const appIcon = path.join(root, 'assets', 'app.ico');
const trayIcon = path.join(root, 'assets', 'app.png');
const verifying=process.argv.includes('--verify-client');
// Installed application files are read-only; keep downloads and edits per user.
const packagedRuntime=isPackagedRuntime({isPackaged:app.isPackaged,appPath:app.getAppPath()});
const installedMode=packagedRuntime||(verifying&&process.argv.includes('--verify-installed'));
const development=!installedMode&&fs.existsSync(path.join(root,'developer/main.cjs'));
let developmentTools;
const userDataDirectory=packagedRuntime ? path.join(app.getPath('appData'),'青竹桌宠') : path.join(root,'数据');
const data = verifying ? path.join(root,'tests/results/client-data-'+Date.now()) : userDataDirectory;
fs.mkdirSync(data, { recursive: true });
app.setPath('userData', data);
app.setPath('sessionData', path.join(data, '浏览器缓存'));
app.setName('青竹桌宠');
if (process.platform === 'win32') app.setAppUserModelId('com.qingzhu.pet');
let pet, player, surface, panelReady=false, panel, editor, tray, timer, dragControl, windowMover, lastHit = null, polling = false, quitting = false;
let settings = defaults(), savedPosition = null, revision = 0, petSize = null, displaySize = null;
// Keep release downloads compatible with HTTP/1.1 proxies.
app.commandLine.appendSwitch('disable-http2');
let updateFixture;
const downloadPackage=require('./github-download.cjs').createGitHubDownload((...args)=>net.fetch(...args));
const sourceCharactersDirectory=characterDirectory({root,data:userDataDirectory,packaged:packagedRuntime,verifying:false});
const charactersDirectory=verifying?path.join(data,'characters'):sourceCharactersDirectory;
if(verifying)require('../tests/client-fixtures.cjs')(sourceCharactersDirectory,charactersDirectory);
if(verifying&&installedMode)updateFixture=require('../tests/update-fixture.cjs')({root,charactersDirectory});
const fetchRemote=(...args)=>updateFixture?updateFixture.fetch(...args):net.fetch(...args);
const fetchDownload=(...args)=>updateFixture?updateFixture.download(...args):downloadPackage(...args);
const frameWriter=createFrameWriter({data,roots:verifying?[charactersDirectory]:[charactersDirectory,path.join(root,'assets')]});
const inspectInstalled=development?entries=>require('../developer/pack-builder.cjs').scanCharacters(charactersDirectory,{packs:entries},new Set(JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'))).characters.map(c=>c.id))):undefined;
const packs=createPackManager({root,data,charactersDirectory,fetch:fetchDownload,catalogFetch:fetchRemote,inspectInstalled,allowUnlistedImport:development,allowBuiltinUpdates:installedMode,appVersion:app.getVersion(),onChange:()=>{if(panel)broadcast();}});
let updates;
let manifest,catalog,allActions,variants;
const actionCounts=Object.create(null);
function reloadLibrary(){
  manifest=packs.load().manifest;catalog=createCharacterCatalog(manifest);allActions=manifest.actions;
  for(const a of allActions)for(const f of a.frames){
    const resolved=path.resolve(a.assetsRoot,f.file);
    f.url=pathToFileURL(resolved).href+'?v='+f.sha256;
    if(f.edgeMaskFile)f.edgeMaskUrl=pathToFileURL(path.resolve(a.assetsRoot,f.edgeMaskFile)).href;
  }
  variants=new Map(allActions.map(a=>{
    const repair=':'+createHash('sha256').update(a.frames.map(f=>f.sha256).join('|')).digest('hex');
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
  reloadLibrary();character=catalog.get(catalog.has(character.id)?character.id:catalog.defaultId);actions=character.actions;settings.character=character.id;
  scheduleAction=createActionScheduler(actions);
  dragAnimations=createDragAnimationController(actions,character.interactions);
  settings=configure(settings,{},actions);
  revision++;resizePet();broadcast();save();return snapshot();
}
function playInstalledCharacter(id){
  installedLibrary();
  return update({character:id,action:idleAction(catalog.get(id).actions).id,frame:0,visible:true,autoPlay:true,playing:true});
}
const settingsFile = path.join(data, 'settings.json');
try {
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const selected = !verifying && catalog.has(saved.settings?.character) ? saved.settings.character : catalog.defaultId;
  character = catalog.get(selected); actions = character.actions;
  scheduleAction = createActionScheduler(actions);
  dragAnimations = createDragAnimationController(actions, character.interactions);
  settings.character = character.id;
  settings = configure(settings, { ...saved.settings, character: character.id, action: idleAction(actions).id, autoPlay: true, playing: true, visible: true, frame: 0 }, actions);
  if (Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y)) savedPosition = saved.position;
} catch { /* First launch uses defaults. */ }
function snapshot() {
  return { development,updates:updates?.snapshot(),presentation:surface?.mode||'desktop', settings, revision, packs:packs.list(), characters: catalog.list(), character: {id: character.id, name: character.name}, interactions: character.interactions, interactionPhase: dragAnimations.phase, actionCounts: {...actionCounts}, idleId: idleAction(actions).id, starts: actions.map(a => { const v = currentAnimation(a.id); return { id: a.id, variant: v.variant, frame: v.frames[0] }; }), display: displaySize, actions: actions.map(a => ({ id: a.id, title: a.title, role: a.role, width: a.width, height: a.height, count: a.frames.length, duration: a.frames.reduce((s,f) => s + f.durationMs, 0) })), animation: currentAnimation() };
}
function save() {
  const body = { settings, position: savedPosition };
  fs.writeFileSync(settingsFile + '.tmp', JSON.stringify(body, null, 2));
  fs.renameSync(settingsFile + '.tmp', settingsFile);
}
function broadcast() {
  const state=snapshot();
  for (const win of [player, panelReady&&panel?.isVisible()?panel:null]) if (win && !win.webContents.isDestroyed()) win.webContents.send('state', state);
}
function freePosition(x, y) {
  // Transparent padding may extend beyond the desktop; dragging has no screen clamp.
  return { x: Math.round(x), y: Math.round(y) };
}
function movePet(x, y) {
  // Windows moves the native window without resizing it. The configured
  // dimensions are used only by the fallback on other platforms.
  if(surface?.hosted){surface.move(x,y);return;}
  const size = petSize || pet.getBounds();
  windowMover.move(x,y,size);
}
function resizePet() {
  const a = currentAnimation();
  const display = petSize ? screen.getDisplayMatching(surface?.hosted?panel.getBounds():pet.getBounds()) : screen.getPrimaryDisplay(), area = display.workArea;
  displaySize = frameDisplaySize(a, settings.scale, display);
  const width = Math.max(160, Math.ceil(displaySize.width + 16)), height = Math.ceil(displaySize.height + 42);
  const old = petSize ? pet.getBounds() : savedPosition || { x: area.x + area.width - width - 60, y: area.y + area.height - height - 20 };
  petSize = { width, height };
  const pos = freePosition(old.x, old.y);
  if(!surface?.hosted){pet.setBounds({ ...pos, width, height });savedPosition = pos;}
  surface?.setSize({width,height},{x:(width-displaySize.width)/2,y:height-displaySize.height-34,...displaySize});
  lastHit = null;
}
function centerOnDesktop() {
  hidePanel();endDrag();
  const area=screen.getPrimaryDisplay().workArea,b=pet.getBounds();
  const pos=freePosition(area.x+(area.width-b.width)/2,area.y+(area.height-b.height)/2);
  movePet(pos.x,pos.y);savedPosition=pos;
  settings.visible=true;pet.showInactive();lastHit=null;broadcast();save();
}

let petMenu,contextMenuOpen=false;
let panelWindowState;
let editorReady,quitRequested=false;
async function showEditor(){
  endDrag();const preferences=dragAnimations.cancel();
  update({...preferences,autoPlay:false,playing:false});
  if(!editor||editor.isDestroyed()){
    const area=screen.getPrimaryDisplay().workArea;
    editor=new BrowserWindow({width:Math.min(1100,area.width-32),height:Math.min(820,area.height-32),minWidth:720,minHeight:540,title:'青竹桌宠 · 透明帧修补',icon:appIcon,backgroundColor:'#202824',autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    editor.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    editor.webContents.on('will-navigate',e=>e.preventDefault());
    editor.webContents.on('will-prevent-unload',()=>{editor.show();editor.focus();editor.webContents.send('editor-confirm-close');});
    editor.on('closed',()=>{editor=null;if(quitRequested){quitRequested=false;app.quit();}});
    editorReady=editor.loadFile(path.join(__dirname,'frame-editor.html'));
  }
  await editorReady;editor.show();editor.focus();return {opened:true};
}
function editorOnly(event){if(!editor||event.sender!==editor.webContents)throw Error('请从透明帧修补工具操作');}
function editAction(id){const action=allActions.find(a=>a.id===id);if(!action)throw Error('动画不存在');return action;}

function enterPanel() {
  if(!panelReady || !panel.isVisible() || panel.isMinimized())return;
  endDrag();
  if(surface.attach()){resizePet();broadcast();}
}
function leavePanel() {
  if(!surface?.hosted)return;
  endDrag();const preferences=dragAnimations.cancel();if(preferences)settings={...settings,...preferences};
  surface.detach();resizePet();
  if(!settings.autoPlay||!settings.playing)update({visible:true,autoPlay:true,playing:true,action:idleAction(actions).id,frame:0});
  else{settings.visible=true;pet.showInactive();broadcast();save();}
}
// Experimental desktop memory mode: keep the player alive, unload only the
// hidden gallery after a grace period. Quick round trips need no page reload.
let panelSleepTimer, panelLoad, panelSleeping=false, panelWanted=false, panelImporting=false;
function loadPanel(file) {
  const pending=panel.loadFile(path.join(__dirname,file));
  panelLoad=pending;
  pending.finally(()=>{if(panelLoad===pending)panelLoad=null;}).catch(()=>{});
  return pending;
}
function schedulePanelSleep() {
  clearTimeout(panelSleepTimer);
  panelSleepTimer=setTimeout(async()=>{
    // Keep in-flight import/delete dialogs and their completion handlers alive.
    if(quitting||panelWanted||panel.isVisible()||panelLoad||panelImporting||['downloading','verifying','installing'].includes(packs.list().transfer.status)){if(!quitting&&!panelWanted)schedulePanelSleep();return;}
    try {
      const busy=await panel.webContents.executeJavaScript("typeof removing!=='undefined' && removing");
      if(quitting||panelWanted||panel.isVisible())return;
      if(busy){schedulePanelSleep();return;}
      panelReady=false;panelSleeping=true;
      await loadPanel('panel-sleep.html');
    } catch(error) {console.error('主界面休眠失败：',error.message);}
  },3000);
}
function hidePanel() {
  panelWanted=false;leavePanel();panel?.setSkipTaskbar(true);panel?.hide();schedulePanelSleep();
}
async function showPanel() {
  panelWanted=true;clearTimeout(panelSleepTimer);
  try {
    while(panelLoad)await panelLoad;
    if(panelSleeping){panelSleeping=false;await loadPanel('panel.html');panelReady=true;}
    if(quitting||!panelWanted){if(!quitting)schedulePanelSleep();return;}
    panel.setSkipTaskbar(false);
    if(panel.isMinimized())panel.restore();panel.show();enterPanel();broadcast();panel.focus();
  } catch(error) {panelSleeping=true;console.error('主界面恢复失败：',error.message);}
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
  if (!surface?.hosted) {if (settings.visible) pet.showInactive(); else pet.hide();}
  broadcast(); save(); return snapshot();
}
function endDrag() { dragControl?.stop(); }
function onDragMove() {
  const patch = dragAnimations.moved(settings);
  if (patch) update(patch);
}
function authorized(event) { return [player, panel, editor].some(w => w && !w.webContents.isDestroyed() && w.webContents === event.sender); }
function handle(name, fn) { ipcMain.handle(name, (event, ...args) => { if (!authorized(event)) throw new Error('非法调用'); return fn(event, ...args); }); }
if (!app.requestSingleInstanceLock() && !verifying) app.quit();
else {
  app.on('second-instance', () => { if (panel && pet) { centerOnDesktop();showPanel(); } });
  app.whenReady().then(async () => {
    const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };
    panelWindowState = createPanelWindowState({file:path.join(data,'panel-window.json'),screen});
    panel = new BrowserWindow({ ...panelWindowState.options, title: '青竹桌宠', icon:appIcon, backgroundColor: '#3b3023', titleBarStyle: 'hidden', titleBarOverlay: {color:'#3b3023',symbolColor:'#efdfbb',height:34}, autoHideMenuBar: true, show: false, webPreferences:{...webPreferences,backgroundThrottling:true} });
    panelWindowState.attach(panel);
    pet = new BaseWindow({ width: 266, height: 416, icon:appIcon, transparent: true, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false });
    player = new WebContentsView({webPreferences});
    surface = createSharedSurface({desktop:pet,panel,view:player});
    pet.on('closed',()=>{if(!player.webContents.isDestroyed())player.webContents.close();});
    pet.setAlwaysOnTop(true, 'screen-saver');
    windowMover = createWindowMover(pet,screen);
    dragControl = createDragController({
      // Verification supplies movement signals without touching the user's cursor.
      getCursor: verifying ? () => ({ x: 0, y: 0 }) : () => screen.getCursorScreenPoint(),
      getBounds: () => surface.bounds(),
      clamp: (x,y) => surface.clamp(x,y),
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
        const b = pet.getBounds(); if(!surface.hosted)savedPosition = { x: b.x, y: b.y };
        player.webContents.send('drag-end'); lastHit = null;
        const patch = quitting ? null : dragAnimations.release(settings);
        if (patch) update(patch); else save();
      }
    });
    for (const win of [panel, player]) {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', e => e.preventDefault());
    }
    handle('snapshot', () => ({...snapshot(),development}));
    const panelOnly=event=>{if(event.sender!==panel.webContents)throw Error('请从主界面操作更新');};
    updates=require('./update-service.cjs').createUpdateService({data,installed:installedMode,version:app.getVersion(),packs,fetch:fetchRemote,downloadFetch:fetchDownload,
      onChange:()=>{broadcast();if(tray)tray.setToolTip('青竹桌宠'+(updates?.snapshot().software.availableVersion?' · 有软件更新':''));},
      onInstalled:()=>installedLibrary(),canUpdate:()=>!frameWriter.busy&&!(editor&&!editor.isDestroyed())&&!panelImporting});
    handle('pack-check-updates',async event=>{panelOnly(event);await updates.checkCharacters();return snapshot();});
    handle('update-preferences',(event,patch)=>{panelOnly(event);updates.configure(patch);return snapshot();});
    handle('software-check',async event=>{panelOnly(event);await updates.software.check();return snapshot();});
    handle('software-download',async event=>{panelOnly(event);await updates.software.download();return snapshot();});
    handle('software-cancel',event=>{panelOnly(event);updates.software.cancel();});
    handle('software-install',async event=>{
      panelOnly(event);if(!installedMode)throw Error('请在安装版中更新软件');
      if(frameWriter.busy||editor&&!editor.isDestroyed()||packs.busy||updates.characterBusy)throw Error('请先完成当前人物操作并关闭修补窗口');
      const installer=await updates.software.prepareInstall();
      if(verifying)throw Error('自动验收仅验证安装包，禁止启动安装程序');
      await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(installer,[],{detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
      app.quit();
    });
    handle('pack-update',async(event,id)=>{
      if(event.sender!==panel.webContents)throw Error('请从主界面更新人物');
      if(frameWriter.busy||editor&&!editor.isDestroyed())throw Error('请先保存并关闭修补工具');
      const entry=packs.list().entries.find(p=>p.id===id);
      if(!entry?.updateAvailable)throw Error('此人物没有可用更新');
      const answer=await dialog.showMessageBox(panel,{type:'question',buttons:['取消','更新人物'],defaultId:0,cancelId:0,
        message:'拉取「'+entry.name+'」？',detail:'将使用 GitHub 上的人物内容替换本地内容，本地修补不会合并。当前人物资源文件夹会保留备份。'});
      if(answer.response!==1)return snapshot();
      await packs.install(id);return installedLibrary();
    });
    if(development)developmentTools=require('../developer/main.cjs')({app,BrowserWindow,ipcMain,panel,root,data,charactersDirectory,fetch:(...args)=>net.fetch(...args),verifying});
    handle('developer-publisher',event=>{
      if(!development||!developmentTools)throw Error('此功能仅供本地开发版使用');
      return developmentTools.open(event);
    });
    handle('pet-context-menu',event=>{
      if(event.sender!==player.webContents)throw Error('请从人物打开菜单');
      endDrag();petMenu?.closePopup();
      const wasPlaying=settings.playing;
      petMenu=Menu.buildFromTemplate([{label:'设置',click:showPanel},{label:wasPlaying?'暂停':'播放',click:()=>update({playing:!wasPlaying})}]);
      contextMenuOpen=true;
      petMenu.popup({window:surface.hosted?panel:pet,callback:()=>{contextMenuOpen=false;lastHit=null;}});
      return {opened:true};
    });
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
      editorOnly(event);return {maskFormat:2,batchSave:true,directWrite:true,characters:catalog.list(),character:character.id,action:settings.action,frame:settings.frame,actions:catalog.list().flatMap(c=>catalog.get(c.id).actions.map(a=>({id:a.id,title:a.title,characterId:c.id,width:a.width,height:a.height,count:a.frames.length})))};
    });
    handle('editor-load',(event,id,index)=>{
      editorOnly(event);const action=editAction(id);if(!Number.isInteger(index)||index<0||index>=action.frames.length)throw Error('帧编号不合法');
      return {maskFormat:2,url:action.frames[index].url,baseSha:action.frames[index].sha256,erased:new Uint8Array(action.width*action.height)};
    });
    handle('editor-save-batch',async(event,items)=>{
      editorOnly(event);
      if(!Array.isArray(items)||items.length<1||items.length>2048||items.reduce((sum,item)=>sum+(item?.erased?.length||0),0)>134217728)throw Error('本批修补数据过大或格式不正确');
      const result=await frameWriter.saveBatch(items.map(item=>({action:editAction(item.actionId),index:item.index,expectedSha:item.baseSha,erased:item.erased})));
      installedLibrary();return result;
    });
    handle('editor-cancel-close',event=>{editorOnly(event);quitRequested=false;});
    handle('editor-discard-close',event=>{editorOnly(event);if(frameWriter.busy)throw Error('正在保存，请稍候');editor.close();});
    handle('pack-remove',async(event,id)=>{
      if(event.sender!==panel.webContents)throw Error('请从人物列表删除人物包');
      if(frameWriter.busy)throw Error('正在保存修补，请稍候');
      if(editor&&!editor.isDestroyed()){editor.show();editor.focus();throw Error('请先保存并关闭透明帧修补工具，再删除人物包');}
      const entry=packs.list().entries.find(p=>p.id===id);if(!entry?.removable)throw Error('此人物不能删除');
      const previous=character.id;if(previous===id)update({character:catalog.defaultId});
      try{await packs.remove(id);return installedLibrary();}catch(error){if(previous===id)update({character:previous});throw error;}
    });
    handle('manual-download',async(event,id)=>{
      if(event.sender!==panel.webContents)throw Error('请从设置面板打开下载页');
      let url='https://github.com/WuJiaJun1020/qingzhu-pet/releases/latest';
      if(id!==null){
        const entry=packs.list().entries.find(p=>p.id===id);
        if(!entry?.url||!/^https:\/\/github\.com\/WuJiaJun1020\/qingzhu-pet\/releases\/download\/[^/]+\/[^/]+$/.test(entry.url))throw Error('人物下载地址不合法');
        url=entry.url;
      }
      if(verifying)return url;
      await shell.openExternal(url);return url;
    });
    handle('pack-install', async (event,id)=>{
      if(event.sender!==panel.webContents)throw new Error('请从设置面板安装人物');
      if(frameWriter.busy)throw Error('正在保存修补，请稍候');await packs.install(id);return playInstalledCharacter(id);
    });
    handle('pack-import', async event=>{
      if(event.sender!==panel.webContents)throw new Error('请从设置面板导入人物');
      if(frameWriter.busy)throw Error('正在保存修补，请稍候');
      panelImporting=true;
      try {
        const selected=await dialog.showOpenDialog(panel,{title:'导入人物资源包',properties:['openFile'],filters:[{name:'青竹桌宠人物包',extensions:['qzpet']}]});
        if(selected.canceled)return snapshot();
        const id=await packs.importFile(selected.filePaths[0]);return playInstalledCharacter(id);
      } finally {panelImporting=false;}
    });
    handle('pack-cancel',()=>updates.cancelCharacters());
    handle('panel', () => showPanel());
    handle('panel-hide', event => {if(event.sender===panel.webContents)hidePanel();});
    handle('panel-reset-size', event => {if(event.sender!==panel.webContents)return;endDrag();return panelWindowState.reset();});
    handle('player-region', (event,rect) => {
      if(event.sender!==panel.webContents)return;
      const [width,height]=panel.getContentSize();
      if(!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k]))||rect.x<0||rect.y<0||rect.width<160||rect.height<100||rect.x+rect.width>width+1||rect.y+rect.height>height+1)return;
      if(surface.setRegion(rect)){if(surface.hosted){endDrag();resizePet();broadcast();}else enterPanel();}
    });
    handle('player-preview-visible',(event,visible)=>{if(event.sender===panel.webContents&&typeof visible==='boolean')surface.setPreviewVisible(visible);});
    handle('quit', () => app.quit());
    handle('drag-start', event => {
      if (event.sender !== player.webContents) return;
      dragControl.start();
      pet.setIgnoreMouseEvents(false); lastHit = true;
      return snapshot();
    });
    handle('drag-end', () => endDrag());
    ipcMain.on('progress', (event, frame, rev) => {
      if (event.sender !== player.webContents || rev !== revision || !Number.isInteger(frame)) return;
      settings.frame = Math.max(0, Math.min(currentAnimation().frames.length - 1, frame));
      if(panelReady&&panel.isVisible())panel.webContents.send('progress', settings.frame);
    });
    handle('ended', (event, rev) => {
      if (event.sender !== player.webContents || rev !== revision || !settings.playing) return snapshot();
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
    await Promise.all([panel.loadFile(path.join(__dirname, 'panel.html')), player.webContents.loadFile(path.join(__dirname, 'pet.html'))]);
    resizePet(); broadcast();
    panelReady=true;panelWanted=true;pet.showInactive();panel.showInactive();enterPanel();
    panel.on('show',enterPanel);panel.on('restore',enterPanel);
    panel.on('hide',()=>{if(!quitting){panelWanted=false;leavePanel();panel.setSkipTaskbar(true);schedulePanelSleep();}});
    panel.on('minimize',()=>{if(!quitting)hidePanel();});
    panel.on('close', event => { if (!quitting) { event.preventDefault(); hidePanel(); } });
    pet.on('close', event => { if (!quitting) { event.preventDefault(); update({ visible: false }); showPanel(); } });
    const trayImage = nativeImage.createFromPath(trayIcon);
    if (trayImage.isEmpty()) throw new Error('软件图标无法加载');
    tray = new Tray(trayImage.resize({ width: 20, height: 20 }));
    tray.setToolTip('青竹桌宠 · 双击打开设置');
    tray.on('double-click', showPanel);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开青竹桌宠', click: showPanel }, { label: '找回桌宠（重新居中）', click: centerOnDesktop }, { label: '显示桌宠', click: () => update({ visible: true }) }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]));
    timer = setInterval(async () => {
      if (pet.isDestroyed() || !pet.isVisible() || surface.hosted) return;
      if (dragControl.active||contextMenuOpen) return;
      const point = screen.getCursorScreenPoint();
      if (polling) return;
      polling = true;
      try {
        const b = pet.getBounds(), x = point.x - b.x, y = point.y - b.y;
        const hit = x >= 0 && y >= 0 && x < b.width && y < b.height && await player.webContents.executeJavaScript(`window.hitTest(${x},${y})`);
        if (!dragControl.active && hit !== lastHit) {
          pet.setIgnoreMouseEvents(!hit, { forward: true });
          lastHit = hit;
        }
      } catch { /* Window may close during a poll. */ } finally { polling = false; }
    }, 70);
    pet.on('blur', () => { if (!verifying && !surface.hosted) endDrag(); });
    if(!verifying)updates.start();
    if(!verifying&&process.argv.includes('--edit-frames'))await showEditor();
    if (verifying) await require('../tests/verify-client.cjs')({app,pet,player,surface,panel,showPanel,hidePanel,charactersDirectory,movePet,update,updates,snapshot,root,data,onDragMove,showEditor,getEditor:()=>editor,sourceCharactersDirectory,getPetMenu:()=>petMenu,getPublisher:()=>developmentTools?.getWindow()});
  }).catch(error => { fs.writeFileSync(path.join(data, '错误日志.txt'), error.stack || String(error)); console.error(error); if(verifying)app.exit(1);else app.quit(); });
}
app.on('before-quit', event => { if(editor&&!editor.isDestroyed()){event.preventDefault();quitRequested=true;editor.close();return;} quitting = true; updates?.stop(); clearTimeout(panelSleepTimer); panelWindowState?.dispose(); clearInterval(timer); dragControl?.dispose(); if (pet && !pet.isDestroyed() && !surface?.hosted) savedPosition = { x: pet.getBounds().x, y: pet.getBounds().y }; save(); });
app.on('window-all-closed', () => app.quit());
