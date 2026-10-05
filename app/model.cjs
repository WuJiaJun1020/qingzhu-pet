'use strict';
const defaults = () => ({ action: 'idle', scale: .65, playing: true, loop: true, autoPlay: true, actionProbability: 30, visible: true, edgeBlend: true, frame: 0 });
function idleAction(actions) { return actions.find(a => a.role === 'idle') || actions[0]; }
function idleActions(actions) {
  const clips = actions.filter(a => a.role === 'idle');
  return clips.length ? clips : [idleAction(actions)];
}
function configure(current, patch, actions) {
  const next = { ...current };
  delete next.cleanNoise; // Migrate settings from the former comparison switch.
  if (!actions.some(a => a.id === next.action)) { next.action = idleAction(actions).id; next.frame = 0; }
  if (typeof patch.action === 'string' && actions.some(a => a.id === patch.action)) {
    if (next.action !== patch.action) next.frame = 0;
    next.action = patch.action;
  }
  const scale = Number.isFinite(patch.scale) ? patch.scale : next.scale;
  next.scale = Number.isFinite(scale) ? Math.max(.1, Math.min(1, scale)) : defaults().scale;
  if (Number.isFinite(patch.actionProbability)) next.actionProbability = Math.max(0, Math.min(100, patch.actionProbability));
  for (const key of ['playing', 'loop', 'autoPlay', 'visible', 'edgeBlend']) if (typeof patch[key] === 'boolean') next[key] = patch[key];
  const count = actions.find(a => a.id === next.action).frames.length;
  if (Number.isInteger(patch.frame)) next.frame = Math.max(0, Math.min(count - 1, patch.frame));
  next.frame = Math.max(0, Math.min(count - 1, next.frame));
  return next;
}
// Scale percentages refer to source pixels, independent of Windows display DPI.
function frameDisplaySize(animation, scale, display) {
  const factor = display.scaleFactor || 1, area = display.workArea;
  const limited = Math.min(scale, (area.width - 16) * factor / animation.width, (area.height - 42) * factor / animation.height);
  return { width: Math.round(animation.width * limited) / factor, height: Math.round(animation.height * limited) / factor };
}
function frameAt(elapsed, frames, loop) {
  const total = frames.reduce((sum, f) => sum + f.durationMs, 0);
  if (!loop && elapsed >= total) return frames.length - 1;
  const time = Math.max(0, elapsed) % total;
  let boundary = 0;
  // Match seek's cumulative sum so fractional frame durations keep exact boundaries.
  for (let i = 0; i < frames.length; i++) { boundary += frames[i].durationMs; if (time < boundary) return i; }
  return 0;
}
// Completed idle clips draw for a special; special clips always return to an idle.
function nextAction(settings, actions, random = Math.random, choose, chooseIdle) {
  const idles = idleActions(actions), ids = new Set(idles.map(a => a.id));
  const other = actions.filter(a => !ids.has(a.id) && a.role !== 'interaction');
  const returnIdle = () => chooseIdle ? chooseIdle(idles) :
    idles.length === 1 ? idles[0].id : idles[Math.min(idles.length - 1, Math.floor(random() * idles.length))].id;
  if (!ids.has(settings.action) || !other.length || settings.actionProbability <= 0) return returnIdle();
  if (random() >= settings.actionProbability / 100) return returnIdle();
  if (choose) return choose(other);
  return other[Math.min(other.length - 1, Math.floor(random() * other.length))].id;
}
function shuffledPicker(random) {
  let remaining = [], last = null;
  return (choices, avoid = last) => {
    if (!remaining.length) {
      remaining = choices.map(a => a.id);
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      // Avoid repeating across shuffled rounds or the initial default idle.
      if (remaining.length > 1 && remaining[0] === avoid) {
        const j = 1 + Math.floor(random() * (remaining.length - 1));
        [remaining[0], remaining[j]] = [remaining[j], remaining[0]];
      }
    }
    last = remaining.shift();
    return last;
  };
}
function createActionScheduler(actions, random = Math.random) {
  const chooseSpecial = shuffledPicker(random), chooseIdle = shuffledPicker(random);
  const idleIds = new Set(idleActions(actions).map(a => a.id));
  let lastIdle = idleAction(actions).id;
  return settings => {
    if (idleIds.has(settings.action)) lastIdle = settings.action;
    const selected = nextAction(settings, actions, random, chooseSpecial, clips => chooseIdle(clips, lastIdle));
    if (idleIds.has(selected)) lastIdle = selected;
    return selected;
  };
}
module.exports = { frameDisplaySize, defaults, configure, frameAt, idleAction, idleActions, nextAction, createActionScheduler };
