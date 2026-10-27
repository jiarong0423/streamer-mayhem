import test from 'node:test';
import assert from 'node:assert/strict';
import { MatrixGame } from '../dist/matrix.mjs';
import { EventSubAdapter, syntheticWelcome, syntheticChat } from '../dist/eventsub_adapter.mjs';

function fixture() {
  const time={now:0}, statuses=[], delivered=[];
  const game=new MatrixGame({clock:()=>time.now});game.start();
  const p={x:.5,y:.5,visibility:1};game.addFrame({frameId:'0',captureTime:0,nose:p,leftShoulder:p,rightShoulder:p});game.tick();
  const adapter=new EventSubAdapter({game,clock:()=>time.now,onStatus:s=>statuses.push(s),onDelivery:d=>delivered.push(d)});
  return {time,game,adapter,statuses,delivered};
}
const chat=(n='n1',m='m1',actor='u1',text='!throw 5')=>syntheticChat({notificationId:n,messageId:m,actorId:actor,text});

test('welcome and chat normalize into a real synthetic attack',()=>{
  const f=fixture();assert.equal(f.adapter.ingest(syntheticWelcome()).kind,'welcome');
  assert.equal(f.adapter.ingest(chat()).accepted,true);assert.equal(f.game.attacks[0].cell,5);assert.equal(f.delivered.length,1);
});
test('same notification or message ID is accepted at most once',()=>{
  const f=fixture();f.adapter.ingest(syntheticWelcome());assert.equal(f.adapter.ingest(chat()).accepted,true);
  assert.equal(f.adapter.ingest(chat()).reason,'DUPLICATE');
  assert.equal(f.adapter.ingest(chat('n2','m1')).reason,'DUPLICATE');
  assert.equal(f.adapter.ingest(chat('n1','m2')).reason,'DUPLICATE');assert.equal(f.game.attacks.length,1);
});
test('offline, reconnect, welcome, revocation and keepalive are explicit simulations',()=>{
  const f=fixture();assert.equal(f.adapter.ingest(chat()).reason,'OFFLINE');f.adapter.ingest(syntheticWelcome());
  assert.equal(f.adapter.ingest({metadata:{message_type:'session_keepalive'},payload:{}}).kind,'keepalive');
  f.adapter.ingest({metadata:{message_type:'session_reconnect'},payload:{}});assert.equal(f.game.connection,'OFFLINE');
  assert.equal(f.adapter.ingest(chat()).reason,'OFFLINE');f.adapter.ingest(syntheticWelcome());
  assert.equal(f.adapter.ingest(chat()).accepted,true);f.adapter.ingest({metadata:{message_type:'revocation'},payload:{}});
  assert.equal(f.adapter.status,'SIMULATED_REVOKED');assert.equal(f.game.connection,'OFFLINE');
});
test('malformed, oversized, unsupported and mismatched envelopes fail closed',()=>{
  const f=fixture();f.adapter.ingest(syntheticWelcome());
  assert.equal(f.adapter.ingest('{').reason,'INVALID_JSON');assert.equal(f.adapter.ingest('x'.repeat(32769)).reason,'MESSAGE_TOO_LARGE');
  assert.equal(f.adapter.ingest(null).reason,'INVALID_ENVELOPE');
  const bad=chat();bad.payload.subscription.type='channel.cheer';assert.equal(f.adapter.ingest(bad).reason,'UNSUPPORTED_SUBSCRIPTION');
  const mismatch=chat();mismatch.metadata.subscription_type='channel.cheer';assert.equal(f.adapter.ingest(mismatch).reason,'SUBSCRIPTION_MISMATCH');
  const wrongChannel=chat();wrongChannel.payload.event.broadcaster_user_id='some-other-channel';assert.equal(f.adapter.ingest(wrongChannel).reason,'WRONG_CHANNEL');
  const missing=chat();delete missing.payload.event.message_id;assert.equal(f.adapter.ingest(missing).reason,'INVALID_EVENT');
  assert.equal(f.game.attacks.length,0);
});
test('a replayed EventSub message stays deduplicated after a round reset',()=>{
  const f=fixture();f.adapter.ingest(syntheticWelcome());assert.equal(f.adapter.ingest(chat()).accepted,true);
  f.time.now=1;f.game.reset();f.game.start();f.adapter.ingest(syntheticWelcome());
  const p={x:.5,y:.5,visibility:1};f.game.addFrame({frameId:'reset',captureTime:1,nose:p,leftShoulder:p,rightShoulder:p});f.game.tick();
  assert.equal(f.adapter.ingest(chat()).reason,'DUPLICATE');assert.equal(f.game.attacks.length,0);
});
test('rejects commands without throwing or interpreting markup',()=>{
  const f=fixture();f.adapter.ingest(syntheticWelcome());assert.equal(f.adapter.ingest(chat('n','m','u','<script>')).reason,'INVALID_COMMAND');
  assert.equal(f.game.attacks.length,0);f.adapter.disconnect();assert.equal(f.adapter.status,'OFFLINE');
});
