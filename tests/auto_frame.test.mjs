import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoFrame} from '../dist/auto_frame.mjs';

const face=(cx=.5,cy=.42,fw=.166)=>({cx,cy,fw});

test('AUTO-01 frames only after the face has been steady for the required frames',()=>{
  const a=new AutoFrame({frames:5});
  for(let i=0;i<4;i++)assert.equal(a.update(face(.5,.42,.12),i*33),null);
  const crop=a.update(face(.5,.42,.12),4*33);
  assert.ok(crop);assert.ok(Math.abs(1-crop.left-crop.right-.78)<.001);   // 0.12 face width x 6.5 face widths
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

test('AUTO-07 turning the head (narrower face, same height) does not re-frame; moving closer or farther (height changes) does',()=>{
  const a=new AutoFrame({frames:1,holdMs:500});a.update({cx:.5,cy:.45,fw:.16,fh:.28},0);
  for(let t=33;t<5000;t+=33)assert.equal(a.update({cx:.5,cy:.45,fw:.07,fh:.28},t),null);       // yaw: width halves, height unchanged
  a.update({cx:.5,cy:.45,fw:.16,fh:.5},6000);
  assert.ok(a.update({cx:.5,cy:.45,fw:.16,fh:.5},6600),'face got much taller: re-frame');
});

import {createCropGate} from '../dist/auto_frame.mjs';
test('GATE-01 (theme) a crop is held while a shot is on screen, applied once the field is clear, and a newer crop replaces an older held one',()=>{
  const g=createCropGate(),a={left:.1,right:.1,top:.1,bottom:.1},b={left:.2,right:.2,top:.2,bottom:.2};
  assert.equal(g.take(false),null);                         // nothing offered
  g.offer(a);assert.equal(g.pending,true);assert.equal(g.take(true),null);assert.equal(g.pending,true);   // a ball is falling: hold it
  g.offer(b);g.offer(null);assert.equal(g.take(true),null);  // a newer crop replaces; null offers change nothing
  assert.equal(g.take(false),b);assert.equal(g.pending,false);assert.equal(g.take(false),null);          // applied once, only the newest
  g.offer(a);g.clear();assert.equal(g.take(false),null);
});

test('AUTO-DRIFT a face that settles far from where the crop was built is framed again after the hold time, a game lean never is',()=>{
  const a=new AutoFrame({frames:3,holdMs:2000});
  for(let i=0;i<3;i++)a.update(face(.5,.42,.12),i*33);   // framed at the centre
  assert.equal(a.update(face(.5+.12*1.1,.42,.12),200),null);   // a 1.1 face-width lean: never re-framed
  assert.equal(a.update(face(.5+.12*1.1,.42,.12),5000),null);
  assert.equal(a.update(face(.5+.12*3,.42,.12),6000),null);    // 3 face widths away: starts the hold
  assert.equal(a.update(face(.5+.12*3,.42,.12),7500),null);    // not held long enough
  const crop=a.update(face(.5+.12*3,.42,.12),8100);
  assert.ok(crop,'framed again around the new position');
});
test('AUTO-LOST after the face was missing for a while the next steady face is framed again',()=>{
  const a=new AutoFrame({frames:3,lostMs:1500});
  for(let i=0;i<3;i++)a.update(face(.5,.42,.12),i*33);
  assert.equal(a.update(null,1000),null);assert.equal(a.update(null,2000),null);
  assert.equal(a.update(face(.2,.42,.12),3000),null);   // back: counting steady frames again
  assert.equal(a.update(face(.2,.42,.12),3033),null);
  const crop=a.update(face(.2,.42,.12),3066);
  assert.ok(crop);
  const quick=new AutoFrame({frames:3,lostMs:1500});
  for(let i=0;i<3;i++)quick.update(face(.5,.42,.12),i*33);
  quick.update(null,500);assert.equal(quick.update(face(.5,.42,.12),900),null);assert.equal(quick.update(face(.5,.42,.12),933),null);   // a short loss changes nothing
});
