import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixGame} from '../dist/matrix.mjs';
import {SyntheticFrameSource} from '../dist/frame_source.mjs';
import {createCameraGeometry} from '../dist/camera_geometry.mjs';
import {makeOverlayState,readOverlayState} from '../dist/overlay_protocol.mjs';
import {drawArena} from '../dist/arena_draw.mjs';

const p={x:.5,y:.5,visibility:1};
const out={x:.01,y:.5,visibility:1};
const points=(nose=p)=>({nose,leftShoulder:nose,rightShoulder:nose});
const raw=(epoch,sequence,captureTime,nose=p)=>({epoch,sequence,captureTime,...points(nose)});
function setup(options={}){
  let now=0;const events=[];const game=new MatrixGame({clock:()=>now,onEvent:e=>events.push(e),options});
  const source=new SyntheticFrameSource({game,clock:()=>now,maxAge:game.config.maxAge});
  game.beforeTick=()=>source.sync();game.setConnection(true);game.start();
  const at=t=>{now=t;};const capture=(t,nose=p)=>{at(t);const result=source.capture(points(nose));game.tick();return result;};
  const send=(t,id='1')=>{at(t);return game.receiveChat({notificationId:`n${id}`,messageId:`m${id}`,actorId:'viewer',receivedAt:t,text:'!throw 5'});};
  return {game,source,events,at,capture,send};
}

test('a fresh frame arriving before tick cannot conceal a stale source interval or cause ring-out',()=>{
  let now=0;const events=[];const g=new MatrixGame({clock:()=>now,onEvent:e=>events.push(e)});
  const frame=(id,t)=>({frameId:id,captureTime:t,...points(out)});
  g.setConnection(true);g.start();assert.equal(g.addFrame(frame('first',0)),true);g.tick();
  now=1001;assert.equal(g.addFrame(frame('late',1001)),false);assert.equal(g.mode,'TRACKING_LOST');
  assert.equal(g.hp,100);assert.equal(events.filter(e=>e.type==='ringOut').length,0);assert.equal(g.addFrame(frame('same-watermark',1001)),false);
  now=1002;assert.equal(g.addFrame(frame('new',1002)),true);g.tick();assert.equal(g.mode,'RECOVERING');
});

test('source stop cancels a pending attack once; old epoch cannot revive it; fresh recovery is required',()=>{
  const s=setup();assert.equal(s.capture(0),true);assert.equal(s.send(1).accepted,true);const oldEpoch=s.source.epoch;
  s.at(100);assert.equal(s.source.stop(),true);assert.equal(s.source.stop(),false);assert.equal(s.game.mode,'TRACKING_LOST');
  assert.deepEqual(s.game.results.map(x=>[x.outcome,x.reason]),[['UNKNOWN','SOURCE_STOPPED']]);assert.equal(s.game.hp,100);assert.equal(s.game.score,0);
  assert.equal(s.source.accept(raw(oldEpoch,2,100)),false);assert.equal(s.source.start(),true);assert.equal(s.source.accept(raw(oldEpoch,3,100)),false);
  s.at(101);assert.equal(s.source.accept(raw(s.source.epoch,1,101)),true);s.game.tick();assert.equal(s.game.mode,'RECOVERING');
  for(const t of [301,501,701,901,1101])s.capture(t);assert.equal(s.game.mode,'PLAYING');assert.equal(s.game.results.length,1);assert.equal(s.game.hp,100);
});

test('freshness boundary, duplicate and reordered frames do not refresh the source',()=>{
  const s=setup();assert.equal(s.capture(0),true);assert.equal(s.send(1).accepted,true);const epoch=s.source.epoch;
  s.at(249);assert.equal(s.source.accept(raw(epoch,1,249)),false);assert.equal(s.source.accept(raw(epoch,2,0)),false);
  assert.equal(s.source.accept(raw(epoch,2,250)),false); // Future frame.
  s.at(250);assert.equal(s.source.sync(),true);assert.equal(s.game.mode,'PLAYING');
  s.at(251);assert.equal(s.source.sync(),false);assert.equal(s.game.mode,'TRACKING_LOST');
  assert.equal(s.game.results[0].outcome,'UNKNOWN');assert.equal(s.game.hp,100);assert.equal(s.game.score,0);
  assert.equal(s.source.accept(raw(epoch,3,251)),false);s.game.tick();assert.equal(s.game.results.length,1);
});

test('chat admission checks source age before evaluating a pending hit',()=>{
  const s=setup();assert.equal(s.capture(0),true);assert.equal(s.send(0,'1').accepted,true);
  const result=s.send(251,'2');assert.equal(result.accepted,false);assert.equal(result.reason,'NOT_PLAYING');
  assert.equal(s.game.mode,'TRACKING_LOST');assert.deepEqual(s.game.results.map(x=>x.outcome),['UNKNOWN']);
  assert.equal(s.game.hp,100);assert.equal(s.game.score,0);assert.equal(s.events.filter(e=>e.type==='ringOut').length,0);
});

test('a late capture with a new sequence cannot renew freshness or replace the accepted frame',()=>{
  const s=setup();s.capture(0);const epoch=s.source.epoch;s.at(100);
  assert.equal(s.source.accept(raw(epoch,2,-151)),false);assert.equal(s.source.lastCapture,0);assert.equal(s.game.latestFrame.captureTime,0);
  assert.equal(s.source.accept(raw(epoch,2,50)),true);assert.equal(s.source.lastCapture,50);
  s.at(200);assert.equal(s.source.accept(raw(epoch,3,49)),false);assert.equal(s.source.lastCapture,50);
});

test('identical pose with advancing capture time stays fresh; supplied metadata cannot spoof capture',()=>{
  const s=setup();assert.equal(s.capture(0),true);
  for(let t=100;t<=1200;t+=100)assert.equal(s.capture(t),true);
  assert.equal(s.game.mode,'PLAYING');assert.equal(s.game.hp,100);
  s.at(1300);assert.equal(s.source.capture({...points(),epoch:-1,sequence:999999,captureTime:999999}),true);
  assert.equal(s.source.lastCapture,1300);assert.equal(s.source.lastFrame.epoch,s.source.epoch);
});

test('source loss while paused stays paused and does not resume automatically',()=>{
  const s=setup();s.capture(0);s.send(1);s.at(100);assert.equal(s.game.pause(),true);assert.equal(s.source.stop(),true);
  assert.equal(s.game.mode,'PAUSED');assert.equal(s.game.results[0].outcome,'UNKNOWN');s.at(200);s.source.start();s.capture(201);
  assert.equal(s.game.mode,'PAUSED');assert.equal(s.game.resume(),true);assert.equal(s.game.mode,'RECOVERING');
});

test('source interruption during recovery requires a completely new countdown',()=>{
  const s=setup();s.capture(0);s.at(10);s.source.stop();s.at(11);s.source.start();s.capture(12);
  assert.equal(s.game.mode,'RECOVERING');s.capture(200);s.at(300);s.source.stop();assert.equal(s.game.mode,'TRACKING_LOST');
  s.at(301);s.source.start();s.capture(302);assert.equal(s.game.mode,'RECOVERING');
  for(const t of [502,702,902,1102,1301])s.capture(t);assert.equal(s.game.mode,'RECOVERING');
  s.capture(1302);assert.equal(s.game.mode,'PLAYING');
});

test('ordinary landmark loss preserves existing paused-attack semantics while source frames continue',()=>{
  const s=setup();s.capture(0);s.send(1);s.capture(200);s.capture(300,null);assert.equal(s.game.mode,'TRACKING_LOST');assert.equal(s.game.attacks.length,1);
  for(let t=500;t<=1500;t+=200)s.capture(t,null);assert.equal(s.game.results.length,0);
  s.capture(1600);assert.equal(s.game.mode,'RECOVERING');for(const t of [1800,2000,2200,2400,2600,2800,2801])s.capture(t);
  assert.equal(s.game.results[0].outcome,'HIT');assert.equal(s.game.hp,85);
});

test('immediate landmark loss at the same capture time rejects chat while retaining the pending attack',()=>{
  const s=setup();s.capture(0);assert.equal(s.send(0,'1').accepted,true);
  s.game.loseLandmarks();assert.equal(s.game.mode,'TRACKING_LOST');assert.equal(s.game.attacks.length,1);
  assert.equal(s.source.capture(points(null)),false);assert.equal(s.send(0,'2').reason,'NOT_PLAYING');
  for(const t of [100,200,300,400,500])s.capture(t,null);
  assert.equal(s.game.attacks.length,1);assert.equal(s.game.results.length,0);
  for(const t of [600,800,1000,1200,1400,1600,1800,2000,2100])s.capture(t);
  assert.equal(s.game.results.length,1);assert.equal(s.game.results[0].outcome,'HIT');
});

test('loss exactly at impact wins, rejects repeated chat and resolves using a recovered fresh frame',()=>{
  const s=setup();s.capture(0);assert.equal(s.send(0).accepted,true);s.capture(250);s.at(500);
  s.game.loseLandmarks();assert.equal(s.game.mode,'TRACKING_LOST');assert.equal(s.game.gameTime,500);
  assert.equal(s.game.hp,100);assert.equal(s.game.score,0);assert.equal(s.game.attacks.length,1);assert.equal(s.game.results.length,0);
  s.game.loseLandmarks();s.game.tick();assert.equal(s.send(500,'2').reason,'NOT_PLAYING');
  assert.equal(s.game.attacks.length,1);assert.equal(s.game.results.length,0);
  assert.equal(s.capture(500,null),true);
  const other={x:1/6,y:1/6,visibility:1};s.capture(501,other);
  for(const t of [701,901,1101,1301,1501])s.capture(t,other);
  assert.equal(s.game.mode,'PLAYING');assert.equal(s.game.results.length,1);
  assert.equal(s.game.results[0].outcome,'DODGE');assert.equal(s.game.results[0].sampledAt,1501);
  assert.equal(s.game.results[0].sampledFrameId,s.source.lastFrame.frameId);assert.equal(s.game.hp,100);assert.equal(s.game.score,25);
});

test('zero recovery and repeated equal-time ticks cannot settle a loss against an old frame',()=>{
  const s=setup({recovery:0});s.capture(0);s.send(0);s.capture(250);s.at(500);s.game.loseLandmarks();
  for(let i=0;i<3;i++)s.game.tick();assert.equal(s.game.gameTime,500);assert.equal(s.game.results.length,0);
  const other={x:1/6,y:1/6,visibility:1};assert.equal(s.capture(500,other),true);assert.equal(s.game.mode,'RECOVERING');
  s.game.tick();assert.equal(s.game.mode,'PLAYING');assert.equal(s.game.results.length,1);
  assert.equal(s.game.results[0].outcome,'DODGE');assert.equal(s.game.results[0].sampledFrameId,s.source.lastFrame.frameId);
  s.game.tick();assert.equal(s.game.results.length,1);assert.equal(s.game.hp,100);
});

test('loss just before impact freezes it; loss just after preserves the earlier impact',()=>{
  const before=setup();before.capture(0);before.send(0);before.capture(250);before.at(499);before.game.loseLandmarks();
  assert.equal(before.game.gameTime,499);assert.equal(before.game.hp,100);assert.equal(before.game.attacks.length,1);
  before.capture(500);for(const t of [700,900,1100,1300,1500,1501])before.capture(t);
  assert.equal(before.game.results[0].outcome,'HIT');assert.equal(before.game.hp,85);
  const after=setup();after.capture(0);after.send(0);after.capture(250);after.at(501);after.game.loseLandmarks();
  // The age is 251ms here, so use a fresh frame before testing the after boundary below.
  assert.equal(after.game.results[0].outcome,'UNKNOWN');assert.equal(after.game.results[0].reason,'SOURCE_STALE');
  const fresh=setup();fresh.capture(0);fresh.send(0);fresh.capture(250);fresh.capture(300);fresh.at(501);fresh.game.loseLandmarks();
  assert.equal(fresh.game.mode,'TRACKING_LOST');assert.equal(fresh.game.hp,85);assert.equal(fresh.game.attacks.length,0);
  assert.equal(fresh.game.results.length,1);assert.equal(fresh.game.results[0].outcome,'HIT');assert.equal(fresh.game.results[0].sampledAt,500);
});

test('loss at ring-out deadline prevents a ring penalty',()=>{
  const s=setup();s.capture(0,out);for(const t of [200,400,600,800])s.capture(t,out);
  s.at(1000);s.game.loseLandmarks();assert.equal(s.game.mode,'TRACKING_LOST');assert.equal(s.game.hp,100);
  assert.equal(s.events.filter(event=>event.type==='ringOut').length,0);
  s.game.tick();assert.equal(s.game.hp,100);
});

test('projection exception stops the source, cancels attacks and requires a fresh epoch recovery',()=>{
  const s=setup();let fail=false;s.source.project=frame=>{if(fail)throw new Error('PROJECT_FAILED');return frame;};
  s.capture(0);s.send(0);const oldEpoch=s.source.epoch;fail=true;s.at(1);
  assert.equal(s.source.capture(points()),false);assert.equal(s.source.running,false);assert.equal(s.source.lastFrame,null);
  assert.equal(s.game.mode,'TRACKING_LOST');assert.deepEqual(s.game.results.map(r=>[r.outcome,r.reason]),[['UNKNOWN','SOURCE_PROJECT_ERROR']]);
  assert.equal(s.send(1,'2').reason,'NOT_PLAYING');assert.equal(s.source.start(),true);
  assert.equal(s.source.accept(raw(oldEpoch,99,1)),false);fail=false;s.capture(2);assert.equal(s.game.mode,'RECOVERING');
  for(const t of [202,402,602,802,1002])s.capture(t);assert.equal(s.game.mode,'PLAYING');
});

test('reentrant projection fails closed and cannot accept the outer frame',()=>{
  const s=setup();s.capture(0);s.send(0);s.at(1);
  s.source.project=frame=>{s.source.capture(points());return frame;};
  assert.equal(s.source.capture(points()),false);assert.equal(s.source.running,false);assert.equal(s.source.lastFrame,null);
  assert.equal(s.game.mode,'TRACKING_LOST');assert.equal(s.game.results[0].reason,'SOURCE_PROJECT_ERROR');assert.equal(s.game.attacks.length,0);
});

test('non-playing game and overlay states contain no stale marker or attack warning',()=>{
  const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:64,y:396,width:320,height:216},sourceWidth:1280,sourceHeight:720});
  const session='a'.repeat(32);
  for(const mode of ['TRACKING_LOST','RECOVERING','PAUSED','ROUND_END']){
    const snapshot={mode,attacks:[{cell:5}],hp:100,score:0};
    const msg=makeOverlayState({session,sequence:1,geometry,snapshot,sourcePoint:p});assert.deepEqual(msg.snapshot.attacks,[]);assert.equal(msg.sourcePoint,null);
    const received=readOverlayState({...msg,snapshot:{mode,attacks:[{cell:5}]},sourcePoint:p},session,1280,720);
    assert.deepEqual(received.snapshot.attacks,[]);assert.equal(received.sourcePoint,null);
    const calls=[];const ctx={canvas:{width:1280,height:720},createRadialGradient:()=>({addColorStop(){}})};
    for(const fn of ['clearRect','fillRect','save','restore','beginPath','rect','clip','strokeRect','fillText','arc','fill','stroke','moveTo','lineTo','roundRect','ellipse','translate','scale'])ctx[fn]=(...args)=>calls.push({fn,args,fillStyle:ctx.fillStyle});
    const result=drawArena(ctx,snapshot,p,{tracking:true,geometry});assert.equal(result.position,null);
    assert.equal(calls.some(c=>c.fn==='fillRect'&&c.fillStyle==='rgba(250,83,57,.35)'),false);
  }
});
