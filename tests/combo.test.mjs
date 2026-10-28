import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixGame,gradeFor,comboMultiplier} from '../dist/matrix.mjs';

const at=x=>({x,y:.5,visibility:1});
const frame=(id,t,nose)=>({frameId:id,captureTime:t,nose,leftShoulder:null,rightShoulder:null});
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

test('COMBO-01 gradeFor thresholds: B 500, A 1000, S 1600, below is null',()=>{
  for(const [score,grade] of [[0,null],[499,null],[500,'B'],[999,'B'],[1000,'A'],[1599,'A'],[1600,'S'],[99999,'S'],[-5,null],[NaN,null],[undefined,null]])assert.equal(gradeFor(score),grade,String(score));
});

test('COMBO-02 multiplier tiers: x1 below 5, x1.5 from 5, x2 from 10',()=>{
  for(const [n,m] of [[0,1],[1,1],[4,1],[5,1.5],[9,1.5],[10,2],[40,2],[-3,1],[NaN,1]])assert.equal(comboMultiplier(n),m,String(n));
});

test('COMBO-03 consecutive catches build the combo and the 5th and 10th get x1.5 and x2',()=>{
  const s=setup();const deltas=[];
  for(let i=0;i<10;i++){const r=s.catchGold();assert.equal(r.outcome,'CATCH');deltas.push(r.scoreDelta);assert.equal(r.combo,i+1);}
  assert.deepEqual(deltas,[25,25,25,25,38,38,38,38,38,50]);   // round(25*1.5)=38, 25*2=50
  const snap=s.game.snapshot();assert.equal(snap.combo,10);assert.equal(snap.multiplier,2);
  assert.equal(s.game.score,deltas.reduce((a,b)=>a+b,0));
});

test('COMBO-04 AVOID counts toward the combo and its +10 is multiplied too',()=>{
  const s=setup();for(let i=0;i<4;i++)s.catchGold();
  const r=s.avoidBomb();assert.equal(r.outcome,'AVOID');assert.equal(r.combo,5);assert.equal(r.multiplier,1.5);assert.equal(r.scoreDelta,15);
});

test('COMBO-05 catching a bomb resets the combo and costs the usual 25 points',()=>{
  const s=setup();for(let i=0;i<6;i++)s.catchGold();
  const before=s.game.score,r=s.catchBomb();assert.equal(r.outcome,'BOMB');assert.equal(r.scoreDelta,-25);assert.equal(s.game.score,before-25);
  assert.equal(s.game.snapshot().combo,0);assert.equal(s.game.snapshot().multiplier,1);
  assert.equal(s.catchGold().scoreDelta,25);
});

test('COMBO-06 one or two misses keep the combo; the third miss in a row resets it; a catch clears the miss count',()=>{
  const s=setup();for(let i=0;i<5;i++)s.catchGold();
  s.missGold();s.missGold();assert.equal(s.game.snapshot().combo,5);
  s.catchGold();assert.equal(s.game.snapshot().combo,6);          // the miss streak was cleared
  s.missGold();s.missGold();assert.equal(s.game.snapshot().combo,6);
  const r=s.missGold();assert.equal(r.outcome,'MISS');assert.equal(s.game.snapshot().combo,0);
  assert.equal(s.catchGold().scoreDelta,25);
});

test('COMBO-07 a mosquito bite resets the combo; swat and dodge do not; UNKNOWN changes nothing',()=>{
  const s=setup();for(let i=0;i<5;i++)s.catchGold();
  s.game.settleFaceMosquito({outcome:'SWAT'});s.game.settleFaceMosquito({outcome:'DODGE'});s.game.settleFaceMosquito({outcome:'UNKNOWN'});
  assert.equal(s.game.snapshot().combo,5);
  s.game.settleFaceMosquito({outcome:'BITE'});assert.equal(s.game.snapshot().combo,0);
});

test('COMBO-08 reset() clears combo state',()=>{
  const s=setup();for(let i=0;i<5;i++)s.catchGold();
  s.game.reset();assert.equal(s.game.snapshot().combo,0);assert.equal(s.game.snapshot().multiplier,1);
});
