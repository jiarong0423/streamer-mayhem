import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MatrixGame} from '../dist/matrix.mjs';
import {LEVELS,LEVEL_ORDER,DEFAULT_LEVEL,zoneFor,stepPicker,CALIBRATE_FRAMES,NodDetector,scaleFall,applyLevel,drawPicker} from '../dist/difficulty.mjs';
test('DIFF-01 levels get harder in both range and speed, and the default is NORMAL',()=>{
  const l=LEVEL_ORDER.map(id=>LEVELS[id]);
  for(let i=1;i<l.length;i++){assert.ok(l[i].catchHalf<l[i-1].catchHalf);assert.ok(l[i].speed>l[i-1].speed);}
  assert.equal(LEVELS.EASY.catchHalf,.075);assert.equal(LEVELS.EASY.speed,1);assert.equal(DEFAULT_LEVEL,'NORMAL');
});
test('DIFF-02 the zone is the sideways shift from the resting position: left of it EASY, right HARD, near it NORMAL',()=>{
  assert.equal(zoneFor(-.1),'EASY');assert.equal(zoneFor(0),'NORMAL');assert.equal(zoneFor(.1),'HARD');assert.equal(zoneFor(.05),'NORMAL');
  assert.equal(zoneFor(NaN),null);assert.equal(zoneFor(undefined),null);
});
test('DIFF-03 the picker calibrates on the first frames wherever the face is, then follows the head, with no timer',()=>{
  let s=null;
  for(let i=0;i<CALIBRATE_FRAMES;i++){s=stepPicker(s,.3);assert.equal(s.zone,'NORMAL');}   // sitting at 0.3 is fine: that is the resting spot
  assert.ok(Math.abs(s.base-.3)<1e-9);
  assert.equal(stepPicker(s,.3+.1).zone,'HARD');assert.equal(stepPicker(s,.3-.1).zone,'EASY');assert.equal(stepPicker(s,.3+.03).zone,'NORMAL');
  assert.equal(stepPicker(stepPicker(s,.3+.1),NaN).zone,'HARD');   // the last good zone is kept while the face is lost
  assert.equal(stepPicker(null,NaN).zone,null);
  // the app starts the picker with a state that has only a zone: it must still calibrate
  let p={zone:null};for(let i=0;i<CALIBRATE_FRAMES;i++)p=stepPicker(p,.5);
  assert.ok(Math.abs(p.base-.5)<1e-9);assert.equal(stepPicker(p,.5-.1).zone,'EASY');
});
test('DIFF-04 a nod is a quick dip and return; jitter and a slow lean down are not',()=>{
  const run=(series)=>{const n=new NodDetector();let hits=0;series.forEach(([y,t])=>{if(n.update(y,t))hits++;});return hits;};
  const still=[];for(let t=0;t<1000;t+=33)still.push([.5+(t%66?.004:-.004),t]);
  assert.equal(run(still),0);                                        // tracking jitter
  const nodSeries=[...still,[.54,1033],[.56,1100],[.55,1200],[.51,1300],[.5,1400]];
  assert.equal(run(nodSeries),1);                                    // down by 0.06 and back within 400 ms
  const slow=[...still];for(let k=1;k<=60;k++)slow.push([.5+k*.002,1000+k*50]);
  assert.equal(run(slow),0);                                         // drifting down for 3 s is a lean
  const stuck=[...still,[.56,1033],[.56,2500],[.5,2600]];
  assert.equal(run(stuck),0);                                        // down and held longer than a nod
  const twice=[...nodSeries,[.56,1500],[.5,1560]];
  assert.equal(run(twice),1);                                        // the cooldown ignores an immediate second dip
});
test('DIFF-05 applyLevel sets the catch zone and the default fall times, and scaleFall never goes below the floor',()=>{
  const game=new MatrixGame({});
  applyLevel(game,LEVELS.HARD);
  assert.equal(game.config.catchHalf,LEVELS.HARD.catchHalf);assert.equal(game.config.dropFall,Math.round(2500/LEVELS.HARD.speed));assert.equal(game.config.pieFall,Math.round(1700/LEVELS.HARD.speed));
  assert.equal(scaleFall(2800,LEVELS.EASY),2800);assert.ok(scaleFall(2800,LEVELS.HARD)<scaleFall(2800,LEVELS.NORMAL));
  assert.equal(scaleFall(100,LEVELS.HARD),900);
});
test('DIFF-06 a narrower catch zone really is harder to satisfy',()=>{
  const miss=half=>{
    const clock={now:0},results=[];
    const game=new MatrixGame({clock:()=>clock.now,onEvent:e=>{if(e.type==='result')results.push(e);},options:{catchHalf:half}});game.setConnection(true);game.start();
    const frame=t=>({frameId:`f${t}`,captureTime:t,nose:{x:.5+.065,y:.4,visibility:1},leftShoulder:null,rightShoulder:null});   // 0.065 away from the middle landing x
    game.addFrame(frame(0));game.tick();
    game.receiveChat({notificationId:'n',messageId:'m',actorId:'a',receivedAt:0,text:'!drop 2'});
    for(clock.now=33;clock.now<4000;clock.now+=33){game.addFrame(frame(clock.now));game.tick();}
    return results.find(r=>r.kind==='DROP')?.outcome;
  };
  assert.equal(miss(.075),'CATCH');assert.equal(miss(LEVELS.HARD.catchHalf),'MISS');
});
test('DIFF-07 the picker draws without throwing and the app wires it in',()=>{
  const calls=[];const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:(...a)=>{calls.push(k);},set:(t,k,v)=>{t[k]=v;return true;}});
  drawPicker(ctx,{x:0,y:0,width:1920,height:1080},{zone:'HARD'});drawPicker(ctx,null,null);
  assert.ok(calls.includes('fillText'));
  const app=readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8'),server=readFileSync(new URL('../scripts/serve-local.mjs',import.meta.url),'utf8');
  assert.match(app,/from '\.\/difficulty\.mjs'/);assert.match(app,/session\.phase='choose'/);assert.match(app,/applyWaves\(waves,playLevel\)/);assert.doesNotMatch(app,/scaleFall\(next/);assert.ok(server.includes('difficulty.mjs'));
});

test('DIFF-08 a sideways tilt that lowers the nose and brings it back is not a nod, but a nod with a steady x is',()=>{
  const run=(series)=>{const n=new NodDetector();let hits=0;series.forEach(([y,t,x])=>{if(n.update(y,t,x))hits++;});return hits;};
  const still=[];for(let t=0;t<1000;t+=33)still.push([.8,t,.5]);
  const tilt=[...still,[.84,1033,.52],[.9,1100,.58],[.98,1200,.62],[.92,1300,.6],[.82,1400,.52],[.8,1500,.5]];   // x moves 0.12 while the nose dips and returns
  assert.equal(run(tilt),0);
  const nodSteady=[...still,[.84,1033,.5],[.9,1100,.505],[.86,1200,.5],[.81,1300,.5],[.8,1400,.5]];
  assert.equal(run(nodSteady),1);
});

test('DIFF-09 harder levels send more pies and more twin pies; applyWaves puts them into the generator',async()=>{
  const {applyWaves}=await import('../dist/difficulty.mjs');
  const l=LEVEL_ORDER.map(id=>LEVELS[id]);
  for(let i=1;i<l.length;i++){assert.ok(l[i].pieShare[0]>l[i-1].pieShare[0]);assert.ok(l[i].pieShare[1]>l[i-1].pieShare[1]);assert.ok(l[i].doublePie>=l[i-1].doublePie);}
  assert.equal(LEVELS.EASY.doublePie,0);assert.ok(LEVELS.HARD.doublePie>0);
  const waves={};applyWaves(waves,LEVELS.HARD);
  assert.deepEqual([waves.bombStart,waves.bombEnd,waves.doublePie,waves.speed],[LEVELS.HARD.pieShare[0],LEVELS.HARD.pieShare[1],LEVELS.HARD.doublePie,LEVELS.HARD.speed]);
  applyWaves(waves,null);assert.equal(waves.doublePie,LEVELS.NORMAL.doublePie);
});

test('DIFF-10 every level has its own grade thresholds, lower for the harder levels, and gradeFor uses them',async()=>{
  const {gradeFor,DEFAULT_GRADES}=await import('../dist/matrix.mjs');
  const g=LEVEL_ORDER.map(id=>LEVELS[id].grades);
  for(let i=1;i<g.length;i++){assert.ok(g[i].S<g[i-1].S&&g[i].A<g[i-1].A&&g[i].B<g[i-1].B);}
  for(const x of g)assert.ok(x.S>x.A&&x.A>x.B&&x.B>0);
  assert.deepEqual({...LEVELS[DEFAULT_LEVEL].grades},{...DEFAULT_GRADES});
  assert.equal(gradeFor(120,LEVELS.NORMAL.grades),'A');assert.equal(gradeFor(120,LEVELS.HARD.grades),'S');assert.equal(gradeFor(120,LEVELS.EASY.grades),'A');assert.equal(gradeFor(70,LEVELS.EASY.grades),null);
});
