import { MatrixGame } from './matrix.mjs';
import { EventSubAdapter, syntheticChat, syntheticWelcome } from './eventsub_adapter.mjs';
import { MockEventSubTransport } from './mock_eventsub_transport.mjs';
import { MockOAuth } from './mock_oauth.mjs';
import { AuthPopupController } from './auth_popup_controller.mjs';
import { TwitchProvider, LOCAL_CONFIG, LIVE_NETWORK_ENABLED, validateProviderConfig } from './twitch_provider.mjs';
import { ProviderActivation } from './provider_activation.mjs';
import { IrcAnonymousChat, normalizeChannel } from './irc_anonymous.mjs';
import { CameraTracker, PointStabilizer } from './camera_tracker.mjs';
import { drawArena } from './arena_draw.mjs';
import {AutoFrame} from './auto_frame.mjs';
import {dropColumn,dropTarget,DROP_FLOOR} from './drop_lanes.mjs';
import {CatchBurst,loadSprites} from './catch_fx.mjs';
import {DropWaves} from './drop_waves.mjs';
import {FaceMosquito} from './face_mosquito.mjs';
import {MotionProbe,grayFromRgba} from './motion_probe.mjs';
import {createCameraGeometry,centerCrop,projectCameraPoint,projectCameraFrame,canvasPointToSource,visiblePointToCanvas} from './camera_geometry.mjs';
import {makeOverlayState,OVERLAY_CLOSED_TYPE} from './overlay_protocol.mjs';
import {SyntheticFrameSource} from './frame_source.mjs';

const $ = selector => document.querySelector(selector);
const canvas=$('#arena'),ctx=canvas.getContext('2d');
const player={x:.5,y:.5};
const poseControls={spread:.1,hip:.5,leftWrist:{x:.25,y:.55},rightWrist:{x:.75,y:.55}};
const challengeNames={DROP:'Catch the drop',CROSS:'Cross Inferno',FREEZE:'Freeze',MOSQUITO:'Mosquito',LAVA:'Lava'};
let cameraGeometry=createCameraGeometry({canvasWidth:canvas.width,canvasHeight:canvas.height,viewport:{x:0,y:0,width:canvas.width,height:canvas.height},sourceWidth:1280,sourceHeight:720});
let eventId=0,tracking=true,lastEffect=null,animationId=0,mockMode=false,chatMode=false,providerActivation=null,configuredProvider=null,ircChat=null,cameraTracker=null,cameraOn=false,cameraMirror=true,cameraKindLabel='CAMERA FACE TRACKING',savedGeometry=null;
let overlaySession=null,overlaySequence=0,lastOverlayUpdate=0,overlayInFlight=0,overlayEnabled=false;
const modeNames={IDLE:'Ready',PLAYING:'Playing',PAUSED:'Paused',TRACKING_LOST:'Tracking lost',RECOVERING:'Getting ready',ROUND_END:'Round over'};
const reasons={MODE_BUSY:'Finish the current challenge first',POSE_UNKNOWN:'Not enough joints visible or lava at its cap; restore the joint',FREEZE_COOLDOWN:'Freeze is cooling down',GAME_COOLDOWN:'This game is cooling down',INVALID_LEVEL:'Lava level must be between 0.1 and 0.8',INVALID_COMMAND:'Enter !throw 1-9, !freeze, !mosquito or !lava',ACTOR_COOLDOWN:'This viewer must wait',GLOBAL_COOLDOWN:'Wait a moment before throwing',QUEUE_FULL:'Attack queue full',OFFLINE:'Simulated chat is offline',NOT_PLAYING:'The game cannot accept attacks now',DUPLICATE:'Duplicate event skipped',INVALID_EVENT:'Malformed simulated event'};

function feed(title,detail) {
  const li=document.createElement('li'),dot=document.createElement('span'),body=document.createElement('div');
  const name=document.createElement('b'),description=document.createElement('small'),time=document.createElement('time');
  dot.className='feed-dot';name.textContent=title;description.textContent=detail;time.textContent='NOW';
  body.append(name,description);li.append(dot,body,time);const list=$('#activity');list.prepend(li);
  while(list.children.length>3)list.lastElementChild.remove();
}

const waves=new DropWaves({seed:(Date.now()&0x7fffffff)||1});let waveSerial=0,roundEnding=false,banner=null;
const autoDrops=document.querySelector('#auto-drops');
$('#face-mosquito').addEventListener('click',()=>{startFaceMosquito();});
$('#swat').addEventListener('click',()=>{swatFrames=3;});
autoDrops.addEventListener('change',()=>{waves.reset(performance.now());roundEnding=false;banner=null;mosquitoPlanned=false;feed(autoDrops.checked?'Auto drops on':'Auto drops off',autoDrops.checked?'Random gold items and bombs, rising difficulty':'Only chat starts drops');});
const catchFx=new CatchBurst();let fxSprites={},lastMarker=null;
// The mosquito that goes for the face: flight in face_mosquito.mjs; a hand swat or face slap is seen as motion (motion_probe.mjs) where the mosquito is.
const mosquito=new FaceMosquito({seed:(Date.now()&0x7fffffff)||1});
const probe=new MotionProbe(),probeCanvas=document.createElement('canvas');probeCanvas.width=64;probeCanvas.height=36;
const probeCtx=probeCanvas.getContext('2d',{willReadFrequently:true});
let probeFailed=false;
let swatFrames=0,biteAt=-Infinity,mosquitoPlanned=false,lastProbeTime=-1,nextMosquitoTry=0;
if(debugOnEarly())window.__mosqLog=[];
function debugOnEarly(){return new URLSearchParams(location.search).has('debug');}
// Face position and width in visible-window coordinates, or null when no face is tracked.
function currentFace(){
  const g=cameraGeometry;if(!g)return null;
  const last=frameSource.lastFrame,point=cameraOn?(last?.torso??last?.nose??null):(last?.nose??null);
  const p=point?projectCameraPoint({...point,visibility:1},g):null;if(!p)return null;
  const span=1-g.crop.left-g.crop.right,w=cameraOn&&cameraTracker?.lastFace?Math.max(.04,cameraTracker.lastFace.fw/span):.12;
  return {x:p.x,y:p.y,w};
}
function startFaceMosquito(){
  if(mosquito.active||game.mode!=='PLAYING'){game.refundFaceMosquito();return false;}
  const face=currentFace();if(!face){feed('No face yet','The mosquito needs a tracked face');game.refundFaceMosquito();return false;}
  probe.reset();swatFrames=0;lastProbeTime=-1;
  if(!mosquito.start(performance.now(),face))return false;
  game.setFaceMosquitoBusy(true);feed('Mosquito!','It is coming for your face: dodge it, swat it, or slap your face when it lands');return true;
}
// One step of the mosquito per frame: look for motion where it is (camera only), advance it, and book the result with the game.
// Motion around (p.x,p.y) in window coordinates, radius r in window widths; null when the camera has not produced a new frame since the last call.
// The screen redraws at 60 Hz but the camera delivers about 30 frames a second: only a NEW camera frame is compared, otherwise two identical frames
// would read as "no motion" and a real slap could never add up to two frames in a row.
function motionLevelAt(p,r){
  const video=$('#camera-video');
  if(!cameraOn||!cameraGeometry||video.readyState<2||video.currentTime===lastProbeTime)return null;
  try{
    lastProbeTime=video.currentTime;
    probeCtx.drawImage(video,0,0,64,36);
    const gray=grayFromRgba(probeCtx.getImageData(0,0,64,36).data,64,36);if(gray)probe.push(gray);
    const c=canvasPointToSource(visiblePointToCanvas({x:p.x,y:p.y},cameraGeometry),cameraGeometry);
    return c?probe.level({x:c.x,y:c.y,r:r*(1-cameraGeometry.crop.left-cameraGeometry.crop.right)}):0;
  }catch(error){if(!probeFailed){probeFailed=true;console.error('ERROR motion probe',error);}return 0;}   // a failed read must not freeze the mosquito
}
// With ?debug=1 the face motion is measured all the time (no mosquito needed) so a slap, a clap or a wave can be seen and the threshold calibrated.
function debugFaceMotion(now){
  if(!debugOn||!cameraOn||mosquito.active)return;
  const face=currentFace();if(!face)return;
  const level=motionLevelAt(face,face.w);if(level===null)return;
  debugStats.level=level;debugStats.peak=Math.max(debugStats.peak*.97,level);
  if(window.__mosqLog&&window.__mosqLog.length<4000)window.__mosqLog.push([Math.round(now),+level.toFixed(3),'FACE',+face.x.toFixed(3),+face.y.toFixed(3)]);
}
function stepMosquito(now,snapshot){
  if(!mosquito.active)return;
  if(!['PLAYING','TRACKING_LOST','RECOVERING'].includes(snapshot.mode)){mosquito.cancel(now);game.setFaceMosquitoBusy(false);return;}
  const snap=mosquito.snapshot(now);let level=0;
  if(swatFrames>0){swatFrames--;level=1;}                                   // the on-screen Swat button (no camera needed)
  else if(cameraOn&&cameraGeometry)level=motionLevelAt(snap.probe,snap.probe.r);
  if(level!==null){debugStats.level=level;debugStats.peak=Math.max(debugStats.peak*.97,level);if(window.__mosqLog&&window.__mosqLog.length<4000)window.__mosqLog.push([Math.round(now),+level.toFixed(3),snap.state,+snap.x.toFixed(3),+snap.y.toFixed(3)]);}
  const result=mosquito.update(now,currentFace(),level);
  if(result){
    game.setFaceMosquitoBusy(false);
    const booked=game.settleFaceMosquito(result);
    if(booked){
      lastEffect={outcome:booked.outcome,at:now,scoreDelta:booked.scoreDelta};
      if(booked.outcome==='SWAT'&&cameraGeometry){const v=cameraGeometry.visible;catchFx.spawn(v.x+snap.x*v.width,v.y+snap.y*v.height,now,v.width/5);}
      if(booked.outcome==='BITE')biteAt=now;
    }
  }
}
loadSprites().then(sprites=>{fxSprites=sprites;});
const game=new MatrixGame({onEvent:event=>{
  if(event.type==='result'){
    if(event.outcome==='CATCH'&&cameraGeometry){
      // Burst where the item was caught: at its target x on the floor line.
      const v=cameraGeometry.visible,column=(event.cells?.[0]??event.cell-3),size=v.width/3;
      const at={x:v.x+(dropTarget(column)??.5)*v.width,y:v.y+DROP_FLOOR*v.height};catchFx.spawn(at.x,at.y,performance.now(),size*.5);
    }
    lastEffect={outcome:event.outcome,at:performance.now(),scoreDelta:event.scoreDelta??0};
    const titles={HIT:'Ouch, hit!',DODGE:'Nice dodge',CATCH:'Caught it!',MISS:'Missed it',BOMB:'Boom! Bomb caught',AVOID:'Bomb dodged',SWAT:'Swatted it!',BITE:'Bitten!'};
    feed(titles[event.outcome]??'Undetermined',`${challengeNames[event.kind]??`Target cell ${event.cell}`} · ${event.outcome}`);
  } else if(event.type==='faceMosquito')startFaceMosquito();
  else if(event.type==='lavaBurn')feed('Lava burn',`HP ${event.hpDelta} · stand to avoid the lava`);
  else if(event.type==='ringOut')feed('Character left the arena','Out of bounds');
}});
const stabilizer=new PointStabilizer();
const frameSource=new SyntheticFrameSource({game,maxAge:game.config.maxAge,project:frame=>{
  const out=cameraGeometry?projectCameraFrame(frame,cameraGeometry):{...frame,nose:null,leftShoulder:null,rightShoulder:null};
  if(cameraOn&&out&&Object.hasOwn(out,'torso'))out.torso=stabilizer.update(out.torso);
  return out;
}});
game.beforeTick=()=>frameSource.sync();
const adapter=new EventSubAdapter({game,onStatus:status=>{
  if(mockMode||chatMode||providerActivation||ircChat)return;
  const online=status==='SIMULATED_ONLINE';$('#connection-badge').textContent=online?'Simulated connection':'Simulated disconnect';
  $('#connection').textContent=online?'↯ Simulate disconnect':'↻ Restore simulation';
}});
const oauth=new MockOAuth();
const chatTransport=new MockEventSubTransport({adapter,oauth,profile:'chat',onStatus:(status,detail)=>{
  const labels={CONNECTING:'Local chat connecting',SUBSCRIBING:'Local chat subscribing',ONLINE:'Local chat subscribed',MIGRATING:'Local subscription migrating',RETRYING:'Local chat reconnecting',STOPPED:'Local chat stopped'};
  if(chatMode)$('#connection-badge').textContent=labels[status]??status;
  if(detail==='AUTH_REQUIRED')feed('Simulated authorization expired','Stop and re-authorize');
},onDelivery:result=>{if(result.accepted)feed('Local chat attack',`!throw ${result.cell} · 0.5 s warning`);}});
const popupController=['http://127.0.0.1:4173','http://localhost:4173'].includes(location.origin)?new AuthPopupController({oauth,origin:location.origin,
  openWindow:url=>window.open(url,'streamer-mayhem-local-auth','popup,width=520,height=420'),
  onState:state=>{
    if(state==='PENDING'){$('#mock-toggle').disabled=true;$('#auth-mock-toggle').textContent='Cancel local authorization';syncProviderControls();}
    else if(['CANCELLED','CLOSED','DENIED','FAILED','BLOCKED'].includes(state)){
      $('#mock-toggle').disabled=false;$('#auth-mock-toggle').textContent='Start local chat auth test';syncProviderControls();
      if(state==='CANCELLED'||state==='CLOSED')feed('Local authorization cancelled','Can restart test');
      else feed('Local simulated authorization incomplete',state==='DENIED'?'Authorization denied':state==='BLOCKED'?'Allow pop-ups for this local page':'Authorization validation failed');
    }
  },
  onSuccess:()=>{chatMode=true;$('#connection').disabled=true;$('#mock-toggle').disabled=true;$('#auth-mock-toggle').textContent='Stop local chat test';syncProviderControls();chatTransport.start();}
}):null;
const transport=new MockEventSubTransport({adapter,onStatus:(status,detail)=>{
  const labels={CONNECTING:'CLI connecting',SUBSCRIBING:'CLI subscribing',ONLINE:'CLI mock connected',MIGRATING:'CLI subscription migrating',RETRYING:'CLI reconnecting',STOPPED:'CLI stopped'};
  if(mockMode)$('#connection-badge').textContent=status==='RETRYING' && detail.startsWith('SUBSCRIPTION_')?'CLI subscription failed, retrying':labels[status]??status;
  if(detail==='REVOKED')feed('Mock subscription revoked','Auto-reconnect stopped');
},onDelivery:result=>{
  if(result.accepted)feed('Local mock attack',`!throw ${result.cell} · 0.5 s warning`);
}});

// Synthetic state is relayed only through the same loopback server, in memory.
try {
  if(typeof crypto?.getRandomValues!=='function')throw new Error('SECURE_RANDOM_UNAVAILABLE');
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);overlaySession=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  $('#overlay-link').removeAttribute('href');
} catch {overlaySession=null;$('#overlay-link').removeAttribute('href');$('#overlay-hint').textContent='This browser cannot sync the synthetic pages.';}
function publishOverlay(snapshot,{force=false}={}){
  if(!overlayEnabled||!overlaySession||(overlayInFlight&&!force))return;
  const sourcePoint=snapshot.mode==='PLAYING'&&frameSource.running&&cameraGeometry?frameSource.lastFrame?.nose??null:null;
  const message=makeOverlayState({session:overlaySession,sequence:++overlaySequence,geometry:cameraGeometry,snapshot,sourcePoint});
  overlayInFlight++;fetch('./__overlay/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(1000)}).then(response=>{if(!response.ok)throw new Error('RELAY_UNAVAILABLE');if(overlayEnabled)$('#overlay-hint').textContent='Synthetic data sent; keep this controller page open.';}).catch(()=>{if(overlayEnabled)$('#overlay-hint').textContent='Cannot reach the local overlay relay; check the local server.';}).finally(()=>{overlayInFlight--;});
}

function stopOverlaySync(){
  if(!overlayEnabled)return;overlayEnabled=false;
  fetch('./__overlay/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:OVERLAY_CLOSED_TYPE,session:overlaySession,sequence:++overlaySequence}),credentials:'omit',redirect:'error',keepalive:true}).catch(()=>{});
  $('#overlay-link').removeAttribute('href');$('#overlay-toggle').textContent='Enable overlay sync';$('#overlay-hint').textContent='Overlay sync stopped.';
}
$('#overlay-toggle').addEventListener('click',()=>{
  if(overlayEnabled){stopOverlaySync();return;}
  if(!overlaySession){$('#overlay-hint').textContent='This browser cannot sync the synthetic pages.';return;}
  overlayEnabled=true;const link=new URL('./overlay.html',location.href);link.search=new URLSearchParams({mode:'synthetic',session:overlaySession}).toString();$('#overlay-link').href=link.href;
  $('#overlay-toggle').textContent='Stop overlay sync';$('#overlay-hint').textContent='Connecting to the local overlay.';publishOverlay(game.tick());
});

function addSyntheticFrame(){
  const visible=tracking&&cameraGeometry?projectCameraPoint({...player,visibility:1},cameraGeometry):null;
  const source=p=>{
    if(!visible||!p)return null;
    const mapped=canvasPointToSource(visiblePointToCanvas(p,cameraGeometry),cameraGeometry);
    return mapped?{...mapped,visibility:1}:null;
  };
  const nose=visible?{...player,visibility:1}:null;
  const leftShoulder=visible?source({x:visible.x-.06,y:visible.y+.1}):null;
  const rightShoulder=visible?source({x:visible.x+.06,y:visible.y+.1}):null;
  const elbows=$('#elbow-known').checked,hands=$('#wrist-known').checked,hips=$('#hip-known').checked;
  return frameSource.capture({nose,leftShoulder,rightShoulder,
    leftElbow:visible&&elbows?source({x:visible.x-poseControls.spread,y:visible.y+.2}):null,
    rightElbow:visible&&elbows?source({x:visible.x+poseControls.spread,y:visible.y+.2}):null,
    leftWrist:hands?source(poseControls.leftWrist):null,rightWrist:hands?source(poseControls.rightWrist):null,
    leftHip:visible&&hips?source({x:visible.x-.035,y:poseControls.hip}):null,
    rightHip:visible&&hips?source({x:visible.x+.035,y:poseControls.hip}):null});
}

function updateScreen(snapshot){
  const mode=modeNames[snapshot.mode]??snapshot.mode;if($('#game-status').textContent!==mode)$('#game-status').textContent=mode;
  $('#health').textContent=String(snapshot.hp);$('#health-fill').style.width=`${snapshot.hp}%`;
  $('#score').textContent=String(snapshot.score).padStart(3,'0');
  $('#last-result').textContent=snapshot.lastResult?.outcome??'—';
  $('#pause').textContent=snapshot.mode==='PAUSED'?'▶ Resume game':'Ⅱ Pause game';
  $('#tracking').textContent=tracking?'◎ Simulate tracking loss':'◎ Restore tracking';
  const sourceStatus=!frameSource.running?'Synthetic frames interrupted':snapshot.mode==='RECOVERING'?'Synthetic frames resuming':frameSource.lastFrame?'Synthetic frames updating':'Waiting for synthetic frames';
  if($('#frame-source-status').textContent!==sourceStatus)$('#frame-source-status').textContent=sourceStatus;
  const challenge=snapshot.freeze?.active?snapshot.freeze:snapshot.actionGame?.active?snapshot.actionGame:null;
  const kind=snapshot.freeze?.active?'FREEZE':challenge?.kind;
  $('#challenge-status').textContent=challenge?`${challengeNames[kind]} · ${challenge.status} · ${(challenge.remainingMs/1000).toFixed(1)} s${challenge.recoveryRemaining?` · ready in ${(challenge.recoveryRemaining/1000).toFixed(1)} s`:''}`:'Pick a game to start; one challenge at a time.';
  canvas.dataset.challenge=kind??'';canvas.dataset.phase=challenge?.phase??challenge?.status??'';canvas.dataset.lastKind=snapshot.lastResult?.kind??'';
  $('#frame-source-toggle').textContent=frameSource.running?'Simulate frame interruption':'Restore synthetic frames';
}

// Camera tracking: the page shows the mirrored camera image under the grid; poses come from the in-browser model.
// "Center me": the 3x3 grid covers a window about three face widths wide around the seated streamer instead of the whole camera frame,
// so leaning one face width changes the column. Same fraction on both axes keeps the 16:9 aspect (a digital zoom).
const NO_CROP=Object.freeze({left:0,right:0,top:0,bottom:0});
let cameraCrop=NO_CROP;
function buildCameraGeometry(w,h){
  return createCameraGeometry({canvasWidth:canvas.width,canvasHeight:canvas.height,viewport:{x:0,y:0,width:canvas.width,height:canvas.height},sourceWidth:w,sourceHeight:h,mirror:cameraMirror,fit:'contain',crop:cameraCrop});
}
function setCameraCrop(crop){
  cameraCrop=crop??NO_CROP;const video=$('#camera-video');
  cameraGeometry=buildCameraGeometry(video.videoWidth||1280,video.videoHeight||720);
  stabilizer.reset();game.invalidateTracking();frameSource.reset();
}
function syncCameraGeometry(){
  // The stream's size changes when the phone rotates; rebuild the grid so it always matches the visible image.
  const video=$('#camera-video'),w=video.videoWidth,h=video.videoHeight;
  if(!w||!h||!cameraGeometry||(cameraGeometry.sourceWidth===w&&cameraGeometry.sourceHeight===h))return;
  cameraGeometry=buildCameraGeometry(w,h);
  stabilizer.reset();game.invalidateTracking();frameSource.reset();
}
// Grace for brief tracking gaps; it must stay below the game's 250 ms maxAge, otherwise an old position would be passed off as fresh.
const GRACE_MS=200;let lastGood=null;
const autoFrame=new AutoFrame();
// Optional readout for real-camera tests: open the page with ?debug=1. It shows why a drop was UNKNOWN (low score, slow frames, no face).
const debugStats={frames:0,since:performance.now(),fps:0,score:null,shownAt:0,level:0,peak:0};
const debugOn=new URLSearchParams(location.search).has('debug');
function updateDebug(now,snapshot){
  if(!debugOn||now-debugStats.shownAt<250)return;
  const dt=(now-debugStats.since)/1000;if(dt>=1){debugStats.fps=debugStats.frames/dt;debugStats.frames=0;debugStats.since=now;}
  debugStats.shownAt=now;const v=cameraGeometry?.visible,x=v&&lastMarker?(lastMarker.x-v.x)/v.width:null,lane=dropColumn(x);
  const el=$('#camera-debug');el.hidden=false;
  el.textContent=`score ${debugStats.score===null?'none':debugStats.score.toFixed(2)} · fps ${debugStats.fps.toFixed(1)} · x ${x===null?'—':Math.round(x*100)+'%'} · lane ${lane===null?'—':['L','C','R'][lane-1]} · ${snapshot.mode}`+((mosquito.active||debugOn&&cameraOn)?` · motion ${debugStats.level.toFixed(2)} peak ${debugStats.peak.toFixed(2)}`:'')+(snapshot.lastResult?.kind==='DROP'?` · judged ${snapshot.lastResult.outcome} x ${snapshot.lastResult.sampledX===null?'—':Math.round(snapshot.lastResult.sampledX*100)+'%'} caught ${snapshot.lastResult.caught===null?'—':snapshot.lastResult.caught}`:'');
}
function pollCamera(){
  syncCameraGeometry();
  const result=cameraTracker.poll();
  if(!result.fresh)return;
  debugStats.frames++;debugStats.score=result.points?.torso?.visibility??null;
  // Automatic digital zoom: frame the face once it is steady, and again only if the person moves much closer or farther.
  if(cameraTracker.kind==='face'&&$('#camera-auto').checked){
    const crop=autoFrame.update(cameraTracker.lastFace,performance.now());
    if(crop){setCameraCrop(crop);$('#camera-status').textContent='Auto-framed: the grid now covers about six face widths around you, with room above your head; lean a little to change column.';}
  }
  // A tilted head can drop the face for a few frames; keep the last position for a short grace period instead of declaring tracking lost.
  if(result.points){lastGood={points:result.points,at:performance.now()};frameSource.capture(result.points);}
  else if(lastGood&&performance.now()-lastGood.at<GRACE_MS)frameSource.capture(lastGood.points);
  else{stabilizer.reset();lastGood=null;}
}
function drawCameraBackdrop(context,geometry){
  const video=$('#camera-video');if(video.readyState<2)return;
  const v=geometry.visible,i=geometry.image;
  context.save();context.beginPath();context.rect(v.x,v.y,v.width,v.height);context.clip();
  if(geometry.mirror){context.translate(i.x+i.width,i.y);context.scale(-1,1);}else context.translate(i.x,i.y);
  const c=geometry.crop,vw=video.videoWidth,vh=video.videoHeight;
  context.drawImage(video,c.left*vw,c.top*vh,(1-c.left-c.right)*vw,(1-c.top-c.bottom)*vh,0,0,i.width,i.height);context.restore();
}
function setPoseLabels(text,badge){
  for(const element of document.querySelectorAll('[data-pose-label]'))element.textContent=text;
  const node=document.querySelector('.simulation-badge');if(node)node.lastChild.textContent=` ${badge}`;
}
function setCameraMode(on){
  cameraOn=on;stabilizer.reset();
  if(on){
    const video=$('#camera-video');savedGeometry=cameraGeometry;
    cameraCrop=NO_CROP;cameraGeometry=buildCameraGeometry(video.videoWidth||1280,video.videoHeight||720);
    setPoseLabels(cameraKindLabel,'Camera tracking');
    $('#camera-toggle').textContent='Turn off camera tracking';
  } else {
    if(savedGeometry)cameraGeometry=savedGeometry;savedGeometry=null;
    setPoseLabels('SYNTHETIC POSE INPUT','Synthetic input');
    $('#camera-toggle').textContent='Turn on camera tracking';
  }
  game.invalidateTracking();frameSource.reset();lastEffect=null;
}
$('#camera-toggle').addEventListener('click',async()=>{
  const button=$('#camera-toggle');
  if(cameraOn||cameraTracker){cameraTracker?.stop();cameraTracker=null;autoFrame.reset();$('#camera-center').disabled=true;$('#camera-center-reset').disabled=true;cameraCrop=NO_CROP;$('#camera-zoom').disabled=true;$('#camera-zoom-reset').disabled=true;$('#camera-facing').disabled=false;$('#camera-kind').disabled=false;setCameraMode(false);$('#camera-status').textContent='Camera off. Keyboard or mouse input is used.';return;}
  button.disabled=true;$('#camera-status').textContent='Starting camera and loading the pose model…';
  const labels={CAMERA_DENIED:'Camera permission was denied. Allow the camera for this page and try again.',CAMERA_UNSUPPORTED:'This browser cannot open a camera here. Use http://localhost:4173/.',CAMERA_BUSY:'Another app (OBS, a call, another tab) is using this camera. Close it and try again.',CAMERA_NOT_FOUND:'No camera was found. Connect one and try again.',MODEL_FAILED:'The pose model could not start.'};
  const facing=$('#camera-facing').value,kind=$('#camera-kind').value;cameraMirror=$('#camera-mirror').checked;cameraKindLabel=kind==='face'?'CAMERA FACE TRACKING':'CAMERA POSE TRACKING';
  const tracker=new CameraTracker({video:$('#camera-video'),kind,facingMode:facing,onStatus:(status,detail)=>{if(status==='FAILED')$('#camera-status').textContent=labels[detail]??'Camera tracking failed.';}});
  const ok=await tracker.start();
  button.disabled=false;
  if(!ok)return;
  cameraTracker=tracker;$('#camera-center').disabled=kind!=='face';$('#camera-center-reset').disabled=false;$('#camera-zoom').disabled=kind!=='face';$('#camera-zoom-reset').disabled=false;$('#camera-facing').disabled=true;$('#camera-kind').disabled=true;setCameraMode(true);$('#camera-status').textContent='Camera tracking on. Keep your face in view (body mode: head and shoulders).';
});
const zoomMessages={ZOOM_UNSUPPORTED:'This camera does not support zoom.',NO_FACE:'No face found yet. Sit in view, then try again.',ZOOM_FAILED:'The camera refused the zoom change.'};
$('#camera-center').addEventListener('click',()=>{
  if(!cameraTracker)return;
  const crop=cameraTracker.kind==='face'?centerCrop(cameraTracker.lastFace):null;
  if(!crop){$('#camera-status').textContent='No face found yet. Sit in view, then try again.';return;}
  setCameraCrop(crop);autoFrame.adopt(cameraTracker.lastFace);$('#camera-status').textContent='Centered. The grid now covers about six face widths around you, with room above your head; lean a little to change column.';
});
// Mirror can be flipped while the camera runs; the grid, lanes and backdrop are rebuilt for the new orientation.
$('#camera-mirror').addEventListener('change',()=>{cameraMirror=$('#camera-mirror').checked;if(cameraOn)setCameraCrop(cameraCrop);});
$('#camera-center-reset').addEventListener('click',()=>{$('#camera-auto').checked=false;autoFrame.reset();setCameraCrop(null);$('#camera-status').textContent='View reset to the whole camera frame.';});
// Full screen keeps the whole 3x3 grid on screen (phone browser bars otherwise cut off the bottom row).
$('#fullscreen').addEventListener('click',async()=>{
  const frame=document.querySelector('.arena-frame');
  try{if(document.fullscreenElement)await document.exitFullscreen();else await frame.requestFullscreen();}
  catch{feed('Full screen unavailable','This browser did not allow full screen');}
});
$('#camera-zoom').addEventListener('click',async()=>{
  if(!cameraTracker)return;const result=await cameraTracker.zoomToFace();
  if(result.ok){stabilizer.reset();game.invalidateTracking();frameSource.reset();}
  $('#camera-status').textContent=result.ok?`Zoom set to ${result.zoom}x so your face fills about a sixth of the frame width.`:(zoomMessages[result.reason]??'Zoom failed.');
});
$('#camera-zoom-reset').addEventListener('click',async()=>{
  if(!cameraTracker)return;const result=await cameraTracker.resetZoom();
  if(result.ok){stabilizer.reset();game.invalidateTracking();frameSource.reset();}
  $('#camera-status').textContent=result.ok?'Zoom reset to 1x.':(zoomMessages[result.reason]??'Zoom failed.');
});
function loop(){
  try{loopBody();}
  catch(error){if(!loopFailed){loopFailed=true;console.error('ERROR frame loop',error);feed('Frame error','A frame failed; the game keeps running');}}
  finally{animationId=requestAnimationFrame(loop);}
}
let loopFailed=false;
function loopBody(){
  const now=performance.now();if(cameraOn)pollCamera();else addSyntheticFrame();let snapshot=game.tick();
  // Automatic waves (local game logic): irregular gold items and bombs while the round is playing and the box is ticked.
  // A round is 75 s: after that no new drops start, and when the last one has landed the round ends with a summary banner.
  if(autoDrops.checked&&waves.difficulty(now)>=1)roundEnding=true;
  if(roundEnding&&snapshot.attacks.length===0){
    roundEnding=false;autoDrops.checked=false;banner={text:`ROUND OVER · SCORE ${snapshot.score}`,at:now};feed('Round over',`Score ${snapshot.score}`);
  }
  // Once per round, about two thirds in, the mosquito comes for the face; gold items and bombs wait while it is around.
  // (once per round, retried about once a second until a face is tracked and no gold or bomb is still falling)
  if(autoDrops.checked&&!roundEnding&&!mosquitoPlanned&&waves.difficulty(now)>=.66&&snapshot.mode==='PLAYING'&&snapshot.attacks.length===0&&now>=nextMosquitoTry){
    nextMosquitoTry=now+1000;if(startFaceMosquito())mosquitoPlanned=true;
  }
  stepMosquito(now,snapshot);debugFaceMotion(now);
  if(autoDrops.checked&&!roundEnding&&!mosquito.active&&snapshot.mode==='PLAYING'&&game.connection==='ONLINE'){
    const next=waves.update(now,snapshot.attacks.length);
    if(next){const id=`wave-${++waveSerial}`;game.receiveWaveDrop({notificationId:id,messageId:id,actorId:id,receivedAt:performance.now()},next);snapshot=game.tick();}
  }
  const last=frameSource.lastFrame,anchor=cameraOn?(last?.torso??last?.nose??null):(last?.nose??null);
  const drawn=drawArena(ctx,snapshot,anchor,{now,lastEffect,banner,mosquito:mosquito.snapshot(now),biteAt,showMarker:debugOn,tracking:frameSource.running&&Boolean(anchor),geometry:cameraGeometry,
    backdrop:cameraOn?drawCameraBackdrop:null,marker:cameraOn});lastMarker=drawn?.position??null;
  catchFx.draw(ctx,now,fxSprites,cameraGeometry?.visible??null);updateDebug(now,snapshot);updateScreen(snapshot);
  if(now-lastOverlayUpdate>=100){lastOverlayUpdate=now;publishOverlay(snapshot);}
}

function send(text){
  const command=typeof text==='string'?text.trim():'';
  if(/^!freeze$/i.test(command)){sendChallenge('FREEZE');return;}
  if(/^!mosquito$/i.test(command)){sendChallenge('MOSQUITO');return;}
  const lava=/^!lava(?:\s+(0\.[1-8]))?$/i.exec(command);
  if(lava){sendChallenge('LAVA',lava[1]?Number(lava[1]):.45);return;}
  const serial=++eventId;
  const result=adapter.ingest(syntheticChat({notificationId:`notification-${serial}`,messageId:`message-${serial}`,
    actorId:`viewer-${serial%16}`,text}));
  const feedback=$('#command-feedback');
  if(result.accepted&&result.kind==='DROP'){feedback.textContent=`Synthetic command sent: drop in column ${result.cell-3}`;feed('Viewer drop',`!drop ${result.cell-3} · 1.5 s to get under it`);}
  else if(result.accepted){feedback.textContent=`Synthetic command sent: cell ${result.cell}`;feed('Viewer attack',`!throw ${result.cell} · 0.5 s warning`);}
  else feedback.textContent=reasons[result.reason]??'Event could not be handled';
}

function move(dx,dy){
  if(!cameraGeometry)return;
  const mapped=projectCameraPoint({...player,visibility:1},cameraGeometry)??{x:.5,y:.5};
  const visible={x:Math.max(1/6,Math.min(5/6,mapped.x+dx/3)),y:Math.max(1/6,Math.min(5/6,mapped.y+dy/3))};
  const source=canvasPointToSource(visiblePointToCanvas(visible,cameraGeometry),cameraGeometry);if(source)Object.assign(player,source);
}
const movement={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};
document.querySelectorAll('[data-move]').forEach(button=>button.addEventListener('click',()=>move(...movement[button.dataset.move])));
document.querySelectorAll('[data-throw]').forEach(button=>button.addEventListener('click',()=>send(`!throw ${button.dataset.throw}`)));
$('#synthetic-cross').addEventListener('click',()=>{
  if(mockMode||chatMode||providerActivation)return;
  const serial=++eventId;
  const result=game.receiveSyntheticCross({notificationId:`notification-${serial}`,messageId:`message-${serial}`,
    actorId:'synthetic-cross-viewer',receivedAt:performance.now()});
  $('#command-feedback').textContent=result.accepted?'Cross Inferno! Move to a corner (1, 3, 7, 9) within 1.5 s.':reasons[result.reason]??'Event could not be handled';
  if(result.accepted)feed('Simulated Cross Inferno','1.5 s warning · corners safe · single outcome');
});
function sendChallenge(kind,level=.45){
  if(mockMode||chatMode||providerActivation||popupController?.pending){$('#command-feedback').textContent='Stop the local chat auth test before starting a challenge';return;}
  const serial=++eventId,event={notificationId:`notification-${serial}`,messageId:`message-${serial}`,actorId:`synthetic-${kind}-viewer`,receivedAt:performance.now()};
  const result=kind==='FREEZE'?game.receiveSyntheticFreeze(event):kind==='MOSQUITO'?game.receiveSyntheticMosquito(event):game.receiveSyntheticLava(event,{level});
  $('#command-feedback').textContent=result.accepted?`${challengeNames[kind]}${result.raised?'Lava level raised':'Started'}`:reasons[result.reason]??'Event could not be handled';
  if(result.accepted)feed(challengeNames[kind],result.raised?'Raise target level':'Uses synthetic joint controls');
}
for(const [id,kind] of [['synthetic-freeze','FREEZE'],['synthetic-mosquito','MOSQUITO'],['synthetic-lava','LAVA']])$(`#${id}`).addEventListener('click',()=>sendChallenge(kind));
$('#elbow-spread').addEventListener('input',()=>{poseControls.spread=Number($('#elbow-spread').value)/100;$('#elbow-value').textContent=`${Math.round(poseControls.spread*100)}%`;});
$('#hip-stand').addEventListener('click',()=>{poseControls.hip=.5;});
$('#hip-crouch').addEventListener('click',()=>{poseControls.hip=.93;});
$('#synthetic-clap').addEventListener('click',()=>{
  const p={x:(poseControls.leftWrist.x+poseControls.rightWrist.x)/2,y:(poseControls.leftWrist.y+poseControls.rightWrist.y)/2};
  poseControls.leftWrist={...p,x:p.x-.015};poseControls.rightWrist={...p,x:p.x+.015};
});
$('#chat-form').addEventListener('submit',event=>{event.preventDefault();send($('#chat-input').value);});
$('#calibration-form').addEventListener('input',()=>{$('#calibration-status').textContent='Settings changed; press Apply calibration.';});
$('#calibration-form').addEventListener('submit',event=>{
  event.preventDefault();game.invalidateTracking();frameSource.reset();lastEffect=null;
  const percent=id=>{const element=$(`#${id}`);if(element.value.trim()==='')throw new Error('EMPTY_VALUE');return Number(element.value)/100;};
  try {
    const aspect=$('#cal-aspect').value;const dimensions=aspect==='16:9'?[1280,720]:aspect==='4:3'?[640,480]:null;
    if(!dimensions)throw new Error('INVALID_ASPECT');
    cameraGeometry=createCameraGeometry({canvasWidth:canvas.width,canvasHeight:canvas.height,
      viewport:{x:percent('cal-x')*canvas.width,y:percent('cal-y')*canvas.height,width:percent('cal-width')*canvas.width,height:percent('cal-height')*canvas.height},
      sourceWidth:dimensions[0],sourceHeight:dimensions[1],
      crop:{left:percent('crop-left'),right:percent('crop-right'),top:percent('crop-top'),bottom:percent('crop-bottom')},
      fit:$('#cal-fit').value,rotation:Number($('#cal-rotation').value),mirror:$('#cal-mirror').checked});
    const center=canvasPointToSource(visiblePointToCanvas({x:.5,y:.5},cameraGeometry),cameraGeometry);Object.assign(player,center);
    $('#calibration-status').textContent='Calibration applied; resumes when tracking recovers.';
  } catch {cameraGeometry=null;$('#calibration-status').textContent='Invalid calibration: keep the region inside the frame, with width and height above zero and crops totalling under 100%.';}
});
$('#provider-form').addEventListener('input',()=>{configuredProvider=null;$('#provider-feedback').textContent='Settings changed; validate again.';syncProviderControls();});
$('#provider-form').addEventListener('submit',event=>{
  event.preventDefault();configuredProvider=null;
  try {
    configuredProvider=validateProviderConfig({clientId:$('#provider-client-id').value.trim(),channelId:$('#provider-channel-id').value.trim(),redirectUri:$('#provider-callback').value.trim()});
    if(new URL($('#provider-callback').value.trim()).origin!==location.origin)throw new Error('INVALID_CALLBACK');
    $('#provider-feedback').textContent='Settings validated; ready to authorize.';
  } catch(error) {
    const errors={INVALID_CLIENT_ID:'Invalid Client ID format',INVALID_CHANNEL_ID:'Channel ID must be numeric',INVALID_CALLBACK:'Callback URL must be http://localhost:4173/oauth-callback.html (or 127.0.0.1) or a same-origin path ending in it'};
    $('#provider-feedback').textContent=errors[error.message]??'Settings unusable';
  }
  syncProviderControls();
});
// Both buttons use the same lifecycle; the live button cannot bypass the hard lock.
function syncProviderControls(){
  const busy=Boolean(providerActivation)||Boolean(ircChat),otherBusy=mockMode||chatMode||Boolean(popupController?.pending);
  $('#provider-local').disabled=otherBusy||Boolean(ircChat);
  $('#irc-start').disabled=Boolean(providerActivation)||otherBusy;
  $('#irc-start').textContent=ircChat?'Disconnect':'Connect without login (read-only)';
  $('#irc-channel').disabled=Boolean(ircChat);
  $('#provider-local').textContent=providerActivation?'Stop / cancel local simulation':'Test with local simulator';
  $('#provider-live').disabled=!LIVE_NETWORK_ENABLED||!configuredProvider||busy||otherBusy;
  $('#provider-live').textContent=LIVE_NETWORK_ENABLED?'Authorize and subscribe':'Authorize and subscribe (unavailable)';
  for(const element of $('#provider-form').elements)element.disabled=busy;
  $('#mock-toggle').disabled=busy||chatMode||Boolean(popupController?.pending);
  $('#auth-mock-toggle').disabled=busy||mockMode;
  $('#connection').disabled=busy||mockMode||chatMode;
  for(const button of document.querySelectorAll('[data-throw], #chat-input, #chat-form button'))button.disabled=busy;
  for(const button of document.querySelectorAll('#synthetic-cross,#synthetic-freeze,#synthetic-mosquito,#synthetic-lava'))button.disabled=busy||mockMode||chatMode||Boolean(popupController?.pending);
}
function finishProvider(message){
  const current=providerActivation;if(!current)return;
  providerActivation=null;current.stop();adapter.ingest(syntheticWelcome());
  $('#provider-status').textContent=message;syncProviderControls();
}
function startProvider(mode){
  if(providerActivation||ircChat||mockMode||chatMode||popupController?.pending)return;
  if(mode==='live'&&(!LIVE_NETWORK_ENABLED||!configuredProvider)){$('#provider-status').textContent='Live connection unavailable or settings not validated.';return;}
  if(!['http://127.0.0.1:4173','http://localhost:4173'].includes(location.origin)){$('#provider-status').textContent='Open this page at localhost:4173 or 127.0.0.1:4173.';return;}
  const prefix=mode==='local'?'Local simulation':'Twitch';
  const provider=new TwitchProvider({mode,game,config:mode==='local'?LOCAL_CONFIG:configuredProvider,
    onStatus:(status,detail)=>{
      if(!providerActivation)return;
      const labels={CONNECTING:'Connecting',SUBSCRIBING:'Subscribing',ONLINE:'Chat subscribed',MIGRATING:'Subscription migrating',RETRYING:'Reconnecting'};
      if(labels[status]){$('#provider-status').textContent=`${prefix}: ${labels[status]}`;$('#connection-badge').textContent=`${prefix}: ${labels[status]}`;}
      if(status==='STOPPED'&&detail)finishProvider(detail==='AUTH_REQUIRED'?'Authorization expired; re-authorize.':'Subscription stopped; re-authorize.');
    },
    onDelivery:result=>{if(result.accepted)feed(`${prefix}Chat attack`,`!throw ${result.cell} · 0.5 s warning`);}
  });
  const activation=new ProviderActivation({provider,origin:location.origin,
    openWindow:url=>window.open(url,'streamer-mayhem-provider-auth','popup,width=520,height=420'),
    onState:state=>{
      const messages={PENDING:'Waiting for authorization; press Stop / Cancel.',VALIDATING:'Validating authorization.',AUTHORIZED:'Authorized; subscribing.'};
      if(messages[state])$('#provider-status').textContent=`${prefix}: ${messages[state]}`;
      if(['CANCELLED','CLOSED','DENIED','FAILED','BLOCKED','LIVE_LOCKED'].includes(state)){
        const errors={CANCELLED:'Authorization cancelled.',CLOSED:'Authorization window closed.',DENIED:'Authorization denied.',FAILED:'Authorization or subscription failed to start.',BLOCKED:'Allow pop-ups for this page.',LIVE_LOCKED:'Live connection unavailable.'};
        finishProvider(`${prefix}: ${errors[state]}`);
      }
    }});
  providerActivation=activation;adapter.disconnect();syncProviderControls();
  if(!activation.start() && providerActivation)finishProvider(`${prefix}: could not start authorization.`);
}
$('#provider-local').addEventListener('click',()=>{if(providerActivation)finishProvider('Local simulation stopped.');else startProvider('local');});
$('#provider-live').addEventListener('click',()=>startProvider('live'));
// Anonymous read-only chat: no account, token or Twitch application is needed.
function stopIrc(message){
  const current=ircChat;if(!current)return;
  ircChat=null;current.stop();adapter.ingest(syntheticWelcome());
  $('#irc-status').textContent=message;$('#connection-badge').textContent='Simulated connection';syncProviderControls();
}
$('#irc-start').addEventListener('click',()=>{
  if(ircChat){stopIrc('Disconnected.');return;}
  if(providerActivation||mockMode||chatMode||popupController?.pending)return;
  let channel;try{channel=normalizeChannel($('#irc-channel').value);}catch{$('#irc-status').textContent='Enter a Twitch channel name (letters, digits, underscore).';return;}
  const labels={CONNECTING:'Connecting',ONLINE:`Live chat connected: #${channel}`,RETRYING:'Reconnecting'};
  const chat=new IrcAnonymousChat({channel,game,
    onStatus:(status,detail)=>{
      if(ircChat!==chat)return;
      if(labels[status]){$('#irc-status').textContent=labels[status];$('#connection-badge').textContent=`Twitch chat: ${labels[status]}`;}
      if(status==='STOPPED')stopIrc(`Connection stopped (${detail??'unknown'}); press Connect to retry.`);
    },
    onDelivery:result=>{if(result.accepted)feed('Twitch chat attack',`!throw ${result.cell} · 0.5 s warning`);}});
  ircChat=chat;adapter.disconnect();syncProviderControls();chat.start();
});

function pointInput(event){
  const rect=canvas.getBoundingClientRect();const source=canvasPointToSource({x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height},cameraGeometry);
  if(!source)return;
  const target=$('#pointer-control').value;
  if(target==='body')Object.assign(player,source);
  else {const visible=projectCameraPoint({...source,visibility:1},cameraGeometry);if(visible)poseControls[target]={x:visible.x,y:visible.y};}
}
canvas.addEventListener('pointerdown',event=>{pointInput(event);canvas.setPointerCapture?.(event.pointerId);canvas.focus();});
canvas.addEventListener('pointermove',event=>{if(event.buttons===1)pointInput(event);});
canvas.addEventListener('keydown',event=>{
  const keys={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
  if(keys[event.key]){event.preventDefault();move(...movement[keys[event.key]]);}
});
$('#pause').addEventListener('click',()=>{
  if(game.mode==='PAUSED'){game.resume();feed('Game getting ready to resume','Hold position; resumes after the countdown');}
  else if(game.pause())feed('Game paused','Chat attacks paused');
});
$('#tracking').addEventListener('click',()=>{tracking=!tracking;if(!tracking)game.loseLandmarks();const snapshot=game.tick();updateScreen(snapshot);publishOverlay(snapshot,{force:true});feed(tracking?'Synthetic tracking restored':'Synthetic tracking interrupted',tracking?'Resumes after the preparation countdown':'No hit or out-of-bounds is judged');});
$('#frame-source-toggle').addEventListener('click',()=>{
  if(frameSource.running){frameSource.stop();lastEffect=null;feed('Synthetic frames interrupted','Pending attacks cancelled; no score or damage');}
  else {frameSource.start();feed('Synthetic frames resuming','Countdown starts after a fresh frame arrives');}
  const snapshot=game.tick();updateScreen(snapshot);publishOverlay(snapshot,{force:true});
});
$('#connection').addEventListener('click',()=>{
  if(adapter.status==='SIMULATED_ONLINE'){adapter.disconnect();feed('Simulated chat is offline','No new attacks accepted');}
  else {adapter.ingest(syntheticWelcome());feed('Simulated chat restored','Synthetic events re-enabled');}
});
$('#mock-toggle').addEventListener('click',()=>{
  if(!mockMode){mockMode=true;syncProviderControls();$('#connection').disabled=true;$('#auth-mock-toggle').disabled=true;$('#mock-toggle').textContent='Stop local CLI mock';transport.start();}
  else {transport.stop();mockMode=false;syncProviderControls();$('#connection').disabled=false;$('#auth-mock-toggle').disabled=false;$('#mock-toggle').textContent='Connect local CLI mock';adapter.ingest(syntheticWelcome());}
});
$('#auth-mock-toggle').addEventListener('click',()=>{
  if(chatMode){chatTransport.stop();oauth.clear();chatMode=false;syncProviderControls();$('#connection').disabled=false;$('#mock-toggle').disabled=false;$('#auth-mock-toggle').textContent='Start local chat auth test';adapter.ingest(syntheticWelcome());return;}
  if(!popupController){feed('Local authorization cannot start','Open the game at localhost:4173 or 127.0.0.1:4173');return;}
  if(popupController.pending)popupController.cancel();else popupController.start();
});
window.addEventListener('message',event=>{popupController?.handleMessage(event);providerActivation?.handleMessage(event);});
$('#reset').addEventListener('click',()=>{
  game.reset();frameSource.reset();waves.reset(performance.now());roundEnding=false;banner=null;mosquito.cancel(performance.now());game.setFaceMosquitoBusy(false);mosquitoPlanned=false;player.x=.5;player.y=.5;tracking=true;lastEffect=null;game.start();
  if(ircChat)game.setConnection(ircChat.status==='ONLINE');else if(providerActivation)game.setConnection(providerActivation.provider.transport.status==='ONLINE');else if(mockMode||chatMode)game.setConnection((chatMode?chatTransport:transport).status==='ONLINE');else adapter.ingest(syntheticWelcome());
  poseControls.spread=.1;poseControls.hip=.5;poseControls.leftWrist={x:.25,y:.55};poseControls.rightWrist={x:.75,y:.55};
  $('#elbow-spread').value='10';$('#elbow-value').textContent='10%';for(const id of ['elbow-known','wrist-known','hip-known'])$(`#${id}`).checked=true;
  addSyntheticFrame();game.tick();
  $('#command-feedback').textContent='Try !throw 1–9, !drop 1–3, !bomb 1–3, !freeze, !mosquito or !lava';feed('Round reset','HP and score reset');
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){frameSource.stop();if(game.mode==='PLAYING'||game.mode==='TRACKING_LOST'||game.mode==='RECOVERING')game.pause();feed('Game paused','Judging pauses while the page is hidden');const snapshot=game.tick();updateScreen(snapshot);publishOverlay(snapshot,{force:true});}
  else{frameSource.start();stabilizer.reset();}   // back on screen: judging frames may flow again (the game itself still waits for Resume)
});
window.addEventListener('pagehide',()=>{stopOverlaySync();cancelAnimationFrame(animationId);transport.stop();chatTransport.stop();cameraTracker?.stop();popupController?.dispose();providerActivation?.stop();ircChat?.stop();oauth.clear();});

syncProviderControls();game.start();addSyntheticFrame();game.tick();adapter.ingest(syntheticWelcome());animationId=requestAnimationFrame(loop);
