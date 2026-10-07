'use strict';
const api=window.publisherAPI,$=id=>document.getElementById(id);
let busy=false,plan;
function preview(show){$('preview').hidden=!show;$('rows').hidden=show;document.querySelector('footer').hidden=show;}
const selected=()=>Array.from(document.querySelectorAll('#rows input:checked'),input=>input.value);
function controls(){for(const id of ['scan','publish','cancel'])$(id).disabled=busy;$('prepare').disabled=busy||!selected().length;for(const input of document.querySelectorAll('#rows input'))input.disabled=busy||input.dataset.locked==='true';}
async function run(fn){if(busy)return;busy=true;controls();$('result').textContent='';try{await fn();}catch(error){$('status').textContent=error.message;}finally{busy=false;controls();}}
api.progress(message=>{$('status').textContent=message;});
$('scan').onclick=()=>run(async()=>{
  preview(false);plan=null;const report=await api.scan();$('rows').replaceChildren();
  for(const p of report.characters){
    const label=document.createElement('label');label.className='character'+(p.error?' error':'');
    const input=document.createElement('input');input.type='checkbox';input.value=p.id;input.checked=p.changed;input.dataset.locked=String(!p.changed||!!p.error);
    const text=document.createElement('span');text.textContent=p.name;
    const hint=document.createElement('small');hint.textContent=p.error|| (p.changed?(p.isNew?'新增人物 · ':'有修改 · ')+(p.bytes/1048576).toFixed(1)+' MiB':'与已发布版本一致');
    text.append(hint);label.append(input,text);$('rows').append(label);input.onchange=()=>{preview(false);plan=null;controls();};
  }
  const count=report.characters.filter(p=>p.changed).length;$('empty').hidden=count!==0;
  $('status').textContent='扫描完成：'+count+' 个人物有修改。'+(report.dryRun?' 当前为自动验收，仅允许预览。':'');
});
$('prepare').onclick=()=>run(async()=>{
  plan=await api.prepare(selected());$('summary').replaceChildren();
  for(const p of plan.characters){const line=document.createElement('p');line.textContent=p.name+' · '+(p.bytes/1048576).toFixed(1)+' MiB · '+p.actions.length+' 套动作';$('summary').append(line);}
  preview(true);$('status').textContent='打包与完整性校验通过，请核对后确认发布。';
});
$('cancel').onclick=()=>{preview(false);plan=null;};
$('publish').onclick=()=>run(async()=>{
  if(!plan)return;const result=await api.publish(plan.id);
  $('result').textContent='发布完成\n'+result.url+(result.warning?'\n'+result.warning:'');
  preview(false);plan=null;for(const input of document.querySelectorAll('#rows input')){input.checked=false;input.dataset.locked='true';}
});
api.context().then(c=>{$('directory').textContent=c.charactersDirectory;}).catch(e=>{$('status').textContent=e.message;});
