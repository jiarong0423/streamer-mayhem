// Camera pose input. The pose model (MediaPipe Pose Landmarker, Apache-2.0) runs in this browser tab; no video frame is uploaded anywhere.
export const POSE_ASSETS=Object.freeze({bundle:'./vendor/mediapipe/vision_bundle.mjs',wasm:'./vendor/mediapipe/wasm',model:'./vendor/mediapipe/pose_landmarker_lite.task',faceModel:'./vendor/mediapipe/blaze_face_short_range.tflite',faceLandmarker:'./vendor/mediapipe/face_landmarker.task'});
// MediaPipe pose landmark indices ("left" is the person's own left).
export const LANDMARKS=Object.freeze({nose:0,leftShoulder:11,rightShoulder:12,leftElbow:13,rightElbow:14,leftWrist:15,rightWrist:16,leftHip:23,rightHip:24});
const finite=Number.isFinite;

function toPoint(landmark) {
  if(!landmark || !finite(landmark.x) || !finite(landmark.y))return null;
  if(landmark.x<0 || landmark.x>1 || landmark.y<0 || landmark.y>1)return null;
  const visibility=finite(landmark.visibility)?Math.max(0,Math.min(1,landmark.visibility)):0;
  return {x:landmark.x,y:landmark.y,visibility};
}
// Landmarks (normalized to the unmirrored source frame) -> the joint names the game uses, plus the shoulder midpoint `torso`.
export function landmarksToPoints(landmarks) {
  if(!Array.isArray(landmarks))return null;
  const points={};
  for(const [name,index] of Object.entries(LANDMARKS))points[name]=toPoint(landmarks[index]);
  const a=points.leftShoulder,b=points.rightShoulder;
  points.torso=a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2,visibility:Math.min(a.visibility,b.visibility)}:null;
  return points;
}

// Face detection result -> game points. The face box centre is the steady judging anchor (`torso` slot); the nose tip is the nose.
// Face mode has no shoulders, wrists or hips, so Freeze, Mosquito and Lava report POSE_UNKNOWN in this mode.
export function faceToPoints(detection,width,height) {
  const box=detection?.boundingBox;
  if(!box || !(width>0) || !(height>0) || ![box.originX,box.originY,box.width,box.height].every(finite))return null;
  const score=finite(detection.categories?.[0]?.score)?Math.max(0,Math.min(1,detection.categories[0].score)):0;
  const center=toPoint({x:(box.originX+box.width/2)/width,y:(box.originY+box.height/2)/height,visibility:score});
  if(!center)return null;
  const tip=detection.keypoints?.[2];
  const nose=toPoint(tip&&{x:tip.x,y:tip.y,visibility:score})??center;
  return {nose,torso:center,leftShoulder:null,rightShoulder:null};
}

// Face Landmarker result (468+ landmarks normalized to the source frame) -> game points and a face box.
// The landmarker tracks the face from frame to frame, so a tilted or turning head does not drop out the way a per-frame detector does.
// The judging anchor (`torso` slot) is the centre of the landmark bounding box; the nose is landmark 1. Returns {points,face:{cx,cy,fw}} or null.
export function faceLandmarksToPoints(landmarks) {
  if(!Array.isArray(landmarks) || landmarks.length<468)return null;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,count=0;
  for(const l of landmarks){
    if(!l || !finite(l.x) || !finite(l.y))continue;
    count++;minX=Math.min(minX,l.x);maxX=Math.max(maxX,l.x);minY=Math.min(minY,l.y);maxY=Math.max(maxY,l.y);
  }
  if(count<400 || !(maxX>minX) || !(maxY>minY))return null;
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2,center=toPoint({x:cx,y:cy,visibility:1});
  if(!center)return null;
  const nose=toPoint(landmarks[1]&&{x:landmarks[1].x,y:landmarks[1].y,visibility:1})??center;
  return {points:{nose,torso:center,leftShoulder:null,rightShoulder:null},face:{cx,cy,fw:maxX-minX}};
}

const cellOf=p=>Math.min(2,Math.floor(p.y*3))*3+Math.min(2,Math.floor(p.x*3))+1;
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
// Smooths a point and keeps it in its current grid cell until it is clearly (by `margin`) inside another,
// so standing on a grid line does not flip the judged cell from frame to frame. Works in visible-region coordinates (0..1).
export class PointStabilizer {
  constructor({alpha=.5,margin=.03}={}) {
    if(!(alpha>0&&alpha<=1) || !(margin>=0&&margin<.16))throw new RangeError('INVALID_STABILIZER');
    this.alpha=alpha;this.margin=margin;this.reset();
  }
  reset(){this.last=null;this.cell=null;}
  update(point) {
    if(!point || !finite(point.x) || !finite(point.y)){this.reset();return null;}
    const smooth=this.last?{x:this.last.x+this.alpha*(point.x-this.last.x),y:this.last.y+this.alpha*(point.y-this.last.y)}:{x:point.x,y:point.y};
    let out=smooth;
    const cell=cellOf(smooth);
    if(this.cell && cell!==this.cell) {
      const col=(this.cell-1)%3,row=Math.floor((this.cell-1)/3),x0=col/3,x1=(col+1)/3,y0=row/3,y1=(row+1)/3;
      const dx=Math.max(x0-smooth.x,0,smooth.x-x1),dy=Math.max(y0-smooth.y,0,smooth.y-y1);
      if(Math.max(dx,dy)<this.margin)out={x:clamp(smooth.x,x0+1e-6,x1-1e-6),y:clamp(smooth.y,y0+1e-6,y1-1e-6)};
    }
    this.last=smooth;this.cell=cellOf(out);
    return {x:out.x,y:out.y,visibility:point.visibility};
  }
}

export class CameraTracker {
  constructor({video,kind='face',facingMode='user',mediaDevices=globalThis.navigator?.mediaDevices,loadVision=()=>import(POSE_ASSETS.bundle),assets=POSE_ASSETS,clock=()=>performance.now(),onStatus=()=>{}}={}) {
    if(!video)throw new TypeError('A video element is required');
    if(!['user','environment'].includes(facingMode))throw new RangeError('INVALID_FACING_MODE');
    if(!['face','pose'].includes(kind))throw new RangeError('INVALID_KIND');
    this.kind=kind;this.facingMode=facingMode;
    this.video=video;this.mediaDevices=mediaDevices;this.loadVision=loadVision;this.assets=assets;this.clock=clock;this.onStatus=onStatus;
    this.lastFaceWidth=null;this.lastFace=null;this.faceEngine=null;this.status='OFF';this.stream=null;this.landmarker=null;this.lastVideoTime=-1;this.lastStamp=-1;
  }
  #set(status,detail){this.status=status;this.onStatus(status,detail);}
  async start() {
    if(this.status==='STARTING'||this.status==='ON')return false;
    this.#set('STARTING');
    try {
      if(typeof this.mediaDevices?.getUserMedia!=='function')throw new Error('CAMERA_UNSUPPORTED');
      this.stream=await this.mediaDevices.getUserMedia({video:{facingMode:this.facingMode,width:{ideal:1280},height:{ideal:720}},audio:false});
      this.video.srcObject=this.stream;this.video.muted=true;this.video.playsInline=true;await this.video.play();
      const vision=await this.loadVision();
      const fileset=await vision.FilesetResolver.forVisionTasks(this.assets.wasm);
      const face=this.kind==='face';
      const landmarkerOptions=delegate=>({baseOptions:{modelAssetPath:this.assets.faceLandmarker,delegate},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.35,minFacePresenceConfidence:.35,minTrackingConfidence:.35});
      const detectorOptions=delegate=>({baseOptions:{modelAssetPath:this.assets.faceModel,delegate},runningMode:'VIDEO',minDetectionConfidence:.35});
      const poseOptions=delegate=>({baseOptions:{modelAssetPath:this.assets.model,delegate},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5});
      const create=async(Task,options)=>{try{return await Task.createFromOptions(fileset,options('GPU'));}catch{return await Task.createFromOptions(fileset,options('CPU'));}};
      this.faceEngine=null;
      if(face){
        // Prefer the tracking landmarker; if it cannot start, fall back to the plain face detector.
        try{if(!vision.FaceLandmarker)throw new Error('NO_LANDMARKER');this.landmarker=await create(vision.FaceLandmarker,landmarkerOptions);this.faceEngine='landmarker';}
        catch{this.landmarker=await create(vision.FaceDetector,detectorOptions);this.faceEngine='detector';}
      }else this.landmarker=await create(vision.PoseLandmarker,poseOptions);
      this.#set('ON');return true;
    } catch(error) {
      this.#teardown();
      this.#set('FAILED',error?.name==='NotAllowedError'?'CAMERA_DENIED':error?.message==='CAMERA_UNSUPPORTED'?'CAMERA_UNSUPPORTED':'MODEL_FAILED');
      return false;
    }
  }
  // Returns {fresh,points}. `fresh` is false while the video has no new frame since the last call; `points` is null when no person is found.
  poll() {
    if(this.status!=='ON'||!this.landmarker||this.video.readyState<2||this.video.currentTime===this.lastVideoTime)return {fresh:false,points:null};
    this.lastVideoTime=this.video.currentTime;
    const stamp=Math.max(this.lastStamp+1,Math.floor(this.clock()));this.lastStamp=stamp;
    let result;try{result=this.landmarker.detectForVideo(this.video,stamp);}catch{return {fresh:true,points:null};}
    if(this.kind==='face'&&this.faceEngine==='landmarker') {
      const parsed=faceLandmarksToPoints(result?.faceLandmarks?.[0]);
      this.lastFace=parsed?.face??null;this.lastFaceWidth=this.lastFace?.fw??null;
      return {fresh:true,points:parsed?.points??null};
    }
    if(this.kind==='face') {
      const detection=result?.detections?.[0],width=detection?.boundingBox?.width/this.video.videoWidth;
      this.lastFaceWidth=finite(width)&&width>0?width:null;
      const box=detection?.boundingBox,vw=this.video.videoWidth,vh=this.video.videoHeight;
      this.lastFace=this.lastFaceWidth&&vw>0&&vh>0?{cx:(box.originX+box.width/2)/vw,cy:(box.originY+box.height/2)/vh,fw:this.lastFaceWidth}:null;
      return {fresh:true,points:faceToPoints(detection,this.video.videoWidth,this.video.videoHeight)};
    }
    return {fresh:true,points:landmarksToPoints(result?.landmarks?.[0])};
  }
  // Hardware/ISP zoom (cameras report a range such as 1-10x; it cannot go below 1). Sets the zoom so the face is about `target` of the frame width (a sixth, the median in the 2026-10-28 survey of live Just Chatting channels).
  async zoomToFace(target=1/6) {
    const track=this.stream?.getVideoTracks?.()[0],range=track?.getCapabilities?.().zoom;
    if(!range)return {ok:false,reason:'ZOOM_UNSUPPORTED'};
    if(!(this.lastFaceWidth>0))return {ok:false,reason:'NO_FACE'};
    const current=track.getSettings?.().zoom??1,step=range.step>0?range.step:.1;
    const wanted=Math.max(range.min,Math.min(range.max,current*target/this.lastFaceWidth));
    const zoom=Math.round(wanted/step)*step;
    try{await track.applyConstraints({advanced:[{zoom}]});}catch{return {ok:false,reason:'ZOOM_FAILED'};}
    return {ok:true,zoom:Math.round(zoom*100)/100};
  }
  async resetZoom() {
    const track=this.stream?.getVideoTracks?.()[0],range=track?.getCapabilities?.().zoom;
    if(!range)return {ok:false,reason:'ZOOM_UNSUPPORTED'};
    try{await track.applyConstraints({advanced:[{zoom:range.min}]});}catch{return {ok:false,reason:'ZOOM_FAILED'};}
    return {ok:true,zoom:range.min};
  }
  #teardown() {
    try{this.landmarker?.close();}catch{/* already closed */}
    this.landmarker=null;
    for(const track of this.stream?.getTracks?.()??[])track.stop();
    this.stream=null;this.lastFaceWidth=null;this.lastFace=null;this.video.srcObject=null;this.lastVideoTime=-1;this.lastStamp=-1;
  }
  stop(){this.#teardown();this.#set('OFF');}
}
