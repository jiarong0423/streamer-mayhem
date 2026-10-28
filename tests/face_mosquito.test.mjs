import test from 'node:test';
import assert from 'node:assert/strict';
import {FaceMosquito,mosquitoDistance} from '../dist/face_mosquito.mjs';

const face=(x=.5,y=.5,w=.17)=>({x,y,w});
// Runs the mosquito at ~60 fps until it returns a result or `until` ms pass; `at(t)` gives the face (or null) and `level(t,m)` the swat level.
function run(m,{until=20000,at=()=>face(),level=()=>0,from=0}={}){
  const states=[];let result=null,t=from;
  for(;t<=from+until&&!result;t+=16){result=m.update(t,at(t),level(t,m));const s=m.snapshot(t);if(s)states.push({t,...s});}
  return {result,states,t};
}

test('MOSQ-01 starts once, only with a usable face; options are validated',()=>{
  const m=new FaceMosquito();
  for(const bad of [null,undefined,{x:.5,y:.5},{x:NaN,y:.5,w:.1},{x:.5,y:.5,w:0}])assert.equal(m.start(0,bad),false);
  assert.equal(m.active,false);assert.equal(m.start(0,face()),true);assert.equal(m.start(10,face()),false);assert.equal(m.active,true);
  for(const bad of [{approachMs:0},{maxApproaches:0},{amplitude:1},{landFactor:0},{swatLevel:2},{swatFrames:0},{lagMs:NaN}])assert.throws(()=>new FaceMosquito(bad),RangeError);
  assert.equal(new FaceMosquito().update(0,face()),null);assert.equal(new FaceMosquito().snapshot(0),null);
});

test('MOSQ-02 the path is an irregular S, not a straight line, and differs from one mosquito to the next',()=>{
  const m=new FaceMosquito({seed:3});m.start(0,face(.5,.55));
  const {states}=run(m,{until:3000});
  const first=states[0],last=states.at(-1);
  // Deviation of each point from the straight line first->last, with a sign: an S crosses the line at least once.
  const dx=last.x-first.x,dy=(last.y-first.y)/(16/9),len=Math.hypot(dx,dy);
  const dev=states.map(s=>(dx*((s.y-first.y)/(16/9))-dy*(s.x-first.x))/len);
  assert.ok(Math.max(...dev.map(Math.abs))>.02,`max deviation ${Math.max(...dev.map(Math.abs))}`);
  assert.ok(dev.some(d=>d>.01)&&dev.some(d=>d<-.01),'it should swing to both sides (S shape)');
  const starts=[];for(let i=0;i<6;i++){const n=new FaceMosquito({seed:3});n.serial=i;n.start(0,face());starts.push(JSON.stringify(n.snapshot(0).x.toFixed(3)));}
  assert.ok(new Set(starts).size>=4,'start positions vary');
  const a=new FaceMosquito({seed:9}),b=new FaceMosquito({seed:9});a.start(0,face());b.start(0,face());
  assert.deepEqual(run(a,{until:2000}).states,run(b,{until:2000}).states);                  // same seed, same flight
});

test('MOSQ-03 it starts at an edge of the window and arrives at a face that stays still',()=>{
  const m=new FaceMosquito({seed:5});m.start(0,face());const s0=m.snapshot(0);
  assert.ok(s0.x<=0||s0.x>=1||s0.y<=0,`starts at an edge: ${s0.x},${s0.y}`);
  const {states}=run(m,{until:4500,level:()=>0});
  const landed=states.find(s=>s.state==='LANDED');assert.ok(landed,'lands on a still face');assert.ok(landed.t>=3000&&landed.t<=3700,`landed at ${landed.t}`);
  assert.ok(mosquitoDistance(landed,{x:.5,y:.5})<.1);
});

test('MOSQ-04 landed and not slapped within two seconds is a BITE',()=>{
  const m=new FaceMosquito({seed:5});m.start(0,face());
  const {result,states}=run(m,{until:9000});
  const landed=states.find(s=>s.state==='LANDED');
  assert.equal(result.outcome,'BITE');assert.equal(result.reason,'NOT_SLAPPED');
  assert.ok(result.ms>=landed.t+1990&&result.ms<=landed.t+2100,`bite at ${result.ms}, landed ${landed.t}`);
  const mid=states.filter(s=>s.state==='LANDED');assert.ok(mid[0].landedProgress<.05&&mid.at(-1).landedProgress>.95,'progress runs over the window');
  assert.equal(m.active,false);assert.equal(m.update(result.ms+20,face()),null,'the result is delivered once');
});

test('MOSQ-05 a slap on the face (motion) while landed is a SWAT; one noisy frame is not',()=>{
  const m=new FaceMosquito({seed:5});m.start(0,face());let landedAt=null;
  const {result}=run(m,{until:9000,level:(t,mm)=>{const s=mm.snapshot(t);if(s?.state==='LANDED'&&landedAt===null)landedAt=t;return s?.state==='LANDED'&&t>landedAt+500&&t<landedAt+532?.6:0;}});
  assert.equal(result.outcome,'SWAT');assert.equal(result.reason,'FACE_SLAP');
  const n=new FaceMosquito({seed:5});n.start(0,face());let la=null;
  const one=run(n,{until:9000,level:(t,mm)=>{const s=mm.snapshot(t);if(s?.state==='LANDED'&&la===null)la=t;return s?.state==='LANDED'&&t>la+500&&t<la+510?.6:0;}});
  assert.equal(one.result.outcome,'BITE','a single frame above the threshold is not enough');
  const low=new FaceMosquito({seed:5});low.start(0,face());assert.equal(run(low,{until:9000,level:()=>.29}).result.outcome,'BITE');
});

test('MOSQ-06 a hand swat in flight kills it; the probe points at the mosquito',()=>{
  const m=new FaceMosquito({seed:7});m.start(0,face());
  const seen=[];
  const {result}=run(m,{until:9000,level:(t,mm)=>{const s=mm.snapshot(t);if(t>1500&&t<1540){seen.push(s.probe);return .5;}return 0;}});
  assert.equal(result.outcome,'SWAT');assert.equal(result.reason,'HAND_IN_FLIGHT');assert.ok(result.ms<1700);
  assert.ok(seen[0].r>=.04&&seen[0].r<=.2&&Number.isFinite(seen[0].x));
});

test('MOSQ-07 it aims at where the face was: a quick move away makes it miss and loop back; moving away again and again makes it give up',()=>{
  const dodge=new FaceMosquito({seed:5});dodge.start(0,face(.5,.5));
  const jump=t=>t<3300?face(.5,.5):face(.8,.5);                       // leans far away just before it arrives
  const {result,states}=run(dodge,{until:30000,at:jump});
  assert.ok(states.some(s=>s.approach>=2),'it came round for a second approach');
  assert.ok(['BITE','DODGE'].includes(result.outcome));
  const keep=new FaceMosquito({seed:5,maxApproaches:3});keep.start(0,face(.5,.5));
  const swing=t=>face(.5+.3*Math.sin(t/300),.5);                      // keeps moving fast: never in the same place twice
  const out=run(keep,{until:30000,at:swing});
  assert.ok(['DODGE','BITE'].includes(out.result.outcome));assert.ok(out.result.approaches<=3);
});

test('MOSQ-08 face lost: a short gap is ridden out, a long one ends with UNKNOWN and no penalty',()=>{
  const m=new FaceMosquito({seed:5});m.start(0,face());
  const gap=run(m,{until:9000,at:t=>t>1000&&t<1500?null:face()});assert.notEqual(gap.result.outcome,'UNKNOWN');
  const n=new FaceMosquito({seed:5});n.start(0,face());
  const lost=run(n,{until:9000,at:t=>t>1000?null:face()});assert.equal(lost.result.outcome,'UNKNOWN');assert.equal(lost.result.reason,'FACE_LOST');assert.ok(lost.result.ms>=1990&&lost.result.ms<=2100);
});

test('MOSQ-09 cancel gives UNKNOWN once and clears the mosquito; it can start again',()=>{
  const m=new FaceMosquito({seed:5});assert.equal(m.cancel(0),null);m.start(0,face());
  const r=m.cancel(500);assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'CANCELLED');assert.equal(m.active,false);assert.equal(m.cancel(600),null);
  assert.equal(m.start(1000,face()),true);
});

test('MOSQ-10 bad numbers are survived: NaN level counts as no motion, NaN time is ignored',()=>{
  const m=new FaceMosquito({seed:5});m.start(0,face());
  assert.equal(m.update(NaN,face(),0),null);
  const {result}=run(m,{until:9000,level:()=>NaN});assert.equal(result.outcome,'BITE');
});
