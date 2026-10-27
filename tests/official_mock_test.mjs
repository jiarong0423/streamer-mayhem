// Integration test for Twitch CLI v1.1.24's loopback mock, not a production transport.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MatrixGame } from '../dist/matrix.mjs';
import { EventSubAdapter } from '../dist/eventsub_adapter.mjs';
import { assertRpcLoopback } from './mock_guard.mjs';

const cli=process.env.TWITCH_CLI, injector=process.env.MOCK_INJECTOR;
if (!cli || !injector) throw new Error('TWITCH_CLI and MOCK_INJECTOR must be set');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('TWITCH_')));
env.CI='true'; env.TWITCH_DISABLE_UPDATE_CHECKS='true';
const run=promisify(execFile), config=['--config','/private/tmp/streamer-mayhem-missing-config.env'];
const server=spawn(cli,[...config,'event','websocket','start-server','--ip','127.0.0.1','--port','8080'],{env,stdio:['ignore','pipe','pipe']});
let output='', closed=false;
server.on('close',()=>{closed=true;});
for (const stream of [server.stdout,server.stderr]) stream.on('data',data=>{output=(output+data.toString()).slice(-16000);});
const timeout=setTimeout(()=>{console.error('FAIL overall timeout'); server.kill('SIGINT'); process.exitCode=1;},25000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const command=async (...args)=>run(cli,[...config,...args],{env,timeout:4000,maxBuffer:16384});
const send=async (text,id,actor='viewer')=>run(injector,[text,id,actor],{env,timeout:4000,maxBuffer:16384});
function safeUrl(raw) {
  const url=new URL(raw);
  if (url.protocol!=='ws:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.port!=='8080' || url.username || url.password) throw new Error('Non-loopback reconnect URL blocked');
  return url.href;
}
function connect(raw) {
  const socket=new WebSocket(safeUrl(raw)), messages=[], waiters=[];
  const closedPromise=new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}));
  let failure;
  socket.addEventListener('message',event=>{let data;try {data=JSON.parse(event.data);} catch {failure=new Error('Invalid mock JSON');return;}
    const waiter=waiters.shift();if(waiter)waiter.resolve(data);else messages.push(data);});
  socket.addEventListener('error',()=>{failure=new Error('WebSocket failure');for(const w of waiters.splice(0))w.reject(failure);});
  const next=()=>new Promise((resolve,reject)=>{
    if(failure)return reject(failure);if(messages.length)return resolve(messages.shift());
    const waiter={resolve:data=>{clearTimeout(timer);resolve(data);},reject};
    const timer=setTimeout(()=>{const index=waiters.indexOf(waiter);if(index>=0)waiters.splice(index,1);reject(new Error('Timed out waiting for mock message'));},4000);
    waiters.push(waiter);
  });
  return {socket,next,closed:closedPromise};
}
async function main() {
  for(let i=0;i<80 && !output.includes('Connect to the WebSocket server at:');i++){if(closed)throw new Error('Mock server exited during startup');await sleep(50);}
  if(!output.includes('Connect to the WebSocket server at:'))throw new Error('Mock server startup timed out');
  await assertRpcLoopback(server.pid);
  let now=0, frame=0;const clock=()=>now, p={x:.5,y:.5,visibility:1};
  const game=new MatrixGame({clock,options:{globalCooldown:0,actorCooldown:0}});game.start();
  const advance=delta=>{now+=delta;game.addFrame({frameId:String(++frame),captureTime:now,nose:p,leftShoulder:p,rightShoulder:p});game.tick();};
  game.addFrame({frameId:'initial',captureTime:0,nose:p,leftShoulder:p,rightShoulder:p});game.tick();
  const adapter=new EventSubAdapter({game,clock});
  let connection=connect('ws://127.0.0.1:8080/ws');
  assert.equal(adapter.ingest(await connection.next()).kind,'welcome');
  await send('!throw 5','message-1');const first=await connection.next();
  assert.equal(adapter.ingest(first).accepted,true);assert.equal(game.attacks[0].cell,5);
  await send('!throw 5','message-1');assert.equal(adapter.ingest(await connection.next()).reason,'DUPLICATE');
  assert.equal(adapter.ingest(first).reason,'DUPLICATE');assert.equal(game.attacks.length,1);
  advance(500);assert.equal(game.results[0].outcome,'HIT');assert.equal(game.hp,85);
  await send('!throw 10','invalid-1');assert.equal(adapter.ingest(await connection.next()).reason,'INVALID_COMMAND');
  for(let cell=1;cell<=9;cell++) {
    await send(`!throw ${cell}`,`matrix-${cell}`);assert.equal(adapter.ingest(await connection.next()).cell,cell);
    advance(500);assert.equal(game.results.at(-1).outcome,cell===5?'HIT':'DODGE');
  }
  console.log('PASS official mock chat delivery, 1–9 commands/collisions, message-ID and envelope replay dedupe');
  await command('event','websocket','close',`--session=${adapter.sessionId}`,'--reason=4006');
  const closeEvent=await Promise.race([connection.closed,sleep(4000).then(()=>{throw new Error('Server close timed out');})]);
  assert.equal(closeEvent.code,4006);adapter.disconnect();assert.equal(game.connection,'OFFLINE');
  connection=connect('ws://127.0.0.1:8080/ws');assert.equal(adapter.ingest(await connection.next()).kind,'welcome');
  await send('!throw 9','message-3','viewer-3');assert.equal(adapter.ingest(await connection.next()).cell,9);
  console.log('PASS server-directed disconnect 4006, new session and delivery');
  await command('event','websocket','reconnect');const notice=await connection.next();
  assert.equal(adapter.ingest(notice).kind,'reconnect');assert.equal(game.connection,'OFFLINE');
  const next=connect(notice.payload.session.reconnect_url);assert.equal(adapter.ingest(await next.next()).kind,'welcome');
  connection.socket.close();connection=next;
  await send('!throw 1','message-2','viewer-2');assert.equal(adapter.ingest(await connection.next()).cell,1);
  await send('!throw 5','message-1');assert.equal(adapter.ingest(await connection.next()).reason,'DUPLICATE');
  console.log('PASS official mock session_reconnect, local reconnect URL and dedupe after reconnection');
  connection.socket.close();adapter.disconnect();
  console.log('LIMIT no mock subscriptions; metadata-ID replay is in-process because CLI regenerates notification IDs');
}
try {await main();} catch(error) {console.error('FAIL',error.message);process.exitCode=1;} finally {
  clearTimeout(timeout);if(!closed)server.kill('SIGINT');
  for(let i=0;i<40&&!closed;i++)await sleep(50);
  if(!closed){console.error('FAIL mock server did not exit');process.exitCode=1;}
}
