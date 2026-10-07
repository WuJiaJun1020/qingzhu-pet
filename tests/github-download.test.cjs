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

test('API quota cooldown skips metadata across character downloads until reset',async()=>{
 let clock=100000,calls=[];
 const download=createGitHubDownload(async u=>{calls.push(u);return u.includes('api.github.com')?new Response('',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'200'}}):new Response('ok');},{now:()=>clock});
 await download(url);await download(url.replace('other','next'));
 assert.equal(calls.filter(u=>u.includes('api.github.com')).length,1);
 clock=201000;await download(url);assert.equal(calls.filter(u=>u.includes('api.github.com')).length,2);
});

test('rate-limited asset API falls back to the public binary and caches cooldown',async()=>{
 const calls=[];
 const download=createGitHubDownload(async u=>{
  calls.push(u);
  if(u.includes('/tags/'))return new Response(JSON.stringify({assets:[{name:'other.qzpet',url:'https://api.github.com/repos/WuJiaJun1020/qingzhu-pet/releases/assets/1'}]}));
  return u.includes('/assets/')?new Response('',{status:429,headers:{'retry-after':'60'}}):new Response('ok');
 });
 assert.equal(await (await download(url)).text(),'ok');await download(url);
 assert.equal(calls.length,4);assert.equal(calls[3],url);
});


test('first public rate limit fails immediately; only user calls can retry after cooldown',async()=>{
 let clock=0,binary=0;
 const download=createGitHubDownload(async u=>{
  if(u.includes('api.github.com'))return new Response('',{status:403});
  return ++binary===1?new Response('',{status:429,headers:{'retry-after':'60'}}):new Response('ok');
 },{now:()=>clock});
 await assert.rejects(download(url),/限流.*手动重试/);assert.equal(binary,1);
 await assert.rejects(download(url),/限流/);assert.equal(binary,1,'cooldown must neither wait nor send a premature request');
 clock=60001;assert.equal(binary,1,'clock advancing cannot trigger an automatic retry');
 assert.equal(await (await download(url)).text(),'ok');assert.equal(binary,2);
});

test('network failure makes no automatic retry',async()=>{
 let binary=0;
 const download=createGitHubDownload(async u=>{if(u.includes('api.github.com'))return new Response('',{status:403});binary++;throw Error('connection closed');});
 await assert.rejects(download(url),/connection closed/);assert.equal(binary,1);
});

test('cancelled request does not reach the download endpoint',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 const download=createGitHubDownload(async(u,o)=>{o.signal.throwIfAborted();calls++;return new Response('ok');});
 await assert.rejects(download(url,{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});
