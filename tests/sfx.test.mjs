import test from 'node:test';
import assert from 'node:assert/strict';
import {createSfx,SFX_KEY,SFX_PEAK_DB,COMBO_SCALE} from '../dist/sfx.mjs';

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
  for(const name of ['catch','miss','bombWarn','bomb','avoid','hit','dodge','roundStart','roundEnd','tick']){
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

test('SFX-06 no sound is longer than 450 ms except the multi-note jingles',async()=>{
  for(const name of ['catch','miss','avoid','hit','dodge','tick','bomb']){
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

test('SFX-10 the pie warning is an alarm: pulses every 0.2 s through the first 72% of the pie time',async()=>{
  const {sfx,ctx}=await ready();sfx.play('bombWarn',{leadMs:1700});
  const starts=sources(ctx).map(s=>s.starts[0]);
  assert.equal(starts.length,6);   // floor(1.7*.72/.2)
  assert.ok(starts.every((t,i)=>Math.abs(t-i*.2)<1e-9),JSON.stringify(starts));
  const early=await ready();early.sfx.play('bombWarn',{leadMs:100});
  assert.equal(sources(early.ctx).length,2);   // at least two pulses even for a very short lead
  const bad=await ready();bad.sfx.play('bombWarn',{leadMs:NaN});assert.equal(sources(bad.ctx).length,2);
  const long=await ready();long.sfx.play('bombWarn',{leadMs:60000});assert.ok(sources(long.ctx).length<=8);
});

test('SFX-13 setEnabled(false) silences everything and the master follows the volume squared',async()=>{
  const {sfx,ctx}=await ready();
  const comp=ctx.nodes.find(n=>n.kind==='compressor'),master=ctx.nodes.filter(n=>n.kind==='gain').find(n=>n.out.includes(comp));
  sfx.setVolume(.5);assert.ok(Math.abs(master.gain.calls.at(-1).v-.5*.25)<1e-9);
  sfx.setVolume(7);assert.ok(Math.abs(master.gain.calls.at(-1).v-.5)<1e-9);sfx.setVolume(NaN);assert.equal(sfx.volume,1);sfx.setVolume(-3);assert.equal(sfx.volume,0);
  sfx.setVolume(1);sfx.play('roundStart');
  sfx.setEnabled(false);assert.equal(master.gain.calls.at(-1).v,0);assert.equal(sfx.play('catch'),false);assert.equal(sfx.status(),'MUTED');
});

test('SFX-14 hidden page: suspend suspends the context; resume resumes; keepAlive ignores hiding',async()=>{
  const {sfx,ctx}=await ready();
  sfx.suspend();assert.equal(ctx.suspends,1);assert.equal(sfx.play('catch'),false);
  const before=ctx.resumes;sfx.resume();await Promise.resolve();assert.equal(ctx.resumes,before+1);assert.equal(sfx.play('catch'),true);
  const kept=await ready({sfx:{keepAlive:true}});kept.sfx.suspend();assert.equal(kept.ctx.suspends,0);
});

test('SFX-15 unknown names and garbage options are harmless',async()=>{
  const {sfx}=await ready({sfx:{dedupeMs:0}});
  assert.equal(sfx.play('nope'),false);assert.equal(sfx.play(undefined),false);
  for(const opts of [undefined,{},{combo:NaN},{combo:-4},{combo:1e9},{freq:'x',at:-1,leadMs:-9}])assert.doesNotThrow(()=>{sfx.play('catch',opts);sfx.play('tick',opts);sfx.play('bombWarn',opts);});
});

test('SFX-T1 (theme) swish, rim, splat and shoot are synthesized: each plays, builds sources and stays quiet',async()=>{
  for(const name of ['swish','rim','splat','shoot']){
    const {sfx,ctx}=await ready();
    assert.equal(sfx.play(name,{skipDedupe:true}),true,`${name} plays`);
    assert.ok(sources(ctx).length>=1,`${name} builds at least one source`);
    assert.ok(peak(ctx.nodes)<=Math.pow(10,-9/20)+1e-9,`${name} peak stays below -9 dB`);
  }
});
