// Product transport + game, using official CLI mock without strict topic filtering.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {MatrixGame} from '../dist/matrix.mjs';
import {EventSubAdapter} from '../dist/eventsub_adapter.mjs';
import {MockEventSubTransport} from '../dist/mock_eventsub_transport.mjs';
import {assertRpcLoopback} from './mock_guard.mjs';

const cli=process.env.TWITCH_CLI,injector=process.env.MOCK_INJECTOR;
if(!cli||!injector)throw new Error('TWITCH_CLI and MOCK_INJECTOR required');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('TWITCH_')));
env.CI='true';env.TWITCH_DISABLE_UPDATE_CHECKS='true';
const config=['--config','/private/tmp/streamer-mayhem-missing-config.env'],run=promisify(execFile);
const server=spawn(cli,[...config,'event','websocket','start-server','--ip','127.0.0.1','--port','8080'],{env,stdio:['ignore','pipe','pipe']});
let output='',closed=false;server.on('close',()=>{closed=true;});
for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{output=(output+data.toString()).slice(-16000);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(predicate,label)=>{for(let i=0;i<120;i++){if(predicate())return;await sleep(25);}throw new Error(`Timed out: ${label}`);};
const command=(...args)=>run(cli,[...config,...args],{env,timeout:4000,maxBuffer:16384});
const send=(text,id)=>run(injector,[text,id,'viewer'],{env,timeout:4000,maxBuffer:16384});
let transport;const timer=setTimeout(()=>{console.error('FAIL overall timeout');transport?.stop();server.kill('SIGINT');process.exitCode=1;},25000);
try {
  await until(()=>output.includes('Connect to the WebSocket server at:'),'server startup');
  await assertRpcLoopback(server.pid);
  let now=0;const clock=()=>now,p={x:.5,y:.5,visibility:1};
  const game=new MatrixGame({clock,options:{actorCooldown:0,globalCooldown:0}});game.start();
  game.addFrame({frameId:'initial',captureTime:0,nose:p,leftShoulder:p,rightShoulder:p});game.tick();
  const adapter=new EventSubAdapter({game,clock}),deliveries=[];
  transport=new MockEventSubTransport({adapter,retryBaseMs:50,retryMaxMs:100,onDelivery:d=>deliveries.push(d)});
  transport.start();await until(()=>transport.status==='ONLINE','initial connection');
  await send('!throw 5','chat-1');await until(()=>deliveries.length===1,'first command');assert.equal(deliveries[0].cell,5);
  await send('!throw 5','chat-1');await until(()=>deliveries.length===2,'duplicate');assert.equal(deliveries[1].reason,'DUPLICATE');
  const session=adapter.sessionId;await command('event','websocket','close',`--session=${session}`,'--reason=4006');
  await until(()=>transport.status==='ONLINE' && adapter.sessionId!==session,'automatic reconnect');
  await send('!throw 5','chat-1');await until(()=>deliveries.length===3,'cross-session duplicate');assert.equal(deliveries[2].reason,'DUPLICATE');
  now=500;game.addFrame({frameId:'impact',captureTime:now,nose:p,leftShoulder:p,rightShoulder:p});game.tick();assert.equal(game.hp,85);
  await send('!throw 1','chat-2');await until(()=>deliveries.length===4,'new command');assert.equal(deliveries[3].cell,1);
  console.log('PASS product transport receives mock chat, filters duplicates across auto-reconnect and drives game');
  console.log('LIMIT non-strict server; substitute subscription does not represent a chat subscription');
} catch(error){console.error('FAIL',error.message);process.exitCode=1;} finally {
  clearTimeout(timer);transport?.stop();if(!closed)server.kill('SIGINT');for(let i=0;i<40&&!closed;i++)await sleep(50);
  if(!closed){console.error('FAIL mock server did not exit');process.exitCode=1;}
}
