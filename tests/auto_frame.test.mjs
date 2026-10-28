import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoFrame} from '../dist/auto_frame.mjs';

const face=(cx=.5,cy=.42,fw=.166)=>({cx,cy,fw});

test('AUTO-01 frames only after the face has been steady for the required frames',()=>{
  const a=new AutoFrame({frames:5});
  for(let i=0;i<4;i++)assert.equal(a.update(face(),i*33),null);
  const crop=a.update(face(),4*33);
  assert.ok(crop);assert.ok(Math.abs(1-crop.left-crop.right-.996)<.001);
});

test('AUTO-02 a missing face restarts the steady count',()=>{
  const a=new AutoFrame({frames:3});
  a.update(face(),0);a.update(face(),33);a.update(null,66);
  assert.equal(a.update(face(),99),null);assert.equal(a.update(face(),132),null);
  assert.ok(a.update(face(),165));
});

test('AUTO-03 leaning or moving without a size change never re-frames',()=>{
  const a=new AutoFrame({frames:1,holdMs:500});assert.ok(a.update(face(),0));
  for(let t=33;t<6000;t+=33)assert.equal(a.update(face(.5+(t%700)/2000,.3+(t%300)/1500,.166*(1+((t%100)-50)/1000)),t),null);
});

test('AUTO-04 re-frames only after the face stays much bigger or smaller for the hold time',()=>{
  const a=new AutoFrame({frames:1,holdMs:1000});a.update(face(),0);
  assert.equal(a.update(face(.5,.42,.30),100),null);
  assert.equal(a.update(face(.5,.42,.30),900),null);
  const crop=a.update(face(.5,.42,.30),1200);
  assert.ok(crop);assert.ok(Math.abs(1-crop.left-crop.right-Math.min(1,.30*6))<.001);
  // The new size is the reference now, so staying there is stable.
  assert.equal(a.update(face(.5,.42,.30),5000),null);
});

test('AUTO-05 a brief size blip does not re-frame and the timer restarts',()=>{
  const a=new AutoFrame({frames:1,holdMs:1000});a.update(face(),0);
  a.update(face(.5,.42,.30),100);a.update(face(),600);
  assert.equal(a.update(face(.5,.42,.30),1500),null);
  assert.equal(a.update(face(.5,.42,.30),2000),null);
});

test('AUTO-06 reset and adopt manage the reference; bad faces are ignored',()=>{
  const a=new AutoFrame({frames:1});assert.ok(a.update(face(),0));
  a.reset();assert.ok(a.update(face(),10));
  a.adopt(face(.5,.5,.3));assert.equal(a.update(face(.5,.5,.3),20),null);
  for(const bad of [null,undefined,{cx:NaN,cy:.5,fw:.2},{cx:.5,cy:.5,fw:0}]){const b=new AutoFrame({frames:1});assert.equal(b.update(bad,0),null);}
  assert.throws(()=>new AutoFrame({frames:0}),RangeError);assert.throws(()=>new AutoFrame({low:1.2}),RangeError);
});
