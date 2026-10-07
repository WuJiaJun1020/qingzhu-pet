'use strict';
const api=window.petAPI, $=id=>document.getElementById(id);
let removeTarget='',removing=false;
let previewVisible, state, selected='', filter='all', current=0, scrubbing=false, actionSignature='', gallerySignature='';
const scene=document.querySelector('.scene');
let savedPanel={};
try {savedPanel=JSON.parse(sessionStorage.getItem('panel-view')||'{}');}catch{}
selected=savedPanel.selected||'';
filter=['all','installed','available'].includes(savedPanel.filter)?savedPanel.filter:'all';
$('search').value=savedPanel.search||'';
for(const button of document.querySelectorAll('[data-filter]'))button.setAttribute('aria-pressed',String(button.dataset.filter===filter));
window.addEventListener('pagehide',()=>sessionStorage.setItem('panel-view',JSON.stringify({selected,activeCharacter:state?.character.id,filter,search:$('search').value,scroll:$('portraits').scrollTop,drawerScroll:document.querySelector('.drawer-content').scrollTop,settingsOpen:!$('settings-drawer').hidden,panelsHidden:scene.classList.contains('panels-hidden'),inspection:$('inspection').open})));
function report(error){$('error-message').textContent=error.message||String(error);$('error').hidden=false;}
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
  $('invite').textContent=p.installed?'邀至桌面':'安装人物';$('invite').disabled=busy||removing;
  $('pack-remove').hidden=!p.removable;$('pack-remove').disabled=busy||removing;
  if(removeTarget&&removeTarget!==selected&&!removing){removeTarget='';$('remove-confirm').hidden=true;}
}
function progress(frame){
  current=frame;if(!state)return;
  if(!scrubbing)$('seek').value=frame;
  $('frame').textContent=`${frame+1} / ${state.animation.frames.length}`;
  $('time').textContent=(state.animation.frames.slice(0,frame).reduce((sum,f)=>sum+f.durationMs,0)/1000).toFixed(2)+' s';
}
function accept(s){
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
  if(t.status==='error')report(new Error(t.message));
  if(s.packs.warnings.length)report(new Error(s.packs.warnings.join('；')));
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
$('dismiss-error').onclick=()=>{$('error').hidden=true;};
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
if(savedPanel.settingsOpen===false)settings(false);
if(savedPanel.panelsHidden)$('toggle-panels').click();
$('inspection').open=Boolean(savedPanel.inspection);
api.onState(accept);api.onProgress(progress);run(api.snapshot().then(accept));
