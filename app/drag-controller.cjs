'use strict';
// Drag movement is independent of the slower asynchronous alpha hit test.
function createDragController({ getCursor, getBounds, clamp, move, onEnd, onStart = () => {}, onStop = () => {}, setTimer = setInterval, clearTimer = clearInterval }) {
  let active = null, timer = null;
  function tick() {
    if (!active) return;
    const point = getCursor(), b = active.bounds;
    const pos = clamp(b.x + point.x - active.point.x, b.y + point.y - active.point.y, b.width, b.height);
    if (pos.x === active.last.x && pos.y === active.last.y) return;
    move(pos.x, pos.y);
    active.last = pos;
  }
  return {
    get active() { return active !== null; },
    start() {
      if (active) return;
      const bounds = getBounds();
      active = { point: getCursor(), bounds, last: { x: bounds.x, y: bounds.y } };
      onStart();
      timer = setTimer(tick, 8);
    },
    stop() {
      if (!active) return;
      tick();
      clearTimer(timer); timer = null; active = null;
      onStop();
      onEnd();
    },
    dispose() { clearTimer(timer); timer = null; if(active) onStop(); active = null; }
  };
}
module.exports = { createDragController };
