'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({app,panel,player,surface,showPanel,hidePanel,update,snapshot,out,checks})=>{
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const bounded=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+'超时')),6000);})]);}finally{clearTimeout(timer);}};
  const read=()=>app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,workingMiB:p.memory.workingSetSize/1024,privateMiB:(p.memory.privateBytes||0)/1024}));
  const sample=async()=>{
    const readings=[];
    for(let i=0;i<3;i++){readings.push(read());await pause(300);}
    const sums=readings.map(rows=>rows.reduce((s,p)=>({workingMiB:s.workingMiB+p.workingMiB,privateMiB:s.privateMiB+p.privateMiB}),{workingMiB:0,privateMiB:0}));
    return {workingMiB:sums.reduce((n,s)=>n+s.workingMiB,0)/3,privateMiB:sums.reduce((n,s)=>n+s.privateMiB,0)/3,processes:readings[1]};
  };
  update({character:'hanli'});update({action:snapshot().idleId,playing:true,autoPlay:false,frame:0});
  await panel.webContents.executeJavaScript("document.querySelector('[data-filter=installed]').click();document.getElementById('portraits').scrollTop=120;document.getElementById('inspection').open=true");
  const scroll=await panel.webContents.executeJavaScript("document.getElementById('portraits').scrollTop");
  const playerId=player.webContents.id;
  await pause(1500);const window=await sample();
  hidePanel();await pause(5500);const desktop=await sample();
  const cache=await player.webContents.executeJavaScript("({frames:Number(document.getElementById('canvas').dataset.cached),starts:typeof startImages==='undefined'?null:startImages.size})");
  const result={window,desktop,cache,panelUrl:panel.webContents.getURL()};
  fs.writeFileSync(path.join(out,'当前客户端-内存.json'),JSON.stringify(result,null,2));
  assert.ok(result.panelUrl.endsWith('/panel-sleep.html'),'桌宠模式应卸载隐藏主界面');
  assert.equal(cache.frames,6);assert.ok(cache.starts<=4,JSON.stringify(cache));
  const pace=await bounded(player.webContents.executeJavaScript(`new Promise(resolve=>{const seen=new Set(),c=document.getElementById('canvas'),start=performance.now();function tick(now){seen.add(c.dataset.frame);if(now-start>=1500)resolve(seen.size);else requestAnimationFrame(tick);}requestAnimationFrame(tick);})`),'休眠后动画刷新');
  assert.ok(pace>=25,'低内存模式动画不应明显降帧：'+pace);
  await bounded(player.webContents.executeJavaScript('window.petAPI.dragStart()'),'休眠后拖拽');assert.equal(snapshot().interactionPhase,'grab');
  await bounded(player.webContents.executeJavaScript('window.petAPI.dragEnd()'),'休眠后松手');
  await pause(700);
  await bounded(showPanel(),'休眠后恢复');for(let i=0;i<240&&!surface.hosted;i++)await pause(25);
  assert.equal(surface.hosted,true);assert.equal(player.webContents.id,playerId);
  assert.equal(await panel.webContents.executeJavaScript("document.querySelector('[data-filter=installed]').getAttribute('aria-pressed')"),'true');
  assert.equal(await panel.webContents.executeJavaScript("document.getElementById('inspection').open"),true);
  assert.equal(await panel.webContents.executeJavaScript("document.getElementById('portraits').scrollTop"),scroll);
  checks.push(`桌宠休眠释放主界面，预读6帧/首帧${cache.starts}帧；1.5秒播放${pace}个不同动画帧，拖拽响应正常；恢复同一播放器及筛选/滚动/逐帧展开状态`);
  checks.push(`内存抽查（全部客户端进程合计，三次均值）：主界面私有 ${window.privateMiB.toFixed(1)} MiB，桌宠私有 ${desktop.privateMiB.toFixed(1)} MiB，桌宠工作集 ${desktop.workingMiB.toFixed(1)} MiB`);
  return result;
};
