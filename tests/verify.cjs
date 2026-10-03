'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { nativeImage } = require('electron');
module.exports = async ({ app, pet, panel, getBoard, movePet, update, snapshot, root, windowMover, freePosition }) => {
  const out = path.join(root, 'tests/results'); fs.mkdirSync(out, { recursive: true });
  const checks = [], errors = [];
  for (const w of [pet,panel]) w.webContents.on('console-message', (_, level, message) => { if(level >= 3) errors.push(message); });
  const js = code => pet.webContents.executeJavaScript(code);
  const wait = async check => { const start = Date.now(); while (Date.now()-start < 12000) { if(await check()) return; await new Promise(r => setTimeout(r,60)); } throw new Error('等待渲染超时'); };
  const frame = () => js('Number(document.getElementById("canvas").dataset.frame)');
  const screenshot = async (w,name) => fs.writeFileSync(path.join(out,name+'.png'), (await w.webContents.capturePage()).toPNG());
  const canvasCenter=async () => {
    const r=await js("(() => {const r=document.getElementById('canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    const c=pet.getContentBounds();return {x:c.x+r.x,y:c.y+r.y};
  };
  const boardCenter=async () => {
    const board=getBoard(),c=board.getContentBounds();
    const r=await board.webContents.executeJavaScript("(() => {const r=document.getElementById('surface').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    return {x:c.x+r.x,y:c.y+r.y};
  };
  const centered=async () => {const p=await canvasCenter(),b=await boardCenter();return Math.abs(p.x-b.x)<=3 && Math.abs(p.y-b.y)<=3;};
  try {
    const iconPath=path.join(root,'assets','app.ico');
    const ico=fs.readFileSync(iconPath);
    assert.equal(ico.readUInt32LE(0),0x00010000);
    assert.ok(ico.readUInt16LE(4)>0);
    assert.equal(nativeImage.createFromPath(path.join(root,'assets','app.png')).isEmpty(),false);
    if(process.platform==='win32') {
      const ffi=require('koffi');
      const getIcon=ffi.load('user32.dll').func('uintptr_t __stdcall SendMessageW(uintptr_t hwnd, uint32_t message, uintptr_t kind, intptr_t extra)');
      for(const win of [pet,panel,getBoard()]) {
        const handle=win.getNativeWindowHandle();
        const hwnd=handle.length===8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
        assert.ok(getIcon(hwnd,0x7f,1,0),'窗口未设置软件图标');
      }
    }
    checks.push('自定义ICO和托盘图片可加载，三个原生窗口已设置软件图标');
    assert.equal(getBoard()?.isVisible(),true);assert.equal(pet.isVisible(),true);
    await wait(centered);checks.push('启动默认打开背景板，动画画面居中');
    if(process.argv.includes('--board=black')) {
      assert.equal(await getBoard().webContents.executeJavaScript("document.getElementById('surface').dataset.mode"),'black');
      checks.push('启动参数切换到黑底检查板');
    }
    assert.deepEqual(snapshot().actions.map(a=>a.id), ['idle','reading','bottle','hug','swords']);
    assert.equal(snapshot().settings.action,'idle');assert.equal(snapshot().settings.autoPlay,true);
    checks.push('加载待机、阅读、小绿瓶、相拥与御剑五套动画，启动进入自动待机');
    update({edgeBlend:false,autoPlay:false});
    for(const a of snapshot().actions) {
      update({ action:a.id, frame:0, playing:false, loop:true, visible:true });
      await wait(async () => await js(`document.getElementById('canvas').dataset.action === '${a.id}'`) && await frame() === 1);
      const alpha = await js(`(() => { const c=document.getElementById('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let zero=0,soft=0,solid=0;for(let i=3;i<d.length;i+=4){if(d[i]===0)zero++;else if(d[i]===255)solid++;else soft++;}return {zero,soft,solid}; })()`);
      const raw = nativeImage.createFromPath(path.join(root,'assets',snapshot().animation.frames[0].file)).toBitmap();
      const expected = {zero:0,soft:0,solid:0}; for(let i=3;i<raw.length;i+=4){if(raw[i]===0)expected.zero++;else if(raw[i]===255)expected.solid++;else expected.soft++;}
      assert.deepEqual(alpha,expected); assert.ok(alpha.zero>0 && alpha.solid>1000 && alpha.soft>0);
      await screenshot(pet,a.id+'-transparent'); checks.push(a.id+' 原始透明像素一致');
      update({frame:Math.floor(a.count/2),playing:false});
      await wait(async () => await frame() === Math.floor(a.count/2)+1);
      const paused = await frame(); await new Promise(r => setTimeout(r,300)); assert.equal(await frame(),paused);
      await screenshot(pet,a.id+'-middle'); checks.push(a.id+' 定位和暂停');
      update({playing:true}); await wait(async () => await frame() > paused+4);
      assert.ok(await js('Number(document.getElementById("canvas").dataset.cached)')<=14); checks.push(a.id+' 正常播放与有界缓存');
      update({ frame: a.count-3, playing:true,loop:false });
      await wait(() => Promise.resolve(!snapshot().settings.playing)); assert.equal(await frame(),a.count); checks.push(a.id+' 非循环保持尾帧');
      update({frame:a.count-3,playing:true,loop:true}); await wait(async () => await frame()<10); checks.push(a.id+' 循环返回首帧');
    }
    // Check the composed window, since CSS masks intentionally leave source
    // frame pixels unchanged. An opaque test card exercises all four edges.
    update({playing:false,frame:0});await wait(async()=>await frame()===1);
    await js('document.body.dataset.hover="false"');
    const fadeRect=await js(`(() => {
      const c=document.getElementById('canvas'),p=c.getContext('2d'),r=c.getBoundingClientRect();
      p.clearRect(0,0,c.width,c.height);p.fillStyle='#308b54';p.fillRect(0,0,c.width,c.height);
      const band=parseFloat(c.style.getPropertyValue('--edge-feather'));
      return {x:r.x,y:r.y,width:r.width,height:r.height,band,
        edgeHit:window.hitTest(r.left+.1,r.top+r.height/2),
        centerHit:window.hitTest(r.left+r.width/2,r.top+r.height/2)};
    })()`);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const fadeImage=await pet.webContents.capturePage();
    const fadePixels=fadeImage.toBitmap(),fadeSize=fadeImage.getSize(),contentBounds=pet.getContentBounds();
    const sampleAlpha=(x,y)=> {
      const px=Math.min(fadeSize.width-1,Math.max(0,Math.floor(x*fadeSize.width/contentBounds.width)));
      const py=Math.min(fadeSize.height-1,Math.max(0,Math.floor(y*fadeSize.height/contentBounds.height)));
      return fadePixels[(py*fadeSize.width+px)*4+3];
    };
    const {x:fx,y:fy,width:fw,height:fh,band}=fadeRect;
    const fadeSides=[
      d=>sampleAlpha(fx+d,fy+fh/2),d=>sampleAlpha(fx+fw-d,fy+fh/2),
      d=>sampleAlpha(fx+fw/2,fy+d),d=>sampleAlpha(fx+fw/2,fy+fh-d)
    ];
    for(const side of fadeSides) {
      const near=side(1),middle=side(band/2),inside=side(band+3);
      assert.ok(near<45 && middle>80 && middle<180 && inside>245,`边界渐隐不连续: ${near},${middle},${inside}`);
    }
    assert.ok(sampleAlpha(fx+1,fy+1)<10,'角落没有叠加透明');
    assert.equal(sampleAlpha(fx+fw/2,fy+fh/2),255);
    assert.equal(fadeRect.edgeHit,false);assert.equal(fadeRect.centerHit,true);
    fs.writeFileSync(path.join(out,'四周渐隐验证.png'),fadeImage.toPNG());
    // Find an actual entrance/exit frame touching the right boundary, without
    // hardcoding character coordinates or animation timing.
    const hug=snapshot().actions.find(a=>a.id==='hug');
    update({action:'hug',frame:0,playing:false});
    let edgeFrame=0,bestCoverage=-1;
    const hugFrames=snapshot().animation.frames;
    for(let i=0;i<hugFrames.length;i++) {
      const raw=nativeImage.createFromPath(path.join(root,'assets',hugFrames[i].file)).toBitmap();
      let coverage=0;for(let y=0;y<hug.height;y++) if(raw[(y*hug.width+hug.width-1)*4+3]>48) coverage++;
      if(coverage>bestCoverage){bestCoverage=coverage;edgeFrame=i;}
    }
    assert.ok(bestCoverage>20,'相拥素材没有边界入场帧');
    update({frame:edgeFrame,playing:false});await wait(async()=>await frame()===edgeFrame+1);
    await js('document.getElementById("canvas").style.maskImage="none"');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await screenshot(pet,'相拥边界-原始');
    await js('document.getElementById("canvas").style.removeProperty("mask-image")');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await screenshot(pet,'相拥边界-渐隐');
    checks.push('四边及四角合成透明渐变、中心完整保留、透明边缘鼠标穿透、相拥入场帧对照');
    update({action:'idle',frame:0,playing:false,cleanNoise:true});await wait(async()=>await frame()===1);
    assert.equal(snapshot().animation.variant,'cleaned-v1');
    const pixelData=()=>js("(() => {const c=document.getElementById('canvas');return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);})()");
    const optimized=await pixelData();
    await panel.webContents.executeJavaScript("document.getElementById('clean-noise').click()");
    await wait(async()=>snapshot().animation.variant==='original' && await frame()===1);
    const original=await pixelData();
    assert.ok(optimized.some((value,i)=>i%4===3 && value<original[i]));
    for(let i=3;i<original.length;i+=4) if(original[i]>=48) assert.deepEqual(optimized.slice(i-3,i+1),original.slice(i-3,i+1));
    await panel.webContents.executeJavaScript("document.getElementById('clean-noise').click()");
    await wait(async()=>snapshot().animation.variant==='cleaned-v1' && await frame()===1);
    checks.push('实际开关切换净化与原版，主体及强特效像素保持一致');
    for(const a of snapshot().actions) {
      const middle=Math.floor(a.count/2);
      update({action:a.id,frame:middle,playing:false,edgeBlend:false});
      await wait(async()=>await frame()===middle+1);
      const raw=await pixelData();
      const maskFile=snapshot().animation.frames[middle].edgeMaskFile;
      if(!maskFile) {
        assert.equal(await panel.webContents.executeJavaScript("document.getElementById('edge-blend').disabled"),true);
        checks.push(a.id+' 纯色透明动画不施加环境渐隐');
        continue;
      }
      const mask=nativeImage.createFromPath(path.join(root,'assets',maskFile)).toBitmap();
      await panel.webContents.executeJavaScript("document.getElementById('edge-blend').click()");
      await wait(async()=>snapshot().animation.variant.endsWith(':edge-blend-v1') && await frame()===middle+1 && await js("state.settings.edgeBlend"));
      const blended=await pixelData();let faded=0,protectedCount=0;
      for(let i=3;i<raw.length;i+=4) {
        if(mask[i]===255) {assert.deepEqual(blended.slice(i-3,i+1),raw.slice(i-3,i+1));protectedCount++;}
        else {assert.ok(Math.abs(blended[i]-raw[i]*mask[i]/255)<=1);if(blended[i]<raw[i])faded++;}
      }
      assert.ok(faded>1000 && protectedCount>10000);
      await screenshot(pet,a.id+'-edge-blended');
      checks.push(a.id+' 环境渐隐，受保护区域完整保留');
    }
    // Exercise actual renderer boundaries, including idle -> same idle revision.
    const idle = snapshot().actions.find(a=>a.id==='idle');
    await panel.webContents.executeJavaScript("document.getElementById('probability').value=47;document.getElementById('probability').dispatchEvent(new Event('input'))");
    await wait(()=>Promise.resolve(snapshot().settings.actionProbability===47));
    const stored=JSON.parse(fs.readFileSync(path.join(root,'tests/results/data/settings.json'),'utf8'));
    assert.equal(stored.settings.actionProbability,47);checks.push('概率滑块实时生效并持久保存');
    update({autoPlay:true,action:'idle',frame:idle.count-1,playing:false,actionProbability:0});
    await wait(async()=>await frame()===idle.count);
    let rev=snapshot().revision;await new Promise(r=>setTimeout(r,160));assert.equal(snapshot().revision,rev);
    update({playing:true});rev=snapshot().revision;
    await wait(()=>Promise.resolve(snapshot().revision>rev));assert.equal(snapshot().settings.action,'idle');
    checks.push('暂停不抽签，0%待机完整结束后重新待机');
    update({action:'idle',frame:idle.count-1,playing:true,actionProbability:100});rev=snapshot().revision;
    await wait(()=>Promise.resolve(snapshot().revision>rev));
    const specialActions=snapshot().actions.filter(a=>a.role!=='idle');
    const firstAutomaticAction=snapshot().settings.action;
    assert.ok(specialActions.some(a=>a.id===firstAutomaticAction));
    const stale=rev, live=snapshot().revision;
    await js(`window.petAPI.ended(${stale})`);assert.equal(snapshot().revision,live);
    for(const a of snapshot().actions.filter(a=>a.id!=='idle')) {
      update({action:a.id,frame:a.count-1,playing:true});rev=snapshot().revision;
      await wait(()=>Promise.resolve(snapshot().revision>rev));assert.equal(snapshot().settings.action,'idle');
    }
    assert.equal(await panel.webContents.executeJavaScript("document.getElementById('loop').disabled"),true);
    checks.push('100%触发其他动作，所有动作结束均回待机，过期通知不会重复切换');
    const autoSequence = [firstAutomaticAction];
    for(let i=1;i<specialActions.length*2;i++) {
      update({action:'idle',frame:idle.count-1,playing:true,actionProbability:100});rev=snapshot().revision;
      await wait(()=>Promise.resolve(snapshot().revision>rev));
      const a=snapshot().actions.find(a=>a.id===snapshot().settings.action);
      autoSequence.push(a.id);
      await wait(async()=>await js(`document.getElementById('canvas').dataset.action==='${a.id}'`) && await frame()>=1);
      update({frame:a.count-1,playing:true});rev=snapshot().revision;
      await wait(()=>Promise.resolve(snapshot().revision>rev));assert.equal(snapshot().settings.action,'idle');
    }
    for(let i=1;i<autoSequence.length;i++) assert.notEqual(autoSequence[i],autoSequence[i-1]);
    for(let i=0;i<autoSequence.length;i+=specialActions.length) {
      assert.deepEqual([...autoSequence.slice(i,i+specialActions.length)].sort(),specialActions.map(a=>a.id).sort());
    }
    const counts=snapshot().actionCounts;
    assert.ok(specialActions.every(a=>counts[a.id]>=2));
    const summary=await panel.webContents.executeJavaScript("document.getElementById('action-counts').textContent");
    assert.ok(specialActions.every(a=>summary.includes(a.title)));
    fs.writeFileSync(path.join(out,'random-actions.json'),JSON.stringify({autoSequence,counts},null,2));
    checks.push(`${autoSequence.length}次真实自动触发：${specialActions.map(a=>a.title).join('、')}各两次，无连续重复，面板显示触发次数`);
    update({autoPlay:false,actionProbability:30});
    const sequence=[...snapshot().actions,...snapshot().actions].map(a=>a.id);
    for(const id of sequence) {
      await panel.webContents.executeJavaScript(`document.getElementById('action').value='${id}';document.getElementById('action').dispatchEvent(new Event('change'))`);
      await new Promise(resolve=>setTimeout(resolve,35));
    }
    const finalAction=snapshot().actions.at(-1);
    update({action:finalAction.id,frame:Math.floor(finalAction.count/2),playing:false});
    await wait(async()=>await js(`document.getElementById('canvas').dataset.action==='${finalAction.id}'`) && await frame()===Math.floor(finalAction.count/2)+1);
    assert.ok(await js('Number(document.getElementById("canvas").dataset.cached)')<=14);
    assert.equal(snapshot().settings.autoPlay,false);checks.push('快速手动切换关闭随机播放，最终动作与帧定位正确');
    update({edgeBlend:true});
    update({action:'idle',frame:0,playing:false,scale:.5}); await wait(() => Promise.resolve(Math.abs(pet.getBounds().height-330)<=2)); console.log('HALF_SIZE', JSON.stringify(pet.getBounds()));
    update({scale:1}); await wait(() => Promise.resolve(Math.abs(pet.getBounds().height-618)<=2)); console.log('FULL_SIZE', JSON.stringify(pet.getBounds())); checks.push('独立缩放');
    // Move a real transparent window while animation plays. The injected cursor
    // affects only this controller, never the user's actual desktop pointer.
    update({action:'idle',frame:0,playing:true,scale:.5});
    await wait(async () => await frame() >= 1);
    const { createDragController } = require('../app/drag-controller.cjs');
    let simulated = { x:0,y:0 }, moves = 0, ended = 0;
    const geometry = [], nativeGeometry = [], samples = [], began = performance.now(), bounds = pet.getBounds();
    const canvasSize = () => js("(() => {const r=document.getElementById('canvas').getBoundingClientRect();return {width:r.width,height:r.height};})()");
    const displayBefore = await canvasSize();
    assert.equal(windowMover.backend,'win32-position-only');
    const nativeBefore=windowMover.nativeBounds();
    const motion = createDragController({
      getCursor: () => simulated,
      getBounds: () => bounds,
      clamp: freePosition,
      move: (x,y) => { movePet(x,y); moves++; samples.push(performance.now()); geometry.push(pet.getBounds()); nativeGeometry.push(windowMover.nativeBounds()); },
      onStart: () => windowMover.beginDrag(), onStop: () => windowMover.endDrag(),
      onEnd: () => ended++
    });
    motion.start();
    const cursor = setInterval(() => { const t=performance.now()-began; simulated={x:Math.round(-t/4),y:Math.round(-t/8)}; },4);
    try { await new Promise(r => setTimeout(r,600)); } finally { clearInterval(cursor); motion.stop(); }
    assert.ok(moves>=40, `拖动600ms只更新${moves}次`); assert.equal(ended,1);
    await wait(async () => await frame()>=7);
    assert.ok(Math.abs(pet.getBounds().x-(bounds.x+simulated.x))<=2);
    const gaps=samples.slice(1).map((t,i)=>t-samples[i]).sort((a,b)=>a-b);
    fs.writeFileSync(path.join(out,'drag-performance.json'),JSON.stringify({moves,elapsedMs:performance.now()-began,medianIntervalMs:gaps[Math.floor(gaps.length/2)],animationFrame:await frame(),startBounds:bounds,endBounds:pet.getBounds(),nativeBefore,nativeAfter:windowMover.nativeBounds(),nativeGeometry,geometry},null,2));
    assert.ok(gaps[Math.floor(gaps.length/2)]<=18, '拖动位置更新间隔过大');
    assert.ok(nativeGeometry.every(b=>b.width===nativeBefore.width && b.height===nativeBefore.height), '原生窗口尺寸变化');
    assert.ok(geometry.every(b => Math.abs(b.width-bounds.width)<=2 && Math.abs(b.height-bounds.height)<=2), '拖动过程中窗口尺寸发生累积变化');
    const displayAfter = await canvasSize();
    assert.deepEqual(displayAfter,displayBefore);
    assert.deepEqual(displayAfter,{width:192,height:288});
    // Moving repeatedly in both directions must never reintroduce size drift.
    for(let i=0;i<80;i++) movePet(bounds.x-(i%20),bounds.y-(i%40)*2);
    assert.ok(Math.abs(pet.getBounds().width-bounds.width)<=2 && Math.abs(pet.getBounds().height-bounds.height)<=2);
    assert.deepEqual(await canvasSize(),displayBefore);
    checks.push('原生仅移动位置，600ms至少40次更新，中位间隔不超过18ms，松手停下且动画持续');
    checks.push('连续向上及往返移动，窗口与桌宠尺寸保持固定');
    // Use the production positioning rule at desktop edges and ensure action
    // changes do not pull the window back inside its transparent PNG boundary.
    const { screen } = require('electron');
    const area = screen.getPrimaryDisplay().workArea;
    const targets = [
      {x:area.x-120,y:area.y-80},
      {x:area.x+area.width-20,y:area.y+area.height-20}
    ];
    for(const target of targets) {
      let cursor={x:0,y:0};
      const start=pet.getBounds();
      const freeDrag=createDragController({getCursor:()=>cursor,getBounds:()=>pet.getBounds(),clamp:freePosition,move:movePet,onEnd:()=>{}});
      freeDrag.start();cursor={x:target.x-start.x,y:target.y-start.y};freeDrag.stop();
      let actual=pet.getBounds();
      assert.ok(Math.abs(actual.x-target.x)<=2 && Math.abs(actual.y-target.y)<=2,'拖动仍受到屏幕或 PNG 边界限制');
      update({action:'reading',frame:0,playing:false});
      actual=pet.getBounds();
      assert.ok(Math.abs(actual.x-target.x)<=2 && Math.abs(actual.y-target.y)<=2,'切换动画把自由拖动的位置拉回屏幕');
      update({action:'idle',frame:0,playing:false});
      assert.deepEqual(await canvasSize(),displayBefore);
    }
    await getBoard().webContents.executeJavaScript('window.petAPI.placeOnBoard()');
    await wait(centered);
    checks.push('允许窗口越过四周屏幕边界，切换动画不弹回，重新居中可找回');
    update({visible:false});assert.equal(pet.isVisible(),false);update({visible:true});assert.equal(pet.isVisible(),true);checks.push('显示与隐藏');
    for(const theme of ['dark','light']) { await panel.webContents.executeJavaScript(`document.body.dataset.theme='${theme}'`); await screenshot(panel,'panel-'+theme); }
    panel.setSize(320,680); await screenshot(panel,'panel-narrow');
    const layout = await panel.webContents.executeJavaScript('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');
    assert.ok(layout.scroll<=layout.width); checks.push('浅深色及窄面板');
    update({frame:0,playing:false}); await wait(async () => await frame()===1);
    await js('document.body.dataset.hover="true"'); await screenshot(pet,'pet-hover');
    const hit = await js(`(() => {const c=document.getElementById('canvas'),r=c.getBoundingClientRect(),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let idx=3;while(d[idx]<=8)idx+=4;const p=(idx-3)/4;return {transparent:window.hitTest(r.left+1,r.top+1),opaque:window.hitTest(r.left+(p%c.width+.5)*r.width/c.width,r.top+(Math.floor(p/c.width)+.5)*r.height/c.height)};})()`);
    assert.equal(hit.transparent,false); assert.equal(hit.opaque,true); checks.push('透明区穿透与主体命中');
    panel.close();assert.equal(panel.isVisible(),false); await js('window.petAPI.panel()');assert.equal(panel.isVisible(),true);checks.push('关闭面板与重新打开');
    await panel.webContents.executeJavaScript("document.getElementById('board').click()");
    await wait(()=>Promise.resolve(!!getBoard()?.isVisible()));
    const board=getBoard(); assert.ok(board?.isVisible()); assert.equal(board.isAlwaysOnTop(),false); assert.equal(pet.isAlwaysOnTop(),true);
    const bjs=code=>board.webContents.executeJavaScript(code);
    const paint=()=>bjs('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    for(const [mode,rgb] of [['black',[0,0,0]],['white',[255,255,255]],['pink',[196,119,147]]]) {
      await bjs(`document.querySelector('[data-mode="${mode}"]').click()`); await paint();
      const r=await bjs(`(() => {const r=document.getElementById('surface').getBoundingClientRect();return {x:Math.ceil(r.x+20),y:Math.ceil(r.y+20),width:10,height:10};})()`);
      const bitmap=(await board.webContents.capturePage(r)).toBitmap();
      assert.deepEqual([bitmap[2],bitmap[1],bitmap[0]],rgb);assert.equal(bitmap[3],255);
    }
    checks.push('背景板纯色像素正确且位于桌宠下方');
    await bjs(`document.getElementById('color').value='#123456';document.getElementById('color').dispatchEvent(new Event('input'))`); await paint();
    assert.equal(await bjs("getComputedStyle(document.getElementById('surface')).backgroundColor"),'rgb(18, 52, 86)');
    board.close();assert.equal(board.isVisible(),false);await panel.webContents.executeJavaScript("document.getElementById('board').click()");
    await wait(()=>Promise.resolve(!!getBoard()?.isVisible()));assert.equal(board.isVisible(),true);
    assert.equal(await bjs("document.getElementById('surface').dataset.mode"),'custom');checks.push('点击背景板按钮打开、自定义颜色与关闭重开');
    await bjs('window.petAPI.placeOnBoard()');
    await wait(centered);
    assert.equal(pet.isVisible(),true);checks.push('桌宠在背景板居中');
    await bjs("document.querySelector('[data-mode=checker]').click()");await paint();await screenshot(board,'board-checker');
    assert.notEqual(await bjs("getComputedStyle(document.getElementById('surface')).backgroundImage"),'none');
    board.setSize(440,500);await paint();
    const narrow=await bjs('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,height:document.getElementById("surface").clientHeight})');
    assert.ok(narrow.scroll<=narrow.width && narrow.height>200);await screenshot(board,'board-narrow');
    await bjs("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");await wait(()=>Promise.resolve(!board.isVisible()));
    checks.push('棋盘格、窄布局与Esc关闭');
    update({action:'idle',frame:0,playing:true,autoPlay:true,actionProbability:30});
    assert.equal(errors.length,0); checks.push('无渲染错误');
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,checks},null,2));
    console.log(JSON.stringify({passed:true,checks}));
  } catch(error) { fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:false,checks,error:error.stack,errors},null,2)); console.error(error); process.exitCode=1; }
  app.quit();
};
