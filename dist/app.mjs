import { MatrixGame, gradeFor } from './matrix.mjs';
import { createSfx } from './sfx.mjs';
import { EventSubAdapter, syntheticChat, syntheticWelcome } from './eventsub_adapter.mjs';
import { MockEventSubTransport } from './mock_eventsub_transport.mjs';
import { MockOAuth } from './mock_oauth.mjs';
import { AuthPopupController } from './auth_popup_controller.mjs';
import { TwitchProvider, LOCAL_CONFIG, LIVE_NETWORK_ENABLED, validateProviderConfig } from './twitch_provider.mjs';
import { ProviderActivation } from './provider_activation.mjs';
import { IrcAnonymousChat, normalizeChannel } from './irc_anonymous.mjs';
import { CameraTracker, PointStabilizer } from './camera_tracker.mjs';
import { drawArena } from './arena_draw.mjs';
import { createTicker, speakableName, cleanName, chatPointsFor } from './ticker.mjs';
import {AutoFrame,createCropGate} from './auto_frame.mjs';
import {dropColumn,dropTarget,dropLandX,DROP_FLOOR} from './drop_lanes.mjs';
import {CatchBurst,loadSprites} from './catch_fx.mjs';
import {DropWaves} from './drop_waves.mjs';
import {createCameraGeometry,centerCrop,projectCameraPoint,projectCameraFrame,canvasPointToSource,visiblePointToCanvas} from './camera_geometry.mjs';
import {createOverlayPublisher,obsCameraSetup,buildOverlayExtras} from './overlay_publisher.mjs';
import {SyntheticFrameSource} from './frame_source.mjs';

// One line for the activity feed, by what the chat command really was (the adapter keeps the game's `kind`).
let lastViewer=null;      // {name,at} of the latest accepted chat command, shown on the stream overlay for a few seconds
const ticker=createTicker();let chatScore=0;const cropGate=createCropGate();
function describeDelivery(result){
  if(result.viewer)lastViewer={name:result.viewer,at:performance.now()};
  if(result.accepted&&result.viewer&&result.eventId!==undefined)ticker.noteShot(result.eventId,result.viewer,performance.now(),result.supporter);
  const who=result.viewer?`${result.viewer}: `:'';
  return who+describeCommand(result);
}
function describeCommand(result){
  if(result.kind==='DROP'){const lane=(result.cells?.[0]??result.cell-3);return result.variant==='BOMB'?`!pie ${lane} · dodge the pie`:`!drop ${lane} · catch the ball`;}
  return `!throw ${result.cell} · 0.5 s warning`;
}
const $ = selector => document.querySelector(selector);
const canvas=$('#arena'),ctx=canvas.getContext('2d');
const player={x:.5,y:.5};
const poseControls={spread:.1,hip:.5,leftWrist:{x:.25,y:.55},rightWrist:{x:.75,y:.55}};
const challengeNames={DROP:'Catch the drop',CROSS:'Cross Inferno',FREEZE:'Freeze',LAVA:'Lava'};
let cameraGeometry=createCameraGeometry({canvasWidth:canvas.width,canvasHeight:canvas.height,viewport:{x:0,y:0,width:canvas.width,height:canvas.height},sourceWidth:1280,sourceHeight:720});
let eventId=0,tracking=true,lastEffect=null,animationId=0,mockMode=false,chatMode=false,providerActivation=null,configuredProvider=null,ircChat=null,cameraTracker=null,cameraOn=false,cameraMirror=true,cameraKindLabel='CAMERA FACE TRACKING',savedGeometry=null;
let lastOverlayUpdate=0,roundLeftNow;
const modeNames={IDLE:'Ready',PLAYING:'Playing',PAUSED:'Paused',TRACKING_LOST:'Tracking lost',RECOVERING:'Getting ready',ROUND_END:'Round over'};
const reasons={MODE_BUSY:'Finish the current challenge first',POSE_UNKNOWN:'Not enough joints visible or lava at its cap; restore the joint',FREEZE_COOLDOWN:'Freeze is cooling down',GAME_COOLDOWN:'This game is cooling down',INVALID_LEVEL:'Lava level must be between 0.1 and 0.8',INVALID_COMMAND:'Enter !drop 1-3 (a ball) or !pie 1-3 (a pie)',ACTOR_COOLDOWN:'This viewer must wait',PIE_COOLDOWN:'A pie was just thrown; wait for the next window',GLOBAL_COOLDOWN:'Wait a moment before sending another',QUEUE_FULL:'Attack queue full',OFFLINE:'Simulated chat is offline',NOT_PLAYING:'The game cannot accept attacks now',DUPLICATE:'Duplicate event skipped',INVALID_EVENT:'Malformed simulated event'};

function feed(title,detail) {
  const li=document.createElement('li'),dot=document.createElement('span'),body=document.createElement('div');
  const name=document.createElement('b'),description=document.createElement('small'),time=document.createElement('time');
  dot.className='feed-dot';name.textContent=title;description.textContent=detail;time.textContent='NOW';
  body.append(name,description);li.append(dot,body,time);const list=$('#activity');list.prepend(li);
  while(list.children.length>3)list.lastElementChild.remove();
}

// Sound: synthesised in sfx.mjs, muted until the streamer clicks the sound button (browsers need a click, and a stream should never start noisy).
// ?sfx=0 turns this page's sound off (the OBS overlay has no sound of its own); ?keepalive=1 keeps it running while the tab is hidden.
const pageParams=new URLSearchParams(location.search);
function safeStorage(){try{return window.localStorage;}catch{return null;}}
const sfx=createSfx({storage:safeStorage(),keepAlive:pageParams.get('keepalive')==='1'});
const soundDisabled=pageParams.get('sfx')==='0';
const OUTCOME_SOUND={CATCH:'catch',MISS:'rim',BOMB:'splat',AVOID:'avoid',HIT:'hit',DODGE:'dodge'};   // UNKNOWN makes no sound
const warnedBombs=new Set(),shotHeard=new Set();
// Announcer (Kokoro af_heart clips generated locally, dist/voice): a three-pointer is called, a two-pointer gets "Good shot!" or "Nice shot!" in turn.
// Only while the sound is on and unlocked, never more than one line per 1.2 s, so a streak of catches does not turn into chatter.
const voiceClips={};let voiceAt=-Infinity,voiceTurn=0,thanksAt=-Infinity;
// Star ball (theme): a chat message with Bits that is not itself a command sends a gold ball with the supporter's name on it (a command that comes with a cheer
// already carries the name, see the engine). Catching a star ball is the thank-you: the announcer says "Thank you for the support!", or, when the streamer
// switched it on (off by default, name filtered, at most one every 8 s), the browser voice reads the name. The fixed clip never says a name.
const starQueue=[];let starSerial=0,starTryAt=0;
function announceSupport(delivery){
  // Only a cheer that is not a command (INVALID_COMMAND) earns a star ball: a refused command (cooldown, busy, duplicate) never does, and the adapter drops repeats.
  if(!(delivery?.cheerBits>0)||delivery.accepted||delivery.reason!=='INVALID_COMMAND')return;
  const name=cleanName(delivery.viewer);if(!name||starQueue.length>=3)return;starQueue.push(name);
}
function stepStars(now){
  if(!starQueue.length||now<starTryAt||game.mode!=='PLAYING')return;starTryAt=now+1500;
  const id=`star-${++starSerial}`,name=starQueue[0];
  const r=game.receiveWaveDrop({notificationId:id,messageId:id,actorId:id,receivedAt:now},{column:[1,3,2][starSerial%3],fall:2800,label:name});
  if(r.accepted){starQueue.shift();ticker.noteShot(id,name,now,true);}
  else if(!['MODE_BUSY','QUEUE_FULL','GLOBAL_COOLDOWN','NOT_PLAYING'].includes(r.reason))starQueue.shift();   // busy: try again shortly; anything else: drop it
}
function thankSupporter(label){
  if(sfx.status()!=='AUDIO READY')return;
  const now=performance.now();if(now-thanksAt<8000)return;thanksAt=now;
  const name=speakableName(label),speak=Boolean(document.querySelector('#speak-names')?.checked&&name&&typeof speechSynthesis!=='undefined');   // empty name: the fixed clip
  try{
    if(speak){const u=new SpeechSynthesisUtterance(`${name}, thank you for the support`);u.lang=/[\u3400-\u9fff]/.test(name)?'zh-TW':'en-US';u.volume=.9;speechSynthesis.cancel();speechSynthesis.speak(u);}
    else{const a=(voiceClips.thanks??=new Audio('./voice/thanks.wav'));a.currentTime=0;a.volume=.9;a.play().catch(()=>{});}
  }catch{/* the strip still shows the supporter */}
}
// Pie warning: a CC0 siren clip (see voice/NOTICE.md). It fades out when the pie is resolved so it never talks over the splat.
function playPieAlarm(){
  if(sfx.status()!=='AUDIO READY')return;
  try{const a=(voiceClips.pie_alarm??=new Audio('./voice/pie_alarm.wav'));clearInterval(a.fadeTimer);a.currentTime=0;a.volume=Math.min(1,.8*Math.max(.2,sfx.volume));a.play().catch(()=>{});}catch{/* the warning flash still shows */}
}
function stopPieAlarm(){
  const a=voiceClips.pie_alarm;if(!a||a.paused)return;
  clearInterval(a.fadeTimer);a.fadeTimer=setInterval(()=>{a.volume=Math.max(0,a.volume-.12);if(a.volume<=.01){clearInterval(a.fadeTimer);a.pause();}},20);
}
function playVoice(points){
  if(sfx.status()!=='AUDIO READY')return;
  const now=performance.now();if(now-voiceAt<1200)return;voiceAt=now;
  const name=points===3?'three_points':(voiceTurn++%2?'nice_shot':'good_shot');
  try{const a=(voiceClips[name]??=new Audio(`./voice/${name}.wav`));a.currentTime=0;a.volume=.9;a.play().catch(()=>{});}catch{/* the sound effects still play */}
}
// ?seed=N makes the automatic waves repeatable (for rehearsals and the video); otherwise each round differs.
const seedParam=Number(new URLSearchParams(location.search).get('seed'));
// Theme pacing: a slow base fall (2.2-3.8 s) made faster by a random factor of 1.1-1.5 per shot (continuous, so speeds are very varied), shrinking a little over the
// round but never faster than 1.5 s (the speed ceiling); gaps never shorter than 0.55 s; at most three shots on screen.
const waves=new DropWaves({seed:Number.isInteger(seedParam)&&seedParam>0?seedParam:(Date.now()&0x7fffffff)||1,maxActive:3,fallMin:2200,fallMax:3800,fallFloor:1500,speedFactor:[1.1,1.5],gapMin:550,gapMax:2400,gapBase:800,gapMean:1000,gapFloor:550,laneStepMs:450,bombStart:.12,bombEnd:.22,columnWeights:[.06,.88,.06],maxSame:4,landXFor:(column,tag)=>dropLandX(column,`wave-${waveSerial+1}-${tag}`,.12)});let waveSerial=0,roundEnding=false,banner=null;
const autoDrops=document.querySelector('#auto-drops');
autoDrops.addEventListener('change',()=>{waves.reset(performance.now());roundEnding=false;banner=null;if(autoDrops.checked)sfx.play('roundStart');if(!autoDrops.checked&&session.phase==='running')session.phase='over';syncStart();feed(autoDrops.checked?'Auto drops on':'Auto drops off',autoDrops.checked?'Random balls and pies, rising difficulty':'Only chat starts drops');});
const catchFx=new CatchBurst({count:24});let fxSprites={},lastMarker=null;
loadSprites().then(sprites=>{fxSprites=sprites;});
const game=new MatrixGame({onEvent:event=>{
  if(event.type==='result'){
    if(event.outcome==='CATCH'&&cameraGeometry){
      // Burst where the item was caught: at its target x on the floor line.
      const v=cameraGeometry.visible,column=(event.cells?.[0]??event.cell-3),size=v.width/3;
      const at={x:v.x+(Number.isFinite(event.landX)?event.landX:(dropTarget(column)??.5))*v.width,y:v.y+DROP_FLOOR*v.height};catchFx.spawn(at.x,at.y,performance.now(),size*.5);
    }
    // x,y (window coordinates, 0..1) say where the effect belongs: the floor spot of a drop.
    const spot=event.kind==='DROP'?{x:Number.isFinite(event.landX)?event.landX:(dropTarget(event.cells?.[0]??event.cell-3)??.5),y:DROP_FLOOR}:{};
    lastEffect={outcome:event.outcome,at:performance.now(),scoreDelta:event.scoreDelta??0,...(Number.isFinite(event.combo)?{combo:event.combo}:{}),...(Number.isFinite(event.points)?{points:event.points}:{}),...spot};
    ticker.noteResult(event,performance.now());if(event.kind==='DROP')chatScore+=chatPointsFor(event.outcome);
    const sound=OUTCOME_SOUND[event.outcome];if(sound)sfx.play(sound,{combo:event.combo});if(event.outcome==='CATCH'){sfx.play('swish');if(event.label)thankSupporter(event.label);else playVoice(event.points);}
    const titles={HIT:'Ouch, hit!',DODGE:'Nice dodge',CATCH:'Caught it!',MISS:'Missed it',BOMB:'Splat! Pie caught',AVOID:'Pie dodged'};
    feed(titles[event.outcome]??'Undetermined',`${challengeNames[event.kind]??`Target cell ${event.cell}`} · ${event.outcome}`);
  } else if(event.type==='lavaBurn')feed('Lava burn',`HP ${event.hpDelta} · stand to avoid the lava`);
  else if(event.type==='ringOut')feed('Character left the arena','Out of bounds');
},options:{landJitter:.12,avoidScore:0,chatThrow:false,chatPieGap:4500,pieFall:1700}});   // theme: dodging a pie scores nothing (a dodge is just not being hit)
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
},onDelivery:result=>{ticker.noteSupport(result,performance.now());announceSupport(result);ticker.noteReject(result,performance.now());if(result.accepted)feed('Local chat attack',describeDelivery(result));}});
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
  if(result.accepted)feed('Local mock attack',describeDelivery(result));
}});

// Synthetic state is relayed only through the same loopback server, in memory (session, sequence and POSTs live in overlay_publisher.mjs).
const overlay=createOverlayPublisher({
  getGeometry:()=>cameraGeometry,
  // The same anchor the arena draws the hoop at: the torso point when the camera is on, otherwise the nose.
  getSourcePoint:()=>{
    if(!frameSource.running||!cameraGeometry)return null;
    const last=frameSource.lastFrame,point=cameraOn?(last?.torso??last?.nose??null):(last?.nose??null);
    return point?{x:point.x,y:point.y,visibility:Number.isFinite(point.visibility)?point.visibility:1}:null;
  },
  getExtras:snapshot=>{const t=performance.now();return buildOverlayExtras({entries:ticker.live(t),now:t,score:snapshot.score,chatScore,banner,roundLeftMs:roundLeftNow});},
  getViewer:()=>lastViewer&&performance.now()-lastViewer.at<4000?lastViewer.name:undefined,
  baseHref:location.href,storage:safeStorage(),
  onStatus:(code,text)=>{$('#overlay-hint').textContent=text;if(code==='UNAVAILABLE')$('#overlay-link').removeAttribute('href');}
});
$('#overlay-link').removeAttribute('href');
$('#overlay-note').textContent=overlay.session()===null?'':overlay.persistent()?'The overlay link stays the same when you reload this page, so the OBS Browser Source does not need to be pasted again.':'This browser cannot store the link: it changes every time this page loads, so paste it into OBS again after a reload.';
const publishOverlay=(snapshot,options)=>overlay.publish(snapshot,options);
function stopOverlaySync(){
  if(!overlay.disable())return;
  $('#overlay-link').removeAttribute('href');$('#overlay-toggle').textContent='Enable overlay sync';
}
function startOverlaySync(){
  if(!overlay.enable())return;
  $('#overlay-link').href=overlay.link();$('#overlay-toggle').textContent='Stop overlay sync';publishOverlay(game.tick());
}
$('#overlay-toggle').addEventListener('click',()=>{if(overlay.isEnabled())stopOverlaySync();else startOverlaySync();});
$('#overlay-auto').checked=overlay.auto();
$('#overlay-auto').addEventListener('change',()=>{overlay.setAuto($('#overlay-auto').checked);});

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
  const scoreEl=$('#score'),scoreText=String(snapshot.score).padStart(3,'0');
  if(scoreEl.textContent!==scoreText){scoreEl.textContent=scoreText;scoreEl.classList.remove('bump');void scoreEl.offsetWidth;scoreEl.classList.add('bump');}
  $('#health-fill').classList.toggle('low',snapshot.hp<=30);
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

// Camera tracking: the page shows the mirrored camera image under the play area; poses come from the in-browser model.
// "Center me": the play area covers a window about six face widths wide around the seated streamer instead of the whole camera frame,
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
const debugStats={frames:0,since:performance.now(),fps:0,score:null,shownAt:0};
const debugOn=new URLSearchParams(location.search).has('debug');
function updateDebug(now,snapshot){
  if(!debugOn||now-debugStats.shownAt<250)return;
  const dt=(now-debugStats.since)/1000;if(dt>=1){debugStats.fps=debugStats.frames/dt;debugStats.frames=0;debugStats.since=now;}
  debugStats.shownAt=now;const v=cameraGeometry?.visible,x=v&&lastMarker?(lastMarker.x-v.x)/v.width:null,lane=dropColumn(x);
  const el=$('#camera-debug');el.hidden=false;
  el.textContent=`score ${debugStats.score===null?'none':debugStats.score.toFixed(2)} · fps ${debugStats.fps.toFixed(1)} · x ${x===null?'—':Math.round(x*100)+'%'} · lane ${lane===null?'—':['L','C','R'][lane-1]} · ${snapshot.mode}`+(snapshot.lastResult?.kind==='DROP'?` · judged ${snapshot.lastResult.outcome} x ${snapshot.lastResult.sampledX===null?'—':Math.round(snapshot.lastResult.sampledX*100)+'%'} caught ${snapshot.lastResult.caught===null?'—':snapshot.lastResult.caught}`:'');
}
function pollCamera(){
  syncCameraGeometry();
  const result=cameraTracker.poll();
  if(!result.fresh)return;
  debugStats.frames++;debugStats.score=result.points?.torso?.visibility??null;
  // Automatic digital zoom: frame the face once it is steady, and again only if the person moves much closer or farther.
  if(cameraTracker.kind==='face'&&$('#camera-auto').checked){
    cropGate.offer(autoFrame.update(cameraTracker.lastFace,performance.now()));
    const crop=cropGate.take(game.attacks.length>0);   // never re-frame under a falling ball: that would clear it
    if(crop){setCameraCrop(crop);$('#camera-status').textContent='Auto-framed: the play area now covers about six face widths around you, with room above your head; lean a little to change column.';}
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
async function toggleCamera(){
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
}
$('#camera-toggle').addEventListener('click',()=>{toggleCamera();});
const zoomMessages={ZOOM_UNSUPPORTED:'This camera does not support zoom.',NO_FACE:'No face found yet. Sit in view, then try again.',ZOOM_FAILED:'The camera refused the zoom change.'};
$('#camera-center').addEventListener('click',()=>{
  if(!cameraTracker)return;
  const crop=cameraTracker.kind==='face'?centerCrop(cameraTracker.lastFace):null;
  if(!crop){$('#camera-status').textContent='No face found yet. Sit in view, then try again.';return;}
  setCameraCrop(crop);autoFrame.adopt(cameraTracker.lastFace);$('#camera-status').textContent='Centered. The play area now covers about six face widths around you, with room above your head; lean a little to change column.';
});
// Mirror can be flipped while the camera runs; the play area, lanes and backdrop are rebuilt for the new orientation.
$('#camera-mirror').addEventListener('change',()=>{cameraMirror=$('#camera-mirror').checked;if(cameraOn)setCameraCrop(cameraCrop);});
$('#camera-center-reset').addEventListener('click',()=>{$('#camera-auto').checked=false;autoFrame.reset();setCameraCrop(null);$('#camera-status').textContent='View reset to the whole camera frame.';});
// Full screen keeps the whole play area on screen (phone browser bars otherwise cut off the bottom row).
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
// Sound that follows the game state each frame: a warning when a pie appears.
function updateSound(snapshot){
  const ids=new Set();
  for(const attack of snapshot.attacks){
    if(attack.kind==='DROP'&&attack.variant!=='BOMB'&&!shotHeard.has(attack.eventId)){shotHeard.add(attack.eventId);sfx.play('shoot');if(shotHeard.size>200)shotHeard.delete(shotHeard.values().next().value);}
    if(attack.variant!=='BOMB')continue;
    ids.add(attack.eventId);
    if(!warnedBombs.has(attack.eventId)){warnedBombs.add(attack.eventId);playPieAlarm();}
  }
  for(const id of warnedBombs)if(!ids.has(id)){warnedBombs.delete(id);if(!warnedBombs.size)stopPieAlarm();}
}
// OBS camera source numbers (flip + crop in pixels) that line the stream up with the grid; text only, refreshed with the overlay publish tick.
let obsSetupText='';
function showObsSetup(){
  const setup=cameraOn?obsCameraSetup(cameraGeometry,{auto:$('#camera-auto').checked&&cameraTracker?.kind==='face'}):null;
  const text=setup?setup.text:'OBS camera source setup appears here once the camera is on.';
  if(text!==obsSetupText){obsSetupText=text;$('#obs-align').textContent=text;}
}
function loopBody(){
  const now=performance.now();if(cameraOn)pollCamera();else addSyntheticFrame();let snapshot=game.tick();
  // Automatic waves (local game logic): irregular balls and pies while the round is playing and the box is ticked.
  // A round is 75 s: after that no new drops start, and when the last one has landed the round ends with a summary banner.
  if(autoDrops.checked&&waves.difficulty(now)>=1)roundEnding=true;
  if(roundEnding&&(snapshot.attacks.length===0||now>waves.startedAt+waves.roundMs+8000)){
    roundEnding=false;autoDrops.checked=false;const grade=gradeFor(snapshot.score);
    banner={text:`ROUND OVER · SCORE ${snapshot.score}${snapshot.score>chatScore?' · STREAMER WINS':snapshot.score<chatScore?' · CHAT WINS':''}`,at:now,grade};feed('Round over',`Score ${snapshot.score}${grade?` · grade ${grade}`:''} · ${snapshot.score>chatScore?'streamer wins':snapshot.score<chatScore?'chat wins':'a draw'} (${snapshot.score}–${chatScore})`);
    sfx.play('roundEnd');if(session.phase==='running')session.phase='over';syncStart();
  }
  stepStars(now);
  updateSound(snapshot);stepSession(now);
  if(autoDrops.checked&&!roundEnding&&snapshot.mode==='PLAYING'&&(game.connection==='ONLINE'||(ircChat&&ircChat.status!=='STOPPED'))){
    const next=waves.update(now,snapshot.attacks.length);
    if(next){const id=`wave-${++waveSerial}-${next.tag??0}`;game.receiveWaveDrop({notificationId:id,messageId:id,actorId:id,receivedAt:performance.now()},next);snapshot=game.tick();}
  }
  const last=frameSource.lastFrame,anchor=cameraOn?(last?.torso??last?.nose??null):(last?.nose??null);
  const roundLeftMs=autoDrops.checked&&!roundEnding?Math.max(0,Math.round(waves.roundMs-(now-waves.startedAt))):undefined;roundLeftNow=roundLeftMs;
  const drawn=drawArena(ctx,{...snapshot,roundLeftMs},anchor,{now,lastEffect,banner,showMarker:false,tracking:frameSource.running&&Boolean(anchor),geometry:cameraGeometry,
    backdrop:cameraOn?drawCameraBackdrop:null,marker:cameraOn,ticker:{entries:ticker.live(now),versus:{streamer:snapshot.score??0,chat:chatScore}}});lastMarker=drawn?.position??null;
  catchFx.draw(ctx,now,fxSprites,cameraGeometry?.visible??null);updateDebug(now,snapshot);updateScreen(snapshot);
  if(now-lastOverlayUpdate>=100){lastOverlayUpdate=now;publishOverlay(snapshot);showObsSetup();}
}

// One-click start: camera on (face mode, mirrored, auto-framed) -> 3-2-1 -> auto drops. The same button (or Esc) stops everything and turns the camera off.
// phases: idle -> starting (camera opening) -> countdown -> running -> over (round finished; the button offers Play again) -> idle
const session={phase:'idle',token:0,countdownAt:0,shown:null};
const START_LABELS={idle:'Start playing',starting:'Starting camera… (click to cancel)',countdown:'Get ready… (click or Esc to stop)',running:'Stop playing (Esc)',over:'Play again'};
function syncStart(){
  const button=$('#start-playing');if(!button)return;
  button.textContent=START_LABELS[session.phase];button.dataset.phase=session.phase;button.setAttribute('aria-pressed',String(session.phase==='running'||session.phase==='countdown'));
}
function startMessage(text){const el=$('#start-status');if(el)el.textContent=text;}
async function startPlaying(){
  const token=++session.token;session.phase='starting';syncStart();startMessage('');
  if(!cameraOn){
    $('#camera-kind').value='face';$('#camera-mirror').checked=true;$('#camera-auto').checked=true;
    await toggleCamera();
    if(token!==session.token){if(cameraOn)await toggleCamera();return;}             // cancelled while the camera was opening
    if(!cameraOn){
      const text=$('#camera-status').textContent,failed=/denied|another app|no camera|cannot|could not|failed/i.test(text);
      session.phase='idle';syncStart();
      startMessage(failed?text:'The camera could not start. Close other apps that use it and try again.');return;
    }
  }
  $('#reset').click();                                                              // a clean round: score, combo and HP back to the start
  session.phase='countdown';session.countdownAt=performance.now();session.shown=null;syncStart();startMessage('Stand where the camera sees your face.');
}
async function stopPlaying(){
  session.token++;session.phase='idle';session.shown=null;
  autoDrops.checked=false;autoDrops.dispatchEvent(new Event('change'));banner=null;
  if(cameraOn||cameraTracker)await toggleCamera();
  syncStart();startMessage('Stopped. Press Start playing to go again.');
}
// Driven from the frame loop so Esc/stop can never leave a timer behind.
function stepSession(now){
  if(session.phase!=='countdown')return;
  const left=3-Math.floor((now-session.countdownAt)/1000);
  if(left>=1){if(session.shown!==left){session.shown=left;banner={text:String(left),at:now,big:true};sfx.play('tick',{freq:1200,skipDedupe:true});}return;}
  session.phase='running';session.shown=null;
  autoDrops.checked=true;autoDrops.dispatchEvent(new Event('change'));banner={text:'GO!',at:now,big:true};   // the change handler clears the banner, so GO! is set after it
  syncStart();startMessage('Catch the balls in the hoop, dodge the pies. Esc stops.');
}
$('#start-playing').addEventListener('click',()=>{
  if(sfx.enabled&&!sfx.unlocked)sfx.unlock();                                       // a remembered "sound on" needs one click per page load
  if(session.phase==='idle'||session.phase==='over')startPlaying();else stopPlaying();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&session.phase!=='idle'){event.preventDefault();stopPlaying();}});
// Sound button: off by default; a click turns it on and unlocks the audio context (browsers require this), another click mutes it.
function syncSound(failed=false){
  const button=$('#sound-toggle'),slider=$('#sound-volume');if(!button)return;
  const status=sfx.status();
  button.textContent=soundDisabled?'Sound disabled (?sfx=0)':failed?'Sound unavailable in this browser':status==='AUDIO READY'?'🔊 Sound on (click to mute)':status==='AUDIO LOCKED'?'🔇 Sound locked (click to enable)':'🔇 Sound off (click to turn on)';
  button.dataset.state=status;button.setAttribute('aria-pressed',String(status==='AUDIO READY'));button.disabled=soundDisabled;
  if(slider){slider.value=String(Math.round(sfx.volume*100));slider.disabled=soundDisabled;}
}
$('#sound-toggle').addEventListener('click',async()=>{
  if(soundDisabled)return;
  if(sfx.enabled&&sfx.unlocked){sfx.setEnabled(false);syncSound();return;}
  sfx.setEnabled(true);const ok=await sfx.unlock();
  if(!ok)sfx.setEnabled(false);
  syncSound(!ok);if(ok)sfx.play('roundStart');
});
$('#sound-volume').addEventListener('input',()=>{sfx.setVolume(Number($('#sound-volume').value)/100);});
syncSound();syncStart();

function send(text){
  const command=typeof text==='string'?text.trim():'';
  if(/^!freeze$/i.test(command)){sendChallenge('FREEZE');return;}
  const lava=/^!lava(?:\s+(0\.[1-8]))?$/i.exec(command);
  if(lava){sendChallenge('LAVA',lava[1]?Number(lava[1]):.45);return;}
  const serial=++eventId;
  // Simulated cheer for trying the supporter features without a real one: "Cheer100 !drop 2" is a command with 100 Bits, "Cheer100" alone is only a cheer.
  const cheer=/^cheer(\d{1,6})\b\s*(.*)$/i.exec(text);
  const result=adapter.ingest(syntheticChat({notificationId:`notification-${serial}`,messageId:`message-${serial}`,
    actorId:`viewer-${serial%16}`,chatterName:['Mika','Jojo','Pixel','Nova','Bao','Luna','Kai','Momo'][serial%8],text:cheer?cheer[2]:text,...(cheer?{cheerBits:Number(cheer[1])}:{})}));
  if(cheer){ticker.noteSupport(result,performance.now());announceSupport(result);ticker.noteReject(result,performance.now());feed('Simulated cheer',`${result.viewer??'viewer'} · ${cheer[1]} bits (simulated)`);}
  const feedback=$('#command-feedback');
  if(result.accepted&&result.viewer&&result.eventId!==undefined)ticker.noteShot(result.eventId,result.viewer,performance.now(),result.supporter);
  if(result.accepted&&result.kind==='DROP'){feedback.textContent=`Synthetic command sent: drop in column ${result.cell-3}`;feed('Viewer drop',`!drop ${result.cell-3} · get the hoop under the ball`);}
  else if(result.accepted){feedback.textContent=`Synthetic command sent: cell ${result.cell}`;feed('Viewer attack',describeDelivery(result));}
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
  const result=kind==='FREEZE'?game.receiveSyntheticFreeze(event):game.receiveSyntheticLava(event,{level});
  $('#command-feedback').textContent=result.accepted?`${challengeNames[kind]}${result.raised?'Lava level raised':'Started'}`:reasons[result.reason]??'Event could not be handled';
  if(result.accepted)feed(challengeNames[kind],result.raised?'Raise target level':'Uses synthetic joint controls');
}
for(const [id,kind] of [['synthetic-freeze','FREEZE'],['synthetic-lava','LAVA']])$(`#${id}`).addEventListener('click',()=>sendChallenge(kind));
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
  for(const button of document.querySelectorAll('#synthetic-cross,#synthetic-freeze,#synthetic-lava'))button.disabled=busy||mockMode||chatMode||Boolean(popupController?.pending);
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
    onDelivery:result=>{ticker.noteSupport(result,performance.now());announceSupport(result);ticker.noteReject(result,performance.now());if(result.accepted)feed(`${prefix}Chat attack`,describeDelivery(result));}
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
    onDelivery:result=>{ticker.noteSupport(result,performance.now());announceSupport(result);ticker.noteReject(result,performance.now());if(result.accepted)feed('Twitch chat attack',describeDelivery(result));}});
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
  game.reset();ticker.reset();chatScore=0;frameSource.reset();waves.reset(performance.now());roundEnding=false;banner=null;player.x=.5;player.y=.5;tracking=true;lastEffect=null;game.start();
  if(ircChat)game.setConnection(ircChat.status==='ONLINE');else if(providerActivation)game.setConnection(providerActivation.provider.transport.status==='ONLINE');else if(mockMode||chatMode)game.setConnection((chatMode?chatTransport:transport).status==='ONLINE');else adapter.ingest(syntheticWelcome());
  poseControls.spread=.1;poseControls.hip=.5;poseControls.leftWrist={x:.25,y:.55};poseControls.rightWrist={x:.75,y:.55};
  $('#elbow-spread').value='10';$('#elbow-value').textContent='10%';for(const id of ['elbow-known','wrist-known','hip-known'])$(`#${id}`).checked=true;
  addSyntheticFrame();game.tick();
  $('#command-feedback').textContent='Try !drop 1–3 (a ball) or !pie 1–3 (a pie)';feed('Round reset','HP and score reset');
});
let hiddenAt=null,hiddenSnapshot=null;
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){hiddenAt=performance.now();sfx.suspend();frameSource.stop();if(game.mode==='PLAYING'||game.mode==='TRACKING_LOST'||game.mode==='RECOVERING')game.pause();feed('Game paused','Judging pauses while the page is hidden or minimised; the stream overlay shows GAME PAUSED. Keep this page visible (a second screen or a window beside OBS).');const snapshot=game.tick();hiddenSnapshot=snapshot;updateScreen(snapshot);publishOverlay(snapshot,{force:true});}
  else{hiddenSnapshot=null;if(hiddenAt!==null){const d=performance.now()-hiddenAt;hiddenAt=null;waves.startedAt+=d;waves.nextAt+=d;if(game.mode==='PAUSED')feed('The game paused while this page was hidden','Press Resume to continue');}sfx.resume();frameSource.start();stabilizer.reset();}   // back on screen: judging frames may flow again (the game itself still waits for Resume)
});
// A hidden page gets no animation frames, so the frame loop cannot refresh the overlay: repeat the PAUSED snapshot every 2 s (timers still run, slowly) so the relay session
// stays open and the overlay keeps saying GAME PAUSED. Nothing is judged or advanced here.
setInterval(()=>{if(document.hidden&&hiddenSnapshot)publishOverlay(hiddenSnapshot,{force:true});},2000);
window.addEventListener('pagehide',()=>{stopOverlaySync();overlay.remember();cancelAnimationFrame(animationId);transport.stop();chatTransport.stop();cameraTracker?.stop();popupController?.dispose();providerActivation?.stop();ircChat?.stop();oauth.clear();});

syncProviderControls();game.start();addSyntheticFrame();game.tick();adapter.ingest(syntheticWelcome());if(overlay.auto())startOverlaySync();animationId=requestAnimationFrame(loop);
