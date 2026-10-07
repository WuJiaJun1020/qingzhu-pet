'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createPublisher}=require('./publisher.cjs');
module.exports=({app,BrowserWindow,ipcMain,panel,root,data,charactersDirectory,fetch,verifying})=>{
  let config={};try{config=JSON.parse(fs.readFileSync(path.join(root,'.local-config.json'),'utf8'));}catch{}
  const sourceRoot=path.resolve(config.sourceRoot||root);
  const builtinIds=new Set(JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'),'utf8')).characters.map(c=>c.id));
  let win;
  const publisher=createPublisher({sourceRoot,data,charactersDirectory,builtinIds,fetch,verifying,onProgress:message=>{if(win&&!win.isDestroyed())win.webContents.send('publisher-progress',message);}});
  const only=event=>{if(!win||win.isDestroyed()||event.sender!==win.webContents)throw Error('请从本地开发版人物发布工具操作');};
  for(const method of ['scan','prepare','publish'])ipcMain.handle('dev-publisher-'+method,async(event,...args)=>{only(event);return publisher[method](...args);});
  ipcMain.handle('dev-publisher-context',event=>{only(event);return {sourceRoot,charactersDirectory,dryRun:verifying};});
  return {
    async open(event){
      if(event.sender!==panel.webContents)throw Error('请从开发版主界面打开');
      if(win&&!win.isDestroyed()){win.show();win.focus();return;}
      win=new BrowserWindow({title:'人物发布 · 本地开发版',width:820,height:650,minWidth:700,minHeight:500,parent:panel,backgroundColor:'#f7f5ee',
        webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
      win.setMenuBarVisibility(false);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
      win.on('close',e=>{if(publisher.busy){e.preventDefault();win.webContents.send('publisher-progress','正在处理，请完成后关闭。');}});
      await win.loadFile(path.join(__dirname,'publisher.html'));win.show();
    },
    getWindow:()=>win
  };
};
