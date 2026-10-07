'use strict';
const header=(response,name)=>response.headers?.get(name);
function limited(response){return response.status===429||(response.status===403&&(header(response,'retry-after')!=null||header(response,'x-ratelimit-remaining')==='0'));}
function retryDelay(response,now,fallback){
  const value=header(response,'retry-after');
  const after=value==null?0:(/^\d+(\.\d+)?$/.test(value)?Number(value)*1000:Date.parse(value)-now);
  const reset=header(response,'x-ratelimit-remaining')==='0'?Number(header(response,'x-ratelimit-reset'))*1000-now:0;
  return Math.max(1000,Number.isFinite(after)?after:0,Number.isFinite(reset)?reset:0,after>0||reset>0?0:fallback);
}
async function discard(response){try{await response.body?.cancel();}catch{}}
// API metadata avoids stale redirects. Public binaries remain available when
// the anonymous API quota is exhausted; remember that cooldown across downloads.
function createGitHubDownload(fetch,{now=Date.now}={}){
  const releases=new Map();let apiUntil=0,publicUntil=0;
  const headers={'User-Agent':'qingzhu-pet'};
  return async(url,options={})=>{
    const link=new URL(url),match=link.pathname.match(/^\/WuJiaJun1020\/qingzhu-pet\/releases\/download\/([^/]+)\/([^/]+)$/);
    if(link.origin!=='https://github.com'||!match||link.username||link.password)throw new Error('人物下载地址不合法');
    const request=options;
    const [,tag,name]=match;
    const cooldown=response=>{if([403,429].includes(response.status))apiUntil=Math.max(apiUntil,now()+retryDelay(response,now(),60000));};
    async function publicDownload(){
      request.signal?.throwIfAborted();
      if(now()<publicUntil)throw Error('GitHub 暂时限流，请稍后手动重试');
      const response=await fetch(url,{...request,headers});
      if(!limited(response))return response;
      publicUntil=Math.max(publicUntil,now()+retryDelay(response,now(),60000));
      await discard(response);
      throw Error('GitHub 暂时限流，请稍后手动重试');
    }
    if(now()<apiUntil)return publicDownload();
    const cached=releases.get(tag);
    let assets=cached&&now()-cached.time<60000&&cached.assets.some(a=>a.name===decodeURIComponent(name))?cached.assets:null;
    if(!assets){
      let response;
      try{response=await fetch(`https://api.github.com/repos/WuJiaJun1020/qingzhu-pet/releases/tags/${tag}`,{...request,headers:{...headers,Accept:'application/vnd.github+json'}});}
      catch(error){if(request.signal?.aborted)throw error;return publicDownload();}
      if(!response.ok){cooldown(response);await discard(response);return publicDownload();}
      assets=(await response.json()).assets;
      if(!Array.isArray(assets))throw new Error('人物发布信息不完整');
      releases.set(tag,{time:now(),assets});
    }
    const asset=assets.find(a=>a.name===decodeURIComponent(name));
    if(!asset)return publicDownload();
    if(!/^https:\/\/api\.github\.com\/repos\/WuJiaJun1020\/qingzhu-pet\/releases\/assets\/\d+$/.test(asset.url))throw new Error('人物资源下载接口不合法');
    let response;
    try{response=await fetch(asset.url,{...request,headers:{...headers,Accept:'application/octet-stream'}});}
    catch(error){if(request.signal?.aborted)throw error;return publicDownload();}
    if([403,404,429].includes(response.status)){
      if(response.status===404)releases.delete(tag);
      cooldown(response);await discard(response);return publicDownload();
    }
    return response;
  };
}
module.exports={createGitHubDownload};
