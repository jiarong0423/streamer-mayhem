import test from 'node:test';
import assert from 'node:assert/strict';
import { MatrixGame } from '../dist/matrix.mjs';
import { IrcAnonymousChat, parseIrcLine, normalizeChannel, IRC_ENDPOINT } from '../dist/irc_anonymous.mjs';

class FakeSocket {
  static instances=[];
  constructor(url){this.url=url;this.sent=[];this.closed=false;FakeSocket.instances.push(this);}
  send(line){this.sent.push(line);}
  close(){this.closed=true;}
  open(){this.onopen?.();}
  push(text){this.onmessage?.({data:text});}
  drop(){this.onclose?.();}
}
function fixture(options={}) {
  FakeSocket.instances=[];
  const time={now:0},statuses=[],timers=[],delivered=[];
  const game=new MatrixGame({clock:()=>time.now});game.start();
  const p={x:.5,y:.5,visibility:1};game.addFrame({frameId:'0',captureTime:0,nose:p,leftShoulder:p,rightShoulder:p});game.tick();
  const chat=new IrcAnonymousChat({game,channel:'#SomeChannel',WebSocketClass:FakeSocket,clock:()=>time.now,
    onStatus:(s,d)=>statuses.push(d?`${s}:${d}`:s),onDelivery:d=>delivered.push(d),random:()=>0,
    setTimer:(fn,ms)=>{const t={fn,ms,cleared:false};timers.push(t);return t;},clearTimer:t=>{if(t)t.cleared=true;},...options});
  return {time,game,chat,statuses,timers,delivered,socket:()=>FakeSocket.instances.at(-1)};
}
const roomstate='@room-id=123;emote-only=0 :tmi.twitch.tv ROOMSTATE #somechannel\r\n';
const privmsg=(id='11111111-aaaa',user='456',text='!throw 5',room='123')=>`@id=${id};room-id=${room};user-id=${user} :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #somechannel :${text}\r\n`;

test('channel names are normalized and invalid ones rejected',()=>{
  assert.equal(normalizeChannel('#SomeChannel'),'somechannel');
  for(const bad of ['','a b','x'.repeat(26),'a;b','#'])assert.throws(()=>normalizeChannel(bad),/INVALID_CHANNEL/);
});
test('parser handles tags, prefix, trailing text and rejects junk',()=>{
  const m=parseIrcLine('@id=a\\sb;room-id=9 :n!n@n PRIVMSG #c :hello world');
  assert.equal(m.command,'PRIVMSG');assert.equal(m.tags.id,'a b');assert.equal(m.trailing,'hello world');assert.deepEqual(m.params,['#c']);
  assert.equal(parseIrcLine(''),null);assert.equal(parseIrcLine('x'.repeat(9000)),null);assert.equal(parseIrcLine('@only-tags'),null);
});
test('connects anonymously: no token, justinfan nick, joins the channel',()=>{
  const f=fixture();assert.equal(f.chat.start(),true);
  assert.equal(f.socket().url,IRC_ENDPOINT);f.socket().open();
  const sent=f.socket().sent.join('\n');
  assert.match(sent,/NICK justinfan\d+/);assert.match(sent,/JOIN #somechannel/);assert.doesNotMatch(sent,/oauth:/i);
  assert.equal(f.chat.start(),false);
});
test('a real chat line becomes one attack only after the room is joined',()=>{
  const f=fixture();f.chat.start();f.socket().open();
  f.socket().push(privmsg());assert.equal(f.game.attacks.length,0);
  f.socket().push(roomstate);assert.equal(f.chat.status,'ONLINE');assert.equal(f.game.connection,'ONLINE');
  f.socket().push(privmsg());assert.equal(f.game.attacks.length,1);assert.equal(f.game.attacks[0].cell,5);
});
test('duplicate message IDs, other rooms, actions and bad tags are ignored',()=>{
  const f=fixture();f.chat.start();f.socket().open();f.socket().push(roomstate);
  f.socket().push(privmsg());f.socket().push(privmsg());
  f.socket().push(privmsg('id-2','456','!throw 4','999'));
  f.socket().push(privmsg('id-3','456','\u0001ACTION !throw 3\u0001'));
  f.socket().push(privmsg('id-4','not-a-number','!throw 2'));
  f.socket().push('@room-id=123 :v!v@v PRIVMSG #somechannel :!throw 1\r\n');
  assert.equal(f.game.attacks.length,1);
});
test('lines split across frames are reassembled',()=>{
  const f=fixture();f.chat.start();f.socket().open();f.socket().push(roomstate);
  const line=privmsg();f.socket().push(line.slice(0,20));f.socket().push(line.slice(20));assert.equal(f.game.attacks.length,1);
});
test('an oversized unterminated buffer is dropped and later lines still work',()=>{
  const f=fixture();f.chat.start();f.socket().open();f.socket().push(roomstate);
  f.socket().push('x'.repeat(8192*16+1));f.socket().push(privmsg('id-9','789','!throw 6'));assert.equal(f.game.attacks.length,1);
});
test('PING is answered and RECONNECT opens a fresh socket',()=>{
  const f=fixture();f.chat.start();f.socket().open();f.socket().push('PING :tmi.twitch.tv\r\n');
  assert.ok(f.socket().sent.includes('PONG :tmi.twitch.tv'));
  const first=f.socket();f.socket().push(':tmi.twitch.tv RECONNECT\r\n');
  assert.equal(first.closed,true);assert.equal(FakeSocket.instances.length,2);
});
test('connection loss goes offline, retries with backoff, then stops after the limit',()=>{
  const f=fixture({maxRetries:2});f.chat.start();f.socket().open();f.socket().push(roomstate);
  const retry=()=>f.timers.filter(t=>!t.cleared&&t.ms!==10000&&t.ms!==360000);
  f.socket().drop();assert.equal(f.game.connection,'OFFLINE');assert.equal(f.chat.status,'RETRYING');assert.equal(retry()[0].ms,1000);
  retry()[0].fn();assert.equal(FakeSocket.instances.length,2);f.socket().drop();assert.equal(retry().at(-1).ms,2000);
  retry().at(-1).fn();f.socket().drop();assert.equal(f.chat.status,'STOPPED');assert.match(f.statuses.at(-1),/STOPPED:CONNECTION_LO/);
});
test('retries never give up by default and the delay stays capped (RT3 I4)',()=>{
  const f=fixture();f.chat.start();
  for(let i=0;i<30;i++){f.socket().drop();const t=f.timers.filter(x=>!x.cleared&&x.ms!==10000&&x.ms!==360000).at(-1);assert.ok(t.ms<=15000);t.cleared=true;t.fn();}
  assert.equal(f.chat.status,'RETRYING'.length?f.chat.status:'');assert.notEqual(f.chat.status,'STOPPED');
});
test('no ROOMSTATE within the join timeout reconnects (RT3 I3)',()=>{
  const f=fixture();f.chat.start();f.socket().open();const first=f.socket();
  const join=f.timers.find(t=>t.ms===10000&&!t.cleared);join.fn();
  assert.equal(first.closed,true);assert.equal(f.chat.status,'RETRYING');assert.match(f.statuses.at(-1),/JOIN_TIMEOUT/);
});
test('a silent but open socket is replaced after the idle limit, and any line resets it (RT3 I2)',()=>{
  const f=fixture();f.chat.start();f.socket().open();f.socket().push(roomstate);
  const idle1=f.timers.filter(t=>t.ms===360000&&!t.cleared).at(-1);
  f.socket().push(':tmi.twitch.tv PING\r\n');assert.equal(idle1.cleared,true);
  const idle2=f.timers.filter(t=>t.ms===360000&&!t.cleared).at(-1);const first=f.socket();idle2.fn();
  assert.equal(first.closed,true);assert.equal(f.chat.status,'RETRYING');assert.match(f.statuses.at(-1),/IDLE_TIMEOUT/);
});
test('stop closes the socket and leaves the game offline',()=>{
  const f=fixture();f.chat.start();f.socket().open();f.socket().push(roomstate);
  const socket=f.socket();f.chat.stop();assert.equal(socket.closed,true);assert.equal(f.chat.status,'STOPPED');assert.equal(f.game.connection,'OFFLINE');
  socket.push(privmsg('late'));assert.equal(f.game.attacks.length,0);
});

test('timers are called without the chat object as this (browser setTimeout throws Illegal invocation otherwise)',()=>{
  const seen=[];
  const strict=function(fn,ms){seen.push(this);return {fn,ms};};
  const {chat}=fixture({setTimer:strict,clearTimer:function(){seen.push(this);}});
  chat.start();chat.stop();
  assert.ok(seen.length>=2);
  assert.ok(seen.every(t=>t===undefined),'timer functions must not receive the chat instance as this');
});
