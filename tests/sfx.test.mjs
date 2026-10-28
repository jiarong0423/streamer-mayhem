import test from 'node:test';
import assert from 'node:assert/strict';
import {createSfx,SFX_KEY,SFX_PEAK_DB,MOSQUITO_DB,COMBO_SCALE} from '../dist/sfx.mjs';

const db=d=>Math.pow(10,d/20);

// A fake AudioContext that records what would have been scheduled. Nothing is played.
class Param {
  constructor(v=0){this.value=v;this.calls=[];}
  setValueAtTime(v,t){this.value=v;this.calls.push({m:'set',v,t});}
  linearRampToValueAtTime(v,t){this.calls.push({m:'lin',v,t});}
  exponentialRampToValueAtTime(v,t){this.calls.push({m:'exp',v,t});}
  setTargetAtTime(v,t,tau){this.calls.push({m:'target',v,t,tau});}
  cancelScheduledValues(){}
}
class Node {
  constructor(ctx,kind){this.ctx=ctx;this.kind=kind;this.out=[];this.disconnected=false;ctx.nodes.push(this);}
  connect(to){this.out.push(to);return to;}
  disconnect(){this.disconnected=true;}
}
class Osc extends Node {
  constructor(ctx){super(ctx,'osc');this.type='sine';this.frequency=new Param(440);this.starts=[];this.stops=[];this.onended=null;}
  start(t=this.ctx.currentTime){this.starts.push(t);}
  stop(t=this.ctx.currentTime){this.stops.push(t);}
}
class FakeCtx {
  constructor({state='suspended'}={}){this.currentTime=0;this.state=state;this.sampleRate=8000;this.nodes=[];this.destination=new Node(this,'destination');this.suspends=0;this.resumes=0;}
  createGain(){const n=new Node(this,'gain');n.gain=new Param(1);return n;}
  createOscillator(){return new Osc(this);}
  createBiquadFilter(){const n=new Node(this,'filter');n.frequency=new Param(350);n.Q=new Param(1);n.type='lowpass';return n;}
  createDynamicsCompressor(){const n=new Node(this,'compressor');for(const k of ['threshold','knee','ratio','attack','release'])n[k]=new Param(0);return n;}
  createDelay(){const n=new Node(this,'delay');n.delayTime=new Param(0);return n;}
  createBufferSource(){const n=new Node(this,'source');n.start=t=>{n.started=t;};n.stop=t=>{n.stopped=t;};n.onended=null;return n;}
  createBuffer(ch,len){return {length:len,getChannelData:()=>new Float32Array(len)};}
  async resume(){this.resumes++;this.state='running';}
  async suspend(){this.suspends++;this.state='suspended';}
  // Moves time forward and fires onended for sources whose stop time has passed.
  advance(dt){this.currentTime+=dt;for(const n of this.nodes)if(n.onended&&(n.stops?.length||n.stopped!==undefined)&&(n.stops?.at(-1)??n.stopped)<=this.currentTime){const f=n.onended;n.onended=null;f();}}
}
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),m};};
async function ready(options={}){
  const holder={},storage=options.storage??memory();
  const sfx=createSfx({ctxFactory:()=>holder.ctx=new FakeCtx(),storage,...options.sfx});
  sfx.setEnabled(true);await sfx.unlock();
  return {sfx,ctx:holder.ctx,storage};
}
const sources=ctx=>ctx.nodes.filter(n=>n.kind==='osc'||n.kind==='source');
const peak=nodes=>Math.max(...nodes.filter(n=>n.kind==='gain'&&n.gain.calls.length).flatMap(n=>n.gain.calls.filter(c=>c.m!=='target').map(c=>c.v)),0);

test('SFX-01 muted and locked by default: play builds no node at all',async()=>{
  let made=0;const sfx=createSfx({ctxFactory:()=>{made++;return new FakeCtx();},storage:memory()});
  assert.equal(sfx.status(),'MUTED');assert.equal(sfx.play('catch'),false);assert.equal(made,0);
  sfx.setEnabled(true);assert.equal(sfx.status(),'AUDIO LOCKED');assert.equal(sfx.play('catch'),false);assert.equal(made,0);
});

test('SFX-02 unlock resumes the one context, status becomes AUDIO READY, the chain ends in a limiter',async()=>{
  let made=0;const holder={};const sfx=createSfx({ctxFactory:()=>{made++;return holder.ctx=new FakeCtx();},storage:memory()});
  sfx.setEnabled(true);assert.equal(await sfx.unlock(),true);await sfx.unlock();
  assert.equal(made,1);assert.equal(sfx.status(),'AUDIO READY');assert.equal(holder.ctx.state,'running');
  const comp=holder.ctx.nodes.find(n=>n.kind==='compressor');
  assert.equal(comp.threshold.value,-14);assert.equal(comp.ratio.value,8);assert.equal(comp.knee.value,12);
  assert.ok(comp.out.includes(holder.ctx.destination));
  const master=holder.ctx.nodes.filter(n=>n.kind==='gain').find(n=>n.out.includes(comp));
  assert.ok(master,'master gain feeds the limiter');assert.ok(Math.abs(master.gain.value-0.5)<1e-9,'about -6 dB');
});

test('SFX-03 a failing context factory leaves it locked without throwing',async()=>{
  const sfx=createSfx({ctxFactory:()=>{throw new Error('AUDIO_UNSUPPORTED');},storage:memory()});
  sfx.setEnabled(true);assert.equal(await sfx.unlock(),false);assert.equal(sfx.status(),'AUDIO LOCKED');assert.equal(sfx.play('catch'),false);
});

test('SFX-04 enabled flag and volume are remembered; an enabled flag still needs a click to unlock; broken storage is tolerated',async()=>{
  const storage=memory();const a=createSfx({ctxFactory:()=>new FakeCtx(),storage});a.setEnabled(true);a.setVolume(.4);
  assert.deepEqual(JSON.parse(storage.m.get(SFX_KEY)),{enabled:true,volume:.4});
  const b=createSfx({ctxFactory:()=>new FakeCtx(),storage});assert.equal(b.enabled,true);assert.equal(b.volume,.4);assert.equal(b.status(),'AUDIO LOCKED');
  const broken={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  const c=createSfx({ctxFactory:()=>new FakeCtx(),storage:broken});assert.equal(c.status(),'MUTED');assert.doesNotThrow(()=>{c.setEnabled(true);c.setVolume(.5);});
  assert.equal(createSfx({ctxFactory:()=>new FakeCtx(),storage:{getItem:()=>'{not json',setItem(){}}}).status(),'MUTED');
});

test('SFX-05 every sound stays under its spec peak and under -6 dB; every oscillator and source has a stop; all disconnect when finished',async()=>{
  for(const name of ['catch','miss','bombWarn','bomb','avoid','hit','dodge','swat','bite','roundStart','roundEnd','tick']){
    const {sfx,ctx}=await ready();const before=ctx.nodes.length;
    assert.equal(sfx.play(name,{leadMs:1500}),true,name);
    const created=ctx.nodes.slice(before);
    const limit=SFX_PEAK_DB[name]!==undefined?db(SFX_PEAK_DB[name]):db(-6);
    // The delay feedback/wet gains (0.25/0.3) are not signal peaks; only voice envelopes are measured.
    const envelopes=created.filter(n=>n.kind==='gain'&&n.gain.calls.length);
    assert.ok(envelopes.length>0,name);
    assert.ok(peak(envelopes)<=limit+1e-9,`${name} peak ${peak(envelopes)} > ${limit}`);
    assert.ok(peak(envelopes)<=db(-6),name);
    for(const s of sources(ctx).filter(n=>created.includes(n)))assert.ok((s.stops?.length??(s.stopped!==undefined?1:0))>=1,`${name} source without stop`);
    ctx.advance(3);assert.ok(created.every(n=>n.disconnected||n.kind==='compressor'||n.kind==='destination'),`${name} leaked a node`);
  }
});

test('SFX-06 no sound is longer than 450 ms except the multi-note jingles and the swat follow-up',async()=>{
  for(const name of ['catch','miss','avoid','hit','dodge','bite','tick','bomb']){
    const {sfx,ctx}=await ready();sfx.play(name);
    for(const s of sources(ctx)){const end=(s.stops?.at(-1)??s.stopped),start=(s.starts?.[0]??s.started);if(end-start>=0.89)continue;   /* the silent timer that releases the explosion room */assert.ok(end-start<=0.471,`${name} ${end-start}`);}
  }
});

test('SFX-07 the same sound within 40 ms is dropped, a different sound or a later one plays',async()=>{
  const {sfx,ctx}=await ready();
  assert.equal(sfx.play('catch'),true);ctx.advance(.02);assert.equal(sfx.play('catch'),false);assert.equal(sfx.play('miss'),true);
  ctx.advance(.03);assert.equal(sfx.play('catch'),true);
});

test('SFX-08 at most 8 voices sound at once; the oldest of the same sound is dropped to make room',async()=>{
  const {sfx,ctx}=await ready({sfx:{dedupeMs:0}});
  for(let i=0;i<12;i++){assert.equal(sfx.play('roundEnd'),true);ctx.advance(.001);}
  const live=sources(ctx).filter(s=>!s.disconnected);
  assert.ok(live.length>0);assert.ok(sources(ctx).filter(s=>s.stops.includes(0)).length>0,'something was cut off');
  // each roundEnd is four oscillators: 8 voices at most means at most 32 live oscillators
  assert.ok(live.length<=8*4,`live oscillators ${live.length}`);
});

test('SFX-09 combo streak: the catch pitch follows the pentatonic scale and is capped at the 8th step',async()=>{
  const mains=[];
  for(const combo of [0,1,2,5,8,12]){
    const {sfx,ctx}=await ready();sfx.play('catch',{combo});
    mains.push(sources(ctx).find(s=>s.kind==='osc').frequency.calls[0].v);
  }
  assert.deepEqual(mains,[880,COMBO_SCALE[0],COMBO_SCALE[1],COMBO_SCALE[4],COMBO_SCALE[7],COMBO_SCALE[7]]);
  assert.ok(COMBO_SCALE.every((f,i,a)=>i===0||f>a[i-1]));
});

test('SFX-10 the bomb warning schedules three beeps that close in on the impact',async()=>{
  const {sfx,ctx}=await ready();sfx.play('bombWarn',{leadMs:2000});
  const starts=sources(ctx).map(s=>s.starts[0]);
  assert.equal(starts.length,3);
  assert.ok(Math.abs(starts[0]-1.5)<1e-9&&Math.abs(starts[1]-1.75)<1e-9&&Math.abs(starts[2]-1.92)<1e-9,JSON.stringify(starts));
  const early=await ready();early.sfx.play('bombWarn',{leadMs:100});
  assert.deepEqual(sources(early.ctx).map(s=>s.starts[0]),[0,.25,.42]);   // already inside the last half second: starts now
  const bad=await ready();bad.sfx.play('bombWarn',{leadMs:NaN});assert.equal(sources(bad.ctx).length,3);
});

test('SFX-11 the mosquito hum is quiet, rises with proximity, and every parameter move is smoothed',async()=>{
  const {sfx,ctx}=await ready();
  assert.equal(sfx.mosquitoLoop.start(),true);
  const osc=sources(ctx).find(s=>s.type==='sawtooth');
  const hum=ctx.nodes.filter(n=>n.kind==='gain'&&n.gain.calls.some(c=>c.m==='target'))[0];
  const levels=[],freqs=[];
  for(const dist of [1,.75,.5,.25,0]){sfx.mosquitoLoop.update({dist});const g=hum.gain.calls.filter(c=>c.m==='target').at(-1).v,f=osc.frequency.calls.filter(c=>c.m==='target').at(-1).v;levels.push(g);freqs.push(f);}
  for(let i=1;i<levels.length;i++){assert.ok(levels[i]>levels[i-1]);assert.ok(freqs[i]>freqs[i-1]);}
  assert.ok(Math.abs(freqs[0]-380)<1e-9&&Math.abs(freqs.at(-1)-500)<1e-9);
  assert.ok(Math.abs(levels[0]-db(-34))<1e-9&&levels.at(-1)<=db(-22)+1e-9);
  // out-of-range or garbage input is clamped
  sfx.mosquitoLoop.update({dist:-5});assert.ok(hum.gain.calls.at(-1).v<=db(-22)+1e-9);
  sfx.mosquitoLoop.update({dist:99});assert.ok(Math.abs(hum.gain.calls.at(-1).v-db(-34))<1e-9);
  sfx.mosquitoLoop.update({dist:NaN});assert.ok(Math.abs(hum.gain.calls.at(-1).v-db(-34))<1e-9);
  sfx.mosquitoLoop.update({landed:true,progress:0});assert.ok(Math.abs(osc.frequency.calls.at(-1).v-520)<1e-9);assert.ok(Math.abs(hum.gain.calls.at(-1).v-db(-24))<1e-9);
  assert.ok(db(MOSQUITO_DB.near)<=db(-22)+1e-12);
  sfx.mosquitoLoop.stop();assert.equal(sfx.mosquitoLoop.active,false);assert.ok(osc.stops.length>=1);
  ctx.advance(1);assert.equal(osc.disconnected,true);
  assert.equal(sfx.mosquitoLoop.update({dist:0}),false);
});

test('SFX-12 landing ticks: every 250 ms, then every 100 ms in the last quarter with rising pitch; none while flying',async()=>{
  const {sfx,ctx}=await ready();sfx.mosquitoLoop.start();
  for(let i=0;i<40;i++){sfx.mosquitoLoop.update({dist:.5,landed:false});ctx.advance(.016);}
  assert.equal(sources(ctx).filter(s=>s.type==='sine'&&s.frequency.calls[0]?.v>=1500).length,0);
  const t0=ctx.currentTime;
  for(let i=0;i<180;i++){const p=Math.min(1,(ctx.currentTime-t0)/2);sfx.mosquitoLoop.update({landed:true,progress:p});ctx.advance(.016);}
  const ticks=sources(ctx).filter(s=>s.type==='sine'&&s.frequency.calls[0]?.v>=1500).map(s=>({t:s.starts[0]-t0,f:s.frequency.calls[0].v})).sort((a,b)=>a.t-b.t);
  const gaps=ticks.slice(1).map((x,i)=>+(x.t-ticks[i].t).toFixed(3));
  const slow=gaps.filter((g,i)=>ticks[i+1].t<1.5),fast=gaps.filter((g,i)=>ticks[i].t>=1.75);
  assert.ok(slow.length>=5&&slow.every(g=>Math.abs(g-.25)<.011),JSON.stringify(slow));
  assert.ok(fast.length>=4&&fast.every(g=>Math.abs(g-.1)<.011),JSON.stringify(fast));
  const late=ticks.filter(x=>x.t>=1.75).map(x=>x.f);for(let i=1;i<late.length;i++)assert.ok(late[i]>late[i-1]);
  assert.ok(ticks.slice(0,6).every(x=>x.f===1500));
  // leaving the face restarts the cadence next time
  sfx.mosquitoLoop.update({landed:false});const n=ticks.length;sfx.mosquitoLoop.update({landed:true,progress:0});
  assert.equal(sources(ctx).filter(s=>s.type==='sine'&&s.frequency.calls[0]?.v>=1500).length,n+1);
});

test('SFX-13 swat and bite stop the hum; setEnabled(false) silences everything and the master follows the volume squared',async()=>{
  const {sfx,ctx}=await ready();sfx.mosquitoLoop.start();assert.equal(sfx.mosquitoLoop.active,true);
  sfx.play('swat');assert.equal(sfx.mosquitoLoop.active,false);
  sfx.mosquitoLoop.start();sfx.play('bite');assert.equal(sfx.mosquitoLoop.active,false);
  const comp=ctx.nodes.find(n=>n.kind==='compressor'),master=ctx.nodes.filter(n=>n.kind==='gain').find(n=>n.out.includes(comp));
  sfx.setVolume(.5);assert.ok(Math.abs(master.gain.calls.at(-1).v-.5*.25)<1e-9);
  sfx.setVolume(7);assert.ok(Math.abs(master.gain.calls.at(-1).v-.5)<1e-9);sfx.setVolume(NaN);assert.equal(sfx.volume,1);sfx.setVolume(-3);assert.equal(sfx.volume,0);
  sfx.setVolume(1);sfx.mosquitoLoop.start();sfx.play('roundStart');
  sfx.setEnabled(false);assert.equal(sfx.mosquitoLoop.active,false);assert.equal(master.gain.calls.at(-1).v,0);assert.equal(sfx.play('catch'),false);assert.equal(sfx.status(),'MUTED');
});

test('SFX-14 hidden page: suspend stops the hum and suspends the context; resume resumes; keepAlive ignores hiding',async()=>{
  const {sfx,ctx}=await ready();sfx.mosquitoLoop.start();
  sfx.suspend();assert.equal(ctx.suspends,1);assert.equal(sfx.mosquitoLoop.active,false);assert.equal(sfx.play('catch'),false);
  const before=ctx.resumes;sfx.resume();await Promise.resolve();assert.equal(ctx.resumes,before+1);assert.equal(sfx.play('catch'),true);
  const kept=await ready({sfx:{keepAlive:true}});kept.sfx.suspend();assert.equal(kept.ctx.suspends,0);
});

test('SFX-15 unknown names and garbage options are harmless',async()=>{
  const {sfx}=await ready({sfx:{dedupeMs:0}});
  assert.equal(sfx.play('nope'),false);assert.equal(sfx.play(undefined),false);
  for(const opts of [undefined,{},{combo:NaN},{combo:-4},{combo:1e9},{freq:'x',at:-1,leadMs:-9}])assert.doesNotThrow(()=>{sfx.play('catch',opts);sfx.play('tick',opts);sfx.play('bombWarn',opts);});
});
