import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));

test('loopback server exposes the full application module graph without widening static routes',{timeout:10000},async()=>{
  const child=spawn(process.execPath,['scripts/serve-local.mjs','--smoke'],{cwd:root,stdio:['ignore','pipe','pipe']});
  let output='',stderr='',settled=false;
  const exited=new Promise(resolveExit=>{
    child.once('error',error=>resolveExit({error}));
    child.once('exit',(code,signal)=>resolveExit({code,signal}));
  });
  const ready=new Promise((resolveReady,reject)=>{
    child.stdout.on('data',data=>{output+=data.toString();const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);if(match&&!settled){settled=true;resolveReady(`http://127.0.0.1:${match[1]}`);}});
    child.stderr.on('data',data=>{stderr+=data.toString();});
    child.once('error',reject);child.once('exit',code=>{if(!settled)reject(new Error(`server exited before ready: ${code} ${stderr}`));});
  });
  try {
    const origin=await ready;const index=await fetch(origin+'/');assert.equal(index.status,200);const live=await fetch(origin+'/live');assert.equal(live.status,200);assert.match(await live.text(),/src="\.\/app\.mjs"/);assert.match(await index.text(),/src="\.\/app\.mjs"/);
    const pending=['/app.mjs'],visited=new Set();
    while(pending.length){
      const path=pending.shift();if(visited.has(path))continue;visited.add(path);
      const response=await fetch(origin+path);assert.equal(response.status,200,`module ${path}`);
      assert.match(response.headers.get('content-type')??'',/^text\/javascript\b/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      const body=await response.text();assert.equal(body,await readFile(resolve(root,'dist',path.slice(1)),'utf8'));
      const imports=body.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.\/[^'"]+)['"]/g);
      for(const match of imports)pending.push(new URL(match[1],origin+path).pathname);
    }
    assert.ok(visited.has('/frame_source.mjs'),'new synthetic frame source must be in the served dependency graph');
    assert.ok(visited.has('/pose_freeze.mjs'),'real engine Freeze dependency must be served');
    assert.equal((await fetch(origin+'/not-allowlisted.mjs')).status,404);
    assert.equal((await fetch(origin+'/frame_source.mjs',{method:'POST'})).status,404);
  } finally {
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
    let timeout;
    const result=await Promise.race([exited,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('owned server did not exit')),2000);})]).finally(()=>clearTimeout(timeout));
    if(result.error)throw result.error;
    if(settled)assert.equal(result.code,0,`owned server exit (signal=${result.signal}, stderr=${stderr})`);
  }
});

test('synthetic server resolves the Freeze dependency in root and dist module contexts',{timeout:10000},async()=>{
  const child=spawn(process.execPath,['tests/serve-synthetic.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
  let stderr='',output='',readyDone=false;
  const exited=new Promise(resolveExit=>{child.once('error',error=>resolveExit({error}));child.once('exit',(code,signal)=>resolveExit({code,signal}));});
  const ready=new Promise((resolveReady,reject)=>{
    child.stdout.on('data',data=>{output+=data.toString();const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);if(match&&!readyDone){readyDone=true;resolveReady(`http://127.0.0.1:${match[1]}`);}});
    child.stderr.on('data',data=>{stderr+=data.toString();});child.once('error',reject);
    child.once('exit',code=>{if(!readyDone)reject(new Error(`server exited before ready: ${code} ${stderr}`));});
  });
  try {
    const origin=await ready;
    for(const prefix of ['/','/dist/']){
      const engine=await fetch(origin+prefix+'matrix.mjs');assert.equal(engine.status,200);
      const body=await engine.text();assert.match(body,/from '\.\/pose_freeze\.mjs'/);
      const dependency=await fetch(origin+prefix+'pose_freeze.mjs');assert.equal(dependency.status,200);
      assert.equal(await dependency.text(),await readFile(resolve(root,'dist/pose_freeze.mjs'),'utf8'));
      assert.equal((await fetch(origin+prefix+'pose_freeze.mjs',{method:'POST'})).status,404);
    }
    assert.equal((await fetch(origin+'/not-allowlisted.mjs')).status,404);
  } finally {
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
    let timeout;const result=await Promise.race([exited,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('owned synthetic server did not exit')),2000);})]).finally(()=>clearTimeout(timeout));
    if(result.error)throw result.error;
    if(readyDone)assert.equal(result.code,0,`owned server exit (signal=${result.signal}, stderr=${stderr})`);
  }
});
