import test from 'node:test';
import assert from 'node:assert/strict';
import { landmarksToPoints, PointStabilizer, CameraTracker, LANDMARKS, POSE_ASSETS } from '../dist/camera_tracker.mjs';

const lm=(x,y,visibility=.9)=>({x,y,visibility});
function pose(overrides={}) {
  const list=new Array(33).fill(null).map(()=>lm(.5,.5));
  const set={nose:lm(.5,.2),leftShoulder:lm(.4,.4),rightShoulder:lm(.6,.4),leftElbow:lm(.3,.5),rightElbow:lm(.7,.5),leftWrist:lm(.25,.6),rightWrist:lm(.75,.6),leftHip:lm(.45,.7),rightHip:lm(.55,.7),...overrides};
  for(const [name,value] of Object.entries(set))list[LANDMARKS[name]]=value;
  return list;
}

test('landmarks map to game joints and the shoulder midpoint becomes the torso',()=>{
  const p=landmarksToPoints(pose());
  assert.deepEqual(p.nose,{x:.5,y:.2,visibility:.9});
  assert.ok(Math.abs(p.torso.x-.5)<1e-9&&Math.abs(p.torso.y-.4)<1e-9);assert.equal(p.torso.visibility,.9);
  assert.equal(p.leftHip.y,.7);assert.equal(p.rightWrist.x,.75);
});
test('missing, out-of-frame or malformed landmarks become null; torso needs both shoulders',()=>{
  assert.equal(landmarksToPoints(undefined),null);assert.equal(landmarksToPoints('x'),null);
  const p=landmarksToPoints(pose({leftShoulder:lm(-.1,.4),nose:{x:NaN,y:.2,visibility:1},leftHip:undefined}));
  assert.equal(p.leftShoulder,null);assert.equal(p.torso,null);assert.equal(p.nose,null);assert.equal(p.leftHip,null);assert.ok(p.rightShoulder);
  assert.equal(landmarksToPoints(pose({nose:{x:.5,y:.5,visibility:7}})).nose.visibility,1);
  assert.equal(landmarksToPoints(pose({nose:{x:.5,y:.5}})).nose.visibility,0);
});
test('stabilizer smooths and holds the cell near a grid line until clearly past it',()=>{
  const s=new PointStabilizer({alpha:1,margin:.03});
  assert.equal(s.update({x:.3,y:.5,visibility:1}).x,.3);                    // cell 4
  const near=s.update({x:.34,y:.5,visibility:1});assert.ok(near.x<1/3);      // 0.007 past the line: still cell 4
  const past=s.update({x:.4,y:.5,visibility:1});assert.equal(past.x,.4);     // 0.067 past: switches to cell 5
  const back=s.update({x:.32,y:.5,visibility:1});assert.ok(back.x>1/3);     // 0.013 back across: holds cell 5
});
test('stabilizer smoothing blends toward the new point and resets without a point',()=>{
  const s=new PointStabilizer({alpha:.5,margin:0});
  s.update({x:.1,y:.1,visibility:1});assert.ok(Math.abs(s.update({x:.3,y:.1,visibility:1}).x-.2)<1e-9);
  assert.equal(s.update(null),null);assert.equal(s.update({x:.9,y:.9,visibility:1}).x,.9);
  assert.throws(()=>new PointStabilizer({alpha:0}),/INVALID_STABILIZER/);assert.throws(()=>new PointStabilizer({margin:.2}),/INVALID_STABILIZER/);
});

function fakeVideo() {
  return {srcObject:null,readyState:4,currentTime:0,muted:false,playsInline:false,played:0,play(){this.played++;return Promise.resolve();}};
}
function fakeVision({fail=false,gpuFails=false,landmarks=[pose()]}={}) {
  const created=[];
  const vision={
    FilesetResolver:{forVisionTasks:async path=>({path})},
    PoseLandmarker:{createFromOptions:async(fileset,options)=>{
      created.push(options.baseOptions.delegate);
      if(fail||(gpuFails&&options.baseOptions.delegate==='GPU'))throw new Error('boom');
      return {closed:false,calls:[],close(){this.closed=true;},detectForVideo(video,stamp){this.calls.push(stamp);return {landmarks};}};
    }}};
  return {vision,created};
}
const media=()=>{const tracks=[{stopped:false,stop(){this.stopped=true;}}];return {tracks,mediaDevices:{getUserMedia:async()=>({getTracks:()=>tracks})}};};

test('start opens the camera, loads the bundled model locally and reports ON',async()=>{
  const video=fakeVideo(),{vision}=fakeVision(),{mediaDevices}=media(),statuses=[];
  let fileset;vision.FilesetResolver.forVisionTasks=async p=>{fileset=p;return {path:p};};
  const tracker=new CameraTracker({video,mediaDevices,loadVision:async()=>vision,onStatus:s=>statuses.push(s)});
  assert.equal(await tracker.start(),true);assert.deepEqual(statuses,['STARTING','ON']);assert.equal(fileset,POSE_ASSETS.wasm);
  assert.ok(video.srcObject&&video.played===1);assert.match(POSE_ASSETS.model,/^\.\/vendor\//);
});
test('GPU failure falls back to CPU; total failure reports MODEL_FAILED and releases the camera',async()=>{
  let f=fakeVision({gpuFails:true}),m=media();
  let tracker=new CameraTracker({video:fakeVideo(),mediaDevices:m.mediaDevices,loadVision:async()=>f.vision});
  assert.equal(await tracker.start(),true);assert.deepEqual(f.created,['GPU','CPU']);
  f=fakeVision({fail:true});m=media();const video=fakeVideo(),statuses=[];
  tracker=new CameraTracker({video,mediaDevices:m.mediaDevices,loadVision:async()=>f.vision,onStatus:(s,d)=>statuses.push(d?`${s}:${d}`:s)});
  assert.equal(await tracker.start(),false);assert.equal(statuses.at(-1),'FAILED:MODEL_FAILED');assert.equal(m.tracks[0].stopped,true);assert.equal(video.srcObject,null);
});
test('camera denial and unsupported browsers are reported without throwing',async()=>{
  const denied=new CameraTracker({video:fakeVideo(),mediaDevices:{getUserMedia:async()=>{throw Object.assign(new Error('x'),{name:'NotAllowedError'});}},loadVision:async()=>fakeVision().vision});
  let last;denied.onStatus=(s,d)=>{last=`${s}:${d}`;};assert.equal(await denied.start(),false);assert.equal(last,'FAILED:CAMERA_DENIED');
  const none=new CameraTracker({video:fakeVideo(),mediaDevices:undefined});none.onStatus=(s,d)=>{last=`${s}:${d}`;};
  assert.equal(await none.start(),false);assert.equal(last,'FAILED:CAMERA_UNSUPPORTED');
});
test('poll returns points only for new video frames with strictly increasing timestamps',async()=>{
  const video=fakeVideo(),{vision}=fakeVision(),{mediaDevices}=media();
  const tracker=new CameraTracker({video,mediaDevices,loadVision:async()=>vision,clock:()=>1000});
  assert.deepEqual(tracker.poll(),{fresh:false,points:null});
  await tracker.start();video.currentTime=.1;
  const first=tracker.poll();assert.equal(first.fresh,true);assert.ok(first.points.torso);
  assert.equal(tracker.poll().fresh,false);                      // same video frame
  video.currentTime=.2;tracker.poll();
  assert.deepEqual(tracker.landmarker.calls,[1000,1001]);        // monotonic even with an identical clock
  video.readyState=1;video.currentTime=.3;assert.equal(tracker.poll().fresh,false);
});
test('no person in frame gives fresh:true with null points; stop releases everything',async()=>{
  const video=fakeVideo(),{vision}=fakeVision({landmarks:[]}),m=media();
  const tracker=new CameraTracker({video,mediaDevices:m.mediaDevices,loadVision:async()=>vision});
  await tracker.start();video.currentTime=.1;assert.deepEqual(tracker.poll(),{fresh:true,points:null});
  const lmk=tracker.landmarker;tracker.stop();
  assert.equal(lmk.closed,true);assert.equal(m.tracks[0].stopped,true);assert.equal(video.srcObject,null);assert.equal(tracker.status,'OFF');
});

test('facing mode is passed to the camera request and validated',async()=>{
  let asked;const {vision}=fakeVision();
  const tracker=new CameraTracker({video:fakeVideo(),facingMode:'environment',loadVision:async()=>vision,
    mediaDevices:{getUserMedia:async c=>{asked=c;return {getTracks:()=>[]};}}});
  await tracker.start();assert.equal(asked.video.facingMode,'environment');assert.equal(asked.audio,false);
  assert.throws(()=>new CameraTracker({video:fakeVideo(),facingMode:'sideways'}),/INVALID_FACING_MODE/);
});
