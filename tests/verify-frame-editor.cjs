'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fileURLToPath}=require('node:url');
if(process.argv.includes('--verify-soft-editor')){module.exports=require('./verify-soft-editor.cjs');}else module.exports=async({app,pet,panel,update,snapshot,root,getEditor})=>{
 const out=path.join(root,'tests/results'),checks=[],errors=[];let editor;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async f=>{const end=Date.now()+15000;while(Date.now()<end){if(await f())return;await pause(40);}throw Error('等待编辑器或播放帧超时');};
 const ejs=code=>editor.webContents.executeJavaScript(code),pjs=code=>pet.webContents.executeJavaScript(code);
 const ui=code=>panel.webContents.executeJavaScript(code);
 const pixel=async(which,x,y)=>ejs(`Array.from(document.getElementById('${which}').getContext('2d').getImageData(${x},${y},1,1).data)`);
 const click=async(x,y)=>{editor.webContents.sendInputEvent({type:'mouseMove',x,y});editor.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});editor.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x,y});await pause(80);};
 try{
  update({character:'ziling'});update({autoPlay:false,playing:false,frame:0,edgeBlend:false});
  await ui("document.getElementById('inspection').open=true;document.getElementById('edit-frame').click()");
  await wait(()=>Promise.resolve(getEditor()?.isVisible()));editor=getEditor();
  editor.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});
  await wait(()=>ejs("window.frameEditor && !document.getElementById('frame').disabled"));
  assert.equal(await ejs("document.getElementById('character').options.length"),snapshot().characters.length);
  checks.push('设置面板入口打开独立修补窗口，可选择全部已安装角色和动作');
  await ejs("document.getElementById('zoom').value='8';document.getElementById('zoom').dispatchEvent(new Event('change'))");
  const size=await ejs("({width:document.getElementById('after').width,display:document.getElementById('after').getBoundingClientRect().width,rendering:getComputedStyle(document.getElementById('after')).imageRendering})");
  assert.equal(size.display,size.width*8);assert.equal(size.rendering,'pixelated');checks.push('800% 放大使用原始像素，保持清晰像素边界');
  await ejs("document.getElementById('zoom').value='1';document.getElementById('zoom').dispatchEvent(new Event('change'));document.getElementById('viewport').scrollTop=0;document.getElementById('viewport').scrollLeft=0;document.getElementById('comparison').checked=false;document.getElementById('comparison').dispatchEvent(new Event('change'))");
  await ejs("document.getElementById('brush').value='1';document.getElementById('soft').checked=false");
  const sample=await ejs(`(()=>{const c=document.getElementById('before'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let y=70;y<220;y++)for(let x=100;x<c.width-100;x++)if(d[(y*c.width+x)*4+3]>200){const r=document.getElementById('stage').getBoundingClientRect();return {x,y,mouseX:Math.floor(r.left+x+.5),mouseY:Math.floor(r.top+y+.5)};}throw Error('没有找到测试像素');})()`);
  const source=snapshot().animation.frames[0].url,base=fs.readFileSync(fileURLToPath(source)),baseSha=crypto.createHash('sha256').update(base).digest('hex'),original=await pixel('before',sample.x,sample.y);
  await click(sample.mouseX,sample.mouseY);assert.equal(await ejs('window.frameEditor.erasedPixels'),1);assert.equal((await pixel('after',sample.x,sample.y))[3],0);assert.deepEqual(await pixel('before',sample.x,sample.y),original);
  await ejs("document.getElementById('undo').click()");assert.deepEqual(await pixel('after',sample.x,sample.y),original);
  await ejs("document.getElementById('redo').click()");assert.equal((await pixel('after',sample.x,sample.y))[3],0);
  await ejs("document.getElementById('restore').click()");await click(sample.mouseX,sample.mouseY);assert.deepEqual(await pixel('after',sample.x,sample.y),original);
  await ejs("document.getElementById('undo').click();document.getElementById('erase').click()");assert.equal(await ejs('window.frameEditor.erasedPixels'),1);
  checks.push('原生鼠标精确清除一个像素，撤销、重做、恢复笔刷均正确，修改前保持不变');
  await ejs("document.getElementById('next').click()");await wait(()=>ejs('window.frameEditor.currentFrame===1&&!document.getElementById("frame").disabled'));
  assert.equal(await ejs('window.frameEditor.erasedPixels'),0);
  await ejs("document.getElementById('prev').click()");await wait(()=>ejs('window.frameEditor.currentFrame===0&&!document.getElementById("frame").disabled'));assert.equal(await ejs('window.frameEditor.erasedPixels'),1);checks.push('逐帧切换保留当前帧未保存修补，其他帧不受影响');
  await ejs("document.getElementById('comparison').checked=true;document.getElementById('comparison').dispatchEvent(new Event('change'))");
  await ejs("window.events=[];for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,e=>window.events.push([type,e.clientX,e.clientY,e.target.id,e.target.parentNode.id]),true)");
  const divider=await ejs("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),target:Math.round(r.left+r.width*.8),y:Math.round(r.top+35),width:r.width};})()");
  editor.webContents.sendInputEvent({type:'mouseMove',x:divider.x,y:divider.y});await pause(60);editor.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:divider.x,y:divider.y});await pause(60);editor.webContents.sendInputEvent({type:'mouseMove',modifiers:['leftButtonDown'],x:divider.target,y:divider.y});await pause(60);editor.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:divider.target,y:divider.y});await pause(100);
  assert.ok(Math.abs(await ejs("parseFloat(document.getElementById('before-clip').style.width)")-divider.width*.8)<2,JSON.stringify({divider,actual:await ejs("({width:document.getElementById('before-clip').style.width,split:document.getElementById('divider').style.left,events:window.events})")}));checks.push('竖向分隔条可用鼠标左右拖动，正确改变修改前后可见区域');
  await ejs("document.getElementById('save').click()");await wait(()=>ejs('window.frameEditor.dirtyFrames===0&&!document.getElementById("frame").disabled'));
  assert.ok(snapshot().animation.variant.includes('repair-'));assert.ok(snapshot().animation.frames[0].repairMaskUrl);
  update({frame:0,playing:false,autoPlay:false,edgeBlend:false});
  await wait(()=>pjs("document.getElementById('canvas').dataset.frame==='1'"));
  assert.equal(await pjs(`document.getElementById('canvas').getContext('2d').getImageData(${sample.x},${sample.y},1,1).data[3]`),0);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(source))).digest('hex'),baseSha);
  checks.push('保存后桌宠立即采用修补像素，原始 WebP 哈希保持不变');
  await ejs("document.getElementById('zoom').value='2';document.getElementById('zoom').dispatchEvent(new Event('change'));document.getElementById('viewport').scrollLeft=170;document.getElementById('viewport').scrollTop=80");
  await pause(150);fs.writeFileSync(path.join(out,'透明帧修补-窗口.png'),(await editor.webContents.capturePage()).toPNG());
  editor.close();await wait(()=>Promise.resolve(!getEditor()));
  await ui("document.getElementById('edit-frame').click()");await wait(()=>Promise.resolve(getEditor()?.isVisible()));editor=getEditor();
  await wait(()=>ejs('window.frameEditor&&!document.getElementById("frame").disabled'));assert.equal(await ejs('window.frameEditor.erasedPixels'),1);checks.push('关闭并重开编辑器后修补记录仍存在');
  await ejs("document.getElementById('reset').click();document.getElementById('save').click()");await wait(()=>ejs('window.frameEditor.dirtyFrames===0&&!document.getElementById("frame").disabled'));
  assert.equal(snapshot().animation.variant,'cleaned-v1');assert.equal(snapshot().animation.frames[0].repairMaskUrl,undefined);
  update({frame:0});await wait(()=>pjs("document.getElementById('canvas').dataset.frame==='1'"));assert.equal(await pjs(`document.getElementById('canvas').getContext('2d').getImageData(${sample.x},${sample.y},1,1).data[3]`),original[3]);
  checks.push('恢复原帧并保存后撤掉修补，实际播放恢复原像素');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'透明帧修补验证.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
 }catch(error){fs.writeFileSync(path.join(out,'透明帧修补验证.json'),JSON.stringify({passed:false,checks,error:error.stack,errors},null,2));console.error(error);process.exitCode=1;}
 getEditor()?.destroy();app.quit();
};



