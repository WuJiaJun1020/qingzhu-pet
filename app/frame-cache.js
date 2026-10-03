'use strict';

// Keep only the current frame, eleven ahead and two behind. A pending decode
// cannot put an obsolete image back after a seek, switch or window close.
class PetFrameCache {
  constructor(frames, loop, load, onError) {
    this.frames = frames;
    this.loop = loop;
    this.load = load;
    this.onError = onError;
    this.entries = new Map();
    this.disposed = false;
  }
  prime(index) {
    if (this.disposed) return [];
    const wanted = new Set();
    for (let offset = 0; offset < 12; offset++) this.addIndex(wanted, index + offset);
    for (let offset = 1; offset <= 2; offset++) this.addIndex(wanted, index - offset);
    for (const key of this.entries.keys()) if (!wanted.has(key)) { this.entries.get(key).image?.close?.(); this.entries.delete(key); }
    return Array.from(wanted, key => {
      let entry = this.entries.get(key);
      if (!entry) {
        entry = { image: null, promise: null };
        this.entries.set(key, entry);
        entry.promise = Promise.resolve().then(() => this.load(this.frames[key].url, this.frames[key])).then(image => {
          if (!this.disposed && this.entries.get(key) === entry) entry.image = image;
          else image?.close?.();
          return image;
        });
        entry.promise.catch(error => { if (!this.disposed && this.entries.get(key) === entry) this.onError(error); });
      }
      return entry.promise;
    });
  }
  addIndex(wanted, index) {
    const count = this.frames.length;
    if (this.loop) wanted.add((index % count + count) % count);
    else if (index >= 0 && index < count) wanted.add(index);
  }
  get(index) { return this.entries.get(index)?.image; }
  get size() { return this.entries.size; }
  dispose() { this.disposed = true; for(const entry of this.entries.values()) entry.image?.close?.(); this.entries.clear(); }
}

if (typeof module !== 'undefined') module.exports = { PetFrameCache };
else globalThis.PetFrameCache = PetFrameCache;
