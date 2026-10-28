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
  const tracker=new CameraTracker({kind:'pose',video,mediaDevices,loadVision:async()=>vision,onStatus:s=>statuses.push(s)});
  assert.equal(await tracker.start(),true);assert.deepEqual(statuses,['STARTING','ON']);assert.equal(fileset,POSE_ASSETS.wasm);
  assert.ok(video.srcObject&&video.played===1);assert.match(POSE_ASSETS.model,/^\.\/vendor\//);
});
test('GPU failure falls back to CPU; total failure reports MODEL_FAILED and releases the camera',async()=>{
  let f=fakeVision({gpuFails:true}),m=media();
  let tracker=new CameraTracker({kind:'pose',video:fakeVideo(),mediaDevices:m.mediaDevices,loadVision:async()=>f.vision});
  assert.equal(await tracker.start(),true);assert.deepEqual(f.created,['GPU','CPU']);
  f=fakeVision({fail:true});m=media();const video=fakeVideo(),statuses=[];
  tracker=new CameraTracker({kind:'pose',video,mediaDevices:m.mediaDevices,loadVision:async()=>f.vision,onStatus:(s,d)=>statuses.push(d?`${s}:${d}`:s)});
  assert.equal(await tracker.start(),false);assert.equal(statuses.at(-1),'FAILED:MODEL_FAILED');assert.equal(m.tracks[0].stopped,true);assert.equal(video.srcObject,null);
});
test('camera denial and unsupported browsers are reported without throwing',async()=>{
  const denied=new CameraTracker({kind:'pose',video:fakeVideo(),mediaDevices:{getUserMedia:async()=>{throw Object.assign(new Error('x'),{name:'NotAllowedError'});}},loadVision:async()=>fakeVision().vision});
  let last;denied.onStatus=(s,d)=>{last=`${s}:${d}`;};assert.equal(await denied.start(),false);assert.equal(last,'FAILED:CAMERA_DENIED');
  const none=new CameraTracker({kind:'pose',video:fakeVideo(),mediaDevices:undefined});none.onStatus=(s,d)=>{last=`${s}:${d}`;};
  assert.equal(await none.start(),false);assert.equal(last,'FAILED:CAMERA_UNSUPPORTED');
});
test('poll returns points only for new video frames with strictly increasing timestamps',async()=>{
  const video=fakeVideo(),{vision}=fakeVision(),{mediaDevices}=media();
  const tracker=new CameraTracker({kind:'pose',video,mediaDevices,loadVision:async()=>vision,clock:()=>1000});
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
  const tracker=new CameraTracker({kind:'pose',video,mediaDevices:m.mediaDevices,loadVision:async()=>vision});
  await tracker.start();video.currentTime=.1;assert.deepEqual(tracker.poll(),{fresh:true,points:null});
  const lmk=tracker.landmarker;tracker.stop();
  assert.equal(lmk.closed,true);assert.equal(m.tracks[0].stopped,true);assert.equal(video.srcObject,null);assert.equal(tracker.status,'OFF');
});

test('facing mode is passed to the camera request and validated',async()=>{
  let asked;const {vision}=fakeVision();
  const tracker=new CameraTracker({kind:'pose',video:fakeVideo(),facingMode:'environment',loadVision:async()=>vision,
    mediaDevices:{getUserMedia:async c=>{asked=c;return {getTracks:()=>[]};}}});
  await tracker.start();assert.equal(asked.video.facingMode,'environment');assert.equal(asked.audio,false);
  assert.throws(()=>new CameraTracker({kind:'pose',video:fakeVideo(),facingMode:'sideways'}),/INVALID_FACING_MODE/);
});

import { faceToPoints } from '../dist/camera_tracker.mjs';
const face=(over={})=>({boundingBox:{originX:500,originY:200,width:200,height:200},categories:[{score:.93}],keypoints:[{x:.4,y:.4},{x:.5,y:.4},{x:.45,y:.5},{x:.45,y:.6}],...over});
test('face detection maps to the nose tip and a steadier face-centre anchor',()=>{
  const p=faceToPoints(face(),1280,720);
  assert.deepEqual(p.nose,{x:.45,y:.5,visibility:.93});
  assert.ok(Math.abs(p.torso.x-600/1280)<1e-9&&Math.abs(p.torso.y-300/720)<1e-9);assert.equal(p.leftShoulder,null);
  assert.deepEqual(faceToPoints(face({keypoints:undefined}),1280,720).nose.x,p.torso.x);          // falls back to the box centre
  assert.equal(faceToPoints(null,1280,720),null);assert.equal(faceToPoints(face(),0,720),null);
  assert.equal(faceToPoints(face({boundingBox:{originX:1600,originY:0,width:200,height:200}}),1280,720),null); // centre outside the frame
});
test('face mode loads the face detector and polls detections; invalid kind is rejected',async()=>{
  const created=[];const video=fakeVideo();video.videoWidth=1280;video.videoHeight=720;
  const vision={FilesetResolver:{forVisionTasks:async()=>({})},FaceDetector:{createFromOptions:async(f,o)=>{created.push(o.baseOptions.modelAssetPath);return {close(){},detectForVideo(){return {detections:[face()]};}};}}};
  const tracker=new CameraTracker({kind:'pose',video,kind:'face',loadVision:async()=>vision,mediaDevices:media().mediaDevices});
  assert.equal(await tracker.start(),true);assert.match(created[0],/blaze_face_short_range\.tflite$/);
  video.currentTime=.1;const r=tracker.poll();assert.equal(r.fresh,true);assert.ok(r.points.torso&&r.points.nose);
  assert.throws(()=>new CameraTracker({kind:'pose',video:fakeVideo(),kind:'hands'}),/INVALID_KIND/);
});

function zoomRig({range={min:1,max:10,step:.1},settings={zoom:1}}={}) {
  const applied=[],track={stop(){},getCapabilities:()=>range?{zoom:range}:{},getSettings:()=>settings,applyConstraints:async c=>{applied.push(c);}};
  const video=fakeVideo();video.videoWidth=1280;video.videoHeight=720;
  const vision={FilesetResolver:{forVisionTasks:async()=>({})},FaceDetector:{createFromOptions:async()=>({close(){},detectForVideo(){return {detections:[{boundingBox:{originX:500,originY:200,width:128,height:160},categories:[{score:.9}],keypoints:[]}]};}})}};
  return {applied,video,tracker:new CameraTracker({video,kind:'face',loadVision:async()=>vision,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})}})};
}
test('zoomToFace sizes the zoom from the measured face width and respects the camera range',async()=>{
  const r=zoomRig();await r.tracker.start();
  assert.deepEqual(await r.tracker.zoomToFace(),{ok:false,reason:'NO_FACE'});
  r.video.currentTime=.1;r.tracker.poll();                                   // face is 128/1280 = 10% of the frame
  const out=await r.tracker.zoomToFace(.2);assert.deepEqual(out,{ok:true,zoom:2});assert.deepEqual(r.applied[0],{advanced:[{zoom:2}]});
  assert.deepEqual(await r.tracker.resetZoom(),{ok:true,zoom:1});
});
test('zoom is clamped to the range, and unsupported or failing cameras are reported',async()=>{
  const small=zoomRig({range:{min:1,max:1.5,step:.1}});await small.tracker.start();small.video.currentTime=.1;small.tracker.poll();
  assert.equal((await small.tracker.zoomToFace(.2)).zoom,1.5);
  const none=zoomRig({range:null});await none.tracker.start();assert.deepEqual(await none.tracker.zoomToFace(),{ok:false,reason:'ZOOM_UNSUPPORTED'});assert.deepEqual(await none.tracker.resetZoom(),{ok:false,reason:'ZOOM_UNSUPPORTED'});
  const bad=zoomRig();await bad.tracker.start();bad.video.currentTime=.1;bad.tracker.poll();
  bad.tracker.stream.getVideoTracks()[0].applyConstraints=async()=>{throw new Error('x');};
  assert.deepEqual(await bad.tracker.zoomToFace(),{ok:false,reason:'ZOOM_FAILED'});
});

import { faceLandmarksToPoints } from '../dist/camera_tracker.mjs';
// A synthetic 478-point face: a grid of points inside a box so the bounding box is known.
const landmarks=(cx=.5,cy=.45,w=.16,h=.28,over=[])=>{
  const pts=[];for(let i=0;i<478;i++)pts.push({x:cx-w/2+w*((i%23)/22),y:cy-h/2+h*(Math.floor(i/23)/20.8),z:0});
  pts[1]={x:cx,y:cy+.02,z:0};for(const [i,v] of over)pts[i]=v;return pts;
};
test('LANDMARK-01 landmarks map to the nose tip, a face-box centre anchor and the face box',()=>{
  const out=faceLandmarksToPoints(landmarks());
  assert.ok(Math.abs(out.points.nose.x-.5)<1e-9&&Math.abs(out.points.nose.y-.47)<1e-9&&out.points.nose.visibility===1);
  assert.ok(Math.abs(out.points.torso.x-.5)<.01&&Math.abs(out.points.torso.y-.45)<.01);assert.equal(out.points.leftShoulder,null);
  assert.ok(Math.abs(out.face.fw-.16)<.01&&Math.abs(out.face.cx-.5)<.01&&Math.abs(out.face.cy-.45)<.01);
});
test('LANDMARK-02 bad or partial landmark sets are rejected',()=>{
  assert.equal(faceLandmarksToPoints(null),null);assert.equal(faceLandmarksToPoints(undefined),null);assert.equal(faceLandmarksToPoints([]),null);
  assert.equal(faceLandmarksToPoints(landmarks().slice(0,300)),null);
  assert.equal(faceLandmarksToPoints(landmarks(1.5,.5)),null);                 // centre outside the frame
  const flat=Array.from({length:478},()=>({x:.5,y:.5}));assert.equal(faceLandmarksToPoints(flat),null);
});
test('LANDMARK-03 face mode prefers the landmarker, keeps tracking a tilted face and reports the face box',async()=>{
  const created=[];const video=fakeVideo();video.videoWidth=1280;video.videoHeight=720;
  const vision={FilesetResolver:{forVisionTasks:async()=>({})},
    FaceLandmarker:{createFromOptions:async(f,o)=>{created.push(o.baseOptions.modelAssetPath);return {close(){},detectForVideo(){return {faceLandmarks:[landmarks(.62,.4)]};}};}},
    FaceDetector:{createFromOptions:async()=>{throw new Error('detector should not be used');}}};
  const tracker=new CameraTracker({video,kind:'face',loadVision:async()=>vision,mediaDevices:media().mediaDevices});
  assert.equal(await tracker.start(),true);assert.match(created[0],/face_landmarker\.task$/);assert.equal(tracker.faceEngine,'landmarker');
  video.currentTime=.1;const r=tracker.poll();assert.equal(r.fresh,true);
  assert.ok(Math.abs(r.points.torso.x-.62)<.01);assert.ok(Math.abs(tracker.lastFace.cx-.62)<.01&&tracker.lastFace.fw>.1);
});
test('LANDMARK-04 an empty landmark result is a fresh frame with no person; the detector is the fallback when the landmarker cannot start',async()=>{
  const video=fakeVideo();video.videoWidth=1280;video.videoHeight=720;
  const empty={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:async()=>({close(){},detectForVideo(){return {faceLandmarks:[]};}})}};
  const t1=new CameraTracker({video,kind:'face',loadVision:async()=>empty,mediaDevices:media().mediaDevices});await t1.start();
  video.currentTime=.1;const r=t1.poll();assert.deepEqual([r.fresh,r.points,t1.lastFace],[true,null,null]);
  const video2=fakeVideo();video2.videoWidth=1280;video2.videoHeight=720;
  const broken={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:async()=>{throw new Error('no gpu or cpu');}},
    FaceDetector:{createFromOptions:async()=>({close(){},detectForVideo(){return {detections:[face()]};}})}};
  const t2=new CameraTracker({video:video2,kind:'face',loadVision:async()=>broken,mediaDevices:media().mediaDevices});
  assert.equal(await t2.start(),true);assert.equal(t2.faceEngine,'detector');video2.currentTime=.1;assert.ok(t2.poll().points.torso);
});
