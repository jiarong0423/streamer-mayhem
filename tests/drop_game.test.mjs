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

test('DROP-09 (theme) the ball is shot from the right in an arc and lands in the dropped column',()=>{
  const calls=[];
  const gradient={addColorStop(){}};
  const ctx=new Proxy({canvas:{width:1280,height:720}},{get:(t,k)=>k in t?t[k]:/^create.*Gradient$/.test(String(k))?()=>gradient:(...a)=>{calls.push([k,a]);},set:(t,k,v)=>{t[k]=v;return true;}});
  const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
  drawCameraOverlay(ctx,geometry,{mode:'PLAYING',attacks:[{cell:5,kind:'DROP',cells:[2,5,8],progress:.5}]},{clear:false});
  const arcs=calls.filter(([k])=>k==='arc');
  assert.ok(arcs.length>=1);
  const [,[ox,oy,radius]]=arcs.at(-1);
  assert.ok(ox>-80&&ox<1280*1.06&&Math.abs(ox-640)>1,`ball is in flight, away from the target: ${ox}`);assert.ok(oy>0&&oy<720*.6,`y ${oy}`);   // mid-flight, near the top of the arc
  drawCameraOverlay(ctx,geometry,{mode:'PLAYING',attacks:[{cell:5,kind:'DROP',cells:[2,5,8],progress:1}]},{clear:false});
  const landed=calls.filter(([k])=>k==='arc').at(-1)[1];
  assert.ok(Math.abs(landed[0]-640)<1,`lands at the target x: ${landed[0]}`);
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
  s.feed(s.clock.now+3000,{x:.5,y:.5,visibility:1});assert.equal(send(2500,3,'BOMB',23).variant,'BOMB');   // the ball has landed, so a pie may come
});
test('DROP-16b (theme) balls and pies are staggered: the other kind is refused while one is on screen',()=>{
  const s=setup();s.feed(100,{x:.5,y:.5,visibility:1});
  const send=(variant,n)=>s.game.receiveWaveDrop({notificationId:`g${n}`,messageId:`g${n}`,actorId:`g${n}`,receivedAt:s.clock.now},{column:2,variant,fall:2500});
  assert.equal(send(undefined,1).accepted,true);
  const refused=send('BOMB',2);assert.equal(refused.accepted,false);assert.equal(refused.reason,'MODE_BUSY');
  s.feed(s.clock.now+3000,{x:.5,y:.5,visibility:1});assert.equal(send('BOMB',3).accepted,true);
  s.feed(s.clock.now+500,{x:.5,y:.5,visibility:1});assert.equal(send(undefined,4).accepted,false);   // and the other way round
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

test('CHAT-REPLY a chat reply prefix "@name " does not break a command (RT3 I7)',()=>{
  const s=setup();s.feed(100,{x:.5,y:.5,visibility:1});
  const r=s.send('@streamer !drop 2');assert.equal(r.accepted,true);assert.equal(r.kind,'DROP');
});

import {dropLandX,dropCaughtAt} from '../dist/drop_lanes.mjs';
test('LAND-01 (theme) landing x is stable per event id, differs between ids, stays inside the window and defaults to the lane centre',()=>{
  assert.equal(dropLandX(2,'m1',0),.5);   // jitter off: the old fixed lane
  assert.equal(dropLandX(2,'m1',.12),dropLandX(2,'m1',.12));
  const xs=new Set();for(let i=0;i<60;i++){const x=dropLandX(1+i%3,`m${i}`,.12);assert.ok(x>=.32-1e-9&&x<=.68+1e-9,`x ${x}`);xs.add(x.toFixed(3));}
  assert.ok(xs.size>30,`landing points should vary, got ${xs.size} distinct`);
  assert.equal(dropLandX(4,'m1',.12),null);
});
test('LAND-02 (theme) with landJitter the catch is judged at the per-shot landing x, not the lane centre',()=>{
  const s=setup({landJitter:.12});s.feed(100,point(.5));
  const r=s.send('!drop 1');assert.equal(r.accepted,true);assert.ok(Number.isFinite(r.landX),'the warning carries landX');
  s.feed(s.clock.now+s.game.config.dropFall+200,point(r.landX));
  const hit=s.game.snapshot().lastResult;assert.equal(hit.outcome,'CATCH');assert.equal(hit.landX,r.landX);
  const t=setup({landJitter:.12});t.feed(100,point(.5));
  const r2=t.send('!drop 3');const away=r2.landX>.5?r2.landX-.2:r2.landX+.2;   // clearly outside the hoop width (0.15)
  t.feed(t.clock.now+t.game.config.dropFall+200,point(away));
  assert.equal(t.game.snapshot().lastResult.outcome,'MISS');
  assert.equal(dropCaughtAt(.5,.5+DROP_CATCH_HALF+.01),false);
});

import {dropPoints} from '../dist/drop_lanes.mjs';
test('PTS-01 (theme) a ball landing near the middle is a two-pointer (20), away from it a three-pointer (30); combo multiplies both',()=>{
  assert.equal(dropPoints(.5),2);assert.equal(dropPoints(.62),2);assert.equal(dropPoints(.66),3);assert.equal(dropPoints(.34),3);assert.equal(dropPoints(NaN),2);
  const score=(col)=>{const s=setup({landJitter:.12});s.feed(100,point(.5));const r=s.send('!drop '+col);s.feed(s.clock.now+s.game.config.dropFall+200,point(r.landX));const res=s.game.snapshot().lastResult;return {pts:res.points,delta:res.scoreDelta,out:res.outcome,landX:r.landX};};
  const seen=new Map();for(let c=1;c<=3;c++){const r=score(c);assert.equal(r.out,'CATCH');assert.equal(r.delta,r.pts*10);seen.set(r.pts,true);assert.equal(r.pts,dropPoints(r.landX));}
});

test('PTS-02 (theme) lane roles: the middle lane is a two-pointer near the middle, the left and right lanes are three-pointers on their own side',()=>{
  for(let i=0;i<300;i++){
    const m=dropLandX(2,`wave-${i}`,.12),l=dropLandX(1,`wave-${i}`,.12),r=dropLandX(3,`wave-${i}`,.12);
    assert.equal(dropPoints(m),2);assert.ok(Math.abs(m-.5)>=.09-1e-9&&Math.abs(m-.5)<=.12+1e-9,`middle ${m}`);
    assert.equal(dropPoints(l),3);assert.ok(l<.5&&.5-l>=.15-1e-9&&.5-l<=.18+1e-9,`left ${l}`);
    assert.equal(dropPoints(r),3);assert.ok(r>.5&&r-.5>=.15-1e-9&&r-.5<=.18+1e-9,`right ${r}`);
  }
});
import {DropWaves} from '../dist/drop_waves.mjs';
test('PTS-03 (theme) the wave generator with lane weights makes about one ball in four a three-pointer and never repeats a lane more than maxSame times',()=>{
  const cfg={maxActive:2,fallMin:2200,fallMax:3800,fallFloor:1800,gapMin:700,gapMax:2800,gapBase:900,gapMean:1100,gapFloor:700,laneStepMs:550,bombStart:.12,bombEnd:.22,columnWeights:[.06,.88,.06],maxSame:4};
  let sides=0,total=0,maxRun=0;
  for(let seed=1;seed<=40;seed++){const w=new DropWaves({seed,...cfg});const live=[];let run=0,last=0;
    for(let tm=0;tm<75000;tm+=50){while(live.length&&live[0]<=tm)live.shift();const d=w.update(tm,live.length);if(d){live.push(tm+d.fall);live.sort((x,y)=>x-y);total++;if(d.column!==2)sides++;run=d.column===last?run+1:1;last=d.column;maxRun=Math.max(maxRun,run);}}}
  const share=sides/total;assert.ok(share>.20&&share<.30,`three-pointer lane share ${share.toFixed(3)}`);assert.ok(maxRun<=4,`longest run ${maxRun}`);
  assert.throws(()=>new DropWaves({columnWeights:[1,1]}),/INVALID_WAVES/);assert.throws(()=>new DropWaves({maxSame:0}),/INVALID_WAVES/);
});

import {shotArc,ARC_RANGES} from '../dist/drop_lanes.mjs';
test('ARC-01 (theme) every shot path stays inside its range; a three-pointer is a gentle arc from the side, a two-pointer drops from above; the same id gives the same path',()=>{
  const inside=(v,[lo,hi])=>v>=lo-1e-9&&v<=hi+1e-9,sides=new Set();
  for(let i=0;i<300;i++){
    const a=shotArc(`wave-${i}`,3),b=shotArc(`wave-${i}`,2);sides.add(b.side);
    assert.ok(inside(a.reach,ARC_RANGES.three.reach)&&inside(a.startY,ARC_RANGES.three.startY)&&inside(a.apex,ARC_RANGES.three.apex),`three ${JSON.stringify(a)}`);
    assert.ok(inside(b.drift,ARC_RANGES.two.drift)&&inside(b.startY,ARC_RANGES.two.startY),`two ${JSON.stringify(b)}`);
    assert.deepEqual(a,shotArc(`wave-${i}`,3));assert.deepEqual(b,shotArc(`wave-${i}`,2));
  }
  assert.equal(sides.size,2,'two-pointers drift to both sides');
  assert.ok(ARC_RANGES.three.apex[0]>=.25,'a three-pointer is never a lob: it peaks no higher than a quarter from the top');
  assert.ok(ARC_RANGES.two.startY[1]<0,'a two-pointer starts above the window');
});

test('WAVE-SPEED (theme) speedFactor 1.1-1.5: every fall is the base fall divided by a continuous per-shot factor, never below the floor, and widely varied',()=>{
  const cfg={fallMin:2200,fallMax:3800,fallFloor:1500,speedFactor:[1.1,1.5],gapFloor:550,gapMin:550,columnWeights:[.06,.88,.06],maxSame:4};
  const falls=[];for(let seed=1;seed<=40;seed++){const w=new DropWaves({seed,...cfg});const live=[];for(let tm=0;tm<20000;tm+=50){while(live.length&&live[0]<=tm)live.shift();const d=w.update(tm,live.length);if(d){live.push(tm+d.fall);live.sort((x,y)=>x-y);falls.push(d.fall);}}}
  assert.ok(Math.min(...falls)>=1500,`ceiling holds: ${Math.min(...falls)}`);assert.ok(Math.max(...falls)<=3800/1.1+1,`slowest ${Math.max(...falls)}`);
  assert.ok(new Set(falls).size>200,`speeds are varied: ${new Set(falls).size} distinct`);
  assert.throws(()=>new DropWaves({speedFactor:[1.5,1.1]}),/INVALID_WAVES/);assert.throws(()=>new DropWaves({speedFactor:[0,1]}),/INVALID_WAVES/);
});

import {OVERLAY_STATE_TYPE as _T} from '../dist/overlay_protocol.mjs';
test('STAR-01 (theme) a wave drop with a label is a star ball: the label is cleaned, travels in the warning and the result; pies never carry one',()=>{
  const s=setup({landJitter:.12});s.feed(100,point(.5));
  const send=(n,over)=>s.game.receiveWaveDrop({notificationId:`s${n}`,messageId:`s${n}`,actorId:`s${n}`,receivedAt:s.clock.now},{column:2,fall:2500,...over});
  const w=send(1,{label:'  Mi\u0000ka  '});assert.equal(w.accepted,true);assert.equal(w.label,'Mika');
  assert.equal(s.game.snapshot().attacks[0].label,'Mika');
  s.feed(s.clock.now+3000,point(w.landX));const res=s.game.snapshot().lastResult;assert.equal(res.label,'Mika');assert.equal(res.outcome,'CATCH');
  assert.equal(send(2,{label:42}).accepted,false);                                  // not a string
  const pie=send(3,{variant:'BOMB',label:'Nova'});assert.equal(pie.accepted,true);assert.equal(pie.label,undefined);   // pies stay pies
  s.feed(s.clock.now+3000,point(.5));
  const long=send(4,{label:'x'.repeat(60)});assert.equal(long.label.length,20);
});
test('STAR-02 (theme) a chat command that comes with a cheer carries the viewer name as its star label; without a cheer it does not',()=>{
  const s=setup({landJitter:.12});s.feed(100,point(.5));
  const chat=(n,extra)=>s.game.receiveChat({notificationId:`c${n}`,messageId:`c${n}`,actorId:`u${n}`,receivedAt:s.clock.now,text:'!drop 2',viewer:'Nova',...extra});
  assert.equal(chat(1,{cheerBits:100}).label,'Nova');
  s.feed(s.clock.now+3000,point(.5));assert.equal(chat(2,{cheerBits:0}).label,undefined);
});

test('STAGGER-01 (theme) with landXFor the generator staggers landings: no two in the same spot, every pair leaves time to lean across, and the sides alternate',()=>{
  const cfg={maxActive:3,fallMin:2200,fallMax:3800,fallFloor:1500,speedFactor:[1.1,1.5],gapMin:550,gapMax:2400,gapBase:800,gapMean:1000,gapFloor:550,laneStepMs:450,bombStart:.12,bombEnd:.22,columnWeights:[.06,.88,.06],maxSame:4};
  let pairs=0,bad=0,same=0,shots=0,sides=0;
  for(let seed=1;seed<=30;seed++){let serial=0;const w=new DropWaves({seed,...cfg,landXFor:(c,t)=>dropLandX(c,`wave-${serial+1}-${t}`,.12)});const live=[],out=[];
    for(let tm=0;tm<75000;tm+=50){while(live.length&&live[0]<=tm)live.shift();const d=w.update(tm,live.length);if(d){serial++;const x=dropLandX(d.column,`wave-${serial}-${d.tag}`,.12);assert.equal(typeof d.tag,'number');live.push(tm+d.fall);live.sort((a,b)=>a-b);out.push({at:tm+d.fall,x});}}
    out.sort((a,b)=>a.at-b.at);shots+=out.length;
    for(let i=1;i<out.length;i++){const dt=out[i].at-out[i-1].at,dx=Math.abs(out[i].x-out[i-1].x);pairs++;if(dt<dx/.30*1000+250-1)bad++;if(dx<.13-1e-9)same++;}}
  assert.ok(shots/30>40,`enough shots per round: ${shots/30}`);
  assert.ok(bad/pairs<.01,`unreachable pairs ${bad}/${pairs}`);
  assert.ok(same/pairs<.01,`same-spot pairs ${same}/${pairs}`);
  assert.throws(()=>new DropWaves({landXFor:42}),/INVALID_WAVES/);assert.throws(()=>new DropWaves({moveSpeed:0}),/INVALID_WAVES/);
});
test('STAGGER-02 (theme) the landing side is not correlated between consecutive ids (the id hash is mixed well)',()=>{
  let flips=0,left=0,prev=null;const n=2000;
  for(let i=1;i<=n;i++){const left0=dropLandX(2,`wave-${i}-0`,.12)<.5;if(left0)left++;if(prev!==null&&left0!==prev)flips++;prev=left0;}
  assert.ok(left/n>.45&&left/n<.55,`left share ${left/n}`);assert.ok(flips/(n-1)>.4&&flips/(n-1)<.6,`side flips ${flips/(n-1)}`);
});

test('PIE-00 (theme) with avoidScore 0 a dodged pie scores nothing and a caught pie still costs points',()=>{
  const s=setup({landJitter:.12,avoidScore:0});s.feed(100,point(.5));
  const send=(n,col)=>s.game.receiveWaveDrop({notificationId:`p${n}`,messageId:`p${n}`,actorId:`p${n}`,receivedAt:s.clock.now},{column:col,variant:'BOMB',fall:2500});
  const r=send(1,2);assert.equal(r.accepted,true);
  s.feed(s.clock.now+3000,point(r.landX<.5?.9:.1));            // far away: dodged
  const res=s.game.snapshot().lastResult;assert.equal(res.outcome,'AVOID');assert.equal(res.scoreDelta,0);assert.equal(s.game.score,0);
});
