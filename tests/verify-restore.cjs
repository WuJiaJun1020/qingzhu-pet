'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async ({app,pet,panel,snapshot,root,verifyRestore})=>{
  const out=path.join(root,'tests/results');
  try {
    const s=snapshot();
    assert.equal(s.character.id,verifyRestore);
    assert.equal(s.settings.character,verifyRestore);
    assert.equal(s.settings.action,s.idleId);
    assert.equal(s.settings.autoPlay,true);assert.equal(s.settings.playing,true);
    assert.equal(s.interactionPhase,'none');
    const end=Date.now()+10000;
    let rendered;
    while(Date.now()<end){
      rendered=await pet.webContents.executeJavaScript('({action:document.getElementById("canvas").dataset.action,frame:Number(document.getElementById("canvas").dataset.frame)})');
      if(rendered.action===s.idleId&&rendered.frame>3)break;
      await new Promise(r=>setTimeout(r,60));
    }
    assert.ok(rendered.action===s.idleId&&rendered.frame>3);
    assert.equal(await panel.webContents.executeJavaScript('document.getElementById("character").value'),verifyRestore);
    const result={passed:true,character:verifyRestore,checks:['从保存的角色配置启动，进入该角色的自动待机，面板与渲染一致']};
    fs.writeFileSync(path.join(out,'启动恢复-'+verifyRestore+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }catch(error){fs.writeFileSync(path.join(out,'启动恢复-'+verifyRestore+'.json'),JSON.stringify({passed:false,error:error.stack},null,2));console.error(error);process.exitCode=1;}
  app.quit();
};
