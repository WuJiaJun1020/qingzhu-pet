'use strict';
const fs = require('node:fs');
const path = require('node:path');

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const isRect = value => value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key])) && value.width > 0 && value.height > 0;
function overlap(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

// All coordinates are Electron DIP. Restore within a connected display, including
// when the original monitor has been unplugged or its scale has changed.
function panelBounds(saved, displays, primary) {
  const previous = isRect(saved?.bounds) ? saved.bounds : null;
  const matching = previous && displays.reduce((best, display) =>
    overlap(previous, display.workArea) > overlap(previous, best.workArea) ? display : best, primary);
  const area = matching && overlap(previous, matching.workArea) > 0 ? matching.workArea : primary.workArea;
  const availableWidth = Math.max(1, area.width - 24), availableHeight = Math.max(1, area.height - 24);
  const minWidth = Math.min(820, availableWidth), minHeight = Math.min(540, availableHeight);
  const width = Math.round(clamp(previous?.width || 900, minWidth, availableWidth));
  const height = Math.round(clamp(previous?.height || 600, minHeight, availableHeight));
  const x = Math.round(clamp(previous?.x ?? area.x + (area.width - width) / 2, area.x + 12, area.x + area.width - width - 12));
  const y = Math.round(clamp(previous?.y ?? area.y + (area.height - height) / 2, area.y + 12, area.y + area.height - height - 12));
  return {x, y, width, height, minWidth, minHeight};
}

function createPanelWindowState({file, screen, onError = console.warn}) {
  let saved = {}, window, timer, closing = false;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { /* First launch or invalid preferences. */ }
  function flush() {
    clearTimeout(timer);
    if (!window || window.isDestroyed()) return;
    // Minimized windows can report platform-specific bounds. Keep the last
    // normal/maximized state until the window is restored.
    if (!window.isMinimized()) saved = {bounds: window.getNormalBounds(), maximized: window.isMaximized()};
    if (!isRect(saved.bounds)) return;
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.writeFileSync(file + '.tmp', JSON.stringify(saved, null, 2) + '\n');
      fs.renameSync(file + '.tmp', file);
    } catch (error) { onError('无法保存主窗口位置：' + error.message); }
  }
  function schedule() {
    if (closing) return;
    clearTimeout(timer); timer = setTimeout(flush, 200); timer.unref?.();
  }
  return {
    options: panelBounds(saved, screen.getAllDisplays(), screen.getPrimaryDisplay()),
    attach(value) {
      window = value;
      for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, schedule);
      window.on('hide', flush);
      window.on('close', flush);
      window.on('closed', () => {clearTimeout(timer); window = null;});
      if (saved.maximized === true) window.maximize();
    },
    async reset() {
      if (!window || window.isDestroyed()) return;
      const display=screen.getDisplayMatching(window.getNormalBounds());
      if(window.isMinimized())window.restore();
      if(window.isFullScreen())await new Promise(resolve=>{window.once('leave-full-screen',()=>setImmediate(resolve));window.setFullScreen(false);});
      if(window.isMaximized())await new Promise(resolve=>{window.once('unmaximize',()=>setImmediate(resolve));window.unmaximize();});
      if(window.isDestroyed())return;
      const {x,y,width,height}=panelBounds(null,[display],display);
      window.setBounds({x,y,width,height});flush();
      return {width,height};
    },
    flush,
    dispose() { closing = true; flush(); }
  };
}

module.exports = {panelBounds, createPanelWindowState};
