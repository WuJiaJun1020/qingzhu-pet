'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {characterDirectory,isPackagedRuntime}=require('../app/development-paths.cjs');
test('development uses the configured pack directory; releases and isolated tests ignore it',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qingzhu-dev-path-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const data=path.join(root,'data'),shared=path.join(root,'shared');fs.mkdirSync(shared);fs.writeFileSync(path.join(shared,'index.json'),'{}');
  fs.writeFileSync(path.join(root,'.local-config.json'),JSON.stringify({sourceRoot:root}));
  assert.equal(characterDirectory({root,data}),path.join(data,'characters'));
  fs.writeFileSync(path.join(root,'.local-config.json'),JSON.stringify({charactersDirectory:shared}));
  assert.equal(characterDirectory({root,data}),shared);
  assert.equal(characterDirectory({root,data,packaged:true}),path.join(data,'characters'));
  assert.equal(characterDirectory({root,data,verifying:true}),path.join(data,'characters'));
  fs.writeFileSync(path.join(root,'.local-config.json'),JSON.stringify({charactersDirectory:'relative'}));
  assert.throws(()=>characterDirectory({root,data}),/绝对路径/);
});
test('renamed preview runtime uses local data while the release remains packaged',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qingzhu-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const appPath=path.join(root,'app');fs.mkdirSync(appPath);
  fs.writeFileSync(path.join(appPath,'package.json'),JSON.stringify({name:'desktop-pet-preview',main:'main.cjs'}));
  assert.equal(isPackagedRuntime({isPackaged:true,appPath}),false);
  const data=path.join(root,'数据');
  assert.equal(characterDirectory({root,data,packaged:isPackagedRuntime({isPackaged:true,appPath})}),path.join(data,'characters'));
  fs.writeFileSync(path.join(appPath,'package.json'),JSON.stringify({name:'qingzhu-pet',main:'app/main.cjs'}));
  assert.equal(isPackagedRuntime({isPackaged:true,appPath}),true);
  assert.equal(isPackagedRuntime({isPackaged:false,appPath}),false);
  assert.equal(isPackagedRuntime({isPackaged:true,appPath:path.join(root,'missing')}),true);
});
