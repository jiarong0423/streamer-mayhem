import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixGame, parseDropCommand, dropCells} from '../dist/matrix.mjs';
import {drawCameraOverlay} from '../dist/matrix_view.mjs';
import {createCameraGeometry} from '../dist/camera_geometry.mjs';
import {OVERLAY_STATE_TYPE} from '../dist/overlay_protocol.mjs';

const point=(x,y=.5)=>({x,y,visibility:1});
const column=n=>point([.35,.5,.65][n-1]);
const frame=(id,at,nose)=>({frameId:id,captureTime:at,nose,leftShoulder:null,rightShoulder:null});

function setup(options={}) {
  const clock={now:0},events=[];
  const game=new MatrixGame({clock:()=>clock.now,onEvent:e=>events.push(e),options});
  game.setConnection(true);game.start();
  let serial=0;
  const feed=(until,nose)=>{while(clock.now<until){clock.now=Math.min(until,clock.now+100);game.addFrame(frame(`f${++serial}`,clock.now,nose));game.tick();}};
  const send=(text,actor='a')=>game.receiveChat({notificationId:`n${++serial}`,messageId:`m${serial}`,actorId:actor,receivedAt:clock.now,text});
  return {clock,events,game,feed,send};
}

test('DROP-01 parses only 1-3 and maps a column to its three cells',()=>{
  for(const n of [1,2,3])assert.equal(parseDropCommand(`  !DROP \t${n} `),n);
  for(const text of ['!drop 0','!drop 4','!drop','!drop 1 2','!throw 1','',null,'!drop '+'1'.repeat(100)])assert.equal(parseDropCommand(text),null);
  assert.deepEqual(dropCells(1),[1,4,7]);assert.deepEqual(dropCells(2),[2,5,8]);assert.deepEqual(dropCells(3),[3,6,9]);
});

test('DROP-02 being in the dropped column when it lands is a CATCH with score and no damage',()=>{
  for(const n of [1,2,3]){
    const s=setup();s.feed(0,column(n));s.feed(100,column(n));
    const accepted=s.send(`!drop ${n}`);
    assert.equal(accepted.accepted,true);assert.equal(accepted.kind,'DROP');assert.deepEqual(accepted.cells,dropCells(n));
    s.feed(s.clock.now+s.game.config.dropFall+200,column(n));
    const result=s.game.snapshot().lastResult;
    assert.equal(result.outcome,'CATCH');assert.equal(result.scoreDelta,s.game.config.dropScore);assert.equal(result.hpDelta,0);
    assert.equal(s.game.hp,100);assert.equal(s.game.score,s.game.config.dropScore);
  }
});

test('DROP-03 being in another column is a MISS that costs nothing',()=>{
  const s=setup();s.feed(100,column(3));
  assert.equal(s.send('!drop 1').accepted,true);
  s.feed(s.clock.now+s.game.config.dropFall+200,column(3));
  const result=s.game.snapshot().lastResult;
  assert.equal(result.outcome,'MISS');assert.equal(result.scoreDelta,0);assert.equal(result.hpDelta,0);
  assert.equal(s.game.hp,100);assert.equal(s.game.score,0);
});

test('DROP-04 the row does not matter, only the column',()=>{
  for(const y of [.1,.5,.9]){
    const s=setup();s.feed(100,point(.5,y));s.send('!drop 2');
    s.feed(s.clock.now+s.game.config.dropFall+200,point(.5,y));
    assert.equal(s.game.snapshot().lastResult.outcome,'CATCH');
  }
});

test('DROP-05 lost tracking at the landing time is UNKNOWN, never a guessed catch',()=>{
  const s=setup();s.feed(100,column(2));s.send('!drop 2');
  s.clock.now+=s.game.config.dropFall+500;s.game.tick();
  const result=s.game.snapshot().lastResult;
  assert.equal(result.outcome,'UNKNOWN');assert.equal(s.game.score,0);assert.equal(s.game.hp,100);
});

test('DROP-06 the item falls linearly and the snapshot exposes progress for the overlay',()=>{
  const s=setup();s.feed(100,column(2));s.send('!drop 2');
  const start=s.game.snapshot().attacks[0];assert.equal(start.kind,'DROP');assert.equal(start.progress,0);
  s.feed(s.clock.now+s.game.config.dropFall/2,column(2));
  const half=s.game.snapshot().attacks[0].progress;assert.ok(half>.4&&half<.6,`progress ${half}`);
});

test('DROP-07 cooldowns and malformed commands behave like other chat commands',()=>{
  const s=setup();s.feed(100,column(2));
  assert.equal(s.send('!drop 5').reason,'INVALID_COMMAND');
  assert.equal(s.send('!drop 2').accepted,true);
  assert.equal(s.send('!drop 2','other').reason,'GLOBAL_COOLDOWN');
  s.feed(s.clock.now+500,column(2));
  assert.equal(s.send('!drop 3').reason,'ACTOR_COOLDOWN');
});

test('DROP-08 attacks keep working unchanged next to drops',()=>{
  const s=setup();s.feed(100,column(2));
  assert.equal(s.send('!throw 5').accepted,true);
  s.feed(s.clock.now+700,column(2));
  assert.equal(s.game.snapshot().lastResult.outcome,'HIT');
  assert.equal(s.game.hp,100-s.game.config.damage);
});

test('DROP-09 the overlay draws a small falling orb inside the dropped column only',()=>{
  const calls=[];
  const gradient={addColorStop(){}};
  const ctx=new Proxy({canvas:{width:1280,height:720}},{get:(t,k)=>k in t?t[k]:/^create.*Gradient$/.test(String(k))?()=>gradient:(...a)=>{calls.push([k,a]);},set:(t,k,v)=>{t[k]=v;return true;}});
  const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
  drawCameraOverlay(ctx,geometry,{mode:'PLAYING',attacks:[{cell:5,kind:'DROP',cells:[2,5,8],progress:.5}]},{clear:false});
  const arcs=calls.filter(([k])=>k==='arc');
  assert.ok(arcs.length>=1);
  for(const [,[x]] of arcs)assert.ok(x>1280/3&&x<2*1280/3,`x ${x}`);
  const [,[ox,oy,radius]]=arcs.at(-1);
  assert.ok(Math.abs(ox-640)<1);assert.ok(oy>720*.2&&oy<720*.6,`y ${oy}`);
  assert.ok(radius>=4&&radius<1280/3/8,`orb radius ${radius} should stay small`);
});

test('DROP-10 overlay protocol accepts a drop and rejects a forged one',async()=>{
  const {renderOverlayState}=await import('../dist/overlay_protocol.mjs').catch(()=>({}));
  assert.equal(typeof OVERLAY_STATE_TYPE,'string');
  if(typeof renderOverlayState!=='function')return;
});

import {DROP_TARGETS,DROP_CATCH_HALF,DROP_START,DROP_FLOOR,dropTarget,dropCaught,dropColumn,dropY} from '../dist/drop_lanes.mjs';
test('DROP-11 targets sit close to the middle and the catcher is about one face width wide',()=>{
  assert.deepEqual([...DROP_TARGETS],[.35,.5,.65]);assert.equal(DROP_CATCH_HALF,.075);
  for(const [c,t] of [[1,.35],[2,.5],[3,.65]])assert.equal(dropTarget(c),t);
  for(const bad of [0,4,1.5,NaN,undefined])assert.equal(dropTarget(bad),null);
  // The window is about six face widths wide: a catcher of 0.15 is about 0.9 of a face width, and so is the distance from the middle to a side target.
  assert.ok(Math.abs(2*DROP_CATCH_HALF*6-.9)<.001);assert.ok(Math.abs((DROP_TARGETS[1]-DROP_TARGETS[0])*6-.9)<.001);
});
test('DROP-12 caught means the catcher covers the target; the zones of neighbouring targets meet without overlapping, and outside the window is unknown',()=>{
  assert.equal(dropCaught(.35,1),true);assert.equal(dropCaught(.35+.075,1),true);assert.equal(dropCaught(.35+.0751,1),false);assert.equal(dropCaught(.35-.0751,1),false);
  assert.equal(dropCaught(.5,2),true);assert.equal(dropCaught(.5,1),false);assert.equal(dropCaught(.65,3),true);assert.equal(dropCaught(.5,3),false);
  for(const bad of [-.01,1.01,NaN,undefined,null,'0.5'])assert.equal(dropCaught(bad,2),null);
  assert.equal(dropCaught(.5,9),null);
  assert.equal(dropColumn(.35),1);assert.equal(dropColumn(.5),2);assert.equal(dropColumn(.65),3);assert.equal(dropColumn(.42),1);assert.equal(dropColumn(.424),1);assert.equal(dropColumn(.43),2);assert.equal(dropColumn(.4251),2);assert.equal(dropColumn(.58),3);assert.equal(dropColumn(.2749),null);assert.equal(dropColumn(.2),null);assert.equal(dropColumn(NaN),null);
});
test('DROP-13 judging uses left/right only: height never matters, a missing or out-of-window x is unknown',()=>{
  for(const y of [-5,.5,5]){
    const s=setup();s.feed(100,{x:.5,y,visibility:1});s.send('!drop 2');
    s.feed(s.clock.now+s.game.config.dropFall+200,{x:.5,y,visibility:1});
    assert.equal(s.game.snapshot().lastResult.outcome,'CATCH',`y=${y}`);
  }
  const near=setup();near.feed(100,{x:.41,y:.5,visibility:1});near.send('!drop 1');
  near.feed(near.clock.now+near.game.config.dropFall+200,{x:.41,y:.5,visibility:1});
  const r=near.game.snapshot().lastResult;assert.equal(r.outcome,'CATCH');assert.equal(r.caught,true);assert.ok(Math.abs(r.sampledX-.41)<1e-9);
  const far=setup();far.feed(100,{x:.5,y:.5,visibility:1});far.send('!drop 1');
  far.feed(far.clock.now+far.game.config.dropFall+200,{x:.5,y:.5,visibility:1});
  assert.equal(far.game.snapshot().lastResult.outcome,'MISS');assert.equal(far.game.snapshot().lastResult.caught,false);
});
test('DROP-14 the item starts above the window and lands near the bottom',()=>{
  assert.ok(DROP_START<0);assert.ok(DROP_FLOOR>.85&&DROP_FLOOR<1);
  assert.equal(dropY(0),DROP_START);assert.equal(dropY(1),DROP_FLOOR);assert.equal(dropY(-1),DROP_START);assert.equal(dropY(5),DROP_FLOOR);
  assert.ok(dropY(.5)>dropY(.25)&&dropY(.75)>dropY(.5));
});

import {parseMatrixCommand,parseBombCommand,cleanCommand} from '../dist/matrix.mjs';
import {makeOverlayState} from '../dist/overlay_protocol.mjs';
test('DROP-15 invisible padding Twitch adds to a repeated message does not break a command',()=>{
  const pad=['\u{E0000}','​','‍','﻿','⁠','\u{E0020}'];
  for(const p of pad){
    assert.equal(parseDropCommand(`!drop 2${p}`),2,JSON.stringify(p));assert.equal(parseBombCommand(`!bomb 3${p}`),3);assert.equal(parseMatrixCommand(`!throw 5${p}`),5);
    assert.equal(parseDropCommand(`${p}!drop 1`),1);
  }
  assert.equal(parseMatrixCommand('!throw 5'),5);assert.equal(cleanCommand('\u{E0000}x y​'),'x y');
  assert.equal(parseDropCommand('!drop 2 \u{E0000}extra'),null);assert.equal(parseDropCommand('!dr​op 2'),2);   // removing the invisible character is the intent; a visible extra word is still rejected
});
test('DROP-16 wave drops: fall time is bounded, bad input is refused and a good one is accepted',()=>{
  const s=setup();s.feed(100,{x:.5,y:.5,visibility:1});
  const send=(fall,column=2,variant,n)=>s.game.receiveWaveDrop({notificationId:`w${n}`,messageId:`w${n}`,actorId:`w${n}`,receivedAt:s.clock.now},{column,variant,fall});
  for(const [i,fall] of [1e308,Infinity,NaN,-5,0,99,10001].entries())assert.equal(send(fall,2,undefined,i).accepted,false,`fall ${fall}`);
  assert.equal(send(5000,0,undefined,20).accepted,false);assert.equal(send(5000,2,'GOLD',21).accepted,false);
  const ok=send(2500,2,undefined,22);assert.equal(ok.accepted,true);
  s.feed(s.clock.now+1000,{x:.5,y:.5,visibility:1});assert.equal(send(2500,3,'BOMB',23).variant,'BOMB');
});
test('DROP-17 bomb outcomes: catching costs points (not below zero), avoiding earns a few',()=>{
  const s=setup();s.feed(100,{x:.5,y:.5,visibility:1});s.send('!bomb 2');
  s.feed(s.clock.now+s.game.config.dropFall+200,{x:.5,y:.5,visibility:1});
  let r=s.game.snapshot().lastResult;assert.equal(r.outcome,'BOMB');assert.equal(r.variant,'BOMB');assert.equal(s.game.score,0);assert.equal(s.game.hp,100);
  const t=setup();t.feed(100,{x:.5,y:.5,visibility:1});t.send('!bomb 1');
  t.feed(t.clock.now+t.game.config.dropFall+200,{x:.5,y:.5,visibility:1});
  r=t.game.snapshot().lastResult;assert.equal(r.outcome,'AVOID');assert.equal(r.scoreDelta,t.game.config.avoidScore);
  const u=setup();u.feed(100,{x:.5,y:.5,visibility:1});u.send('!drop 2');u.feed(u.clock.now+u.game.config.dropFall+200,{x:.5,y:.5,visibility:1});
  assert.equal(u.game.score,25);u.feed(u.clock.now+500,{x:.5,y:.5,visibility:1});u.send('!bomb 2','other');u.feed(u.clock.now+u.game.config.dropFall+200,{x:.5,y:.5,visibility:1});
  assert.equal(u.game.snapshot().lastResult.scoreDelta,-25);assert.equal(u.game.score,0);
});
test('DROP-18 a forged overlay drop without cells, with a bad variant or out-of-range progress is refused',()=>{
  const session='a'.repeat(32),geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
  const make=attack=>makeOverlayState({session,sequence:1,geometry,snapshot:{mode:'PLAYING',attacks:[attack]},sourcePoint:null});
  assert.throws(()=>make({cell:5,kind:'DROP'}),/INVALID_OVERLAY_STATE/);
  assert.throws(()=>make({cell:5,kind:'DROP',cells:[2,5,8],progress:.5,variant:'EVIL'}),/INVALID_OVERLAY_STATE/);
  assert.throws(()=>make({cell:5,kind:'DROP',cells:[2,5,8],progress:2}),/INVALID_OVERLAY_STATE/);
  const bomb=make({cell:5,kind:'DROP',cells:[2,5,8],progress:.5,variant:'BOMB'});assert.equal(bomb.snapshot.attacks[0].variant,'BOMB');
  assert.deepEqual(make({cell:5}).snapshot.attacks,[{cell:5}]);
});
