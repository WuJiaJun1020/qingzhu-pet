'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createSoftwareUpdater}=require('./software-updater.cjs');
function createUpdateService({data,installed,version,packs,fetch,downloadFetch,onChange=()=>{},onInstalled=()=>{},canUpdate=()=>true,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}){
 const configFile=path.join(data,'updates.json');let preferences={autoCharacters:installed,autoSoftware:installed};
 try{const saved=JSON.parse(fs.readFileSync(configFile));for(const key of Object.keys(preferences))if(typeof saved[key]==='boolean')preferences[key]=installed&&saved[key];}catch{}
 let characterBusy=false,pending=false,cancelled=false,stopped=false,timer,retry,cleanupTimer;
 let characters={status:'idle',message:'',updated:[],added:[]};
 const software=createSoftwareUpdater({data,version,installed,fetch,downloadFetch,onChange});
 const emit=patch=>{characters={...characters,...patch};onChange();};
 function configure(patch){for(const key of Object.keys(preferences))if(typeof patch?.[key]==='boolean')preferences[key]=installed&&patch[key];fs.mkdirSync(data,{recursive:true});fs.writeFileSync(configFile+'.tmp',JSON.stringify(preferences));fs.renameSync(configFile+'.tmp',configFile);if(!preferences.autoCharacters){pending=false;clearTimeoutFn(retry);}onChange();return snapshot();}
 async function applyUpdates(){
  const remaining=packs.list().entries.filter(p=>p.installed&&p.updateAvailable&&p.compatible!==false);
  pending=false;
  for(const p of remaining){
   if(cancelled||stopped)break;
   if(!canUpdate()||packs.busy){pending=true;emit({status:'deferred',message:'人物更新将在当前操作完成后继续。'});break;}
   try{emit({status:'updating',message:'正在更新 '+p.name+'…'});await packs.install(p.id);await onInstalled(p.id);characters.updated.push(p.name);}
   catch(error){if(cancelled||error.message.includes('取消'))break;characters.failures.push(p.name+'：'+error.message);}
  }
  if(pending){retry=setTimeoutFn(()=>{if(!stopped&&!characterBusy){characterBusy=true;applyUpdates().finally(()=>{characterBusy=false;});}},60000);retry?.unref?.();return;}
  const blocked=packs.list().entries.filter(p=>p.updateAvailable&&p.compatible===false).length;
  const detail=[characters.updated.length?'已更新 '+characters.updated.length+' 个人物':'',characters.added.length?'新增 '+characters.added.length+' 位人物，可在列表中安装':'',blocked?'部分人物需要先更新软件':'',...characters.failures].filter(Boolean).join('；');
  emit({status:characters.failures.length?'error':'idle',message:cancelled?'人物更新已取消。':detail||'人物资源已是最新。'});
 }
 async function checkCharacters(){
  if(characterBusy)throw Error('正在检查或更新人物');characterBusy=true;cancelled=false;clearTimeoutFn(retry);pending=false;
  emit({status:'checking',message:'正在检查人物更新…',updated:[],added:[],failures:[]});
  try{
   const known=new Set(packs.list().entries.map(p=>p.id));await packs.checkUpdates();
   characters.added=packs.list().entries.filter(p=>!known.has(p.id)).map(p=>p.name);
   if(installed)await applyUpdates();
   else{const entries=packs.list().entries,n=entries.filter(p=>p.updateAvailable).length,errors=entries.filter(p=>p.comparisonError);emit({status:errors.length?'error':'idle',message:errors.length?'部分人物校验失败：'+errors.map(p=>p.name+'（'+p.comparisonError+'）').join('；'):n?'有 '+n+' 个人物的本地内容与 GitHub 不同；本地修改已保留。':'已核对实际内容，已安装人物与 GitHub 一致。'});}
  }catch(error){emit({status:'error',message:error.message});throw error;}finally{characterBusy=false;}
 }
 async function scheduled(){if(stopped)return;await Promise.allSettled([preferences.autoCharacters?checkCharacters():null,preferences.autoSoftware?software.check():null]);if(!stopped){timer=setTimeoutFn(scheduled,6*60*60*1000);timer?.unref?.();}}
 async function cleanupDownloads(){
  if(stopped)return;
  const pendingCleanup=await software.cleanupInstalledDownloads();
  if(pendingCleanup&&!stopped){cleanupTimer=setTimeoutFn(cleanupDownloads,60000);cleanupTimer?.unref?.();}
 }
 function start(){if(!installed||stopped||timer)return;timer=setTimeoutFn(scheduled,15000);timer?.unref?.();cleanupTimer=setTimeoutFn(cleanupDownloads,0);cleanupTimer?.unref?.();}
 function stop(){stopped=true;pending=false;clearTimeoutFn(timer);clearTimeoutFn(retry);clearTimeoutFn(cleanupTimer);packs.cancel();software.cancel();}
 function snapshot(){return {installed,preferences:{...preferences},characters:{...characters},software:software.snapshot()};}
 return {snapshot,configure,checkCharacters,software,start,stop,get characterBusy(){return characterBusy;},cancelCharacters:()=>{cancelled=true;pending=false;clearTimeoutFn(retry);packs.cancel();}};
}
module.exports={createUpdateService};
