'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),cache=path.join(process.env.LOCALAPPDATA,'electron-builder/Cache');
function find(base,file){for(const item of fs.readdirSync(base,{withFileTypes:true})){const candidate=path.join(base,item.name);if(item.isFile()&&item.name===file)return candidate;if(item.isDirectory()){const hit=find(candidate,file);if(hit)return hit;}}}
const compiler=find(path.join(cache,'nsis-3.0.4.1'),'makensis.exe'),plugin=find(path.join(cache,'nsis-resources-3.4.1'),'StdUtils.dll');
if(!compiler||!plugin)throw Error('请先构建 Windows 安装包，以准备 NSIS 依赖');
fs.mkdirSync(path.join(__dirname,'results'),{recursive:true});
const result=spawnSync(compiler,['/V2','/INPUTCHARSET','UTF8','/DQZ_ROOT='+root,'/DQZ_PLUGINS='+path.dirname(plugin),path.join(__dirname,'installer-flow.nsi')],{cwd:root,windowsHide:true,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status;
