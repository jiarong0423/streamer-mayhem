import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixGame,validPoint} from '../dist/matrix.mjs';
import {SyntheticFrameSource} from '../dist/frame_source.mjs';
import {createCameraGeometry,projectCameraFrame,canvasPointToSource,visiblePointToCanvas} from '../dist/camera_geometry.mjs';

const names=['nose','leftShoulder','rightShoulder','leftElbow','rightElbow'];
const point=(x=.5,y=.5,visibility=1)=>({x,y,visibility});
const pose=()=>({nose:point(.5,.2),leftShoulder:point(.4,.4),rightShoulder:point(.6,.4),leftElbow:point(.35,.65),rightElbow:point(.65,.65)});
const makeGeometry=patch=>createCameraGeometry({canvasWidth:1280,canvasHeight:720,
  viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720,...patch});
function setup(geometry=makeGeometry()){
  let now=0,projected;
  const game=new MatrixGame({clock:()=>now});game.setConnection(true);game.start();
  const source=new SyntheticFrameSource({game,clock:()=>now,project:frame=>{projected=projectCameraFrame(frame,geometry);return projected;}});
  game.beforeTick=()=>source.sync();
  return {game,source,at:t=>{now=t;},capture:(points,t=now)=>{now=t;const accepted=source.capture(points);game.tick();return accepted;},projected:()=>projected};
}

test('five distinct joints traverse the actual capture, projection and engine pipeline',()=>{
  const s=setup(),input=pose();assert.equal(s.capture(input),true);
  for(const name of names){
    assert.deepEqual(s.source.lastFrame[name],input[name]);assert.deepEqual(s.game.latestFrame[name],input[name]);
    assert.notEqual(s.source.lastFrame[name],input[name]);assert.notEqual(s.game.latestFrame[name],s.projected()[name]);
  }
  assert.equal(s.game.hp,100);assert.equal(s.game.score,0);
});

test('legacy three-joint callers preserve the previous own-key shapes at every layer',()=>{
  const s=setup(),input=pose();delete input.leftElbow;delete input.rightElbow;assert.equal(s.capture(input),true);
  for(const frame of [s.source.lastFrame,s.projected(),s.game.latestFrame]){
    assert.equal(Object.hasOwn(frame,'leftElbow'),false);assert.equal(Object.hasOwn(frame,'rightElbow'),false);
  }
  assert.deepEqual(Object.keys(s.game.latestFrame),['frameId','captureTime','nose','leftShoulder','rightShoulder']);
  const inherited=Object.assign(Object.create({leftElbow:point(.1,.1),rightElbow:point(.9,.9)}),input);
  assert.equal(s.capture(inherited,1),true);assert.equal(Object.hasOwn(s.game.latestFrame,'leftElbow'),false);
});

test('explicit null, missing, low confidence and invalid elbows never become inferred valid points',()=>{
  const s=setup(),input=pose();input.leftElbow=null;delete input.rightElbow;assert.equal(s.capture(input),true);
  for(const frame of [s.source.lastFrame,s.projected(),s.game.latestFrame]){
    assert.equal(frame.leftElbow,null);assert.equal(Object.hasOwn(frame,'rightElbow'),false);
  }
  const low=pose();low.leftElbow.visibility=.1;low.rightElbow.visibility=0;assert.equal(s.capture(low,1),true);
  assert.equal(s.game.latestFrame.leftElbow.visibility,.1);assert.equal(validPoint(s.game.latestFrame.leftElbow),false);
  assert.equal(s.game.latestFrame.rightElbow.visibility,0);assert.equal(validPoint(s.game.latestFrame.rightElbow),false);
  const invalid=pose();invalid.leftElbow.x=NaN;invalid.rightElbow.x=2;assert.equal(s.capture(invalid,2),true);
  assert.equal(s.game.latestFrame.leftElbow,null);assert.equal(s.game.latestFrame.rightElbow,null);
  const noConfidence=pose();delete noConfidence.leftElbow.visibility;assert.equal(s.capture(noConfidence,3),true);
  assert.equal(s.game.latestFrame.leftElbow,null);assert.equal(s.game.hp,100);assert.equal(s.game.score,0);
});

test('upstream and projector output mutation cannot rewrite retained engine elbow evidence',()=>{
  const s=setup(),input=pose(),expected=structuredClone(input);input.leftElbow.privateField='not-retained';
  assert.equal(s.capture(input),true);
  for(const name of names){input[name].x=.99;input[name].visibility=0;assert.deepEqual(s.source.lastFrame[name],expected[name]);}
  s.projected().leftElbow.x=.99;s.projected().rightElbow.visibility=0;
  assert.deepEqual(s.game.latestFrame.leftElbow,expected.leftElbow);assert.deepEqual(s.game.frames[0].rightElbow,expected.rightElbow);
  assert.equal(Object.hasOwn(s.source.lastFrame.leftElbow,'privateField'),false);
  const direct={frameId:'direct',captureTime:1,...pose()};s.at(1);assert.equal(s.game.addFrame(direct),true);
  direct.leftElbow.x=.01;direct.rightElbow.visibility=0;
  assert.deepEqual(s.game.latestFrame.leftElbow,expected.leftElbow);assert.deepEqual(s.game.latestFrame.rightElbow,expected.rightElbow);
});

test('five-joint source-to-visible mapping survives crop, contain/cover, aspect, mirror and all rotations',()=>{
  const desired={nose:point(.5,.2),leftShoulder:point(.35,.4),rightShoulder:point(.65,.4),leftElbow:point(.2,.7),rightElbow:point(.8,.7)};
  let cases=0;
  for(const sourceWidth of [1280,640])for(const fit of ['contain','cover'])for(const mirror of [false,true])for(const rotation of [0,90,180,270])for(const crop of [{left:0,right:0,top:0,bottom:0},{left:.1,right:.2,top:.1,bottom:.1}]){
    const geometry=makeGeometry({viewport:{x:64,y:144,width:640,height:432},sourceWidth,sourceHeight:sourceWidth===1280?720:480,fit,mirror,rotation,crop});
    const input=Object.fromEntries(names.map(name=>[name,{...canvasPointToSource(visiblePointToCanvas(desired[name],geometry),geometry),visibility:desired[name].visibility}]));
    const s=setup(geometry);assert.equal(s.capture(input),true);
    for(const name of names){assert.ok(Math.abs(s.game.latestFrame[name].x-desired[name].x)<1e-9);assert.ok(Math.abs(s.game.latestFrame[name].y-desired[name].y)<1e-9);}
    cases++;
  }
  assert.equal(cases,64);
});

test('cropped or hidden elbows become null while valid core tracking stays unchanged',()=>{
  const s=setup(makeGeometry({crop:{left:.1,right:.1,top:.1,bottom:.1}})),input=pose();input.leftElbow.x=.05;input.rightElbow.y=.95;
  assert.equal(s.capture(input),true);assert.equal(s.game.latestFrame.leftElbow,null);assert.equal(s.game.latestFrame.rightElbow,null);
  assert.equal(s.game.mode,'PLAYING');assert.equal(s.game.hp,100);assert.equal(s.game.score,0);
});

test('elbows cannot bypass epoch, duplicate, future, stale, stop or recovery admission',()=>{
  const s=setup();assert.equal(s.capture(pose()),true);const raw={epoch:s.source.epoch,sequence:1,captureTime:1,...pose()};
  s.at(1);assert.equal(s.source.accept(raw),false);assert.equal(s.source.accept({...raw,sequence:2,captureTime:2}),false);
  assert.equal(s.source.accept({...raw,epoch:0,sequence:2}),false);
  s.at(251);assert.equal(s.source.accept({...raw,sequence:2,captureTime:251}),false);
  assert.equal(s.game.latestFrame,null);assert.equal(s.game.mode,'TRACKING_LOST');assert.equal(s.game.hp,100);
  assert.equal(s.capture(pose(),252),true);assert.equal(s.game.mode,'RECOVERING');assert.ok(s.game.latestFrame.leftElbow);
  s.source.stop();assert.equal(s.source.capture(pose()),false);assert.equal(s.game.latestFrame,null);
  s.source.start();assert.equal(s.capture(pose(),253),true);assert.equal(s.game.mode,'RECOVERING');
  assert.deepEqual(s.game.latestFrame.rightElbow,pose().rightElbow);
});
