'use strict';
const fs=require('node:fs'),path=require('node:path');
// Electron 38's patched cpSync crashes on this Windows runtime. Use individual
// copies, never hard links: repair verification must not mutate live resources.
module.exports=function copyCharacters(source,destination){
 fs.mkdirSync(destination,{recursive:true});
 for(const entry of fs.readdirSync(source,{withFileTypes:true})){
  const from=path.join(source,entry.name),to=path.join(destination,entry.name);
  if(entry.isDirectory())copyCharacters(from,to);
  else if(entry.isFile())fs.copyFileSync(from,to);
  else throw Error('验收资源不得包含链接：'+from);
 }
};
