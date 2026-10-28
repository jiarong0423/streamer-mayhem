import test from 'node:test';
import assert from 'node:assert/strict';
import {CatchBurst,loadSprites,FX_SPRITES} from '../dist/catch_fx.mjs';

function fakeCtx(){
  const calls=[];
  const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:(...a)=>{calls.push([k,a]);},set:(t,k,v)=>{t[k]=v;return true;}});
  return {ctx,calls};
}
const sprite={};

test('FX-01 spawn creates one burst with the configured particle count and ignores bad input',()=>{
  const b=new CatchBurst({count:10});
  assert.equal(b.spawn(100,200,0,120),true);assert.equal(b.bursts[0].particles.length,10);
  for(const bad of [[NaN,0,0,10],[0,NaN,0,10],[0,0,NaN,10],[0,0,0,0],[0,0,0,-5]])assert.equal(b.spawn(...bad),false);
  assert.equal(b.bursts.length,1);
  assert.throws(()=>new CatchBurst({count:0}),RangeError);assert.throws(()=>new CatchBurst({count:100}),RangeError);
});

test('FX-02 bursts are deterministic per spawn order and the number alive is bounded',()=>{
  const a=new CatchBurst({maxBursts:3}),b=new CatchBurst({maxBursts:3});
  for(let i=0;i<5;i++){a.spawn(0,0,i,100);b.spawn(0,0,i,100);}
  assert.equal(a.bursts.length,3);assert.deepEqual(a.bursts.map(x=>x.particles[0].vx),b.bursts.map(x=>x.particles[0].vx));
});

test('FX-03 particles move outward over time and finished bursts are removed',()=>{
  const b=new CatchBurst({count:12,life:800,ringLife:500});b.spawn(300,400,1000,120);
  const burst=b.bursts[0],p=burst.particles[0];
  const early=CatchBurst.position(burst,p,50),late=CatchBurst.position(burst,p,600);
  assert.ok(Math.hypot(late.x-300,late.y-400)>Math.hypot(early.x-300,early.y-400));
  assert.equal(b.prune(1799),1);assert.equal(b.prune(1800),0);
});

test('FX-04 draw uses the sprites, stays inside the clip and does nothing when idle',()=>{
  const idle=fakeCtx();new CatchBurst().draw(idle.ctx,0,{sparkle:sprite},{x:0,y:0,width:10,height:10});assert.equal(idle.calls.length,0);
  const b=new CatchBurst({count:8});b.spawn(100,100,0,100);
  const {ctx,calls}=fakeCtx();b.draw(ctx,100,{sparkle:sprite,ring:sprite,flare:sprite},{x:0,y:0,width:400,height:300});
  assert.ok(calls.some(([k])=>k==='clip'));
  assert.equal(calls.filter(([k])=>k==='drawImage').length,8+1+1);
  assert.equal(calls.filter(([k])=>k==='save').length,calls.filter(([k])=>k==='restore').length);
});

test('FX-05 without sprites it falls back to plain dots',()=>{
  const b=new CatchBurst({count:6});b.spawn(50,50,0,80);
  const {ctx,calls}=fakeCtx();b.draw(ctx,100,{});
  assert.equal(calls.filter(([k])=>k==='drawImage').length,0);assert.equal(calls.filter(([k])=>k==='arc').length,6);
});

test('FX-06 loadSprites keeps the images that load and skips the ones that fail',async()=>{
  const made=[];
  const makeImage=()=>{const img={};made.push(img);Object.defineProperty(img,'src',{set(url){queueMicrotask(()=>url.includes('star_02')?img.onerror():img.onload());}});return img;};
  const sprites=await loadSprites(FX_SPRITES,makeImage,{color:null});
  assert.deepEqual(Object.keys(sprites).sort(),['flare','sparkle']);
});

test('FX-07 sprites are tinted through a canvas with multiply, and fall back to the original when no canvas works',async()=>{
  const ops=[];
  const makeImage=()=>{const img={naturalWidth:8,naturalHeight:8};Object.defineProperty(img,'src',{set(){queueMicrotask(()=>img.onload());}});return img;};
  const makeCanvas=(w,h)=>({width:w,height:h,getContext:()=>new Proxy({},{get:(t,k)=>k in t?t[k]:(...a)=>{ops.push([k,a]);},set:(t,k,v)=>{t[k]=v;ops.push(['set:'+k,v]);return true;}})});
  const tintedSprites=await loadSprites({a:'x.png'},makeImage,{color:'#ffd23f',makeCanvas});
  assert.equal(tintedSprites.a.width,8);assert.ok(ops.some(([k,v])=>k==='set:globalCompositeOperation'&&v==='multiply'));assert.ok(ops.some(([k,v])=>k==='set:fillStyle'&&v==='#ffd23f'));
  const fallback=await loadSprites({a:'x.png'},makeImage,{color:'#fff',makeCanvas:()=>{throw new Error('no canvas');}});
  assert.equal(fallback.a.naturalWidth,8);
});
