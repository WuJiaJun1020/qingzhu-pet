'use strict';
const fs=require('node:fs'),path=require('node:path');
// The preview's renamed Electron executable reports isPackaged=true even when
// it launches loose source. Identify its explicit wrapper, not its filename.
function isPackagedRuntime({isPackaged,appPath}) {
  if (!isPackaged) return false;
  try {
    const entry=JSON.parse(fs.readFileSync(path.join(appPath,'package.json'),'utf8'));
    if(entry.name==='desktop-pet-preview'&&entry.main==='main.cjs')return false;
  } catch (_) { /* Installed releases retain their per-user data directory. */ }
  return true;
}
function characterDirectory({root,data,packaged,verifying}) {
  if (packaged || verifying) return path.join(data,'characters');
  let configuration;
  try {configuration=JSON.parse(fs.readFileSync(path.join(root,'.local-config.json'),'utf8'));}
  catch(error) {if(error.code==='ENOENT')return path.join(data,'characters');throw error;}
  const directory=configuration.charactersDirectory;
  if(directory===undefined)return path.join(data,'characters');
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('开发人物包目录必须是绝对路径');
  if(!fs.existsSync(path.join(directory,'index.json')))throw Error('开发人物包目录中找不到 index.json');
  return path.resolve(directory);
}
module.exports={characterDirectory,isPackagedRuntime};
