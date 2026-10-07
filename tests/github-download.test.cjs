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

test('public download honors Retry-After before retrying and strips internal callbacks',async()=>{
 let clock=0,binary=0;const waits=[],messages=[];
 const download=createGitHubDownload(async(u,o)=>{
  assert.equal('onRetry' in o,false);
  if(u.includes('api.github.com'))return new Response('',{status:403});
  return ++binary===1?new Response('',{status:429,headers:{'retry-after':'3'}}):new Response('ok');
 },{now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;}});
 assert.equal(await (await download(url,{onRetry:v=>messages.push(v.message)})).text(),'ok');
 assert.deepEqual(waits,[3000]);assert.equal(messages.length,1);assert.equal(binary,2);
});

test('persistent limit retries only twice with backoff, then preserves cooldown',async()=>{
 let clock=0,binary=0;const waits=[];
 const download=createGitHubDownload(async u=>{
  if(u.includes('api.github.com'))return new Response('',{status:403});
  binary++;return new Response('',{status:429});
 },{now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;}});
 await assert.rejects(download(url),/多次限流.*手动下载/);
 assert.deepEqual(waits,[60000,120000]);assert.equal(binary,3);
 await assert.rejects(download(url),/手动下载/);assert.equal(binary,3);
});

test('long Retry-After is not shortened or retried early',async()=>{
 let calls=0;
 const download=createGitHubDownload(async u=>u.includes('api.github.com')?new Response('',{status:403}):(calls++,new Response('',{status:429,headers:{'retry-after':'3600'}})),{wait:()=>assert.fail('must not wait an hour')});
 await assert.rejects(download(url),/手动下载/);await assert.rejects(download(url),/手动下载/);assert.equal(calls,1);
});

test('cancelling during rate-limit wait stops without another request',async()=>{
 const controller=new AbortController();let calls=0;
 const download=createGitHubDownload(async u=>u.includes('api.github.com')?new Response('',{status:403}):(calls++,new Response('',{status:429})));
 await assert.rejects(download(url,{signal:controller.signal,onRetry:()=>controller.abort()}),{name:'AbortError'});
 assert.equal(calls,1);
});
