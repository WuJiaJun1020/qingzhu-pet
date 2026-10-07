'use strict';
const {spawn}=require('node:child_process');
const REPOSITORY='WuJiaJun1020/qingzhu-pet',API='https://api.github.com/repos/'+REPOSITORY;
function git(root,args,input){
  return new Promise((resolve,reject)=>{
    const child=spawn('git',['-c','safe.directory='+root.replaceAll('\\','/'),...args],{cwd:root,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
    let out='',err='';const timer=setTimeout(()=>{child.kill();reject(Error('Git 操作超时'));},60000);
    child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});
    child.on('error',()=>{clearTimeout(timer);reject(Error('找不到 Git，请先安装并登录 GitHub'));});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(args.includes('credential')?'请先在本机 Git 中登录 GitHub':err.slice(0,1000)||'Git 操作失败'));});
    child.stdin.end(input||'');
  });
}
async function connect(root,fetch){
  const credential=await git(root,['-c','credential.interactive=never','credential','fill'],'protocol=https\nhost=github.com\n\n');
  const token=credential.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);
  if(!token)throw Error('未找到 GitHub 登录凭据');
  async function request(route,{method='GET',body,bytes,upload=false}={}){
    const url=new URL(upload?route:API+route);
    if(upload?(url.origin!=='https://uploads.github.com'||!url.pathname.startsWith('/repos/'+REPOSITORY+'/releases/')):url.origin!=='https://api.github.com')throw Error('发布地址不合法');
    const response=await fetch(url.href,{method,redirect:'error',signal:AbortSignal.timeout(180000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':bytes?'application/octet-stream':'application/json'},body:bytes|| (body?JSON.stringify(body):undefined)});
    if(!response.ok){const error=Error('GitHub 请求失败（HTTP '+response.status+'）');error.status=response.status;throw error;}
    return response.status===204?null:response.json();
  }
  const repo=await request('');if(!repo.permissions?.push)throw Error('当前 GitHub 账号没有此仓库的发布权限');
  async function download(id){
    if(!Number.isSafeInteger(id)||id<1)throw Error('附件编号不合法');
    let url=API+'/releases/assets/'+id;
    for(let hop=0;hop<5;hop++){
      const target=new URL(url),authenticated=target.origin==='https://api.github.com';
      if(target.protocol!=='https:'||(!authenticated&&!target.hostname.endsWith('.githubusercontent.com')))throw Error('附件下载跳转不合法');
      const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(180000),headers:{Accept:'application/octet-stream',...(authenticated?{Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}:{})}});
      if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location'),url).href;continue;}
      if(!response.ok)throw Error('下载归档源失败（HTTP '+response.status+'）');
      const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.byteLength;if(size>512*1024**2)throw Error('附件过大');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);
    }
    throw Error('附件下载跳转过多');
  }
  return {request,download};
}
async function remoteState(api){
  const ref=await api.request('/git/ref/heads/main'),head=ref.object.sha;
  const commit=await api.request('/git/commits/'+head);
  const read=async file=>{
    const value=await api.request('/contents/'+file+'?ref='+head);
    if(value.encoding!=='base64')throw Error('远程文件格式不支持');
    return Buffer.from(value.content.replace(/\s/g,''),'base64').toString('utf8');
  };
  return {head,tree:commit.tree.sha,catalog:JSON.parse(await read('assets/character-packs.json')),readme:await read('README.md')};
}
module.exports={connect,remoteState,git,REPOSITORY};
