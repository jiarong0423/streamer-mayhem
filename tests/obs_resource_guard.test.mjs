import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {guardOwnedChild} from '../scripts/obs-resource-guard.mjs';
const make=()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
const opts={scratchPath:'/tmp',sampleMs:5,timeoutMs:500,sample:async()=>({rss:1,cpu:1,count:1}),diskSample:async()=>1};
for(const [name,patch,reason] of [
  ['memory',{sample:async()=>({rss:100,cpu:0,count:1}),maxRss:100},'RSS_LIMIT'],
  ['disk',{diskSample:async()=>100,maxDisk:100},'DISK_LIMIT'],
  ['monitor failure',{sample:async()=>{throw Error('fail');}},'MONITOR_FAILED'],
  ['CPU',{sample:async()=>({rss:1,cpu:201,count:1}),maxCpu:200,cpuWindowMs:0},'CPU_LIMIT'],
  ['deadline',{timeoutMs:30},'TIME_LIMIT']]){
  test(`owned process stops on ${name}`,async()=>{const child=make(),guard=guardOwnedChild(child,{...opts,...patch});const result=await guard.result;assert.equal(result.reason,reason);assert.equal(result.signal,'SIGTERM');});
}
test('normal child completion is reported without a limit violation',async()=>{
  const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'}),guard=guardOwnedChild(child,{...opts});const result=await guard.result;assert.equal(result.reason,'NORMAL');assert.equal(result.code,0);
});

test('spawn failures do not leave a hanging guard',async()=>{
  const child=spawn('/path/that/cannot/exist',[],{stdio:'ignore'});
  // Node has no pid on spawn failure; the guard must reject before arming.
  assert.throws(()=>guardOwnedChild(child,{...opts}));await new Promise(resolve=>child.once('error',resolve));
});
