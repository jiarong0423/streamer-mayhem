import test from 'node:test';
import assert from 'node:assert/strict';
import { MockEventSubTransport } from '../dist/mock_eventsub_transport.mjs';
import { EventSubAdapter, syntheticChat } from '../dist/eventsub_adapter.mjs';
import { MatrixGame } from '../dist/matrix.mjs';

const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(fetchOverride) {
  const sockets=[],requests=[],statuses=[];
  class Socket {
    constructor(url){this.url=url;this.listeners={};sockets.push(this);}
    addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}
    emit(type,event={}){for(const handler of this.listeners[type]??[])handler(event);}
    message(message){this.emit('message',{data:JSON.stringify(message)});}
    close(){this.emit('close');}
  }
  const game=new MatrixGame({clock:()=>0,options:{actorCooldown:0,globalCooldown:0}});game.start();
  const point={x:.5,y:.5,visibility:1};game.addFrame({frameId:'1',captureTime:0,nose:point,leftShoulder:point,rightShoulder:point});game.tick();
  const adapter=new EventSubAdapter({game,clock:()=>0});
  const fetchImpl=async (url,options)=>{requests.push({url,options});if(fetchOverride)return fetchOverride(url,options);
    const input=JSON.parse(options.body);return {ok:true,json:async()=>({data:[{id:'sub',status:'enabled',type:input.type,version:'1',transport:{session_id:input.transport.session_id}}]})};};
  const transport=new MockEventSubTransport({adapter,WebSocketClass:Socket,fetchImpl,retryBaseMs:5,retryMaxMs:20,onStatus:(s,d)=>statuses.push([s,d])});
  const welcome=id=>({metadata:{message_type:'session_welcome'},payload:{session:{id,keepalive_timeout_seconds:10}}});
  return {transport,sockets,requests,statuses,game,adapter,welcome};
}

test('default is inactive, start is explicit and stop prevents reconnect',async()=>{
  const f=fixture();assert.equal(f.sockets.length,0);assert.equal(f.transport.start(),true);assert.equal(f.transport.start(),false);
  f.sockets[0].message(f.welcome('first'));await flush();assert.equal(f.transport.status,'ONLINE');
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'http://127.0.0.1:8080/eventsub/subscriptions');
  f.transport.stop();await new Promise(r=>setTimeout(r,30));assert.equal(f.sockets.length,1);assert.equal(f.game.connection,'OFFLINE');
});
test('planned migration preserves subscription and queues messages until new welcome',async()=>{
  const f=fixture();f.transport.start();f.sockets[0].message(f.welcome('first'));await flush();
  f.sockets[0].message({metadata:{message_type:'session_reconnect'},payload:{session:{reconnect_url:'ws://127.0.0.1:8080/ws?reconnect_id=local'}}});
  const chat=syntheticChat({notificationId:'n',messageId:'m',text:'!throw 5'});f.sockets[0].message(chat);
  assert.equal(f.game.attacks.length,0);f.sockets[1].message(f.welcome('second'));await flush();
  assert.equal(f.requests.length,1);assert.equal(f.game.attacks.length,1);assert.equal(f.transport.status,'ONLINE');f.transport.stop();
});
test('unexpected close creates a new session and subscription',async()=>{
  const f=fixture();f.transport.start();f.sockets[0].message(f.welcome('first'));await flush();f.sockets[0].close();
  assert.equal(f.game.connection,'OFFLINE');await new Promise(r=>setTimeout(r,15));
  f.sockets[1].message(f.welcome('second'));await flush();assert.equal(f.requests.length,2);
  assert.equal(JSON.parse(f.requests[1].options.body).transport.session_id,'second');f.transport.stop();
});
test('untrusted reconnect addresses never open, and failure retries only fixed loopback',async()=>{
  const f=fixture();f.transport.start();f.sockets[0].message(f.welcome('first'));await flush();
  f.sockets[0].message({metadata:{message_type:'session_reconnect'},payload:{session:{reconnect_url:'wss://eventsub.wss.twitch.tv/ws'}}});
  assert.equal(f.game.connection,'OFFLINE');assert.equal(f.sockets.length,1);await new Promise(r=>setTimeout(r,15));
  assert.equal(f.sockets[1].url,'ws://127.0.0.1:8080/ws');f.transport.stop();
});
test('failed subscription remains offline and stop cancels retry',async()=>{
  const f=fixture(async()=>({ok:false}));f.transport.start();f.sockets[0].message(f.welcome('first'));await flush();
  assert.equal(f.transport.status,'RETRYING');assert.equal(f.game.connection,'OFFLINE');f.transport.stop();
  await new Promise(r=>setTimeout(r,30));assert.equal(f.sockets.length,1);
});
test('stop while subscription is pending cannot activate the game later',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));f.transport.start();f.sockets[0].message(f.welcome('first'));
  f.transport.stop();finish({ok:true,json:async()=>({data:[{id:'x',status:'enabled',type:'channel.ban',version:'1',transport:{session_id:'first'}}]})});
  await flush();assert.equal(f.transport.status,'STOPPED');assert.equal(f.game.connection,'OFFLINE');
});
test('fetch is called without an invalid receiver as required by browsers',async()=>{
  const f=fixture(function(url,options){
    assert.equal(this,undefined);const input=JSON.parse(options.body);
    return Promise.resolve({ok:true,json:async()=>({data:[{id:'sub',status:'enabled',type:input.type,version:'1',transport:{session_id:input.transport.session_id}}]})});
  });
  f.transport.start();f.sockets[0].message(f.welcome('first'));await flush();assert.equal(f.transport.status,'ONLINE');f.transport.stop();
});
test('revocation stops reconnect and leaves game offline',async()=>{
  const f=fixture();f.transport.start();f.sockets[0].message(f.welcome('first'));await flush();
  f.sockets[0].message({metadata:{message_type:'revocation'},payload:{}});assert.equal(f.transport.status,'STOPPED');
  await new Promise(r=>setTimeout(r,30));assert.equal(f.sockets.length,1);assert.equal(f.game.connection,'OFFLINE');
});
