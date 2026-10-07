'use strict';
const {REPOSITORY}=require('./github.cjs');
const base='https://github.com/'+REPOSITORY+'/releases/';
const text=value=>String(value).replace(/[|\[\]<>\r\n]/g,'');
const releaseUrl=tag=>base+'tag/'+encodeURIComponent(tag);
const assetName=p=>decodeURIComponent(new URL(p.url).pathname.split('/').pop());
const packUrl=(tag,name)=>base+'download/'+encodeURIComponent(tag)+'/'+encodeURIComponent(name);
function table(packs){
 const rows=['| 人物资源 | 人物资源 | 人物资源 |','| --- | --- | --- |'];
 for(let i=0;i<packs.length;i+=3){const cells=packs.slice(i,i+3).map(p=>'['+text(p.name)+' · '+(p.bytes/1048576).toFixed(1)+' MiB]('+p.url+')');while(cells.length<3)cells.push('');rows.push('| '+cells.join(' | ')+' |');}
 return rows.join('\n');
}
function updateReadme(readme,catalog){
 const lines=readme.split(/\r?\n/),first=lines.findIndex(l=>l.startsWith('|')&&l.includes('.qzpet)'));
 if(first<0)throw Error('README 中找不到人物资源表格');
 let start=first,end=first;while(start>0&&lines[start-1].startsWith('|'))start--;while(end<lines.length&&lines[end].startsWith('|'))end++;
 lines.splice(start,end-start,...table(catalog.packs).split('\n'));
 let result=lines.join('\n').replace(/支持 \d+ 位人物、\d+ 套动画/,`支持 ${catalog.packs.length} 位人物、${catalog.packs.reduce((n,p)=>n+(p.actions?.length||0),0)} 套动画`);
 const links='[最新版人物资源]('+releaseUrl(catalog.resourceReleaseTag)+') · [历史归档]('+releaseUrl(catalog.archiveReleaseTag)+')';
 if(result.includes('<!-- character-release-links -->'))result=result.replace(/<!-- character-release-links -->[^\n]*/, '<!-- character-release-links -->'+links);
 else result=result.replace('## 人物资源\n','## 人物资源\n\n<!-- character-release-links -->'+links+'\n');
 return result;
}
function currentBody(catalog){return '每位人物仅保留最新版，共 **'+catalog.packs.length+' 位**。下载 `.qzpet` 后，在软件中导入。\n\n'+table(catalog.packs)+'\n\n[历史人物包]('+releaseUrl(catalog.archiveReleaseTag)+') · [软件安装包]('+base+'latest)';}
function archiveBody(catalog,assets){
 const names=new Map(catalog.packs.map(p=>[p.id,p.name]));
 const rows=assets.filter(a=>a.name.endsWith('.qzpet')).map(a=>{const match=a.name.match(/^(.+)-([a-f0-9]{12,64})\.qzpet$/);return {name:(names.get(match?.[1])||match?.[1]||a.name)+' · '+(match?.[2]||'').slice(0,12),bytes:a.size,url:packUrl(catalog.archiveReleaseTag,a.name)};});
 return '旧版人物包，仅供回退。\n\n[返回最新版人物资源]('+releaseUrl(catalog.resourceReleaseTag)+')\n\n'+(rows.length?table(rows):'暂无历史版本。');
}
module.exports={assetName,packUrl,releaseUrl,table,updateReadme,currentBody,archiveBody};
