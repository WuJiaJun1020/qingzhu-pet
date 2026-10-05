'use strict';
// Temporary interaction clips override playback without changing user preferences.
function createDragAnimationController(actions, { grab = 'grab', drop = 'drop' } = {}) {
  const held = actions.find(a => a.id === grab && a.role === 'interaction');
  const falling = actions.find(a => a.id === drop && a.role === 'interaction');
  const idle = actions.find(a => a.role === 'idle') || actions[0];
  let phase = 'none', resume = null;
  return {
    get phase() { return phase; },
    begin(settings) {
      if (!held || !falling || phase === 'grab') return null;
      if (!resume) resume = { autoPlay: settings.autoPlay, loop: settings.loop, playing: settings.playing };
      phase = 'grab';
      return { action: held.id, frame: 0, autoPlay: false, loop: false, playing: false };
    },
    moved(settings) {
      if (phase !== 'grab' || settings.action !== held.id || settings.playing) return null;
      return { frame: 0, autoPlay: false, loop: false, playing: true };
    },
    release(settings) {
      if (phase !== 'grab') return null;
      if (settings.action !== held.id) { phase = 'none'; resume = null; return null; }
      phase = 'drop';
      return { action: falling.id, frame: 0, autoPlay: false, loop: false, playing: true };
    },
    complete(settings) {
      if (phase === 'grab' && settings.action === held.id) {
        return { frame: held.frames.length - 1, autoPlay: false, loop: false, playing: false };
      }
      if (phase !== 'drop' || settings.action !== falling.id) return null;
      const patch = { ...resume, action: idle.id, frame: 0 };
      phase = 'none'; resume = null;
      return patch;
    },
    cancel() { const preferences = resume; phase = 'none'; resume = null; return preferences; }
  };
}
module.exports = { createDragAnimationController };
