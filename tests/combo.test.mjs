import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixGame,gradeFor,comboBonus,judgementFor} from '../dist/matrix.mjs';

const at=x=>({x,y:.5,visibility:1});
const frame=(id,t,nose)=>({frameId:id,captureTime:t,nose,leftShoulder:null,rightShoulder:null});
// Note: these drops carry no landX, so the lane centre is the ball's spot: column 2 is a two-pointer (2 points), caught dead centre it is PERFECT (+1) = 3.
// Streamer stands in the middle column (x .5); drops/bombs on column 2 are caught, on column 1 are missed/avoided.
function setup(){
  const clock={now:0},game=new MatrixGame({clock:()=>clock.now});
  game.setConnection(true);game.start();let serial=0;
  const feed=until=>{while(clock.now<until){clock.now=Math.min(until,clock.now+100);game.addFrame(frame(`f${++serial}`,clock.now,at(.5)));game.tick();}};
  feed(200);
  const land=(column,variant)=>{
    feed(clock.now+500);const id=`w${++serial}`;
    const r=game.receiveWaveDrop({notificationId:id,messageId:id,actorId:id,receivedAt:clock.now},{column,variant,fall:600});
    assert.equal(r.accepted,true);feed(clock.now+700);return game.snapshot().lastResult;
  };
  return {game,clock,feed,land,catchGold:()=>land(2),missGold:()=>land(1),catchBomb:()=>land(2,'BOMB'),avoidBomb:()=>land(1,'BOMB')};
}

test('COMBO-01 gradeFor thresholds: the default (NORMAL) is B 60, A 95, S 130 and each level has its own, below is null',()=>{
  for(const [score,grade] of [[0,null],[59,null],[60,'B'],[94,'B'],[95,'A'],[129,'A'],[130,'S'],[99999,'S'],[-5,null],[NaN,null],[undefined,null]])assert.equal(gradeFor(score),grade,String(score));
});

test('COMBO-02 combo bonus: +1 per 5 in a row, at most +3',()=>{
  for(const [n,m] of [[0,0],[1,0],[4,0],[5,1],[9,1],[10,2],[15,3],[40,3],[-3,0],[NaN,0]])assert.equal(comboBonus(n),m,String(n));
});

test('COMBO-03 consecutive catches build the combo; from the 6th the bonus is added to every catch (PERFECT 2-pointer = 3)',()=>{
  const s=setup();const deltas=[];
  for(let i=0;i<10;i++){const r=s.catchGold();assert.equal(r.outcome,'CATCH');assert.equal(r.judgement,'PERFECT');deltas.push(r.scoreDelta);assert.equal(r.combo,i+1);}
  assert.deepEqual(deltas,[3,3,3,3,3,4,4,4,4,4]);   // the bonus uses the streak before the catch: 5 in a row -> +1
  const snap=s.game.snapshot();assert.equal(snap.combo,10);assert.equal(snap.bonus,2);
  assert.equal(s.game.score,deltas.reduce((a,b)=>a+b,0));
});

test('COMBO-04 AVOID counts toward the combo but scores nothing (dodging a pie is worth 0)',()=>{
  const s=setup();for(let i=0;i<4;i++)s.catchGold();
  const r=s.avoidBomb();assert.equal(r.outcome,'AVOID');assert.equal(r.combo,5);assert.equal(r.scoreDelta,0);
});

test('COMBO-05 catching a pie resets the combo and costs 2 points',()=>{
  const s=setup();for(let i=0;i<6;i++)s.catchGold();
  const before=s.game.score,r=s.catchBomb();assert.equal(r.outcome,'BOMB');assert.equal(r.scoreDelta,-2);assert.equal(s.game.score,before-2);
  assert.equal(s.game.snapshot().combo,0);assert.equal(s.game.snapshot().bonus,0);
  assert.equal(s.catchGold().scoreDelta,3);
});

test('COMBO-06 a single miss resets the combo and a catch afterwards starts it again',()=>{
  const s=setup();for(let i=0;i<5;i++)s.catchGold();
  assert.equal(s.game.snapshot().combo,5);
  const r=s.missGold();assert.equal(r.outcome,'MISS');assert.equal(s.game.snapshot().combo,0);
  assert.equal(s.catchGold().scoreDelta,3);
  assert.equal(s.game.snapshot().combo,1);
});

test('COMBO-08 reset() clears combo state',()=>{
  const s=setup();for(let i=0;i<5;i++)s.catchGold();
  s.game.reset();assert.equal(s.game.snapshot().combo,0);assert.equal(s.game.snapshot().bonus,0);
});

test('COMBO-09 judgement tiers: PERFECT within a third of the zone, GREAT within two thirds, GOOD inside it, GOOD keeps the combo',()=>{
  assert.equal(judgementFor(0).id,'PERFECT');assert.equal(judgementFor(.33).id,'PERFECT');assert.equal(judgementFor(.5).id,'GREAT');assert.equal(judgementFor(.66).id,'GREAT');
  assert.equal(judgementFor(.9).id,'GOOD');assert.equal(judgementFor(1).id,'GOOD');assert.equal(judgementFor(1.01),null);assert.equal(judgementFor(NaN),null);assert.equal(judgementFor(-1),null);
  // catch a ball at the edge of the zone: GOOD, 1 point less, and the streak goes on
  const clock={now:0},game=new MatrixGame({clock:()=>clock.now,options:{catchHalf:.1}});game.setConnection(true);game.start();let n=0;
  const feed=(until,x)=>{while(clock.now<until){clock.now=Math.min(until,clock.now+100);game.addFrame(frame(`f${++n}`,clock.now,at(x)));game.tick();}};
  feed(200,.5);
  const drop=(x)=>{feed(clock.now+500,x);const id=`w${++n}`;game.receiveWaveDrop({notificationId:id,messageId:id,actorId:id,receivedAt:clock.now},{column:2,fall:600});feed(clock.now+700,x);return game.snapshot().lastResult;};
  const good=drop(.5+.09);assert.equal(good.judgement,'GOOD');assert.equal(good.scoreDelta,1);   // 2 - 1
  assert.equal(game.snapshot().combo,1);
  const great=drop(.5+.05);assert.equal(great.judgement,'GREAT');assert.equal(great.scoreDelta,2);assert.equal(game.snapshot().combo,2);
  const perfect=drop(.5+.02);assert.equal(perfect.judgement,'PERFECT');assert.equal(perfect.scoreDelta,3);
});
