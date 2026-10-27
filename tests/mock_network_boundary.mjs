// Probe only this machine's loopback and its own en0 address; send no payload.
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';
import {assertRpcLoopback} from './mock_guard.mjs';

const cli=process.env.TWITCH_CLI;if(!cli)throw new Error('TWITCH_CLI required');
const profile='(version 1) (allow default) (deny network*) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:*"))';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('TWITCH_')));
env.CI='true';env.TWITCH_DISABLE_UPDATE_CHECKS='true';
const child=spawn('sandbox-exec',['-p',profile,cli,'--config','/private/tmp/streamer-mayhem-missing-config.env','event','websocket','start-server','--ip','127.0.0.1','--port','8080'],{env,stdio:['ignore','pipe','pipe']});
let ready=false,closed=false;child.on('close',()=>{closed=true;});
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{if(data.toString().includes('Connect to the WebSocket server at:'))ready=true;});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const probe=host=>new Promise(resolve=>{const socket=net.connect({host,port:44747});socket.setTimeout(1500);
  socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false);});});
try {
  for(let i=0;i<120&&!ready&&!closed;i++)await sleep(25);
  if(!ready)throw new Error('server startup failed');await assertRpcLoopback(child.pid);
  if(!await probe('127.0.0.1'))throw new Error('loopback RPC unavailable');
  let ip='';try{ip=execFileSync('/usr/sbin/ipconfig',['getifaddr','en0'],{encoding:'utf8',timeout:2000}).trim();}catch{}
  if(net.isIP(ip) && !ip.startsWith('127.')) {
    if(await probe(ip))throw new Error('RPC reachable on non-loopback self-address');
    console.log('PASS RPC loopback reachable; non-loopback self-address blocked');
  } else console.log('PASS RPC listener is loopback; non-loopback self-address probe SKIPPED (no en0 address)');
} catch(error){console.error('FAIL',error.message);process.exitCode=1;} finally {
  if(!closed)child.kill('SIGINT');for(let i=0;i<80&&!closed;i++)await sleep(25);
  if(!closed){console.error('FAIL mock server did not exit');process.exitCode=1;}
}
