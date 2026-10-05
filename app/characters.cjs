'use strict';
// Each character owns its idle/special pool and its drag/drop interaction pair.
function createCharacterCatalog(manifest) {
  const all = manifest.actions;
  if (!Array.isArray(all) || !all.length) throw new Error('没有可用的动画');
  const ids = new Map(all.map(a => [a.id, a]));
  if (ids.size !== all.length) throw new Error('动画编号重复');
  const entries = manifest.characters || [{ id: 'hanli', name: '韩立', actions: all.map(a => a.id), interactions: manifest.interactions }];
  const owned = new Set(), catalog = new Map();
  for (const entry of entries) {
    if (!entry.id || catalog.has(entry.id) || !entry.name || !entry.actions?.length) throw new Error('角色配置不完整或编号重复');
    const actions = entry.actions.map(id => {
      if (!ids.has(id) || owned.has(id)) throw new Error('角色动画缺失或被重复分配');
      owned.add(id); return ids.get(id);
    });
    if (!actions.some(a => a.role === 'idle')) throw new Error('角色缺少待机动画');
    for (const kind of ['grab', 'drop']) {
      if (!actions.some(a => a.id === entry.interactions?.[kind] && a.role === 'interaction')) throw new Error('角色缺少拖动或下落动画');
    }
    catalog.set(entry.id, { ...entry, actions });
  }
  if (owned.size !== ids.size) throw new Error('存在未分配给角色的动画');
  const defaultId = manifest.defaultCharacter || entries[0].id;
  if (!catalog.has(defaultId)) throw new Error('默认角色不存在');
  return {
    defaultId,
    has: id => catalog.has(id),
    get: id => catalog.get(id),
    list: () => [...catalog.values()].map(c => ({ id: c.id, name: c.name, actionCount: c.actions.length }))
  };
}
module.exports = { createCharacterCatalog };
