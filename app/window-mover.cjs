'use strict';
// Move the HWND without asking Electron to recalculate its width and height.
// Keep all coordinate conversion at the Windows boundary: Electron uses DIP.
function loadBindings() {
  if (process.platform !== 'win32') return null;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll'), winmm = koffi.load('winmm.dll');
  const rect = koffi.struct('PetWindowRect', { left:'long', top:'long', right:'long', bottom:'long' });
  return {
    position: user32.func('int __stdcall SetWindowPos(uintptr_t hwnd, uintptr_t insertAfter, int x, int y, int cx, int cy, uint32_t flags)'),
    rectangle: user32.func('GetWindowRect', 'int', ['uintptr_t', koffi.out(koffi.pointer(rect))]),
    begin: winmm.func('uint32_t __stdcall timeBeginPeriod(uint32_t period)'),
    end: winmm.func('uint32_t __stdcall timeEndPeriod(uint32_t period)')
  };
}
function createWindowMover(win, screen, bindings = loadBindings()) {
  const buffer = win.getNativeWindowHandle();
  const hwnd = buffer.length === 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE());
  let highResolution = false;
  const fallback = (x,y,size) => win.setBounds({x:Math.round(x),y:Math.round(y),width:size.width,height:size.height});
  return {
    backend: bindings ? 'win32-position-only' : 'fixed-bounds',
    move(x,y,size) {
      if (!bindings) return fallback(x,y,size);
      const point = screen.dipToScreenPoint({x:Math.round(x),y:Math.round(y)});
      // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE. No resizing, focus or z-order changes.
      if (!bindings.position(hwnd,0n,point.x,point.y,0,0,0x0001|0x0004|0x0010)) throw new Error('Windows 窗口移动失败');
    },
    beginDrag() { if(bindings && !highResolution) highResolution = bindings.begin(1) === 0; },
    endDrag() { if(highResolution) { bindings.end(1); highResolution = false; } },
    nativeBounds() {
      if (!bindings) return win.getBounds();
      const rect = {}; if(!bindings.rectangle(hwnd,rect)) throw new Error('Windows 窗口尺寸读取失败');
      return {x:rect.left,y:rect.top,width:rect.right-rect.left,height:rect.bottom-rect.top};
    }
  };
}
module.exports = {createWindowMover};
