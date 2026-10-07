const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('publisherAPI',{
  context:()=>ipcRenderer.invoke('dev-publisher-context'),
  scan:()=>ipcRenderer.invoke('dev-publisher-scan'),
  prepare:ids=>ipcRenderer.invoke('dev-publisher-prepare',ids),
  publish:id=>ipcRenderer.invoke('dev-publisher-publish',id),
  progress:fn=>ipcRenderer.on('publisher-progress',(_,message)=>fn(message))
});
