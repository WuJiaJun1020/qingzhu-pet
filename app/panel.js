'use strict';
const api = window.petAPI, $ = id => document.getElementById(id);
let state, current = 0, scrubbing = false, actionOptions = '',characterOptions='',packSignature='';
const run = p => p.catch(e => { $('error').textContent = e.message; $('error').hidden = false; });
const change = patch => run(api.configure(patch));
function progress(frame) {
  current = frame;
  if (!state) return;
  if (!scrubbing) $('seek').value = frame;
  $('frame').textContent = `${frame + 1} / ${state.animation.frames.length}`;
  const time = state.animation.frames.slice(0,frame).reduce((s,f) => s+f.durationMs,0)/1000;
  $('time').textContent = `${time.toFixed(2)} s`;
}
function accept(s) {
  state = s;
  renderPacks(s.packs);
  const characterSignature=s.characters.map(c=>c.id).join('|');
  if(characterSignature!==characterOptions){$('character').replaceChildren();characterOptions=characterSignature;}
  if (!$('character').options.length) for (const c of s.characters) { const option = document.createElement('option'); option.value = c.id; option.textContent = c.name; $('character').appendChild(option); }
  $('character').value = s.character.id;
  $('character-info').textContent = `${s.actions.filter(a=>a.role==='idle').length} 套待机 · ${s.actions.filter(a=>a.role==='action').length} 套特殊动作 · 拖拽 / 下落`;
  const signature = s.actions.map(a=>a.id).join('|');
  if (signature !== actionOptions) { $('action').replaceChildren(); actionOptions = signature; }
  if (!$('action').options.length) for (const a of s.actions) { const option = document.createElement('option'); option.value = a.id; option.textContent = a.title; $('action').appendChild(option); }
  $('action').value = s.settings.action;
  $('play').textContent = s.settings.playing ? '暂停' : '播放';
  $('loop').checked = s.settings.loop;
  $('loop').disabled = s.settings.autoPlay;
  $('auto-play').checked = s.settings.autoPlay;
  $('probability').value = s.settings.actionProbability;
  const specials = s.actions.filter(a=>a.role==='action');
  const hasSpecials = specials.length > 0;
  $('probability').disabled = !hasSpecials;
  $('auto-hint').textContent = hasSpecials ? '每轮待机结束抽签，动作播完回到待机。' : '当前角色循环待机，拖动与松手触发交互。';
  $('action-counts').hidden = !hasSpecials;
  $('action-counts').textContent = '本次自动触发：' + specials.map(a=>`${a.title} ${s.actionCounts[a.id] || 0} 次`).join(' · ');
  $('probability-value').textContent = `${s.settings.actionProbability}%`;
  $('edge-blend').checked = s.settings.edgeBlend;
  $('edge-blend').disabled = !s.animation.frames.every(f=>f.edgeMaskFile);
  $('edge-blend-option').hidden = $('edge-blend').disabled;
  $('playback-mode').textContent = s.settings.autoPlay ? '自动播放' : '手动播放';
  $('edge-blend').title = $('edge-blend').disabled ? '这段动画已去除纯色背景，不施加环境渐隐' : '柔化环境边界并保护主体';
  $('scale').value = Math.round(s.settings.scale * 100);
  $('scale-value').textContent = `${Math.round(s.settings.scale * 100)}%`;
  $('visible').textContent = s.settings.visible ? '隐藏桌宠' : '显示桌宠';
  $('seek').max = s.animation.frames.length - 1;
  const a = s.actions.find(a => a.id === s.settings.action);
  $('size-info').textContent = `100% 对应素材原始 ${a.width} × ${a.height} 像素`;
  $('info').textContent = `${a.width} × ${a.height} · ${a.count} 帧 · ${(a.duration/1000).toFixed(2)} s · ${(a.count*1000/a.duration).toFixed(0)} fps`;
  progress(s.settings.frame);
}
api.onState(accept); api.onProgress(progress); run(api.snapshot().then(accept));
$('character').onchange = e => change({ character: e.target.value });
$('action').onchange = e => change({ action: e.target.value, frame: 0, playing: true, autoPlay: false });
$('auto-play').onchange = e => change(e.target.checked ? {autoPlay: true, action: state.idleId, frame: 0, playing: true} : {autoPlay: false});
$('probability').oninput = e => change({actionProbability: Number(e.target.value)});
$('play').onclick = () => change({ playing: !state.settings.playing });
$('resume-auto').onclick = () => change({autoPlay:true,action:state.idleId,frame:0,playing:true});
$('restart').onclick = () => change({ frame: 0, playing: true });
$('loop').onchange = e => change({ loop: e.target.checked });
$('edge-blend').onchange = e => change({ edgeBlend: e.target.checked });
$('seek').onpointerdown = () => scrubbing = true;
$('seek').oninput = e => change({ frame: Number(e.target.value), playing: false });
$('seek').onchange = () => scrubbing = false;
$('seek').onpointercancel = () => scrubbing = false;
$('prev').onclick = () => change({ frame: current - 1, playing: false });
$('next').onclick = () => change({ frame: current + 1, playing: false });
$('scale').oninput = e => change({ scale: Number(e.target.value)/100 });
for (const button of document.querySelectorAll('[data-size]')) button.onclick = () => change({ scale: Number(button.dataset.size) });
$('visible').onclick = () => change({ visible: !state.settings.visible });
$('edit-frame').onclick = () => run(api.frameEditor.open());
$('board').onclick = () => run(api.board());
$('quit').onclick = () => run(api.quit());
$('theme').onclick = () => { const light = document.body.dataset.theme !== 'light'; document.body.dataset.theme = light ? 'light' : 'dark'; $('theme').textContent = light ? '深色' : '浅色'; };
document.addEventListener('keydown', e => { if(e.target.matches('input,select')) return; if(e.code === 'Space'){ e.preventDefault(); $('play').click(); } else if(e.key === 'ArrowLeft') $('prev').click(); else if(e.key === 'ArrowRight') $('next').click(); });




function renderPacks(packs){
  const transfer=packs.transfer,busy=['downloading','verifying','installing'].includes(transfer.status);
  const signature=JSON.stringify(packs.entries.map(p=>[p.id,p.installed,p.updateAvailable]))+busy;
  if(signature!==packSignature){
    packSignature=signature;$('pack-list').replaceChildren();
    for(const p of packs.entries){
      const row=document.createElement('div');row.className='pack-row';
      const title=document.createElement('span');title.textContent=`${p.name} · ${(p.bytes/1024/1024).toFixed(1)} MiB`;
      const button=document.createElement('button');button.textContent=p.installed?(p.updateAvailable?'更新':'已安装'):'下载';button.disabled=busy||(p.installed&&!p.updateAvailable);
      button.onclick=()=>{$('error').hidden=true;run(api.installCharacter(p.id).then(accept));};
      row.append(title,button);$('pack-list').appendChild(row);
    }
  }
  const percent=transfer.total?Math.min(100,Math.floor(transfer.received/transfer.total*100)):0;
  $('pack-progress').textContent=transfer.status==='downloading'?`${transfer.message} · ${percent}%`:transfer.message||packs.warnings.join('；');
  $('pack-cancel').hidden=transfer.status!=='downloading';$('pack-import').disabled=busy;
}
$('manage-packs').onclick=()=>{const hidden=!$('pack-manager').hidden;$('pack-manager').hidden=hidden;$('manage-packs').setAttribute('aria-expanded',String(!hidden));};
$('pack-import').onclick=()=>{$('error').hidden=true;run(api.importCharacter().then(accept));};
$('pack-cancel').onclick=()=>run(api.cancelDownload());
