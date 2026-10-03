'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../assets');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('published manifest is portable and every original/cleaned frame matches its hash', () => {
  const ids = new Set();
  assert.ok(manifest.actions.some(a => a.role === 'idle'));
  for (const action of manifest.actions) {
    assert.ok(!ids.has(action.id)); ids.add(action.id);
    assert.ok(!action.source && !action.processedOutput, 'Do not publish local source paths');
    assert.ok(action.width > 0 && action.height > 0 && action.frames.length > 0);
    assert.ok(fs.existsSync(path.join(root, action.poster)));
    for (const frame of action.frames) {
      assert.ok(Number.isFinite(frame.durationMs) && frame.durationMs > 0);
      for (const [file, hash] of [[frame.file, frame.sha256], [frame.cleanedFile, frame.cleanedSha256]]) {
        if (!file) continue;
        const resolved = path.resolve(root, file);
        assert.ok(resolved.startsWith(root + path.sep), 'Asset path leaves its directory');
        const bytes = fs.readFileSync(resolved);
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash, file);
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(bytes.readUInt32BE(16), action.width);
        assert.equal(bytes.readUInt32BE(20), action.height);
      }
    }
  }
});
