import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixGame} from '../dist/matrix.mjs';
import {SyntheticFrameSource} from '../dist/frame_source.mjs';
import {createCameraGeometry,projectCameraFrame} from '../dist/camera_geometry.mjs';

const pose=()=>({nose:{x:.5,y:.2,visibility:1},leftShoulder:{x:.42,y:.4,visibility:1},rightShoulder:{x:.58,y:.4,visibility:1},leftElbow:{x:.4,y:.65,visibility:1},rightElbow:{x:.6,y:.65,visibility:1}});
function setup(options={}){
  let now=0,id=0,lastPose=pose();const events=[];
  const game=new MatrixGame({clock:()=>now,onEvent:event=>events.push(event),options});
  game.setConnection(true);game.start();
  const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
  const source=new SyntheticFrameSource({game,clock:()=>now,project:frame=>projectCameraFrame(frame,geometry)});
  game.beforeTick=()=>source.sync();
  const capture=(at,points=lastPose)=>{now=at;lastPose=structuredClone(points);assert.equal(source.capture(points),true);return game.tick();};
  const advance=(at,points=lastPose)=>{while(now+100<at)capture(now+100,lastPose);return capture(at,points);};
  const event=(patch={})=>{const n=++id;return {notificationId:`n-${n}`,messageId:`m-${n}`,actorId:`a-${n}`,receivedAt:now,...patch};};
  capture(0);
  return {game,source,events,capture,advance,event,at:t=>{now=t;},now:()=>now,freeze:patch=>game.receiveSyntheticFreeze(event(patch))};
}

test('real capture/projector/game runs all five joints, exact phases and one success award',()=>{
  const s=setup();assert.equal(s.freeze().accepted,true);
  s.advance(1499);assert.equal(s.game.snapshot().freeze.remainingMs,1);s.advance(1500);
  const snap=s.game.snapshot();assert.equal(snap.freeze.phase,'RED');
  const expected=Object.fromEntries(Object.keys(pose()).map(name=>[name,{...s.game.latestFrame[name]}]));
  assert.deepEqual(snap.freeze.anchor,expected);
  snap.freeze.anchor.leftElbow.x=0;snap.freeze.pose.rightElbow.visibility=0;snap.freeze.box.left=0;
  assert.deepEqual(s.game.snapshot().freeze.anchor,expected);assert.equal(s.game.snapshot().freeze.box.left,.35);
  s.advance(3999);assert.equal(s.game.results.length,0);s.advance(4000);
  assert.equal(s.game.hp,100);assert.equal(s.game.score,100);assert.equal(s.game.results.length,1);
  assert.equal(s.game.results[0].kind,'FREEZE');assert.equal(s.game.results[0].outcome,'DODGE');
  s.at(4001);s.game.tick();s.game.snapshot();assert.equal(s.game.results.length,1);
  assert.equal(s.events.filter(e=>e.type==='result').length,1);
});

test('actual game admission between captures cannot borrow pre-event yellow evidence',()=>{
  const s=setup();s.at(100);assert.equal(s.freeze().accepted,true);
  s.capture(200);s.advance(1500);assert.equal(s.game.snapshot().freeze.phase,'YELLOW');
  assert.equal(s.game.snapshot().freeze.remainingMs,200);s.advance(1700);assert.equal(s.game.snapshot().freeze.phase,'RED');
});

test('each required joint can become UNKNOWN without damage and with full recovery preparation',()=>{
  for(const name of Object.keys(pose())){
    const s=setup();s.freeze();const missing=pose();missing[name]=null;s.capture(100,missing);
    assert.equal(s.game.snapshot().freeze.status,'UNKNOWN');assert.equal(s.game.results.length,0);assert.equal(s.game.hp,100);
    s.capture(200,pose());assert.equal(s.game.snapshot().freeze.recoveryRemaining,1000);
    s.advance(1200);assert.equal(s.game.snapshot().freeze.recoveryRemaining,0);assert.equal(s.game.snapshot().freeze.remainingMs,1500);
    s.capture(1300);assert.equal(s.game.snapshot().freeze.remainingMs,1400);
  }
});

test('loss at yellow boundary wins over anchor capture including explicit landmark loss',()=>{
  for(const explicit of [false,true]){
    const s=setup();s.freeze();s.advance(1499);s.at(1500);
    if(explicit){assert.equal(s.source.capture(pose()),true);s.game.loseLandmarks();}
    else {const p=pose();p.leftElbow.visibility=.1;s.capture(1500,p);}
    assert.equal(s.game.snapshot().freeze.phase,'YELLOW');assert.equal(s.game.snapshot().freeze.anchor,null);
    assert.equal(s.game.snapshot().freeze.status,'UNKNOWN');assert.equal(s.game.results.length,0);
  }
});

test('distinct150ms bad evidence wins at hold end and a shorter final transient may succeed',()=>{
  for(const [badAt,outcome,hp,score] of [[3850,'HIT',88,0],[3900,'DODGE',100,100]]){
    const s=setup();s.freeze();s.advance(1500);const bad=pose();bad.rightElbow.x=.2;
    s.advance(badAt,bad);s.advance(4000,bad);
    assert.equal(s.game.results[0].outcome,outcome);assert.equal(s.game.hp,hp);assert.equal(s.game.score,score);
    s.at(4001);s.game.tick();assert.equal(s.game.results.length,1);
  }
});

test('duplicate render does not advance warning or stability evidence',()=>{
  const s=setup();s.freeze();s.at(200);s.game.tick();assert.equal(s.game.snapshot().freeze.remainingMs,1500);
  s.capture(200);s.advance(1500);const bad=pose();bad.nose.x=.2;s.advance(1600,bad);
  s.at(1750);s.game.tick();assert.equal(s.game.results.length,0);s.capture(1750,bad);
  assert.equal(s.game.results[0].outcome,'HIT');assert.equal(s.game.hp,88);
});

test('manual pause preserves red anchor and preparation overlaps global recovery',()=>{
  const s=setup();s.freeze();s.advance(1500);const anchor=s.game.snapshot().freeze.anchor;
  s.at(1550);assert.equal(s.game.pause(),true);s.advance(2000);
  s.at(2050);assert.equal(s.game.resume(),true);s.capture(2100);s.advance(3100);
  assert.equal(s.game.mode,'PLAYING');assert.equal(s.game.snapshot().freeze.recoveryRemaining,0);
  assert.equal(s.game.snapshot().freeze.remainingMs,2500);assert.deepEqual(s.game.snapshot().freeze.anchor,anchor);
  s.advance(3300);assert.equal(s.game.snapshot().freeze.remainingMs,2300);
});

test('source stop, stale, calibration and ROUND_END cancel once UNKNOWN without score or live anchor',()=>{
  for(const reason of ['SOURCE_STOPPED','SOURCE_STALE','CALIBRATION_CHANGED','ROUND_END']){
    const s=setup();s.freeze();s.advance(1500);
    if(reason==='SOURCE_STOPPED'){s.at(1600);s.source.stop();}
    else if(reason==='SOURCE_STALE'){s.at(1751);s.game.tick();}
    else if(reason==='CALIBRATION_CHANGED'){s.at(1600);s.game.invalidateTracking();}
    else {s.game.mode='ROUND_END';s.game.tick();}
    assert.equal(s.game.results.length,1);assert.equal(s.game.results[0].outcome,'UNKNOWN');assert.equal(s.game.results[0].reason,reason);
    assert.equal(s.game.snapshot().freeze.active,false);assert.equal(s.game.snapshot().freeze.anchor,null);
    assert.equal(s.game.hp,100);assert.equal(s.game.score,0);s.game.tick();assert.equal(s.game.results.length,1);
  }
});

test('Freeze shares event dedupe across modes and reset without consuming rejected cooldowns',()=>{
  const s=setup({actorCooldown:0,globalCooldown:0,freezeCooldown:0});
  const attack=s.event({text:'!throw 5'});assert.equal(s.game.receiveChat(attack).accepted,true);
  const busy=s.event();assert.equal(s.game.receiveSyntheticFreeze(busy).reason,'MODE_BUSY');
  s.advance(500);assert.equal(s.game.receiveSyntheticFreeze({...busy,receivedAt:500}).reason,'DUPLICATE');
  const start=s.event();assert.equal(s.game.receiveSyntheticFreeze(start).accepted,true);
  assert.equal(s.game.receiveSyntheticCross(s.event()).reason,'MODE_BUSY');
  assert.equal(s.game.receiveChat(s.event({text:'!throw 5'})).reason,'MODE_BUSY');
  s.game.reset();s.game.setConnection(true);s.game.start();s.capture(501);
  assert.equal(s.game.receiveSyntheticFreeze({...start,receivedAt:501}).reason,'DUPLICATE');
  assert.equal(s.freeze().accepted,true);
});

test('default Freeze cooldown uses game time and rejected busy requests do not extend it',()=>{
  const s=setup();s.freeze();s.advance(4000);
  assert.equal(s.freeze().reason,'FREEZE_COOLDOWN');s.advance(7999);assert.equal(s.freeze().reason,'FREEZE_COOLDOWN');
  s.advance(8000);assert.equal(s.freeze().accepted,true);
});

test('ring damage is suppressed in Freeze and dwell restarts after its single settlement',()=>{
  const s=setup({ringTime:100});s.freeze();s.advance(1500);const outside=pose();
  for(const p of Object.values(outside))p.x=.01;
  s.advance(1800,outside);s.advance(1950,outside);assert.equal(s.game.hp,88);assert.equal(s.game.outSince,null);
  s.capture(1951,outside);assert.equal(s.game.hp,88);s.advance(2051,outside);assert.equal(s.game.hp,78);
  assert.equal(s.events.filter(e=>e.type==='ringOut').length,1);
});

test('KO emits one clamped hit and cannot duplicate terminal cancellation',()=>{
  const s=setup({freezeDamage:200});s.freeze();s.advance(1500);const bad=pose();bad.leftElbow.x=.1;
  s.advance(1800,bad);s.advance(1950,bad);assert.equal(s.game.mode,'ROUND_END');assert.equal(s.game.hp,0);
  assert.equal(s.game.results.length,1);assert.equal(s.game.results[0].hpDelta,-100);
  s.game.tick();s.game.cancelPending('ROUND_END',s.now());assert.equal(s.game.results.length,1);
});

test('offline and incomplete pose reject before cooldown and local chat routing remains throw-only',()=>{
  const s=setup();s.game.setConnection(false);assert.equal(s.freeze().reason,'OFFLINE');s.game.setConnection(true);
  const p=pose();delete p.leftElbow;s.capture(1,p);assert.equal(s.freeze().reason,'POSE_UNKNOWN');
  s.capture(2,pose());assert.equal(s.game.receiveChat(s.event({text:'!freeze'})).reason,'INVALID_COMMAND');
  assert.equal(s.freeze().accepted,true);
  for(const patch of [{freezeDamage:-1},{freezeScore:NaN},{freezeCooldown:Infinity},{freeze:{warning:0}}]){
    assert.throws(()=>new MatrixGame({options:patch}),RangeError);
  }
});
