'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
try {
  assert.equal(process.platform,'win32','当前客户端窗口验收需要 Windows');
  let config={};
  const configFile=path.join(root,'.local-config.json');
  if(fs.existsSync(configFile))config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  const client=path.resolve(root,config.testClientDirectory||'../桌宠测试器');
  const executable=path.join(client,'runtime/QingzhuPet.exe');
  const appPath=path.join(client,'app');
  assert.ok(fs.existsSync(executable),'找不到当前测试客户端：'+executable);
  const wrapper=JSON.parse(fs.readFileSync(path.join(appPath,'package.json'),'utf8'));
  assert.equal(wrapper.name,'desktop-pet-preview');assert.equal(wrapper.main,'main.cjs');
  const compare=relative=>assert.ok(fs.readFileSync(path.join(root,relative)).equals(fs.readFileSync(path.join(client,relative))),'测试客户端代码未同步：'+relative);
  for(const file of fs.readdirSync(path.join(root,'app'),{withFileTypes:true})){
    if(file.isFile()&&!['package.json','package-lock.json','pnpm-lock.yaml'].includes(file.name))compare('app/'+file.name);
  }
  for(const file of ['tests/verify-client.cjs','tests/verify-panel.cjs','tests/verify-repair.cjs','tests/verify-remove.cjs','tests/verify-memory.cjs','tests/client-fixtures.cjs','assets/manifest.json'])compare(file);
  const reportFile=path.join(client,'tests/results/当前客户端验收.json');
  fs.mkdirSync(path.dirname(reportFile),{recursive:true});
  fs.rmSync(reportFile,{force:true});
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  console.log('验收当前客户端：'+executable);
  const result=spawnSync(executable,[appPath,'--verify-client'],{cwd:client,env,windowsHide:true,stdio:'inherit',timeout:120000});
  if(result.error)throw result.error;
  assert.equal(result.status,0,'当前客户端验收进程失败');
  assert.ok(fs.existsSync(reportFile),'客户端未生成本次验收报告');
  const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
  assert.equal(report.passed,true,report.error||'客户端验收失败');
  assert.equal(path.resolve(report.runtime.appPath),appPath,'报告必须来自当前客户端');
  console.log('验收通过，报告：'+reportFile);
} catch(error) {
  console.error(error.message);process.exitCode=1;
}
