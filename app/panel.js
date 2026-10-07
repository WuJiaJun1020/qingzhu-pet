'use strict';
const api=window.petAPI, $=id=>document.getElementById(id);
let removeTarget='',removing=false;
let lastTransferError='',lastWarning='',noticeTimer;
let previewVisible, state, selected='', filter='all', current=0, scrubbing=false, actionSignature='', gallerySignature='';
const scene=document.querySelector('.scene');
let savedPanel={};
try {savedPanel=JSON.parse(sessionStorage.getItem('panel-view')||'{}');}catch{}
selected=savedPanel.selected||'';
filter=['all','installed','available'].includes(savedPanel.filter)?savedPanel.filter:'all';
$('search').value=savedPanel.search||'';
for(const button of document.querySelectorAll('[data-filter]'))button.setAttribute('aria-pressed',String(button.dataset.filter===filter));
window.addEventListener('pagehide',()=>sessionStorage.setItem('panel-view',JSON.stringify({selected,activeCharacter:state?.character.id,filter,search:$('search').value,scroll:$('portraits').scrollTop,drawerScroll:document.querySelector('.drawer-content').scrollTop,settingsOpen:!$('settings-drawer').hidden,panelsHidden:scene.classList.contains('panels-hidden'),inspection:$('inspection').open})));
function report(error){
  const message=(error.message||String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
  clearTimeout(noticeTimer);
  if(scene.classList.contains('panels-hidden'))$('toggle-panels').click();
  $('error-message').textContent=message;$('error').hidden=false;
  if(message==='下载已取消')noticeTimer=setTimeout(()=>{$('error').hidden=true;},2500);
}
const run=promise=>promise.catch(report);
const change=patch=>run(api.configure(patch));
const portraitUrl=id=>new URL('../assets/shop/portraits/'+encodeURIComponent(id)+'.webp',location.href).href;
function entries(){
  const packs=state.packs.entries.map(p=>({...p}));
  for(const c of state.characters) if(!packs.some(p=>p.id===c.id))packs.push({...c,installed:true});
  return packs;
}
function renderGallery(){
  if(!state)return;
  const search=$('search').value.trim().toLocaleLowerCase();
  const list=entries().filter(p=>(filter==='all'||(filter==='installed')===p.installed)&&p.name.toLocaleLowerCase().includes(search));
  const signature=JSON.stringify(list.map(p=>[p.id,p.name,p.installed]));
  if(signature!==gallerySignature){
    gallerySignature=signature;
    const scroll=$('portraits').scrollTop;
    const fragment=document.createDocumentFragment();
    for(const p of list){
      const button=document.createElement('button');button.className='character-card'+(p.installed?' installed':'');button.dataset.id=p.id;
      button.setAttribute('aria-label',p.name+(p.installed?'，已安装':'，未安装'));
      const image=document.createElement('img');image.src=portraitUrl(p.id);image.alt='';image.loading='lazy';image.draggable=false;
      image.onerror=()=>{image.hidden=true;};
      const name=document.createElement('span');name.className='name';name.textContent=p.name;
      button.append(image,name);
      if(p.installed){const mark=document.createElement('span');mark.className='installed-mark';mark.textContent='✓';mark.setAttribute('aria-hidden','true');button.append(mark);}
      button.onclick=()=>selectCharacter(p.id);fragment.append(button);
    }
    $('portraits').replaceChildren(fragment);$('portraits').scrollTop=scroll;
  }
  for(const button of $('portraits').children)button.setAttribute('aria-pressed',String(button.dataset.id===selected));
  $('empty').hidden=list.length!==0;
}
function selectCharacter(id){
  selected=id;$('error').hidden=true;renderGallery();renderSelection();
  if(entries().find(p=>p.id===id)?.installed&&state.character.id!==id)change({character:id});
}
function renderSelection(){
  const p=entries().find(p=>p.id===selected);if(!p)return;
  // Only installed animation resources may appear on the stage.
  if(previewVisible!==p.installed){previewVisible=p.installed;run(api.previewVisible(previewVisible));}
  const busy=['downloading','verifying','installing'].includes(state.packs.transfer.status);
  $('update-character').hidden=!p.updateAvailable;
  $('update-character').textContent=(state.development?'拉取 GitHub「':'更新「')+p.name+'」';
  $('update-character').disabled=busy||removing||p.compatible===false;
  if(p.compatible===false)$('update-character').textContent='请先更新软件';
  $('invite').textContent=p.installed?'邀至桌面':'安装人物';$('invite').disabled=busy||removing||(!p.installed&&p.compatible===false);
  if(!p.installed&&p.compatible===false)$('invite').textContent='请先更新软件';
  $('pack-remove').hidden=!p.removable;$('pack-remove').disabled=busy||removing;
  if(removeTarget&&removeTarget!==selected&&!removing){removeTarget='';$('remove-confirm').hidden=true;}
}
function progress(frame){
  current=frame;if(!state)return;
  if(!scrubbing)$('seek').value=frame;
  $('frame').textContent=`${frame+1} / ${state.animation.frames.length}`;
  $('time').textContent=(state.animation.frames.slice(0,frame).reduce((sum,f)=>sum+f.durationMs,0)/1000).toFixed(2)+' s';
}
function renderUpdates(info){
  if(!info)return;
  $('auto-character-updates').checked=info.preferences.autoCharacters;$('auto-character-updates').disabled=!info.installed;
  $('auto-software-updates').checked=info.preferences.autoSoftware;$('auto-software-updates').disabled=!info.installed;
  $('update-status').textContent=info.characters.message||(!info.installed?'开发版保留本地帧，更新需手动选择。':'新增人物按需安装，已有动作随人物包更新。');
  $('check-character-updates').disabled=['checking','updating'].includes(info.characters.status);
  const software=info.software,busy=['checking','downloading'].includes(software.status);
  $('software-version').textContent=info.installed?'当前版本 v'+software.version:'本地开发版';
  $('software-status').textContent=software.message||(!info.installed?'安装版支持下载并安装软件更新。':'');
  $('check-software-updates').disabled=busy||!info.installed;
  $('download-software').hidden=!info.installed||!software.availableVersion||software.status==='ready'||software.status==='downloading';
  $('download-software').disabled=busy;$('download-software').textContent=(software.status==='error'?'重试下载 v':'下载 v')+software.availableVersion;
  $('install-software').hidden=software.status!=='ready';$('cancel-software').hidden=software.status!=='downloading';
  $('software-progress').hidden=software.status!=='downloading';$('software-progress').value=software.total?software.received/software.total*100:0;
  $('manual-software').hidden=software.status!=='error'||!software.manualDownload;
}
function accept(s){
  renderUpdates(s.updates);
  if(typeof s.development==='boolean'){$('development-badge').hidden=!s.development;$('publish-characters').hidden=!s.development;}
  const first=!state,previous=state?.character.id||savedPanel.activeCharacter;state=s;
  if(!selected||previous!==s.character.id||!entries().some(p=>p.id===selected))selected=s.character.id;
  renderGallery();renderSelection();
  const signature=JSON.stringify(s.actions.map(a=>[a.id,a.title]));
  if(signature!==actionSignature){actionSignature=signature;$('action').replaceChildren(...s.actions.map(a=>new Option(a.title,a.id)));}
  $('action').value=s.settings.action;$('play').textContent=s.settings.playing?'暂停':'播放';
  $('auto-play').checked=s.settings.autoPlay;$('loop').checked=s.settings.loop;$('loop').disabled=s.settings.autoPlay;
  $('probability').value=s.settings.actionProbability;$('probability-value').textContent=s.settings.actionProbability+'%';
  const specials=s.actions.filter(a=>a.role==='action');$('probability').disabled=!specials.length;
  $('action-counts').textContent=specials.map(a=>`${a.title} ${s.actionCounts[a.id]||0} 次`).join(' · ');
  $('edge-blend').checked=s.settings.edgeBlend;$('edge-blend').disabled=!s.animation.frames.every(f=>f.edgeMaskFile);$('edge-blend-option').hidden=$('edge-blend').disabled;
  $('scale').value=Math.round(s.settings.scale*100);$('scale-value').textContent=$('scale').value+'%';
  $('seek').max=s.animation.frames.length-1;
  const a=s.actions.find(a=>a.id===s.settings.action);$('info').textContent=`${a.width} × ${a.height} · ${a.count} 帧 · ${(a.duration/1000).toFixed(2)} s`;
  const t=s.packs.transfer,busy=['downloading','verifying','installing'].includes(t.status);
  $('pack-import').disabled=busy;$('transfer').hidden=!busy;$('pack-cancel').hidden=t.status!=='downloading';
  $('transfer-message').textContent=t.message||'正在安装';$('transfer-progress').value=t.total?Math.min(100,t.received/t.total*100):0;
  $('manual-character').hidden=t.status!=='error'||!t.manualDownload;
  $('download-recovery').hidden=$('manual-character').hidden;
  $('manual-character').title='下载「'+(entries().find(p=>p.id===t.id)?.name||'人物包')+'」后导入';
  const errorKey=t.status==='error'?t.id+':'+t.message:'';
  if(errorKey&&errorKey!==lastTransferError)report(new Error(t.message));
  lastTransferError=errorKey;
  const warning=s.packs.warnings.join('；');if(warning&&warning!==lastWarning)report(new Error(warning));lastWarning=warning;
  progress(s.settings.frame);window.PetSelect.sync();
  if(first){$('portraits').scrollTop=savedPanel.scroll||0;document.querySelector('.drawer-content').scrollTop=savedPanel.drawerScroll||0;}
}
$('search').oninput=()=>{$('portraits').scrollTop=0;renderGallery();};
for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{filter=button.dataset.filter;for(const item of document.querySelectorAll('[data-filter]'))item.setAttribute('aria-pressed',String(item===button));$('portraits').scrollTop=0;renderGallery();};
$('invite').onclick=()=>{
  const p=entries().find(p=>p.id===selected);if(!p)return;
  $('error').hidden=true;
  if(p.installed)run(api.configure({character:p.id,visible:true}).then(()=>api.hidePanel()));
  else run(api.installCharacter(p.id).then(accept));
};
$('pack-import').onclick=()=>{$('error').hidden=true;run(api.importCharacter().then(accept));};
$('pack-remove').onclick=()=>{const p=entries().find(p=>p.id===selected);if(!p?.removable||removing)return;removeTarget=p.id;$('remove-question').textContent='删除「'+p.name+'」的人物包？';$('remove-confirm').hidden=false;$('remove-cancel').focus();};
$('remove-cancel').onclick=()=>{removeTarget='';$('remove-confirm').hidden=true;$('pack-remove').focus();};
$('remove-confirm').onkeydown=e=>{if(e.key==='Escape'&&!removing){e.preventDefault();$('remove-cancel').click();}};
$('remove-accept').onclick=()=>{if(!removeTarget||removing)return;removing=true;$('remove-accept').disabled=true;$('remove-cancel').disabled=true;$('error').hidden=true;run(api.removeCharacter(removeTarget).then(accept).finally(()=>{removing=false;removeTarget='';$('remove-confirm').hidden=true;$('remove-accept').disabled=false;$('remove-cancel').disabled=false;renderSelection();}));};
$('pack-cancel').onclick=()=>run(api.cancelDownload());
$('manual-character').onclick=()=>run(api.manualDownload(state.packs.transfer.id));
$('retry-character').onclick=()=>{$('error').hidden=true;run(api.installCharacter(state.packs.transfer.id).then(accept));};
$('manual-software').onclick=()=>run(api.manualDownload(null));
$('dismiss-error').onclick=()=>{clearTimeout(noticeTimer);$('error').hidden=true;};
function settings(open){$('settings-drawer').hidden=!open;scene.classList.toggle('settings-closed',!open);$('settings').setAttribute('aria-expanded',String(open));}
$('settings').onclick=()=>settings($('settings-drawer').hidden);$('close-settings').onclick=()=>settings(false);
$('toggle-panels').onclick=()=>{window.PetSelect.close(false);const hidden=scene.classList.toggle('panels-hidden');$('toggle-panels').setAttribute('aria-pressed',String(hidden));$('toggle-panels').setAttribute('aria-label',hidden?'显示面板':'隐藏面板');};
$('hide-panel').onclick=()=>run(api.hidePanel());$('quit').onclick=()=>run(api.quit());
$('action').onchange=e=>change({action:e.target.value,frame:0,playing:true,autoPlay:false});
$('auto-play').onchange=e=>change(e.target.checked?{autoPlay:true,action:state.idleId,frame:0,playing:true}:{autoPlay:false});
$('probability').oninput=e=>change({actionProbability:Number(e.target.value)});
$('scale').oninput=e=>change({scale:Number(e.target.value)/100});
$('play').onclick=()=>change({playing:!state.settings.playing});$('restart').onclick=()=>change({frame:0,playing:true});
$('resume-auto').onclick=()=>change({autoPlay:true,action:state.idleId,frame:0,playing:true});
$('loop').onchange=e=>change({loop:e.target.checked});$('edge-blend').onchange=e=>change({edgeBlend:e.target.checked});
$('seek').onpointerdown=()=>{scrubbing=true;};$('seek').oninput=e=>change({frame:Number(e.target.value),playing:false});
$('seek').onchange=$('seek').onpointercancel=()=>{scrubbing=false;};
$('prev').onclick=()=>change({frame:current-1,playing:false});$('next').onclick=()=>change({frame:current+1,playing:false});
$('reset-window').onclick=()=>run(api.resetPanelSize());
$('edit-frame').onclick=()=>run(api.frameEditor.open());
$('publish-characters').onclick=()=>run(api.openPublisher());
$('check-character-updates').onclick=()=>run(api.checkCharacterUpdates().then(accept));
$('auto-character-updates').onchange=()=>run(api.updatePreferences({autoCharacters:$('auto-character-updates').checked}).then(accept));
$('auto-software-updates').onchange=()=>run(api.updatePreferences({autoSoftware:$('auto-software-updates').checked}).then(accept));
$('check-software-updates').onclick=()=>run(api.checkSoftware().then(accept));
$('download-software').onclick=()=>run(api.downloadSoftware().then(accept));
$('install-software').onclick=()=>run(api.installSoftware());
$('cancel-software').onclick=()=>run(api.cancelSoftware());
$('update-character').onclick=()=>run(api.updateCharacter(selected).then(accept));
if(savedPanel.settingsOpen===false)settings(false);
if(savedPanel.panelsHidden)$('toggle-panels').click();
$('inspection').open=Boolean(savedPanel.inspection);
api.onState(accept);api.onProgress(progress);run(api.snapshot().then(accept));
