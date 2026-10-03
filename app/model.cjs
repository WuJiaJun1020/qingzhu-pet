'use strict';
const defaults = () => ({ action: 'idle', scale: .65, playing: true, loop: true, autoPlay: true, actionProbability: 30, visible: true, cleanNoise: true, edgeBlend: true, frame: 0 });
function idleAction(actions) { return actions.find(a => a.role === 'idle') || actions[0]; }
function configure(current, patch, actions) {
  const next = { ...current };
  if (!actions.some(a => a.id === next.action)) { next.action = idleAction(actions).id; next.frame = 0; }
  if (typeof patch.action === 'string' && actions.some(a => a.id === patch.action)) {
    if (next.action !== patch.action) next.frame = 0;
    next.action = patch.action;
  }
  if (Number.isFinite(patch.scale)) next.scale = Math.max(.1, Math.min(1.5, patch.scale));
  if (Number.isFinite(patch.actionProbability)) next.actionProbability = Math.max(0, Math.min(100, patch.actionProbability));
  for (const key of ['playing', 'loop', 'autoPlay', 'visible', 'cleanNoise', 'edgeBlend']) if (typeof patch[key] === 'boolean') next[key] = patch[key];
  const count = actions.find(a => a.id === next.action).frames.length;
  if (Number.isInteger(patch.frame)) next.frame = Math.max(0, Math.min(count - 1, patch.frame));
  next.frame = Math.max(0, Math.min(count - 1, next.frame));
  return next;
}
function frameAt(elapsed, frames, loop) {
  const total = frames.reduce((sum, f) => sum + f.durationMs, 0);
  if (!loop && elapsed >= total) return frames.length - 1;
  let time = Math.max(0, elapsed) % total;
  for (let i = 0; i < frames.length; i++) { if (time < frames[i].durationMs) return i; time -= frames[i].durationMs; }
  return 0;
}
// Called once at a completed clip boundary. Every special action returns to idle.
function nextAction(settings, actions, random = Math.random, choose) {
  const idle = idleAction(actions), other = actions.filter(a => a.id !== idle.id);
  if (settings.action !== idle.id || !other.length || settings.actionProbability <= 0) return idle.id;
  if (random() >= settings.actionProbability / 100) return idle.id;
  if (choose) return choose(other);
  return other[Math.min(other.length - 1, Math.floor(random() * other.length))].id;
}
function createActionScheduler(actions, random = Math.random) {
  let remaining = [], last = null;
  return settings => nextAction(settings, actions, random, other => {
    if (!remaining.length) {
      remaining = other.map(a => a.id);
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      // Keep the boundary between shuffled rounds from repeating an action.
      if (remaining.length > 1 && remaining[0] === last) {
        const j = 1 + Math.floor(random() * (remaining.length - 1));
        [remaining[0], remaining[j]] = [remaining[j], remaining[0]];
      }
    }
    last = remaining.shift();
    return last;
  });
}
module.exports = { defaults, configure, frameAt, idleAction, nextAction, createActionScheduler };
