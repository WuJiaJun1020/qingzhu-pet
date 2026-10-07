'use strict';
const api = window.petAPI, canvas = document.getElementById('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
let state, cache, ticket = 0, elapsed = 0, last = performance.now(), raf, drawn = -1, dragging = false, dragPointer = null, notified = 0, ending = false;
const startImages = new Map();
const error = e => { document.getElementById('error').textContent = e.message || String(e); document.getElementById('error').hidden = false; };
const run = p => p.catch(error);
function at(time) {
  const frames = state.animation.frames, total = frames.reduce((s,f) => s + f.durationMs, 0);
  if ((state.settings.autoPlay || !state.settings.loop) && time >= total) return frames.length - 1;
  const rest = Math.max(0, time) % total;
  let boundary = 0;
  // Use the same accumulation as accept() when seeking to a frame.
  for (let i = 0; i < frames.length; i++) { boundary += frames[i].durationMs; if (rest < boundary) return i; }
  return 0;
}
function draw(now) {
  if (!cache || !state) return;
  const delta = Math.max(0, now - last); last = now;
  const target = elapsed + (state.settings.playing && !ending ? delta : 0), index = at(target);
  cache.prime(index);
  const image = cache.get(index);
  if (image) {
    elapsed = target;
    if (drawn !== index) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0); drawn = index;
      canvas.dataset.frame = String(index + 1);
    }
    if (now - notified > 120) { api.progress(index, state.revision); notified = now; }
    const total = state.animation.frames.reduce((s,f) => s + f.durationMs, 0);
    if ((state.settings.autoPlay || !state.settings.loop) && state.settings.playing && elapsed >= total && !ending) { ending = true; run(api.ended(state.revision)); }
  }
  canvas.dataset.cached = String(cache.size);
  raf = requestAnimationFrame(draw);
}
async function loadFrame(url, frame) {
  // Explicitly owned bitmaps can be released when evicted; HTMLImage decoding
  // otherwise lets Chromium retain hundreds of past animation frames.
  const load = async src => {
    const response = await fetch(src, {cache:'no-store'});
    if (!response.ok) throw new Error('动画帧读取失败');
    return createImageBitmap(await response.blob());
  };
  const urls=[frame.blendMaskUrl].filter(Boolean);
  if (!urls.length) return load(url);
  const images=[];
  try {
    for(const src of [url,...urls])images.push(await load(src));
    const [image,...masks]=images;
    const work = new OffscreenCanvas(image.width, image.height), paint = work.getContext('2d');
    paint.drawImage(image, 0, 0); paint.globalCompositeOperation = 'destination-in'; for(const mask of masks)paint.drawImage(mask,0,0);
    return work.transferToImageBitmap();
  } finally {for(const image of images)image.close();}
}
const frameKey=frame=>[frame.url,frame.blendMaskUrl||''].join('|');
function warmStarts(starts) {
  const wanted = new Set(starts.map(s => frameKey(s.frame)));
  for (const [key, promise] of startImages) if (!wanted.has(key)) { startImages.delete(key); promise.then(image => image.close?.()).catch(() => {}); }
  for (const s of starts) {
    const key = frameKey(s.frame);
    if (!startImages.has(key)) { const p = loadFrame(s.frame.url, s.frame); startImages.set(key, p); p.catch(error); }
  }
}
async function accept(next) {
  const desktop = next.presentation === 'desktop';
  const immediate = new Set([next.idleId,...Object.values(next.interactions || {})]);
  warmStarts((next.starts || []).filter(s => !desktop || immediate.has(s.id)));
  const reset = !state || next.revision !== state.revision || next.animation.id !== state.animation.id || next.animation.variant !== state.animation.variant;
  const changed = !state || next.animation.id !== state.animation.id || next.animation.variant !== state.animation.variant;
  state = next;
  const display = next.display || { width: Math.round(next.animation.width * next.settings.scale), height: Math.round(next.animation.height * next.settings.scale) };
  canvas.style.width = display.width + 'px';
  canvas.style.height = display.height + 'px';
  canvas.style.setProperty('--edge-feather', Math.max(1, Math.min(display.width, display.height) * .08) + 'px');
  canvas.dataset.action = next.animation.id;
  if (!reset) {cache?.setWindow(desktop ? 5 : 11, desktop ? 0 : 2); return;}
  const current = ++ticket;
  delete canvas.dataset.frame;
  cancelAnimationFrame(raf);
  if (changed) {
    cache?.dispose();
    cache = new PetFrameCache(next.animation.frames, true, async (url, frame) => {
      const first = startImages.get(frameKey(frame));
      // The warm entry may be evicted while its decode is pending.
      if (first) {
        const image = await first;
        if (startImages.get(frameKey(frame)) === first) return createImageBitmap(image);
      }
      return loadFrame(url, frame);
    }, error);
  }
  cache.setWindow(desktop ? 5 : 11, desktop ? 0 : 2);
  elapsed = next.animation.frames.slice(0, next.settings.frame).reduce((s,f) => s + f.durationMs, 0);
  ending = false; drawn = -1;
  // Show the preloaded first frame immediately; future frames decode in parallel.
  try { await cache.prime(next.settings.frame)[0]; } catch(e) { if(current === ticket) error(e); return; }
  if(current !== ticket) return;
  if (canvas.width !== next.animation.width || canvas.height !== next.animation.height) { canvas.width = next.animation.width; canvas.height = next.animation.height; }
  document.getElementById('error').hidden = true;
  last = performance.now(); draw(last);
}
window.hitTest = (x, y) => {
  if (dragging) return true;
  const r = canvas.getBoundingClientRect(), px = Math.floor((x-r.left)*canvas.width/r.width), py = Math.floor((y-r.top)*canvas.height/r.height);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;
  const feather = parseFloat(canvas.style.getPropertyValue('--edge-feather')) || 16;
  const horizontal = Math.max(0, Math.min(1, (x-r.left)/feather, (r.right-x)/feather));
  const vertical = Math.max(0, Math.min(1, (y-r.top)/feather, (r.bottom-y)/feather));
  return ctx.getImageData(px,py,1,1).data[3] * horizontal * vertical > 8;
};
api.onPlayerHost(mode => window.PanelPlacement.host(mode));
api.onState(s => run(accept(s)));
api.onDragEnd(() => {
  dragging = false;
  if (dragPointer !== null && canvas.hasPointerCapture(dragPointer)) canvas.releasePointerCapture(dragPointer);
  dragPointer = null;
});
run(api.snapshot().then(accept));
document.addEventListener('contextmenu', e => { e.preventDefault(); if(window.hitTest(e.clientX,e.clientY))run(api.contextMenu()); });
canvas.onpointerdown = e => {
  if(e.button !== 0 || !window.hitTest(e.clientX,e.clientY)) return;
  dragging = true; dragPointer = e.pointerId; canvas.setPointerCapture(e.pointerId); run(api.dragStart()); e.preventDefault();
};
const end = e => { if(!dragging) return; dragging = false; dragPointer = null; if(canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); run(api.dragEnd()); };
canvas.onpointerup = end; canvas.onpointercancel = end;
document.addEventListener('pointermove', e => { if(dragging && !(e.buttons & 1)) end(e); });
window.addEventListener('pagehide', () => { ++ticket; cancelAnimationFrame(raf); cache?.dispose(); warmStarts([]); });
