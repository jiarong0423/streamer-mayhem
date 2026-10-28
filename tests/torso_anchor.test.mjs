import test from 'node:test';
import assert from 'node:assert/strict';
import { MatrixGame, anchorPoint } from '../dist/matrix.mjs';
import { projectCameraFrame, createCameraGeometry } from '../dist/camera_geometry.mjs';
import { SyntheticFrameSource } from '../dist/frame_source.mjs';

const pt=(x,y,visibility=1)=>({x,y,visibility});
function run(frameFields,text='!throw 5') {
  const clock={now:0},events=[];
  const game=new MatrixGame({clock:()=>clock.now,onEvent:e=>events.push(e)});game.setConnection(true);game.start();
  game.addFrame({frameId:'a',captureTime:0,nose:pt(.5,.5),leftShoulder:pt(.4,.5),rightShoulder:pt(.6,.5)});game.tick();
  clock.now=100;game.addFrame({frameId:'b',captureTime:100,...frameFields});game.tick();
  game.receiveChat({notificationId:'n',messageId:'m',actorId:'u',receivedAt:100,text});
  for(let t=150;t<=700;t+=50){clock.now=t;game.addFrame({frameId:`f${t}`,captureTime:t,...frameFields});game.tick();}
  return events.find(e=>e.outcome)?.outcome;
}
const base={leftShoulder:pt(.4,.5),rightShoulder:pt(.6,.5)};

test('anchorPoint prefers a usable torso and falls back to the nose',()=>{
  assert.deepEqual(anchorPoint({nose:pt(.1,.1),torso:pt(.5,.5)}),pt(.5,.5));
  assert.deepEqual(anchorPoint({nose:pt(.1,.1),torso:null}),pt(.1,.1));
  assert.deepEqual(anchorPoint({nose:pt(.1,.1),torso:pt(.5,.5,.2)}),pt(.1,.1));
  assert.deepEqual(anchorPoint({nose:pt(.1,.1)}),pt(.1,.1));
  assert.equal(anchorPoint(null),null);
});
test('judging follows the torso: head leaning into the hit cell does not count when the torso is out of it',()=>{
  assert.equal(run({...base,nose:pt(.5,.5),torso:pt(.1,.1)}),'DODGE');   // torso in cell 1, attack on 5
  assert.equal(run({...base,nose:pt(.1,.1),torso:pt(.5,.5)}),'HIT');     // head far away, torso in cell 5
});
test('without a torso the nose still decides, exactly as before',()=>{
  assert.equal(run({...base,nose:pt(.5,.5)}),'HIT');
  assert.equal(run({...base,nose:pt(.1,.1)}),'DODGE');
  assert.equal(run({...base,nose:pt(.1,.1),torso:null}),'DODGE');
});
test('torso is carried through the frame source and the camera projection',()=>{
  const g=createCameraGeometry({canvasWidth:1920,canvasHeight:1080,viewport:{x:0,y:0,width:1920,height:1080},sourceWidth:1280,sourceHeight:720,mirror:true});
  const projected=projectCameraFrame({nose:pt(.25,.5),leftShoulder:pt(.2,.5),rightShoulder:pt(.3,.5),torso:pt(.25,.5)},g);
  assert.ok(Math.abs(projected.torso.x-.75)<1e-9);                       // mirrored
  const game=new MatrixGame({clock:()=>0});game.setConnection(true);game.start();
  const source=new SyntheticFrameSource({game,clock:()=>0,project:f=>f});
  assert.equal(source.capture({nose:pt(.5,.5),leftShoulder:pt(.4,.5),rightShoulder:pt(.6,.5),torso:pt(.3,.4)}),true);
  assert.deepEqual(game.latestFrame.torso,pt(.3,.4));
});
