'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { defaults, configure, idleAction, createActionScheduler } = require('./model.cjs');
const { createDragController } = require('./drag-controller.cjs');
const { createWindowMover } = require('./window-mover.cjs');
const root = path.resolve(__dirname, '..');
const appIcon = path.join(root, 'assets', 'app.ico');
const trayIcon = path.join(root, 'assets', 'app.png');
const verifying = process.argv.includes('--verify');
const data = path.join(root, verifying ? 'tests/results/data' : '数据');
fs.mkdirSync(data, { recursive: true });
app.setPath('userData', data);
app.setPath('sessionData', path.join(data, '浏览器缓存'));
app.setName('青竹桌宠');
if (process.platform === 'win32') app.setAppUserModelId('Qingzhu.Pet');
let pet, panel, board, tray, timer, dragControl, windowMover, lastHit = null, polling = false, quitting = false;
let settings = defaults(), savedPosition = null, revision = 0, petSize = null, displaySize = null;
let boardReady = Promise.resolve();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const actions = manifest.actions;
const scheduleAction = createActionScheduler(actions);
const actionCounts = Object.fromEntries(actions.filter(a=>a.role!=='idle').map(a=>[a.id,0]));
for (const a of actions) for (const f of a.frames) {
  const resolved = path.resolve(root, 'assets', f.file);
  if (!resolved.startsWith(path.join(root, 'assets') + path.sep) || !fs.existsSync(resolved)) throw new Error('动画文件缺失或路径不合法');
  f.url = pathToFileURL(resolved).href;
  if (f.cleanedFile) {
    const clean=path.resolve(root,'assets',f.cleanedFile);
    if(!clean.startsWith(path.join(root,'assets')+path.sep) || !fs.existsSync(clean)) throw new Error('净化帧文件缺失或路径不合法');
    f.cleanedUrl=pathToFileURL(clean).href;
  }
  if (f.edgeMaskFile) {
    const mask=path.resolve(root,'assets',f.edgeMaskFile);
    if(!mask.startsWith(path.join(root,'assets')+path.sep) || !fs.existsSync(mask)) throw new Error('环境渐隐遮罩缺失或路径不合法');
    f.edgeMaskUrl=pathToFileURL(mask).href;
  }
}
const variants=new Map(actions.map(a => {
  const original={...a,variant:'original'};
  const cleaned=a.frames.every(f=>f.cleanedUrl) ? {...a,variant:'cleaned-v1',frames:a.frames.map(f=>({...f,file:f.cleanedFile,url:f.cleanedUrl,sha256:f.cleanedSha256}))} : null;
  const blend=base => base && base.frames.every(f=>f.edgeMaskUrl) ? {...base,variant:base.variant+':edge-blend-v1',frames:base.frames.map(f=>({...f,blendMaskUrl:f.edgeMaskUrl}))} : null;
  return [a.id,{original,cleaned,blendedOriginal:blend(original),blendedCleaned:blend(cleaned)}];
}));
function currentAnimation(id = settings.action) {
  const v=variants.get(id), clean=settings.cleanNoise && v.cleaned;
  return (settings.edgeBlend && (clean ? v.blendedCleaned : v.blendedOriginal)) || (clean ? v.cleaned : v.original);
}
const settingsFile = path.join(data, 'settings.json');
try {
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  settings = configure(settings, { ...saved.settings, action: idleAction(actions).id, autoPlay: true, playing: true, visible: true, frame: 0 }, actions);
  if (Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y)) savedPosition = saved.position;
} catch { /* First launch uses defaults. */ }
function snapshot() {
  return { settings, revision, actionCounts: {...actionCounts}, idleId: idleAction(actions).id, starts: actions.map(a => { const v = currentAnimation(a.id); return { id: a.id, variant: v.variant, frame: v.frames[0] }; }), display: displaySize, actions: actions.map(a => ({ id: a.id, title: a.title, role: a.role, width: a.width, height: a.height, count: a.frames.length, duration: a.frames.reduce((s,f) => s + f.durationMs, 0) })), animation: currentAnimation() };
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
  const a = snapshot().animation, area = screen.getPrimaryDisplay().workArea;
  const scale = Math.min(settings.scale, (area.width - 16) / a.width, (area.height - 42) / a.height);
  displaySize = { width: Math.round(a.width * scale), height: Math.round(a.height * scale) };
  const width = Math.max(160, displaySize.width + 16), height = displaySize.height + 42;
  const old = petSize ? pet.getBounds() : savedPosition || { x: area.x + area.width - width - 60, y: area.y + area.height - height - 20 };
  petSize = { width, height };
  const pos = freePosition(old.x, old.y);
  pet.setBounds({ ...pos, width, height });
  savedPosition = pos;
  lastHit = null;
}
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
  settings = configure(settings, patch, actions);
  if (before.action !== settings.action || 'frame' in patch || before.playing !== settings.playing || before.loop !== settings.loop || before.autoPlay !== settings.autoPlay || before.cleanNoise !== settings.cleanNoise || before.edgeBlend !== settings.edgeBlend) revision++;
  if (before.action !== settings.action || before.scale !== settings.scale) resizePet();
  if (settings.visible) pet.showInactive(); else pet.hide();
  broadcast(); save(); return snapshot();
}
function endDrag() { dragControl?.stop(); }
function authorized(event) { return [pet, panel, board].some(w => w && !w.isDestroyed() && w.webContents === event.sender); }
function handle(name, fn) { ipcMain.handle(name, (event, ...args) => { if (!authorized(event)) throw new Error('非法调用'); return fn(event, ...args); }); }
if (!app.requestSingleInstanceLock() && !verifying) app.quit();
else {
  app.on('second-instance', () => { if (panel && pet) placeOnBoard().then(showPanel).catch(console.error); });
  app.whenReady().then(async () => {
    const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };
    panel = new BrowserWindow({ width: 360, height: 800, minWidth: 320, minHeight: 540, title: '青竹桌宠', icon:appIcon, backgroundColor: '#202522', autoHideMenuBar: true, show: false, webPreferences });
    pet = new BrowserWindow({ width: 266, height: 416, icon:appIcon, transparent: true, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, webPreferences });
    pet.setAlwaysOnTop(true, 'screen-saver');
    windowMover = createWindowMover(pet,screen);
    dragControl = createDragController({
      getCursor: () => screen.getCursorScreenPoint(),
      getBounds: () => pet.getBounds(),
      clamp: freePosition,
      move: movePet,
      onStart: () => windowMover.beginDrag(),
      onStop: () => windowMover.endDrag(),
      onEnd: () => {
        const b = pet.getBounds(); savedPosition = { x: b.x, y: b.y };
        save(); pet.webContents.send('drag-end'); lastHit = null;
      }
    });
    for (const win of [panel, pet]) {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', e => e.preventDefault());
    }
    handle('snapshot', () => snapshot());
    handle('configure', (_, patch) => update(patch));
    handle('panel', () => showPanel());
    handle('board-open', () => showBoard());
    handle('board-close', () => board?.hide());
    handle('board-place', () => placeOnBoard());
    handle('quit', () => app.quit());
    handle('drag-start', event => {
      if (event.sender !== pet.webContents) return;
      dragControl.start();
      pet.setIgnoreMouseEvents(false); lastHit = true;
    });
    handle('drag-end', () => endDrag());
    ipcMain.on('progress', (event, frame, rev) => {
      if (event.sender !== pet.webContents || rev !== revision || !Number.isInteger(frame)) return;
      settings.frame = Math.max(0, Math.min(snapshot().animation.frames.length - 1, frame));
      panel.webContents.send('progress', settings.frame);
    });
    handle('ended', (event, rev) => {
      if (event.sender !== pet.webContents || rev !== revision || !settings.playing) return snapshot();
      if (settings.autoPlay) {
        const chosen = scheduleAction(settings);
        if (settings.action === idleAction(actions).id && chosen !== settings.action) actionCounts[chosen]++;
        return update({ action: chosen, frame: 0, playing: true });
      }
      if (!settings.loop) return update({ playing: false, frame: currentAnimation().frames.length - 1 });
      return snapshot();
    });
    await Promise.all([panel.loadFile(path.join(__dirname, 'panel.html')), pet.loadFile(path.join(__dirname, 'pet.html'))]);
    resizePet(); broadcast();
    await showBoard(); arrangeWindows(); await placeOnBoard(); panel.showInactive();
    const requestedBoard=process.argv.find(arg=>arg.startsWith('--board='))?.slice(8);
    if(['checker','black','dark','white','blue','pink'].includes(requestedBoard)) {
      await board.webContents.executeJavaScript(`document.querySelector('[data-mode="${requestedBoard}"]').click()`);
    }
    panel.on('close', event => { if (!quitting) { event.preventDefault(); panel.hide(); } });
    pet.on('close', event => { if (!quitting) { event.preventDefault(); update({ visible: false }); showPanel(); } });
    const trayImage = nativeImage.createFromPath(trayIcon);
    if (trayImage.isEmpty()) throw new Error('软件图标无法加载');
    tray = new Tray(trayImage.resize({ width: 20, height: 20 }));
    tray.setToolTip('青竹桌宠 · 双击打开设置');
    tray.on('double-click', showPanel);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开测试面板', click: showPanel }, { label: '打开背景检查板', click: () => showBoard().catch(console.error) }, { label: '找回桌宠（重新居中）', click: () => placeOnBoard().catch(console.error) }, { label: '显示桌宠', click: () => update({ visible: true }) }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]));
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
    pet.on('blur', endDrag);
    if (verifying) await require('../tests/verify.cjs')({ app, pet, panel, getBoard: () => board, movePet, update, snapshot, root, windowMover, freePosition });
  }).catch(error => { fs.writeFileSync(path.join(data, '错误日志.txt'), error.stack || String(error)); console.error(error); app.quit(); });
}
app.on('before-quit', () => { quitting = true; clearInterval(timer); dragControl?.dispose(); if (pet && !pet.isDestroyed()) savedPosition = { x: pet.getBounds().x, y: pet.getBounds().y }; save(); });
app.on('window-all-closed', () => app.quit());
