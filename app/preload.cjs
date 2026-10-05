const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petAPI', {
  frameEditor: {
    open:()=>ipcRenderer.invoke('editor-open'),
    list:()=>ipcRenderer.invoke('editor-list'),
    load:(action,index)=>ipcRenderer.invoke('editor-load',action,index),
    saveBatch:items=>ipcRenderer.invoke('editor-save-batch',items),
    save:(action,index,baseSha,erased)=>ipcRenderer.invoke('editor-save',action,index,baseSha,erased)
  },
  snapshot: () => ipcRenderer.invoke('snapshot'),
  configure: patch => ipcRenderer.invoke('configure', patch),
  installCharacter: id => ipcRenderer.invoke('pack-install',id),
  importCharacter: () => ipcRenderer.invoke('pack-import'),
  cancelDownload: () => ipcRenderer.invoke('pack-cancel'),
  panel: () => ipcRenderer.invoke('panel'),
  board: () => ipcRenderer.invoke('board-open'),
  closeBoard: () => ipcRenderer.invoke('board-close'),
  placeOnBoard: () => ipcRenderer.invoke('board-place'),
  quit: () => ipcRenderer.invoke('quit'),
  dragStart: () => ipcRenderer.invoke('drag-start'),
  dragEnd: () => ipcRenderer.invoke('drag-end'),
  ended: revision => ipcRenderer.invoke('ended', revision),
  progress: (frame, revision) => ipcRenderer.send('progress', frame, revision),
  onState: fn => ipcRenderer.on('state', (_, s) => fn(s)),
  onProgress: fn => ipcRenderer.on('progress', (_, f) => fn(f)),
  onHover: fn => ipcRenderer.on('hover', (_, h) => fn(h)),
  onDragEnd: fn => ipcRenderer.on('drag-end', fn)
});
