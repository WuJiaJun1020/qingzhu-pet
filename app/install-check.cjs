'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({app,pet,panel,data,root,update,snapshot,showEditor,getEditor,packs})=>{
 const checks=[];
 const wait=async fn=>{const until=Date.now()+12000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('安装版本窗口加载超时');};
 try{
  assert.ok(app.isPackaged);assert.ok(!data.startsWith(root+path.sep));
  fs.writeFileSync(path.join(data,'写入检查.txt'),'ok');checks.push('安装目录与可写用户数据分离');
  assert.equal(snapshot().character.id,'hanli');assert.equal(packs.list().entries.length,26);
  for(const id of ['idle','reading']){
   update({action:id,frame:0,playing:true,autoPlay:false});
   await wait(()=>pet.webContents.executeJavaScript(`document.getElementById('canvas').dataset.action==='${id}'&&Number(document.getElementById('canvas').dataset.frame)>2`));
  }
  assert.equal(await panel.webContents.executeJavaScript("document.querySelector('h1').textContent"),'青竹桌宠');
  checks.push('韩立待机和阅读正常播放，设置界面与26个人物下载项正常加载');
  await showEditor();const editor=getEditor();
  await wait(()=>editor.webContents.executeJavaScript("!!window.frameEditor&&!document.getElementById('frame').disabled"));
  assert.equal(await editor.webContents.executeJavaScript("document.getElementById('show-hints')===null&&document.getElementById('feather-radius').value==='3'"),true);
  fs.writeFileSync(path.join(data,'安装版本修补工具.png'),(await editor.webContents.capturePage()).toPNG());
  checks.push('安装版本的透明帧修补工具正常打开');
  fs.writeFileSync(path.join(data,'安装验收.json'),JSON.stringify({passed:true,version:app.getVersion(),checks},null,2));
  editor.destroy();app.quit();
 }catch(error){
  fs.writeFileSync(path.join(data,'安装验收.json'),JSON.stringify({passed:false,checks,error:error.stack},null,2));
  getEditor()?.destroy();app.exit(1);
 }
};
