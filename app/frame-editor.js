'use strict';
const api=window.petAPI.frameEditor,$=id=>document.getElementById(id),stage=$('stage'),viewport=$('viewport'),after=$('after'),before=$('before'),ctx=after.getContext('2d',{willReadFrequently:true});
let catalog,action,index=0,original,entry,loading=true,loadTicket=0,tool='smart',zoom=1,split=.5,stroke=null,pan=null,space=false;
const brush=window.FrameBrush;
const entries=new Map(),dirty=new Set();
const key=(id,i)=>id+':'+i;
const run=promise=>promise.catch(e=>{loading=!action;if(action)controls();$('error').textContent=e.message||String(e);});
function controls(){
 for(const id of ['character','action','frame','frame-number','reset','feather','batch-feather'])$(id).disabled=loading;
 $('undo').disabled=!entry?.undo.length||loading||!original;$('redo').disabled=!entry?.redo.length||loading||!original;
 $('save').disabled=!dirty.size||loading;$('prev').disabled=loading||index===0;$('next').disabled=loading||index===action.count-1;
 $('frame').value=index;$('frame-number').value=index+1;$('frame-total').textContent='/ '+action.count;
 $('pending').textContent=`${dirty.size} 帧未保存 · 本帧修改 ${entry?.count||0} 像素`;
}
function markEntry(value){
 const k=key(value.actionId,value.index);if(value.mask.every((v,i)=>v===value.saved[i]))dirty.delete(k);else dirty.add(k);
}
function mark(){markEntry(entry);controls();}
function comparison(){
 const enabled=$('comparison').checked;$('before-clip').hidden=!enabled;$('divider').hidden=!enabled;$('before-label').hidden=!enabled;$('after-label').hidden=!enabled;
 $('before-clip').style.width=action.width*zoom*split+'px';$('divider').style.left=split*100+'%';$('divider').setAttribute('aria-valuenow',String(Math.round(split*100)));
}
function resize(){
 if(!action)return;stage.style.width=action.width*zoom+'px';stage.style.height=action.height*zoom+'px';before.style.width=action.width*zoom+'px';before.style.height=action.height*zoom+'px';comparison();
}
function draw(){
 if(!original||!entry)return;const image=new ImageData(new Uint8ClampedArray(original.data),action.width,action.height);
 for(let i=0;i<entry.mask.length;i++){const amount=entry.mask[i];if(amount)image.data[i*4+3]=brush.alpha(original.data[i*4+3],amount);}ctx.putImageData(image,0,0);
}
function finishStroke(){
 if(!stroke)return;
 const changes=[...stroke.changes];stroke=null;
 if(changes.length){entry.undo.push(changes);if(entry.undo.length>100)entry.undo.shift();entry.redo=[];mark();}
}
async function load(id,i){
 finishStroke();if(entry&&!entry.count&&!dirty.has(key(action.id,index))&&!entry.undo.length)entries.delete(key(action.id,index));
 action=catalog.actions.find(a=>a.id===id);index=Math.max(0,Math.min(action.count-1,i));const ticket=++loadTicket;loading=true;original=null;controls();$('error').textContent='';
 const record=await api.load(action.id,index);const image=new Image();image.src=record.url;await image.decode();if(ticket!==loadTicket)return;
 before.width=after.width=action.width;before.height=after.height=action.height;before.getContext('2d').drawImage(image,0,0);
 original=before.getContext('2d').getImageData(0,0,action.width,action.height);
 const k=key(action.id,index);entry=entries.get(k);
 if(!entry){const mask=new Uint8Array(record.erased);entry={actionId:action.id,index,baseSha:record.baseSha,mask,saved:mask.slice(),undo:[],redo:[],count:brush.count(mask)};entries.set(k,entry);}
 if(!entry.originalAlpha)entry.originalAlpha=Uint8Array.from({length:action.width*action.height},(_,p)=>original.data[p*4+3]);
 if(entry.baseSha!==record.baseSha)throw Error('原帧已更新，请关闭并重新打开修补工具');
 $('frame').max=action.count-1;$('frame-number').max=action.count;$('pixel').textContent=`${action.width} × ${action.height} · 单像素修补`;
 loading=false;resize();draw();controls();
}
function position(e){const r=stage.getBoundingClientRect();return {x:Math.floor((e.clientX-r.left)/zoom),y:Math.floor((e.clientY-r.top)/zoom)};}
function paint(x,y){
 const size=Number($('brush').value),strength=Math.max(1,Math.min(100,Number($('strength').value)||100))/100;
 brush.footprint(action.width,action.height,x,y,size,$('soft').checked,(p,weight)=>{
  if(!original.data[p*4+3])return;
  const coverage=Math.round(weight*strength),prior=stroke.coverage.get(p)||0;if(coverage<=prior)return;
  stroke.coverage.set(p,coverage);
  const base=stroke.changes.has(p)?stroke.changes.get(p):entry.mask[p];
  const value=tool==='erase'?Math.round(base+(255-base)*coverage/255):Math.round(base*(255-coverage)/255);
  if(value===entry.mask[p])return;
  if(!stroke.changes.has(p))stroke.changes.set(p,base);
  entry.count+=Number(value>0)-Number(entry.mask[p]>0);entry.mask[p]=value;
 });
}
function hover(e){
 if(loading||!original)return;const p=position(e),inside=p.x>=0&&p.y>=0&&p.x<action.width&&p.y<action.height;
 $('cursor').hidden=!inside;if(!inside)return;
 const size=Math.max(1,Math.min(64,Number($('brush').value)||1));$('cursor').style.borderRadius=$('soft').checked?'50%':'0';$('cursor').style.width=$('cursor').style.height=size*zoom+'px';$('cursor').style.left=Math.floor(p.x-(size-1)/2)*zoom+'px';$('cursor').style.top=Math.floor(p.y-(size-1)/2)*zoom+'px';
 const offset=(p.y*action.width+p.x)*4,rgba=[...original.data.slice(offset,offset+4)];rgba[3]=brush.alpha(rgba[3],entry.mask[p.y*action.width+p.x]);
 $('pixel').textContent=`像素 (${p.x}, ${p.y}) · RGBA ${rgba.join(', ')} · ${Math.round(zoom*100)}%`;
}
stage.onpointerdown=e=>{
 if(loading||!original||e.target.closest('#divider'))return;
 if(e.button===1||space){pan={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};stage.setPointerCapture(e.pointerId);e.preventDefault();return;}
 if(e.button!==0)return;const p=position(e);if(tool==='smart'){
 const region=brush.whiteRegion(original.data,entry.mask,action.width,action.height,p.x,p.y,{radius:Number($('white-radius').value),tolerance:Number($('white-tolerance').value),edge:0});
 const changes=[];region.forEach((v,p)=>{const next=Math.max(entry.mask[p],v);if(next!==entry.mask[p]){changes.push([p,entry.mask[p]]);entry.mask[p]=next;}});
 if(changes.length){entry.undo.push(changes);if(entry.undo.length>100)entry.undo.shift();entry.redo=[];entry.count=brush.count(entry.mask);mark();draw();}
 $('saved').textContent=changes.length?`已去白 ${changes.length} 像素，可继续修补其他帧`:'此处没有识别到相近白色，请调整位置或容差';e.preventDefault();return;
}stroke={changes:new Map(),coverage:new Map(),last:p};stage.setPointerCapture(e.pointerId);paint(p.x,p.y);draw();e.preventDefault();
};
stage.onpointermove=e=>{
 if(pan){viewport.scrollLeft=pan.left+pan.x-e.clientX;viewport.scrollTop=pan.top+pan.y-e.clientY;return;}
 hover(e);if(!stroke)return;const p=position(e),last=stroke.last,steps=Math.max(Math.abs(p.x-last.x),Math.abs(p.y-last.y),1);
 for(let n=1;n<=steps;n++)paint(Math.round(last.x+(p.x-last.x)*n/steps),Math.round(last.y+(p.y-last.y)*n/steps));stroke.last=p;draw();
};
const stop=e=>{pan=null;finishStroke();if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);};
stage.onpointerup=stop;stage.onpointercancel=stop;stage.onpointerleave=()=>{$('cursor').hidden=true;};stage.onlostpointercapture=()=>{pan=null;finishStroke();};
$('divider').onpointerdown=e=>{finishStroke();$('divider').setPointerCapture(e.pointerId);e.stopPropagation();e.preventDefault();};
$('divider').onpointermove=e=>{if(!$('divider').hasPointerCapture(e.pointerId))return;const r=stage.getBoundingClientRect();split=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));comparison();e.stopPropagation();};
$('divider').onpointerup=e=>{if($('divider').hasPointerCapture(e.pointerId))$('divider').releasePointerCapture(e.pointerId);e.stopPropagation();};
$('divider').onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){split=Math.max(0,Math.min(1,split+(e.key==='ArrowLeft'?-.05:.05)));comparison();e.stopPropagation();e.preventDefault();}};
function undo(redo=false){
 finishStroke();if(loading||!original)return;const from=redo?entry.redo:entry.undo,to=redo?entry.undo:entry.redo,changes=from.pop();if(!changes)return;
 const inverse=[];for(const [p,value] of changes){inverse.push([p,entry.mask[p]]);entry.count+=Number(value>0)-Number(entry.mask[p]>0);entry.mask[p]=value;}to.push(inverse);mark();draw();
}
function selectTool(next){finishStroke();tool=next;for(const [id,name] of [['erase','erase'],['restore','restore'],['smart','smart']])$(id).classList.toggle('active',next===name);}
$('smart').onclick=()=>selectTool('smart');
function featherEntry(value){
 const meta=catalog.actions.find(a=>a.id===value.actionId),next=brush.feather(value.mask,meta.width,meta.height,Number($('feather-radius').value)),changes=[];
 next.forEach((v,p)=>{if(v!==value.mask[p]&&value.originalAlpha[p]){changes.push([p,value.mask[p]]);value.mask[p]=v;}});
 if(!changes.length)return false;
 value.undo.push(changes);if(value.undo.length>100)value.undo.shift();value.redo=[];value.count=brush.count(value.mask);markEntry(value);return true;
}
$('feather').onclick=()=>{
 if(loading||!original)return;finishStroke();const changed=featherEntry(entry);controls();draw();
 $('saved').textContent=changed?'当前帧已柔化，保存后应用':'本帧没有可柔化的已擦除边缘';
};
$('batch-feather').onclick=()=>run((async()=>{
 if(loading||!original)return;finishStroke();loading=true;controls();let count=0;
 try{for(const value of entries.values())if(value.count&&featherEntry(value)){count++;if(count%8===0)await new Promise(resolve=>setTimeout(resolve,0));}
 $('saved').textContent=count?`已统一柔化 ${count} 帧，保存后应用`:'本批没有需要柔化的修补帧';}
 finally{loading=false;controls();draw();}
})());
$('undo').onclick=()=>undo();$('redo').onclick=()=>undo(true);
$('erase').onclick=()=>selectTool('erase');
$('restore').onclick=()=>selectTool('restore');
$('reset').onclick=()=>{if(loading)return;finishStroke();const changes=[];entry.mask.forEach((v,p)=>{if(v)changes.push([p,v]);});if(!changes.length)return;entry.undo.push(changes);entry.redo=[];entry.mask.fill(0);entry.count=0;mark();draw();};
async function save(){
 finishStroke();if(loading||!dirty.size)return;$('saved').textContent=`正在保存并应用 ${dirty.size} 帧…`;loading=true;controls();
 try{
  const pending=[...dirty].map(k=>({k,value:entries.get(k)}));
  await api.saveBatch(pending.map(({value})=>({actionId:value.actionId,index:value.index,baseSha:value.baseSha,erased:value.mask})));
  for(const {k,value} of pending){value.saved=value.mask.slice();dirty.delete(k);}
  $('saved').textContent=`已统一保存并应用 ${pending.length} 帧`;
 }finally{loading=false;controls();}
}
$('save').onclick=()=>run(save());
function choices(characterId){
 const choices=catalog.actions.filter(a=>a.characterId===characterId);$('action').replaceChildren(...choices.map(a=>new Option(a.title,a.id)));return choices;
}
$('character').onchange=()=>{const list=choices($('character').value);run(load(list[0].id,0));};$('action').onchange=()=>run(load($('action').value,0));
$('prev').onclick=()=>run(load(action.id,index-1));$('next').onclick=()=>run(load(action.id,index+1));$('frame').oninput=()=>run(load(action.id,Number($('frame').value)));
$('frame-number').onchange=()=>run(load(action.id,Number($('frame-number').value)-1));
$('zoom').onchange=()=>{
 const view=viewport.getBoundingClientRect(),previous=stage.getBoundingClientRect();
 const centerX=(view.left+viewport.clientWidth/2-previous.left)/zoom,centerY=(view.top+viewport.clientHeight/2-previous.top)/zoom;
 zoom=Number($('zoom').value);resize();const next=stage.getBoundingClientRect();
 viewport.scrollLeft+=next.left+centerX*zoom-view.left-viewport.clientWidth/2;
 viewport.scrollTop+=next.top+centerY*zoom-view.top-viewport.clientHeight/2;
};
$('center').onclick=()=>{viewport.scrollLeft=(viewport.scrollWidth-viewport.clientWidth)/2;viewport.scrollTop=(viewport.scrollHeight-viewport.clientHeight)/2;};
viewport.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();const values=[1,2,4,8,16,32],next=Math.max(0,Math.min(values.length-1,values.indexOf(zoom)+(e.deltaY<0?1:-1)));$('zoom').value=values[next];$('zoom').onchange();},{passive:false});
$('comparison').onchange=comparison;$('background').onchange=()=>{viewport.dataset.background=$('background').value;};
document.addEventListener('keydown',e=>{
 if(e.ctrlKey||e.metaKey){if(e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);}if(e.key.toLowerCase()==='s'){e.preventDefault();run(save());}return;}
 if(e.target.matches('input,select'))return;
 if(e.code==='Space'){space=true;e.preventDefault();}
 if(e.key==='ArrowLeft'){e.preventDefault();$('prev').click();}if(e.key==='ArrowRight'){e.preventDefault();$('next').click();}
});document.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});window.addEventListener('blur',()=>{space=false;pan=null;finishStroke();});
window.addEventListener('beforeunload',e=>{finishStroke();if(dirty.size){e.preventDefault();e.returnValue='';}});
window.frameEditor={get dirtyFrames(){return dirty.size;},get currentFrame(){return index;},get erasedPixels(){return entry?.count||0;}};
run((async()=>{catalog=await api.list();if(catalog.maskFormat!==2||!catalog.batchSave)throw Error('请先保存已有修补，再重启客户端以启用批量修补');$('character').replaceChildren(...catalog.characters.map(c=>new Option(c.name,c.id)));$('character').value=catalog.character;choices(catalog.character);$('action').value=catalog.action;await load(catalog.action,catalog.frame);})());
