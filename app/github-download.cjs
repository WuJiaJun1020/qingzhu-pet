'use strict';
// Public release metadata avoids stale web redirects; no account or token is used.
function createGitHubDownload(fetch){
  const releases=new Map();
  const headers={'User-Agent':'qingzhu-pet/0.1'};
  return async(url,options={})=>{
    const link=new URL(url),match=link.pathname.match(/^\/WuJiaJun1020\/qingzhu-pet\/releases\/download\/([^/]+)\/([^/]+)$/);
    if(link.origin!=='https://github.com'||!match)throw new Error('人物下载地址不合法');
    const [,tag,name]=match;
    let assets=releases.get(tag);
    if(!assets){
      const response=await fetch(`https://api.github.com/repos/WuJiaJun1020/qingzhu-pet/releases/tags/${tag}`,{...options,headers:{...headers,Accept:'application/vnd.github+json'}});
      if(!response.ok)return fetch(url,{...options,headers});
      assets=(await response.json()).assets;
      if(!Array.isArray(assets))throw new Error('人物发布信息不完整');
      releases.set(tag,assets);
    }
    const asset=assets.find(a=>a.name===decodeURIComponent(name));
    if(!asset)return fetch(url,{...options,headers});
    if(!/^https:\/\/api\.github\.com\/repos\/WuJiaJun1020\/qingzhu-pet\/releases\/assets\/\d+$/.test(asset.url))throw new Error('人物资源下载接口不合法');
    return fetch(asset.url,{...options,headers:{...headers,Accept:'application/octet-stream'}});
  };
}
module.exports={createGitHubDownload};
