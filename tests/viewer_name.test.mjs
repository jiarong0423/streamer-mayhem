import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanViewerName,syntheticChat,EventSubAdapter,syntheticWelcome} from '../dist/eventsub_adapter.mjs';
import {makeOverlayState,readOverlayState} from '../dist/overlay_protocol.mjs';
import {MatrixGame} from '../dist/matrix.mjs';

test('VIEWER-01 display names lose control, zero-width and tag characters and are cut to 20',()=>{
  assert.equal(cleanViewerName('Alice'),'Alice');
  assert.equal(cleanViewerName('Bo​b\u0007\u{e0041}'),'Bob');
  assert.equal(cleanViewerName('x'.repeat(40)).length,20);
  assert.equal(cleanViewerName('\u{1F600}'.repeat(30)).length,40,'20 emoji, each two UTF-16 units');
  assert.equal(cleanViewerName(undefined),'');assert.equal(cleanViewerName(42),'');
});
test('VIEWER-02 the adapter hands the cleaned name to the delivery callback, and a drop is still a DROP',()=>{
  const out=[];const game=new MatrixGame({clock:()=>0});game.start();
  const p={x:.5,y:.5,visibility:1};game.addFrame({frameId:'0',captureTime:0,nose:p,leftShoulder:p,rightShoulder:p});game.tick();
  const a=new EventSubAdapter({game,clock:()=>0,broadcasterId:'synthetic-channel',onDelivery:d=>out.push(d)});
  a.ingest(syntheticWelcome());game.setConnection(true);
  const r=a.ingest(syntheticChat({notificationId:'n1',messageId:'m1',actorId:'7',chatterName:'Zed​',text:'!drop 2'}));
  assert.equal(r.viewer,'Zed');assert.equal(out[0].kind,'DROP');
});
test('VIEWER-03 the overlay protocol carries a clean viewer name and rejects a bad one',()=>{
  const session='a'.repeat(32),snap={mode:'PLAYING',attacks:[],score:10,hp:90};
  const ok=makeOverlayState({session,sequence:1,geometry:null,snapshot:{...snap,viewer:'Zed'},sourcePoint:null});
  assert.equal(ok.snapshot.viewer,'Zed');
  assert.throws(()=>makeOverlayState({session,sequence:2,geometry:null,snapshot:{...snap,viewer:'x'.repeat(21)},sourcePoint:null}),/INVALID_OVERLAY_STATE/);
  assert.throws(()=>makeOverlayState({session,sequence:3,geometry:null,snapshot:{...snap,viewer:'a\nb'},sourcePoint:null}),/INVALID_OVERLAY_STATE/);
  const none=makeOverlayState({session,sequence:4,geometry:null,snapshot:snap,sourcePoint:null});
  assert.equal('viewer' in none.snapshot,false);
});
