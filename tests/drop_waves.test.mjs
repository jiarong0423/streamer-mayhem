import test from 'node:test';
import assert from 'node:assert/strict';
import {DropWaves} from '../dist/drop_waves.mjs';

const run=(waves,until,active=0,step=50)=>{const out=[];for(let t=0;t<=until;t+=step){const d=waves.update(t,active);if(d)out.push({t,...d});}return out;};

test('WAVES-01 drops are irregular: gaps vary inside the clamp and every fall time is inside the range',()=>{
  const out=run(new DropWaves({seed:7}),60000);
  assert.ok(out.length>25,`count ${out.length}`);
  const gaps=out.slice(1).map((d,i)=>d.t-out[i].t);
  assert.ok(Math.min(...gaps)>=200&&Math.max(...gaps)<=2300,`gaps ${Math.min(...gaps)}..${Math.max(...gaps)}`);
  assert.ok(new Set(gaps.map(g=>Math.round(g/100))).size>=6,'gaps should not be regular');
  for(const d of out){assert.ok(d.fall>=1600*.65-1&&d.fall<=2800,`fall ${d.fall}`);assert.ok([1,2,3].includes(d.column));}
  assert.ok(new Set(out.map(d=>Math.round(d.fall/200))).size>=4,'fall times should vary');
});

test('WAVES-02 same seed gives the same sequence; a different seed does not',()=>{
  const a=run(new DropWaves({seed:3}),20000),b=run(new DropWaves({seed:3}),20000),c=run(new DropWaves({seed:4}),20000);
  assert.deepEqual(a,b);assert.notDeepEqual(a,c);
});

test('WAVES-03 bombs appear, rise over the round, and a gold item is the default',()=>{
  const out=run(new DropWaves({seed:11,roundMs:60000}),60000);
  const bombs=out.filter(d=>d.variant==='BOMB');
  assert.ok(bombs.length>0&&bombs.length<out.length*.5,`bombs ${bombs.length}/${out.length}`);
  for(const d of out)assert.ok(d.variant===undefined||d.variant==='BOMB');
  const early=out.filter(d=>d.t<20000),late=out.filter(d=>d.t>=40000);
  const rate=a=>a.filter(d=>d.variant==='BOMB').length/Math.max(1,a.length);
  assert.ok(late.length>0&&early.length>0);assert.ok(rate(late)>=rate(early)-.1);
});

test('WAVES-04 it gets denser and faster as the round goes on',()=>{
  const out=run(new DropWaves({seed:5,roundMs:60000}),60000);
  const first=out.filter(d=>d.t<20000).length,last=out.filter(d=>d.t>=40000).length;
  assert.ok(last>first,`first ${first} last ${last}`);
});

test('WAVES-05 never starts more than maxActive: while full it waits and tries again',()=>{
  const w=new DropWaves({seed:1,maxActive:2});
  assert.equal(w.update(900,2),null);assert.equal(w.update(950,2),null);
  assert.ok(w.update(1300,1),'a slot is free again');
  assert.equal(w.update(1301,5),null);
});

test('WAVES-06 no lane more than twice in a row',()=>{
  const out=run(new DropWaves({seed:9}),120000);let streak=1,max=1;
  for(let i=1;i<out.length;i++){streak=out[i].column===out[i-1].column?streak+1:1;max=Math.max(max,streak);}
  assert.ok(max<=2,`longest run ${max}`);
});

test('WAVES-07 reset restarts the round clock; bad input and bad options are rejected',()=>{
  const w=new DropWaves({seed:2});run(w,30000);assert.ok(w.difficulty(30000)>.3);
  w.reset(50000);assert.equal(w.difficulty(50000),0);assert.equal(w.update(50100),null);assert.ok(run(w,60000).length>0);
  assert.equal(new DropWaves().update(NaN,0),null);assert.equal(new DropWaves().update(5000,NaN),null);
  for(const bad of [{maxActive:0},{roundMs:0},{gapMin:0},{gapMax:100,gapMin:200},{fallMin:3000,fallMax:2000},{bombStart:.5,bombEnd:.2}])assert.throws(()=>new DropWaves(bad),RangeError);
});

test('WAVES-08 gaps never drop below the global cooldown floor, even late in a round, so no drop is refused',()=>{
  const out=run(new DropWaves({seed:12345,roundMs:75000}),75000,0,10);
  const gaps=out.slice(1).map((d,i)=>d.t-out[i].t);
  assert.ok(Math.min(...gaps)>=440,`min gap ${Math.min(...gaps)}`);
});

test('WAVE-R every generated drop is reachable: lane steps get time, gold and bomb never share a lane within 450 ms, and drops keep coming (RT3 reachability)',()=>{
  for(let seed=1;seed<=60;seed++){
    const w=new DropWaves({seed});const drops=[];let live=[];
    for(let now=0;now<=75000;now+=16){
      live=live.filter(d=>d.at>now);
      const d=w.update(now,live.length);
      if(d){const item={at:now+d.fall,column:d.column,bomb:d.variant==='BOMB',fall:d.fall};drops.push(item);live.push(item);}
    }
    assert.ok(drops.length>=25,`seed ${seed}: only ${drops.length} drops`);
    for(const a of drops){
      assert.ok(a.fall>=1300,`seed ${seed}: fall ${a.fall}`);
      for(const b of drops){
        if(a===b||b.at<a.at-1e-9||(b.at===a.at&&drops.indexOf(b)<drops.indexOf(a)))continue;
        const dt=b.at-a.at;
        if(a.column!==b.column)assert.ok(dt>=Math.abs(a.column-b.column)*350-1,`seed ${seed}: lanes ${a.column}->${b.column} only ${dt} ms apart`);
        else if(a.bomb!==b.bomb)assert.ok(dt>=450-1,`seed ${seed}: gold and bomb in lane ${a.column} ${dt} ms apart`);
      }
    }
  }
});
