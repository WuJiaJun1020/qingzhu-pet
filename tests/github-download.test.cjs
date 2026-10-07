'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createGitHubDownload}=require('../app/github-download.cjs');
const url='https://github.com/WuJiaJun1020/qingzhu-pet/releases/download/test/other.qzpet';
test('public download uses matching release asset and forwards cancellation without credentials',async()=>{
  const calls=[],signal=new AbortController().signal;
  const download=createGitHubDownload(async(u,o)=>{
    calls.push([u,o]);
    return u.includes('/tags/')?{ok:true,json:async()=>({assets:[{name:'other.qzpet',url:'https://api.github.com/repos/WuJiaJun1020/qingzhu-pet/releases/assets/123'}]})}:new Response('bytes');
  });
  assert.equal(await (await download(url,{signal})).text(),'bytes');
  assert.equal(calls[1][1].headers.Accept,'application/octet-stream');
  assert.equal(calls[1][1].signal,signal);
  assert.equal('Authorization' in calls[1][1].headers,false);
  await download(url);assert.equal(calls.length,3);
});
test('API limit falls back to the public URL; unrelated asset endpoints are rejected',async()=>{
  let count=0;
  const download=createGitHubDownload(async()=>++count===1?{ok:false,status:403}:new Response('package'));
  assert.equal(await (await download(url)).text(),'package');
  const unsafe=createGitHubDownload(async()=>({ok:true,json:async()=>({assets:[{name:'other.qzpet',url:'https://example.com/123'}]})}));
  await assert.rejects(()=>unsafe(url),/接口不合法/);
});

test('a newly published file refreshes cached assets on a fixed release',async()=>{
 let calls=0;const download=createGitHubDownload(async u=>{if(u.includes('/tags/')){calls++;return {ok:true,json:async()=>({assets:[{name:'other.qzpet',url:'https://api.github.com/repos/WuJiaJun1020/qingzhu-pet/releases/assets/1'},...(calls>1?[{name:'new.qzpet',url:'https://api.github.com/repos/WuJiaJun1020/qingzhu-pet/releases/assets/2'}]:[])]})};}return new Response(u);});
 await download(url);assert.match(await (await download(url.replace('other.qzpet','new.qzpet'))).text(),/assets\/2$/);assert.equal(calls,2);
});
