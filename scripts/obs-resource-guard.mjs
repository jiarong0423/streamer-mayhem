// Guard a single child owned by this task; no process-group or name-based killing.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const MB=1024*1024;
async function children(pid){
  try {const {stdout}=await exec('/usr/bin/pgrep',['-P',String(pid)],{timeout:1500,maxBuffer:32768});return stdout.trim().split(/\s+/).filter(Boolean).map(Number);}
  catch(error){if(error.code===1&&!String(error.stderr??'').trim())return [];throw new Error('PROCESS_ENUMERATION_FAILED');}
}
export async function sampleOwnedTree(pid){
  const queue=[pid],seen=new Set();
  while(queue.length){const current=queue.shift();if(seen.has(current))continue;seen.add(current);if(seen.size>64)throw new Error('PROCESS_TREE_TOO_LARGE');queue.push(...await children(current));}
  let output;try{({stdout:output}=await exec('/bin/ps',['-o','rss=,%cpu=','-p',[...seen].join(',')],{timeout:1500,maxBuffer:32768}));}catch{throw new Error('PROCESS_SAMPLE_FAILED');}
  let rss=0,cpu=0,count=0;for(const line of output.trim().split('\n')){const m=line.trim().match(/^(\d+)\s+([\d.]+)$/);if(!m)throw new Error('PROCESS_SAMPLE_INVALID');rss+=Number(m[1])*1024;cpu+=Number(m[2]);count++;}
  if(!count||!Number.isFinite(rss)||!Number.isFinite(cpu))throw new Error('PROCESS_SAMPLE_INVALID');return {rss,cpu,count};
}
export async function sampleDisk(path){
  const paths=Array.isArray(path)?path:[path];if(!paths.length)throw new Error('DISK_SAMPLE_INVALID');let bytes=0;
  for(const item of paths){const {stdout}=await exec('/usr/bin/du',['-sk',item],{timeout:3000,maxBuffer:32768});const m=stdout.match(/^\s*(\d+)/);if(!m)throw new Error('DISK_SAMPLE_INVALID');bytes+=Number(m[1])*1024;}
  return bytes;
}
export function guardOwnedChild(child,{sample=sampleOwnedTree,diskSample=sampleDisk,scratchPath,maxRss=2048*MB,maxDisk=2048*MB,maxCpu=200,cpuWindowMs=10000,timeoutMs=600000,sampleMs=2000,onLog=()=>{}}={}){
  if(!child || !Number.isInteger(child.pid)||typeof child.kill!=='function'||!scratchPath)throw new TypeError('Owned child and scratch path required');
  let reason=null,closed=false,timer=null,cpuSince=null,peakRss=0,peakDisk=0,peakCpu=0,inFlight=false;
  const stop=why=>{if(reason||closed)return;reason=why;onLog(`STOP ${why}`);child.kill('SIGTERM');};
  const deadline=setTimeout(()=>stop('TIME_LIMIT'),timeoutMs);
  const check=async()=>{
    if(closed||reason||inFlight)return;inFlight=true;
    try {
      const [m,d]=await Promise.all([sample(child.pid),diskSample(scratchPath)]);if(closed)return;
      if(!Number.isFinite(m.rss)||!Number.isFinite(m.cpu)||!Number.isFinite(d))throw new Error('INVALID_METRIC');
      peakRss=Math.max(peakRss,m.rss);peakDisk=Math.max(peakDisk,d);peakCpu=Math.max(peakCpu,m.cpu);
      onLog(`SAMPLE rss_mib=${Math.ceil(m.rss/MB)} disk_mib=${Math.ceil(d/MB)} cpu_pct=${m.cpu.toFixed(1)} processes=${m.count}`);
      if(m.rss>=maxRss)stop('RSS_LIMIT');else if(d>=maxDisk)stop('DISK_LIMIT');
      else if(m.cpu>maxCpu){cpuSince??=Date.now();if(Date.now()-cpuSince>=cpuWindowMs)stop('CPU_LIMIT');}else cpuSince=null;
    } catch {if(!closed)stop('MONITOR_FAILED');}
    finally {inFlight=false;if(!closed&&!reason)timer=setTimeout(check,sampleMs);}
  };
  let finish;const result=new Promise(resolve=>{finish=(why,code=null,signal=null)=>{if(closed)return;closed=true;clearTimeout(deadline);clearTimeout(timer);onLog(`EXIT code=${code??'null'} signal=${signal??'none'} reason=${why}`);resolve({reason:why,code,signal,peakRss,peakDisk,peakCpu});};});
  child.once('exit',(code,signal)=>finish(reason??'NORMAL',code,signal));
  child.once('error',()=>finish('SPAWN_FAILED'));
  check();return {stop,result};
}
