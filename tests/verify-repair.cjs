'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('node:module').createRequire(path.join(__dirname,'../app/main.cjs'))('sharp');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
module.exports=async({app,panel,player,showEditor,getEditor,update,snapshot,root,data,charactersDirectory,sourceCharactersDirectory,checks})=>{
 assert.notEqual(charactersDirectory,sourceCharactersDirectory,'写帧验收必须在人物副本中执行');
 assert.ok(charactersDirectory.startsWith(data+path.sep));
 const sourceIndex=JSON.parse(fs.readFileSync(path.join(sourceCharactersDirectory,'index.json'))),sourceRoot=path.join(sourceCharactersDirectory,sourceIndex.installed.meining.directory);
 const originalManifest=fs.readFileSync(path.join(sourceRoot,'manifest.json'));
 const original=JSON.parse(originalManifest),idle=original.actions.find(a=>a.role==='idle');
 const originals=idle.frames.slice(0,2).map(f=>({file:f.file,sha:hash(fs.readFileSync(path.join(sourceRoot,f.file)))}));
 const index=JSON.parse(fs.readFileSync(path.join(charactersDirectory,'index.json'))),pack=path.join(charactersDirectory,index.installed.meining.directory),manifestFile=path.join(pack,'manifest.json');
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async predicate=>{for(let i=0;i<240;i++){if(await predicate())return;await pause(25);}throw Error('修补工具验收超时');};
 update({character:'meining'});update({action:idle.id,frame:0,playing:false,autoPlay:false,edgeBlend:false});
 await showEditor();let editor=getEditor();const js=code=>editor.webContents.executeJavaScript(code);
 const ready=()=>wait(()=>js('!!window.frameEditor&&!frameEditor.loading'));
 await ready();assert.equal(await js('catalog.directWrite'),true);
 const selectFrame=async i=>{await js(`document.getElementById('frame-number').value=${i+1};document.getElementById('frame-number').dispatchEvent(new Event('change'))`);await wait(()=>js(`!frameEditor.loading&&frameEditor.currentFrame===${i}`));};
 const erase=()=>js(`(()=>{const c=document.getElementById('after'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let point;for(let y=2;y<c.height-2&&!point;y++)for(let x=2;x<c.width-2;x++){const i=(y*c.width+x)*4;if(d[i+3]===255&&Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2])>40){point={x,y,rgb:[d[i],d[i+1],d[i+2]]};break;}}if(!point)throw Error('缺少不透明彩色像素');document.getElementById('smart').click();document.getElementById('white-radius').value=2;document.getElementById('white-tolerance').value=0;const r=document.getElementById('stage').getBoundingClientRect();document.getElementById('stage').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:1,clientX:r.x+point.x+.5,clientY:r.y+point.y+.5,bubbles:true}));return {...point,picked:document.getElementById('picked-color').textContent,alpha:c.getContext('2d').getImageData(point.x,point.y,1,1).data[3]};})()`);
 const first=await erase();assert.equal(first.alpha,0);assert.equal(first.picked,'#'+first.rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase());
 await js("document.getElementById('undo').click()");assert.equal(await js('frameEditor.dirtyFrames'),0);
 await js("document.getElementById('redo').click()");assert.equal(await js('frameEditor.dirtyFrames'),1);
 await selectFrame(1);const second=await erase();await js("document.getElementById('batch-feather').click()");await ready();assert.equal(await js('frameEditor.dirtyFrames'),2);
 // Saving immediately locks navigation and duplicate saves until fresh bytes reload.
 const locked=await js("(()=>{document.getElementById('save').click();const locked=frameEditor.saving&&document.getElementById('frame').disabled&&document.getElementById('save').disabled;load(action.id,0);save();return locked;})()");assert.equal(locked,true);
 await wait(()=>js('!frameEditor.loading&&!frameEditor.saving&&frameEditor.dirtyFrames===0'));assert.equal(await js('frameEditor.currentFrame'),1);
 assert.equal(await js('frameEditor.erasedPixels'),0);assert.equal(await js('entry.undo.length'),0);
 let saved=JSON.parse(fs.readFileSync(manifestFile)),frames=saved.actions.find(a=>a.id===idle.id).frames;
 for(const [i,point] of [first,second].entries()){
  const bytes=fs.readFileSync(path.join(pack,frames[i].file));assert.equal(hash(bytes),frames[i].sha256);assert.notEqual(frames[i].sha256,originals[i].sha);
  assert.equal((await sharp(bytes).ensureAlpha().raw().toBuffer())[(point.y*idle.width+point.x)*4+3],0);
 }
 checks.push('彩色位置点击自动取色、按连通范围清除；撤销重做、跨帧保留与批量柔化通过');
 // A second edit is relative to the newly written frame, never an old mask.
 const third=await erase();assert.equal(third.alpha,0);await js("document.getElementById('save').click()");await wait(()=>js('!frameEditor.loading&&frameEditor.dirtyFrames===0'));
 saved=JSON.parse(fs.readFileSync(manifestFile));frames=saved.actions.find(a=>a.id===idle.id).frames;
 const latest=await sharp(fs.readFileSync(path.join(pack,frames[1].file))).ensureAlpha().raw().toBuffer();
 for(const point of [second,third])assert.equal(latest[(point.y*idle.width+point.x)*4+3],0);
 update({action:idle.id,frame:1,playing:false,autoPlay:false});
 await wait(()=>player.webContents.executeJavaScript(`document.getElementById('canvas').dataset.frame==='2'&&document.getElementById('canvas').getContext('2d').getImageData(${third.x},${third.y},1,1).data[3]===0`));
 assert.ok(snapshot().animation.frames[1].url.includes(frames[1].sha256));assert.equal(snapshot().animation.frames[1].repairMaskUrl,undefined);
 assert.equal(fs.existsSync(path.join(data,'frame-edits')),false);
 checks.push('两帧直接写入无损WebP和清单；保存中禁止切帧与重复保存；连续保存以新帧为基准，播放缓存刷新且无补丁叠加');
 await erase();editor.close();await wait(()=>js("document.getElementById('close-confirm').open"));
 await js("document.getElementById('continue-edit').click()");assert.equal(await js('frameEditor.dirtyFrames'),1);
 app.quit();await wait(()=>js("document.getElementById('close-confirm').open"));
 await js("document.getElementById('continue-edit').click()");assert.equal(editor.isDestroyed(),false);assert.equal(panel.isDestroyed(),false);
 editor.close();await wait(()=>js("document.getElementById('close-confirm').open"));await js("document.getElementById('discard-edit').click()");await wait(()=>Promise.resolve(getEditor()===null));
 await showEditor();editor=getEditor();await ready();assert.equal(await js('frameEditor.dirtyFrames'),0);assert.equal(await js('frameEditor.erasedPixels'),0);
 fs.writeFileSync(path.join(root,'tests/results/当前客户端-直接修补.png'),(await editor.webContents.capturePage()).toPNG());
 editor.close();await wait(()=>Promise.resolve(getEditor()===null));
 assert.deepEqual(fs.readFileSync(path.join(sourceRoot,'manifest.json')),originalManifest);
 for(const frame of originals)assert.equal(hash(fs.readFileSync(path.join(sourceRoot,frame.file))),frame.sha);
 checks.push('关闭与退出均用内置未保存确认，可继续编辑或放弃；重开读新帧；真实人物资源未被验收改动');
};
