import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixGame} from '../dist/matrix.mjs';
import {ActionGames} from '../dist/action_games.mjs';
import {SyntheticFrameSource} from '../dist/frame_source.mjs';
import {createCameraGeometry,projectCameraFrame} from '../dist/camera_geometry.mjs';
import {makeOverlayState,readOverlayState} from '../dist/overlay_protocol.mjs';

const point=(x,y)=>({x,y,visibility:1});
const pose=()=>({nose:point(.5,.3),leftShoulder:point(.44,.4),rightShoulder:point(.56,.4),leftElbow:point(.4,.5),rightElbow:point(.6,.5),leftWrist:point(.1,.8),rightWrist:point(.9,.8),leftHip:point(.47,.4),rightHip:point(.53,.4)});
const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
function setup(options={}){
  let now=0,id=0,last=pose();const events=[];
  const game=new MatrixGame({clock:()=>now,onEvent:e=>events.push(e),options});game.setConnection(true);game.start();
  const source=new SyntheticFrameSource({game,clock:()=>now,project:f=>projectCameraFrame(f,geometry)});game.beforeTick=()=>source.sync();
  const sample=(at,p=last)=>{now=at;last=structuredClone(p);assert.equal(source.capture(p),true);return game.tick();};
  const advance=(at,p=last)=>{while(now+100<at)sample(now+100,last);return sample(at,p);};
  const event=(patch={})=>{const n=++id;return {notificationId:`n-${n}`,messageId:`m-${n}`,actorId:`actor-${n}`,receivedAt:now,...patch};};
  sample(0);return {game,source,events,sample,advance,event,at:t=>{now=t;},mosquito:()=>game.receiveSyntheticMosquito(event()),lava:level=>game.receiveSyntheticLava(event(),{level})};
}

test('wrists and hips follow real source/projector/engine copies and absent fields stay absent',()=>{
  const s=setup(),p=pose();s.sample(1,p);
  for(const name of ['leftWrist','rightWrist','leftHip','rightHip']){
    assert.ok(Math.abs(s.game.latestFrame[name].x-p[name].x)<1e-12);p[name].x=0;
    assert.notEqual(s.game.latestFrame[name].x,0);
  }
  const missing=pose();for(const name of ['leftWrist','rightWrist','leftHip','rightHip'])delete missing[name];
  s.sample(2,missing);for(const name of ['leftWrist','rightWrist','leftHip','rightHip'])assert.equal(Object.hasOwn(s.game.latestFrame,name),false);
  assert.equal(s.mosquito().reason,'POSE_UNKNOWN');assert.equal(s.lava().reason,'POSE_UNKNOWN');
  s.sample(3,pose());assert.equal(s.mosquito().accepted,true);
});

test('mosquito flight is seeded, bounded, capture-driven and cannot be moved by render repeats',()=>{
  const a=setup(),b=setup();a.mosquito();b.mosquito();
  a.at(100);a.game.tick();assert.deepEqual(a.game.snapshot().actionGame.mosquito,{x:.5,y:.35});
  for(let at=100;at<=9000;at+=100){
    a.sample(at);b.sample(at);const x=a.game.snapshot().actionGame;
    assert.deepEqual(x,b.game.snapshot().actionGame);assert.ok(x.mosquito.x>=36/1280&&x.mosquito.x<=1244/1280);assert.ok(x.mosquito.y>=44/720&&x.mosquito.y<=676/720);
  }
});

test('fast distinct wrist swat awards50 once while stationary overlap cannot claim a hit',()=>{
  const s=setup();s.mosquito();const p=pose();p.leftWrist=point(.5,.35);s.sample(100,p);
  assert.equal(s.game.results[0].outcome,'DODGE');assert.equal(s.game.results[0].reason,'SWAT');assert.equal(s.game.score,50);assert.equal(s.game.hp,100);
  s.at(101);s.game.tick();assert.equal(s.game.results.length,1);
  const still=setup();const stationary=pose();stationary.leftWrist=point(.5,.35);still.sample(1,stationary);still.mosquito();still.sample(101,stationary);
  assert.equal(still.game.results.length,0);assert.equal(still.game.score,0);
});

test('two-wrist closing crossing can clap without meeting single-hand velocity threshold',()=>{
  const s=setup();const wide=pose();wide.leftWrist=point(.4,.35);wide.rightWrist=point(.6,.35);s.sample(1,wide);s.mosquito();
  const closed=pose();closed.leftWrist=point(.485,.35);closed.rightWrist=point(.515,.35);s.at(201);
  assert.equal(s.source.capture(closed),true);s.game.tick();assert.equal(s.game.results[0].reason,'CLAP');assert.equal(s.game.score,50);
});

test('mosquito timeout damages once; missing hand confidence is UNKNOWN and cannot slap',()=>{
  const timeout=setup();timeout.mosquito();timeout.advance(10000);assert.equal(timeout.game.hp,95);assert.equal(timeout.game.results[0].reason,'MOSQUITO_TIMEOUT');
  timeout.at(10001);timeout.game.tick();assert.equal(timeout.game.hp,95);assert.equal(timeout.game.results.length,1);
  const s=setup();s.mosquito();const lost=pose();lost.leftWrist.visibility=.1;lost.rightWrist=null;s.sample(100,lost);
  assert.equal(s.game.snapshot().actionGame.status,'UNKNOWN');assert.equal(s.game.snapshot().actionGame.mosquito,null);
  s.sample(200,pose());s.advance(1200);assert.equal(s.game.snapshot().actionGame.remainingMs,10000);assert.equal(s.game.snapshot().actionGame.recoveryRemaining,0);
  s.sample(1300);assert.equal(s.game.snapshot().actionGame.remainingMs,9900);assert.equal(s.game.results.length,0);
});

test('Lava uses leftHip and distinct continuous evidence for repeated burns, without double final damage',()=>{
  const s=setup();const low=pose();low.leftHip.y=.99;s.sample(1,low);s.lava();s.advance(1001,low);
  assert.equal(s.game.hp,95);assert.equal(s.events.filter(e=>e.type==='lavaBurn').length,1);
  s.at(1002);s.game.tick();assert.equal(s.game.hp,95);s.advance(2001,low);assert.equal(s.game.hp,90);
  const high=pose();high.leftHip.y=.1;s.sample(2101,high);s.advance(8001,high);
  assert.equal(s.game.hp,90);assert.equal(s.game.score,0);assert.equal(s.game.results.length,1);assert.equal(s.game.results[0].kind,'LAVA');assert.equal(s.game.results[0].burns,2);assert.equal(s.game.results[0].hpDelta,0);
});

test('Lava rising threshold does not credit an interval that began above the surface',()=>{
  const s=setup();const p=pose();p.leftHip.y=.9;s.sample(1,p);s.lava();s.advance(1001,p);
  assert.equal(s.game.hp,100);s.sample(1101,p);assert.equal(s.game.hp,95);
});

test('Lava target raises through shared event gates, caps at.8 and clear completion awards75 once',()=>{
  const s=setup({actorCooldown:0,globalCooldown:0});const high=pose();high.leftHip.y=.1;s.sample(1,high);assert.equal(s.lava(.45).accepted,true);
  for(let i=0;i<4;i++)assert.equal(s.lava().accepted,true);
  assert.equal(s.game.snapshot().actionGame.targetLevel,.8);assert.equal(s.lava().reason,'POSE_UNKNOWN');
  s.advance(8001,high);assert.equal(s.game.hp,100);assert.equal(s.game.score,75);assert.equal(s.game.results[0].outcome,'DODGE');
});

test('Lava UNKNOWN clears dwell, recovery cannot backfill it, and KO cancels only once',()=>{
  const s=setup();const low=pose();low.leftHip.y=.99;s.sample(1,low);s.lava();s.advance(901,low);
  const lost=pose();lost.leftHip=null;s.sample(1001,lost);assert.equal(s.game.snapshot().actionGame.status,'UNKNOWN');
  s.sample(1101,low);s.advance(2101,low);assert.equal(s.game.hp,100);s.advance(3001,low);assert.equal(s.game.hp,100);s.sample(3101,low);assert.equal(s.game.hp,95);
  const ko=setup();ko.game.hp=5;ko.sample(1,low);ko.lava();ko.advance(1001,low);
  assert.equal(ko.game.hp,0);assert.equal(ko.game.mode,'ROUND_END');assert.equal(ko.game.results.length,1);assert.equal(ko.game.results[0].outcome,'UNKNOWN');assert.equal(ko.game.score,0);
  ko.game.tick();assert.equal(ko.game.results.length,1);
});

test('all challenge modes exclude projectiles and each other, IDs survive reset',()=>{
  for(const kind of ['MOSQUITO','LAVA']){
    const s=setup();const e=s.event();assert.equal((kind==='LAVA'?s.game.receiveSyntheticLava(e):s.game.receiveSyntheticMosquito(e)).accepted,true);
    assert.equal(s.game.receiveSyntheticFreeze(s.event()).reason,'MODE_BUSY');
    assert.equal(s.game.receiveSyntheticCross(s.event()).reason,'MODE_BUSY');
    assert.equal(s.game.receiveChat(s.event({text:'!throw 5'})).reason,'MODE_BUSY');
    s.game.reset();s.game.setConnection(true);s.game.start();s.sample(1);
    assert.equal(s.game.receiveSyntheticMosquito({...e,receivedAt:1}).reason,'DUPLICATE');
  }
});

test('action pause/resume/source lifecycle cannot preserve old motion or award on stale frames',()=>{
  for(const kind of ['MOSQUITO','LAVA']){
    const s=setup();(kind==='LAVA'?s.lava:s.mosquito)();s.advance(200);s.at(250);s.game.pause();s.advance(600);
    s.at(650);s.game.resume();s.sample(700);s.advance(1700);assert.equal(s.game.snapshot().actionGame.remainingMs,kind==='LAVA'?7800:9800);
    s.at(1750);s.source.stop();assert.equal(s.game.results.length,1);assert.equal(s.game.results[0].outcome,'UNKNOWN');assert.equal(s.game.hp,100);assert.equal(s.game.score,0);
  }
});

test('action admission and UNKNOWN floors reject fresh but delayed captures',()=>{
  const game=new ActionGames();let id=0;const frame=(at,p=pose())=>({frameId:`delay-${++id}`,captureTime:at,...p});
  game.start({kind:'LAVA',eventId:'late',now:100,frame:frame(0)});game.update({now:200,frame:frame(200),mode:'PLAYING'});assert.equal(game.snapshot().remainingMs,8000);
  const lost=pose();lost.leftHip=null;game.update({now:400,frame:frame(300,lost),mode:'PLAYING'});
  game.update({now:450,frame:frame(350),mode:'PLAYING'});game.update({now:500,frame:frame(500),mode:'PLAYING'});assert.equal(game.snapshot().recoveryRemaining,1000);
  for(let at=700;at<=1500;at+=200)game.update({now:at,frame:frame(at),mode:'PLAYING'});
  assert.equal(game.snapshot().remainingMs,8000);assert.equal(game.snapshot().recoveryRemaining,0);
});

test('v3 roundtrip includes bounded challenge render state without private fields and hides unknown pose',()=>{
  for(const kind of ['MOSQUITO','LAVA','FREEZE']){
    const s=setup();if(kind==='FREEZE')s.game.receiveSyntheticFreeze(s.event());else (kind==='LAVA'?s.lava:s.mosquito)();
    const snapshot=s.game.snapshot();snapshot.privateField='private-test-value';
    const message=makeOverlayState({session:'a'.repeat(32),sequence:1,geometry,snapshot,sourcePoint:point(.5,.3)});
    assert.equal(message.type,'synthetic-state-v3');assert.equal(JSON.stringify(message).includes('private-test-value'),false);assert.equal(JSON.stringify(message).includes('actor-'),false);
    const decoded=readOverlayState(message,'a'.repeat(32),640,360);assert.equal(Boolean(decoded.snapshot.freeze??decoded.snapshot.actionGame),true);
    const scene=decoded.snapshot.freeze??decoded.snapshot.actionGame;scene.pose[Object.keys(scene.pose)[0]].x=0;
    assert.notEqual((message.snapshot.freeze??message.snapshot.actionGame).pose[Object.keys(scene.pose)[0]].x,0);
    const p=pose();if(kind==='FREEZE')p.leftElbow=null;else if(kind==='LAVA')p.leftHip=null;else {p.leftWrist=null;p.rightWrist=null;}
    s.sample(100,p);const unknown=makeOverlayState({session:'a'.repeat(32),sequence:2,geometry,snapshot:s.game.snapshot(),sourcePoint:point(.5,.3)});
    assert.equal((unknown.snapshot.freeze??unknown.snapshot.actionGame).pose,null);
  }
});

test('v3 rejects malformed challenge geometry, counters, poses and mixed active modes',()=>{
  const s=setup();s.mosquito();const session='a'.repeat(32);
  const valid=makeOverlayState({session,sequence:1,geometry,snapshot:s.game.snapshot(),sourcePoint:point(.5,.3)});
  const invalids=[{status:'OTHER'},{kind:'CUSTOM'},{remainingMs:Infinity},{remainingMs:-1},{recoveryRemaining:60001},{burns:1.5},{burns:61},{level:.81},{pose:null},{mosquito:null},{mosquito:{x:2,y:.2}},{pose:{leftWrist:{x:.5,y:.5,visibility:2},rightWrist:null}}];
  for(const patch of invalids){const message=structuredClone(valid);Object.assign(message.snapshot.actionGame,patch);assert.throws(()=>readOverlayState(message,session,1280,720),/INVALID_OVERLAY_STATE/);}
  const mixed=structuredClone(valid);mixed.snapshot.attacks=[{cell:5}];assert.throws(()=>readOverlayState(mixed,session,1280,720));
  const f=setup();f.game.receiveSyntheticFreeze(f.event());const frozen=makeOverlayState({session,sequence:1,geometry,snapshot:f.game.snapshot(),sourcePoint:point(.5,.3)});
  for(const patch of [{phase:'GREEN'},{pose:null},{anchor:pose()},{box:{left:.7,right:.3,top:0,bottom:1}},{remainingMs:60001}]){
    const message=structuredClone(frozen);Object.assign(message.snapshot.freeze,patch);assert.throws(()=>readOverlayState(message,session,1280,720));
  }
});
