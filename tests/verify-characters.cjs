const {fileURLToPath}=require('node:url');
const readImage=require('./read-image.cjs');
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {nativeImage}=require('electron');
module.exports=async ({app,pet,panel,snapshot,update,root,onDragMove,getBoard})=>{
  const out=path.join(root,'tests/results'),checks=[],errors=[];
  const js=code=>pet.webContents.executeJavaScript(code);
  const pjs=code=>panel.webContents.executeJavaScript(code);
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async predicate=>{const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await pause(40);}throw new Error('等待角色渲染超时');};
  const rendered=()=>js('({action:document.getElementById("canvas").dataset.action,frame:Number(document.getElementById("canvas").dataset.frame),cached:Number(document.getElementById("canvas").dataset.cached)})');
  const capture=async name=>fs.writeFileSync(path.join(out,name+'.png'),(await pet.webContents.capturePage()).toPNG());
  for(const w of [pet,panel])w.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});
  try {
    // Verification drives the API itself. Ignore incidental clicks on the visible
    // test surfaces so manual input cannot change saved drag preferences midway.
    await js("document.documentElement.style.pointerEvents='none'");
    await pjs("document.documentElement.style.pointerEvents='none'");
    assert.equal(await pjs("document.getElementById('clean-noise')===null"),true);
    assert.equal('cleanNoise' in snapshot().settings,false);
    assert.ok(snapshot().animation.frames.every(f=>!f.cleanedFile));
    await pjs("document.getElementById('manage-packs').click()");
    assert.equal(await pjs("document.querySelectorAll('#pack-list .pack-row').length"),snapshot().packs.entries.length);
    assert.equal(await pjs("document.getElementById('pack-import').disabled"),false);
    checks.push('仅净化帧、无原始帧开关、人物下载和本地导入入口通过');
    if(!process.argv.some(a=>a.startsWith('--board='))){
      assert.equal(getBoard(),undefined);
      checks.push('默认启动仅桌宠与设置面板，不创建背景检查板');
    }
    assert.equal(await pjs("document.getElementById('inspection').open"),false);
    assert.equal(await pjs("document.getElementById('scale').max"),'100');
    update({scale:1.5});assert.equal(snapshot().settings.scale,1);
    await wait(()=>js(`Math.abs(document.getElementById('canvas').getBoundingClientRect().width*window.devicePixelRatio-${snapshot().animation.width})<1`));
    assert.equal(await js(`Math.abs(document.getElementById('canvas').getBoundingClientRect().height*window.devicePixelRatio-${snapshot().animation.height})<1`),true);
    update({scale:.65});
    checks.push('尺寸上限为 100%，实际显示像素与素材分辨率一致，兼容屏幕 DPI');
    await pjs("document.getElementById('manage-packs').click()");
    checks.push('人物资源可折叠，动画检查默认收起，常用设置集中显示');
    const characters=snapshot().characters;
    assert.ok(characters.length>=1);assert.equal(characters[0].id,'hanli');
    await wait(()=>pjs(`document.getElementById('character').options.length===${characters.length}`));
    checks.push(`角色下拉框显示全部 ${characters.length} 位已安装角色`);
    for(const c of characters) {
      await pjs(`document.getElementById('character').value=${JSON.stringify(c.id)};document.getElementById('character').dispatchEvent(new Event('change'))`);
      await wait(()=>Promise.resolve(snapshot().character.id===c.id));
      await wait(async()=>{const r=await rendered();return r.action===snapshot().idleId&&r.frame>0;});
      const s=snapshot(),idle=s.idleId,grab=s.interactions.grab,drop=s.interactions.drop;
      assert.equal(s.settings.character,c.id);assert.equal(s.settings.autoPlay,true);assert.equal(s.settings.playing,true);
      if(c.id!=='hanli') {
        assert.equal(s.actions.filter(a=>a.role==='idle').length,1);
        assert.equal(s.actions.filter(a=>a.role==='interaction').length,2);
        assert.equal(s.actions.find(a=>a.id===c.id+'-wave')?.role,'action');
      }
      assert.equal(s.starts.length,s.actions.length);
      assert.equal(await pjs('document.getElementById("action").options.length'),s.actions.length);
      assert.equal(await pjs('document.getElementById("probability").disabled'),!s.actions.some(a=>a.role==='action'));
      checks.push(c.name+' 切换进入自身待机，仅列出自身动画与预加载首帧');
      const bounds=pet.getBounds();
      update({autoPlay:false,loop:false,playing:false,frame:0});
      for(const a of snapshot().actions) {
        update({action:a.id,frame:Math.floor(a.count/2),playing:false,edgeBlend:false});
        await wait(async()=>{const r=await rendered();return r.action===a.id&&r.frame===Math.floor(a.count/2)+1;});
        const frame=snapshot().animation.frames[Math.floor(a.count/2)];
        const raw=await readImage(pet.webContents,fileURLToPath(frame.url));
        const expected={zero:0,soft:0,solid:0};for(let i=3;i<raw.length;i+=4){if(raw[i]===0)expected.zero++;else if(raw[i]===255)expected.solid++;else expected.soft++;}
        const alpha=await js(`(()=>{const c=document.getElementById('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,r={zero:0,soft:0,solid:0};for(let i=3;i<d.length;i+=4){if(d[i]===0)r.zero++;else if(d[i]===255)r.solid++;else r.soft++;}return r;})()`);
        assert.deepEqual(alpha,expected);assert.ok(alpha.zero>1000&&alpha.solid>1000&&alpha.soft>0);
        await capture(c.id+'-'+a.id+'-middle');
        assert.ok((await rendered()).cached<=14);
        update({frame:a.count-2,playing:true,loop:false});
        await wait(()=>Promise.resolve(!snapshot().settings.playing));
        await wait(async()=>(await rendered()).frame===a.count);
        assert.equal(snapshot().animation.id,a.id);assert.equal(snapshot().settings.frame,a.count-1);
        checks.push(c.name+' '+a.title+' 透明像素一致、逐帧定位、缓存有界与自然尾帧通过');
      }
      update({action:idle,frame:0,autoPlay:true,playing:true,actionProbability:100});
      const dragStartState=snapshot();
      assert.equal(dragStartState.interactionPhase,'none',c.name+' unexpected pre-existing drag');
      assert.equal(dragStartState.settings.autoPlay,true);
      await js('window.petAPI.dragStart()');
      await wait(async()=>{const r=await rendered();return r.action===grab&&r.frame===1;});
      assert.equal(snapshot().settings.playing,false);await pause(140);assert.equal((await rendered()).frame,1);
      const oldRevision=snapshot().revision;
      onDragMove();await wait(async()=>(await rendered()).frame>3);
      const movingRevision=snapshot().revision;
      onDragMove();assert.equal(snapshot().revision,movingRevision);
      await wait(()=>Promise.resolve(!snapshot().settings.playing));
      const grabCount=snapshot().animation.frames.length;
      await wait(async()=>(await rendered()).frame===grabCount);
      await pause(160);assert.equal(snapshot().settings.frame,grabCount-1);
      await capture(c.id+'-grab-held-tail');
      onDragMove();assert.equal(snapshot().settings.frame,0);assert.equal(snapshot().settings.playing,true);
      await js(`window.petAPI.ended(${oldRevision})`);assert.equal(snapshot().settings.action,grab);
      await js('window.petAPI.dragEnd()');assert.equal(snapshot().settings.action,drop);
      await wait(()=>Promise.resolve(snapshot().settings.action===idle));
      assert.equal(snapshot().settings.autoPlay,true,JSON.stringify({character:c.id,before:dragStartState.settings,after:snapshot().settings,phase:snapshot().interactionPhase}));assert.equal(snapshot().interactionPhase,'none');
      assert.equal(pet.getBounds().width,bounds.width);assert.equal(pet.getBounds().height,bounds.height);
      checks.push(c.name+' 移动播一次、停住保持尾帧、再次移动重播、松手下落后回自身待机');
      if(c.id!=='hanli') {
        const wave=c.id+'-wave';
        const beforeCount=snapshot().actionCounts[wave];
        update({action:idle,frame:snapshot().actions.find(a=>a.id===idle).count-2,playing:true,autoPlay:true,actionProbability:100});
        await wait(()=>Promise.resolve(snapshot().settings.action===wave));
        await wait(async()=>{const r=await rendered();return r.action===wave&&r.frame>1;});
        assert.equal(snapshot().actionCounts[wave],beforeCount+1);
        await wait(()=>pjs(`document.getElementById('action-counts').textContent.includes('挥手打招呼 ${beforeCount+1} 次')`));
        update({frame:snapshot().animation.frames.length-2,playing:true});
        await wait(()=>Promise.resolve(snapshot().settings.action===idle));
        checks.push(c.name+' 待机结束自动触发挥手、面板计数增加、播完返回自身待机');
      }
      update({action:idle,frame:snapshot().actions.find(a=>a.id===idle).count-2,playing:true,autoPlay:true,actionProbability:0});
      const revision=snapshot().revision;
      await wait(()=>Promise.resolve(snapshot().revision>revision));
      assert.equal(snapshot().actions.find(a=>a.id===snapshot().settings.action).role,'idle');
      if(c.id!=='hanli')assert.equal(snapshot().settings.action,idle);
      checks.push(c.name+' 自动待机循环不串用其他角色');
    }
    const before=snapshot();assert.throws(()=>update({character:'missing'}));assert.equal(snapshot().character.id,before.character.id);
    // Switch in the middle of an interaction, then deliver its stale completion.
    if(characters.length>1){
      const first=characters[0],next=characters[1];
      update({character:first.id});await js('window.petAPI.dragStart()');onDragMove();
      const staleGrab=snapshot().revision;update({character:next.id});
      const idle=snapshot().idleId;
      assert.equal(snapshot().interactionPhase,'none');assert.equal(snapshot().settings.action,idle);
      await js(`window.petAPI.ended(${staleGrab})`);assert.equal(snapshot().settings.action,idle);
      await js('window.petAPI.dragEnd()');assert.equal(snapshot().settings.action,idle);
      checks.push('拖动途中切换角色会结束旧交互，旧完成通知和松手不污染新角色');
    }
    for(const c of [...characters].reverse())update({character:c.id});
    const finalCharacter=characters.find(c=>c.id==='mupeiling')||characters.at(-1);
    update({character:finalCharacter.id});
    await wait(async()=>(await rendered()).action===snapshot().idleId);
    const finalCount=snapshot().actions.length;
    await wait(()=>pjs(`document.getElementById('action').options.length===${finalCount}&&document.getElementById('character').value===${JSON.stringify(finalCharacter.id)}`));
    const saved=JSON.parse(fs.readFileSync(path.join(out,'data/settings.json'),'utf8'));
    assert.equal(saved.settings.character,finalCharacter.id);
    checks.push('快速连续切换最终角色正确，角色选择写入配置供下次启动恢复');
    await pjs("document.getElementById('resume-auto').click()");
    await wait(()=>Promise.resolve(snapshot().settings.autoPlay&&snapshot().actions.find(a=>a.id===snapshot().settings.action).role==='idle'));
    fs.writeFileSync(path.join(out,'设置布局-深色.png'),(await panel.webContents.capturePage()).toPNG());
    await pjs("document.getElementById('inspection').open=true;document.getElementById('board').click()");
    await wait(()=>Promise.resolve(getBoard()?.isVisible()));
    getBoard().close();assert.equal(getBoard().isVisible(),false);
    checks.push('回到待机按钮与手动打开/关闭背景检查板通过');
    await pjs("document.getElementById('inspection').open=false");
    await pjs("document.getElementById('theme').click()");
    fs.writeFileSync(path.join(out,'设置布局-浅色.png'),(await panel.webContents.capturePage()).toPNG());
    panel.setSize(320,820);await pause(100);
    assert.equal(await pjs('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true);
    fs.writeFileSync(path.join(out,'角色选择面板.png'),(await panel.webContents.capturePage()).toPNG());
    update({character:'hanli',frame:0,playing:true,autoPlay:true,actionProbability:30,edgeBlend:true});
    assert.deepEqual(errors,[]);checks.push('浅色窄面板与无渲染错误通过');
    fs.writeFileSync(path.join(out,'角色接入验证.json'),JSON.stringify({passed:true,checks},null,2));
    console.log(JSON.stringify({passed:true,checks}));
  }catch(error){fs.writeFileSync(path.join(out,'角色接入验证.json'),JSON.stringify({passed:false,checks,error:error.stack,errors,state:snapshot(),rendered:await rendered()},null,2));console.error(error);process.exitCode=1;}
  app.quit();
};
