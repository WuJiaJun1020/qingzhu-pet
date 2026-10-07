'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {fileHash}=require('./pack-format.cjs');
const {renameWithRetry}=require('./file-operations.cjs');
const {validVersion,compareVersions}=require('./versions.cjs');
const API='https://api.github.com/repos/WuJiaJun1020/qingzhu-pet';
const PREFIX='https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/';
const LATEST='https://github.com/WuJiaJun1020/qingzhu-pet/releases/latest';
const releaseTag=url=>url?.match(/^https:\/\/github\.com\/WuJiaJun1020\/qingzhu-pet\/releases\/tag\/(v\d+\.\d+\.\d+)\/?$/)?.[1];
async function pageReleaseTag(response){
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.byteLength;if(size>2*1024**2)throw Error('软件发布页面过大');chunks.push(Buffer.from(chunk));}
 const html=Buffer.concat(chunks).toString('utf8');
 for(const meta of html.match(/<meta\b[^>]*>/gi)||[]){
  if(!/\bproperty\s*=\s*["']og:url["']/i.test(meta))continue;
  const value=meta.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
  if(value){const tag=releaseTag(new URL(value,LATEST).href);if(tag)return tag;}
 }
 throw Error('暂时无法识别软件版本，请重试或前往 GitHub 下载');
}
function findRelease(releases,currentVersion){
 const options=[];
 for(const release of releases){
  const version=release.tag_name?.replace(/^v/,'');
  if(release.draft||release.prerelease||!validVersion(version)||compareVersions(version,currentVersion)<=0)continue;
  const name=`qingzhu-pet-${version}-windows-x64-setup.exe`,asset=release.assets?.find(a=>a.name===name);
  if(!asset||asset.state!=='uploaded')continue;
  const url=PREFIX+encodeURIComponent(release.tag_name)+'/'+name;
  if(asset.browser_download_url!==url||!Number.isSafeInteger(asset.size)||asset.size<2||asset.size>1024**3)throw Error('安装包发布信息不合法');
  const digest=asset.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
  const checksums=release.assets.find(a=>a.name==='SHA256SUMS.txt');
  options.push({version,name,url,bytes:asset.size,sha256:digest,checksumUrl:checksums?.browser_download_url===PREFIX+encodeURIComponent(release.tag_name)+'/SHA256SUMS.txt'?checksums.browser_download_url:null});
 }
 return options.sort((a,b)=>compareVersions(b.version,a.version))[0]||null;
}
function createSoftwareUpdater({data,version,installed,fetch,downloadFetch=fetch,onChange=()=>{}}){
 let state={status:'idle',version,availableVersion:null,received:0,total:0,message:''},candidate=null,ready=null,busy=false,controller;
 const emit=patch=>{state={...state,...patch};onChange();};
 const exclusive=async fn=>{if(busy)throw Error('软件更新正在处理');busy=true;try{return await fn();}finally{busy=false;}};
 async function cleanupInstalledDownloads(){
  if(!installed||!validVersion(version))return false;
  const folder=path.join(data,'software-updates');let entries;
  try{
   // Only remove our own completed installers in the real update-cache directory.
   const directory=await fs.lstat(folder);if(!directory.isDirectory()||directory.isSymbolicLink())return false;
   entries=await fs.readdir(folder,{withFileTypes:true});
  }catch(error){return error.code!=='ENOENT';}
  let pending=false;
  for(const entry of entries){
   const cachedVersion=entry.name.match(/^qingzhu-pet-(\d+\.\d+\.\d+)-windows-x64-setup\.exe$/)?.[1];
   if(!entry.isFile()||!validVersion(cachedVersion)||compareVersions(cachedVersion,version)>0)continue;
   try{await fs.unlink(path.join(folder,entry.name));}catch(error){if(error.code!=='ENOENT')pending=true;}
  }
  return pending;
 }
 async function publicLatest(){
  const options={method:'HEAD',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])};
  const response=await fetch(LATEST,options);
  if(!response.ok)throw Error('检查软件更新失败，请稍后重试');
  let tag=releaseTag(response.url);
  // Electron net.fetch may leave Response.url empty after a redirect.
  if(!tag){const page=await fetch(LATEST,{...options,method:'GET'});if(!page.ok)throw Error('无法读取软件发布页，请稍后重试');tag=await pageReleaseTag(page);}
  const nextVersion=tag.slice(1);if(compareVersions(nextVersion,version)<=0)return null;
  const name=`qingzhu-pet-${nextVersion}-windows-x64-setup.exe`,url=PREFIX+tag+'/'+name;
  const asset=await fetch(url,options),size=Number(asset.headers.get('content-length'));
  if([403,429].includes(asset.status))throw Error('GitHub 暂时限制访问安装包，请稍后手动重试或前往 GitHub 下载');
  if(!asset.ok||!Number.isSafeInteger(size)||size<2||size>1024**3)throw Error('无法确认安装包大小，请稍后重试');
  return {version:nextVersion,name,url,bytes:size,checksumUrl:PREFIX+tag+'/SHA256SUMS.txt'};
 }
 async function check(){return exclusive(async()=>{
  if(!installed){emit({status:'development',message:'本地开发版不覆盖安装，请在安装版中更新软件。'});return;}
  emit({status:'checking',manualDownload:false,message:'正在检查软件版本…'});controller=new AbortController();
  try{
   const releases=[];let fallback=false;
   for(let page=1;page<=5;page++){
    const response=await fetch(API+'/releases?per_page=100&page='+page,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),headers:{Accept:'application/vnd.github+json'}});
    if([403,429].includes(response.status)){fallback=true;break;}
    if(!response.ok)throw Error('检查软件更新失败（HTTP '+response.status+'）');
    const batch=await response.json();if(!Array.isArray(batch))throw Error('软件发布信息不完整');releases.push(...batch);if(batch.length<100)break;
   }
   const next=fallback?await publicLatest():findRelease(releases,version);candidate=next;
   if(next&&!next.sha256){
    if(!next.checksumUrl)throw Error('新版安装包缺少 SHA-256 校验信息');
    const response=await downloadFetch(next.checksumUrl,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),cache:'no-store'});if(!response.ok)throw Error('无法读取安装包校验信息');
    const chunks=[];let n=0;for await(const chunk of response.body){n+=chunk.byteLength;if(n>65536)throw Error('安装包校验文件过大');chunks.push(Buffer.from(chunk));}
    for(const line of Buffer.concat(chunks).toString('utf8').split(/\r?\n/)){const m=line.match(/^([a-f0-9]{64})\s+\*?(.+)$/);if(m&&m[2]===next.name)next.sha256=m[1];}
    if(!next.sha256)throw Error('找不到新版安装包的 SHA-256');
   }
   if(ready&&(ready.version!==next?.version||ready.sha256!==next?.sha256||ready.bytes!==next?.bytes))ready=null;
   emit(next?{status:ready?'ready':'available',availableVersion:next.version,total:next.bytes,message:ready?'安装包已就绪。':'发现新版 v'+next.version}:{status:'latest',availableVersion:null,message:'软件已是最新版。'});
  }catch(error){emit({status:'error',manualDownload:true,message:error.message});throw error;}finally{controller=null;}
 });}
 async function download(){return exclusive(async()=>{
  if(!installed)throw Error('本地开发版不能下载并覆盖安装');
  if(!candidate?.sha256)throw Error('请先检查软件更新');
  const next={...candidate},folder=path.join(data,'software-updates'),target=path.join(folder,next.name);await fs.mkdir(folder,{recursive:true});
  const temporary=target+'.'+crypto.randomUUID()+'.partial';controller=new AbortController();
  try{
   emit({status:'downloading',manualDownload:false,received:0,total:next.bytes,message:'正在下载安装包…'});
   const response=await downloadFetch(next.url,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20*60*1000)])});if(!response.ok)throw Error('安装包下载失败（HTTP '+response.status+'）');
   emit({message:'正在下载安装包…'});
   const handle=await fs.open(temporary,'wx');let size=0,last=0;const digest=crypto.createHash('sha256');
   try{for await(const chunk of response.body){if(controller.signal.aborted)throw Error('下载已取消');size+=chunk.byteLength;if(size>next.bytes)throw Error('安装包大小超过清单');digest.update(chunk);await handle.writeFile(chunk);if(Date.now()-last>200){emit({received:size});last=Date.now();}}}finally{await handle.close();}
   if(size!==next.bytes||digest.digest('hex')!==next.sha256)throw Error('安装包校验失败，请重新下载');
   const handle2=await fs.open(temporary);try{const signature=Buffer.alloc(2);await handle2.read(signature,0,2,0);if(signature.toString()!=='MZ')throw Error('下载文件不是 Windows 安装程序');}finally{await handle2.close();}
   await renameWithRetry(temporary,target);ready={...next,file:target};emit({status:'ready',received:size,message:'下载完成，可退出并安装。'});
  }catch(error){const message=controller.signal.aborted?'下载已取消':error.message+'。请前往 GitHub 手动下载最新版安装包。';emit({status:'error',manualDownload:!controller.signal.aborted,message});throw Error(message);}finally{controller=null;await fs.rm(temporary,{force:true});}
 });}
 async function prepareInstall(){
  if(!installed||!ready||busy)throw Error('安装包尚未就绪');
  try{if((await fs.stat(ready.file)).size!==ready.bytes||await fileHash(ready.file)!==ready.sha256)throw Error('安装包校验失败');}
  catch{ready=null;emit({status:'error',message:'安装包缺失或已改变，请重新下载。'});throw Error('安装包校验失败');}
  return ready.file;
 }
 return {check,download,prepareInstall,cleanupInstalledDownloads,cancel:()=>controller?.abort(),get busy(){return busy;},snapshot:()=>({...state,installed})};
}
module.exports={findRelease,createSoftwareUpdater};
