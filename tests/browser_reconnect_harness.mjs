// Bounded local-only driver used while a real browser displays the product page.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';

const binary=process.env.SIMULATOR_BIN;if(!binary)throw new Error('SIMULATOR_BIN required');
const children=[spawn(process.execPath,['scripts/serve-local.mjs'],{stdio:'ignore'}),spawn(binary,[],{stdio:'ignore'})];
const endpoint='http://127.0.0.1:8091/__mock/control',headers={'X-Mock-Control':'synthetic-only'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<100;i++){const v=await fn();if(v)return v;await sleep(50);}throw new Error(`Timeout: ${label}`);};
const get=async()=>{const r=await fetch(endpoint,{headers,signal:AbortSignal.timeout(1000)});assert.equal(r.ok,true);return (await r.json()).data;};
const send=async body=>{const r=await fetch(endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(1000)});assert.equal(r.status,200);};
let ended=false,busy=false;const io=createInterface({input:process.stdin});
async function finish(failed=false) {
  if(ended)return;ended=true;clearTimeout(deadline);io.close();if(failed)process.exitCode=1;
  for(const child of children)if(child.exitCode===null && child.signalCode===null)child.kill('SIGINT');
  for(let i=0;i<60 && children.some(c=>c.exitCode===null&&c.signalCode===null);i++)await sleep(50);
  if(children.some(c=>c.exitCode===null&&c.signalCode===null)){console.error('FAIL child did not exit');process.exitCode=1;}
}
const deadline=setTimeout(()=>{console.error('FAIL browser test timed out');finish(true);},120000);
for(const child of children)child.on('error',()=>{console.error('FAIL child startup');finish(true);});
for(const child of children)child.on('exit',()=>{if(!ended){console.error('FAIL child exited unexpectedly');finish(true);}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>finish(true));
try {
  await until(async()=>{try{const r=await fetch('http://127.0.0.1:4173/',{signal:AbortSignal.timeout(500)});return r.ok;}catch{return false;}},'page');
  await until(async()=>{try{await get();return true;}catch{return false;}},'simulator');
  console.log('READY: browser may open http://127.0.0.1:4173/');
  io.on('line',async line=>{
    if(busy||ended)return;const action=line.trim();if(action==='stop'){console.log('STOP');await finish();return;}
    if(action!=='disconnect'&&action!=='migrate'){console.log('Use disconnect, migrate, or stop');return;}busy=true;
    try {
      const before=await get();assert.equal(before.length,1);assert.equal(before[0].type,'channel.chat.message');
      await send({action:action==='disconnect'?'disconnect':'reconnect',session:before[0].transport.session_id});
      const next=await until(async()=>{const subs=await get();return subs.find(s=>s.transport.session_id!==before[0].transport.session_id && (action==='disconnect'?s.id!==before[0].id:s.id===before[0].id));},'subscription reconnect');
      // Allow the browser to finish its recovery countdown before the attack.
      await sleep(1200);const event={action:'chat',session:next.transport.session_id,text:action==='disconnect'?'!throw 1':'!throw 2',message_id:`browser-${action}-m`,notification_id:`browser-${action}-n`};
      await send(event);await send(event);console.log(`PASS ${action}: subscription recovered; same synthetic event delivered twice`);
    } catch(error){console.error('FAIL',error.message);await finish(true);}finally{busy=false;}
  });
}catch(error){console.error('FAIL',error.message);await finish(true);}
