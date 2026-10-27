// Exercises the product mock transport with the official CLI in strict subscription mode.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MatrixGame } from '../dist/matrix.mjs';
import { EventSubAdapter } from '../dist/eventsub_adapter.mjs';
import { MockEventSubTransport } from '../dist/mock_eventsub_transport.mjs';
import { assertRpcLoopback } from './mock_guard.mjs';

const cli=process.env.TWITCH_CLI, injector=process.env.MOCK_INJECTOR;
if(!cli || !injector)throw new Error('TWITCH_CLI and MOCK_INJECTOR required');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('TWITCH_')));
env.CI='true';env.TWITCH_DISABLE_UPDATE_CHECKS='true';
const config=['--config','/private/tmp/streamer-mayhem-missing-config.env'], run=promisify(execFile);
const server=spawn(cli,[...config,'event','websocket','start-server','--ip','127.0.0.1','--port','8080','--require-subscription'],{env,stdio:['ignore','pipe','pipe']});
let output='',closed=false;server.on('close',()=>{closed=true;});
for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{output=(output+data.toString()).slice(-16000);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async (predicate,label)=>{for(let i=0;i<120;i++){if(predicate())return;await sleep(25);}throw new Error(`Timed out: ${label}`);};
const command=(...args)=>run(cli,[...config,...args],{env,timeout:4000,maxBuffer:16384});
const subscriptions=async()=>{
  const r=await fetch('http://127.0.0.1:8080/eventsub/subscriptions',{headers:{'Client-Id':'streamer-mayhem-local-mock'},redirect:'error',credentials:'omit'});
  assert.equal(r.ok,true);return (await r.json()).data;
};
let transport;
const timer=setTimeout(()=>{console.error('FAIL overall timeout');transport?.stop();server.kill('SIGINT');process.exitCode=1;},25000);
try {
  await until(()=>output.includes('Connect to the WebSocket server at:'),'server startup');
  await assertRpcLoopback(server.pid);
  const game=new MatrixGame(),adapter=new EventSubAdapter({game});game.start();
  const statuses=[],delivered=[];let posts=0;
  const trackedFetch=(url,options)=>{posts++;return fetch(url,options);};
  transport=new MockEventSubTransport({adapter,fetchImpl:trackedFetch,retryBaseMs:50,retryMaxMs:100,onStatus:(status,detail)=>statuses.push([status,detail]),onDelivery:r=>delivered.push(r)});
  assert.equal(posts,0);transport.start();await until(()=>transport.status==='ONLINE','initial subscription');
  let active=(await subscriptions()).filter(s=>s.status==='enabled');assert.equal(active.length,1);
  assert.equal(active[0].type,'channel.ban');assert.equal(active[0].transport.session_id,adapter.sessionId);
  let oldId=active[0].id,oldSession=adapter.sessionId;assert.equal(posts,1);
  await command('event','trigger','channel.ban','--transport=websocket','--no-config');
  await until(()=>delivered.some(x=>x.reason==='UNSUPPORTED_SUBSCRIPTION'),'supported mock event');
  await assert.rejects(run(injector,['!throw 5','strict-chat','viewer'],{env,timeout:4000}));
  console.log('PASS strict mock subscription active, supported event delivered, unsupported chat rejected');
  await command('event','websocket','close',`--session=${oldSession}`,'--reason=4006');
  await until(()=>transport.status==='ONLINE' && adapter.sessionId!==oldSession,'automatic resubscription');
  active=(await subscriptions()).filter(s=>s.status==='enabled');assert.equal(active.length,1);
  assert.notEqual(active[0].id,oldId);assert.equal(active[0].transport.session_id,adapter.sessionId);assert.equal(posts,2);
  console.log('PASS server close 4006 triggers automatic new session and new subscription');
  oldId=active[0].id;oldSession=adapter.sessionId;
  await command('event','websocket','reconnect');
  await until(()=>transport.status==='ONLINE' && adapter.sessionId!==oldSession,'automatic migration');
  active=(await subscriptions()).filter(s=>s.status==='enabled');assert.equal(active.length,1);
  assert.equal(active[0].id,oldId);assert.equal(active[0].transport.session_id,adapter.sessionId);assert.equal(posts,2);
  const before=delivered.length;await command('event','trigger','channel.ban','--transport=websocket','--no-config');
  await until(()=>delivered.length>before,'delivery after migration');
  console.log('PASS official session_reconnect migrates same subscription without a new POST and resumes delivery');
  console.log('LIMIT official CLI v1.1.24 rejects channel.chat.message subscription; substitute channel.ban used');
} catch(error){console.error('FAIL',error.message);process.exitCode=1;} finally {
  clearTimeout(timer);transport?.stop();if(!closed)server.kill('SIGINT');for(let i=0;i<40&&!closed;i++)await sleep(50);
  if(!closed){console.error('FAIL mock server did not exit');process.exitCode=1;}
}
