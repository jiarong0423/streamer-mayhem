import test from 'node:test';
import assert from 'node:assert/strict';
import {MotionProbe,grayFromRgba} from '../dist/motion_probe.mjs';

const W=64,H=36;
const frame=(fill=100)=>new Uint8Array(W*H).fill(fill);
const block=(f,x0,y0,x1,y1,v)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)f[y*W+x]=v;return f;};

test('PROBE-01 a still scene reads 0 and the first frame only seeds the comparison',()=>{
  const p=new MotionProbe();assert.equal(p.level({x:.5,y:.5,r:.1}),0);
  assert.equal(p.push(frame()),true);assert.equal(p.level({x:.5,y:.5,r:.1}),0);
  p.push(frame());assert.equal(p.level({x:.5,y:.5,r:.1}),0);
});

test('PROBE-02 something moving inside the region reads high; the same movement elsewhere reads 0',()=>{
  const p=new MotionProbe();p.push(frame());
  p.push(block(frame(),24,10,40,26,230));                           // a bright block (a hand) around the middle
  assert.ok(p.level({x:.5,y:.5,r:.12})>.6,`${p.level({x:.5,y:.5,r:.12})}`);
  assert.equal(p.level({x:.1,y:.1,r:.06}),0);assert.equal(p.level({x:.9,y:.9,r:.06}),0);
  assert.ok(p.level({x:.5,y:.5,r:.5})>0&&p.level({x:.5,y:.5,r:.5})<.5,'a big circle only partly covered');
});

test('PROBE-03 a change over most of the frame (lighting, shake) is not a hand',()=>{
  const p=new MotionProbe();p.push(frame(100));p.push(frame(160));
  assert.equal(p.level({x:.5,y:.5,r:.2}),0);
  const q=new MotionProbe({globalLimit:1});q.push(frame(100));q.push(frame(160));assert.equal(q.level({x:.5,y:.5,r:.2}),1);
});

test('PROBE-04 small brightness noise is below the threshold',()=>{
  const p=new MotionProbe();const a=frame(100);p.push(a);
  const b=frame(100);for(let i=0;i<b.length;i+=3)b[i]=100+((i/3)%2?10:-10);p.push(b);
  assert.equal(p.level({x:.5,y:.5,r:.3}),0);
});

test('PROBE-05 bad input is ignored: wrong-size frames, NaN or negative regions, regions off the edge',()=>{
  const p=new MotionProbe();assert.equal(p.push(new Uint8Array(10)),false);assert.equal(p.push(null),false);
  p.push(frame());p.push(block(frame(),0,0,10,10,255));
  for(const bad of [{x:NaN,y:.5,r:.1},{x:.5,y:.5,r:0},{x:.5,y:.5,r:-1},{x:.5,y:undefined,r:.1}])assert.equal(p.level(bad),0);
  assert.ok(p.level({x:0,y:0,r:.1})>0,'a region at the corner is clipped, not an error');assert.equal(p.level({x:5,y:5,r:.1}),0);
  p.reset();assert.equal(p.level({x:.1,y:.1,r:.2}),0);
  for(const bad of [{width:4},{threshold:0},{globalLimit:0},{height:1.5}])assert.throws(()=>new MotionProbe(bad),RangeError);
});

test('PROBE-06 grayFromRgba converts to luminance and rejects short buffers',()=>{
  const rgba=new Uint8ClampedArray([255,255,255,255, 0,0,0,255, 255,0,0,255, 0,255,0,255]);
  const g=grayFromRgba(rgba,2,2);assert.equal(g.length,4);assert.ok(g[0]>=253);assert.equal(g[1],0);assert.ok(g[3]>g[2]&&g[2]>0);
  assert.equal(grayFromRgba(rgba,4,4),null);assert.equal(grayFromRgba(null,2,2),null);assert.equal(grayFromRgba(rgba,0,2),null);
});
