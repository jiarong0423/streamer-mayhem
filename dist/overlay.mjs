// Standalone Browser Source page, synthetic channel only; no Twitch, OBS or camera APIs.
import {parseOverlayQuery,readOverlayState,OVERLAY_CLOSED_TYPE} from './overlay_protocol.mjs';
import {drawCameraOverlay} from './matrix_view.mjs';
import {drawHud as sharedHud,strokedText,COLORS,MIN_TEXT_PX} from './art.mjs';
import {projectCameraPoint,visiblePointToCanvas} from './camera_geometry.mjs';
import {gridCell} from './matrix.mjs';
const canvas=document.querySelector('#overlay'),ctx=canvas.getContext('2d');
let session=null,channel=null,lastSequence=-1,lastMessage=0,lastMessageData=null;
function clear(status){ctx.clearRect(0,0,canvas.width,canvas.height);canvas.setAttribute('aria-label',status);canvas.dataset.status=status;canvas.dataset.cell='';}
function resize(){canvas.width=Math.min(4096,Math.max(1,Math.round(innerWidth)));canvas.height=Math.min(2160,Math.max(1,Math.round(innerHeight)));if(lastMessageData)render(lastMessageData);else clear('Overlay not connected');}
// Score and health (and, once the protocol carries them, combo / multiplier / round timer) come from the shared art kit; the panel is a little denser on a transparent stream.
const drawHud=(snapshot,rect,now)=>sharedHud(ctx,rect,snapshot,now,{panelAlpha:.72});
// What chat can type, always on screen while playing, plus the name of whoever just triggered something.
function drawHints(rect,viewer){
  const size=Math.max(MIN_TEXT_PX,rect.height/30);
  strokedText(ctx,'!drop 1–3  ·  !bomb 1–3  ·  !mosquito',rect.x+rect.width/2,rect.y+rect.height-size*.8,size,COLORS.paper,{alpha:.85});
  if(viewer)strokedText(ctx,viewer,rect.x+rect.width/2,rect.y+rect.height-size*2.3,size*1.1,COLORS.gold);
}
function render(data){
  let state;try{state=readOverlayState(data,session,canvas.width,canvas.height);}catch{lastMessageData=null;clear('Invalid overlay data');return;}
  if(!state.geometry){clear('Not calibrated');return;}
  const projected=projectCameraPoint(state.sourcePoint,state.geometry),projectedCell=gridCell(projected);
  const mode=state.snapshot.mode==='PLAYING'&&projectedCell===null?'TRACKING_LOST':state.snapshot.mode;
  const snapshot={...state.snapshot,mode,attacks:mode==='PLAYING'?state.snapshot.attacks:[]};
  const now=performance.now();drawCameraOverlay(ctx,state.geometry,snapshot,{now});
  const rect=state.geometry.visible;ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
  const fontSize=Math.max(8,Math.min(20,rect.width/24,rect.height/15));ctx.fillStyle='#fff';ctx.font=`bold ${fontSize}px sans-serif`;ctx.textAlign='right';
  let cell=null;
  if(snapshot.mode==='PLAYING'){const p=visiblePointToCanvas(projected,state.geometry);cell=projectedCell;if(p){ctx.fillStyle='#00ffff';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,Math.min(5,rect.width/70)),0,2*Math.PI);ctx.fill();}}
  if(Number.isFinite(snapshot.score))drawHud(snapshot,rect,now);
  if(snapshot.mode==='PLAYING')drawHints(rect,snapshot.viewer);
  ctx.restore();const status=snapshot.mode==='TRACKING_LOST'?'Tracking lost':`Overlay ${snapshot.mode}`;canvas.setAttribute('aria-label',status);canvas.dataset.status=status;canvas.dataset.cell=cell===null?'':String(cell);
}
try{session=parseOverlayQuery(location.search);}catch{session=null;}
resize();window.addEventListener('resize',resize);
if(session && typeof EventSource==='function'){
  channel=new EventSource(`./__overlay/events?session=${encodeURIComponent(session)}`);
  channel.addEventListener('message',event=>{
    let message;try{message=JSON.parse(event.data);}catch{lastMessageData=null;lastMessage=0;clear('Invalid overlay data');return;}
    if(!message||message.session!==session)return;
    if(message.type===OVERLAY_CLOSED_TYPE){if(!Number.isSafeInteger(message.sequence)||message.sequence<=lastSequence)return;lastSequence=message.sequence;lastMessageData=null;lastMessage=0;clear('Controller page closed');return;}
    try{const checked=readOverlayState(message,session,canvas.width,canvas.height);if(checked.sequence<=lastSequence)return;
      lastSequence=checked.sequence;lastMessage=performance.now();lastMessageData=message;render(message);
    }catch{lastMessageData=null;lastMessage=0;clear('Invalid overlay data');}
  });
  const watchdog=setInterval(()=>{if(lastMessage && performance.now()-lastMessage>1500){lastMessageData=null;lastMessage=0;clear('Controller page offline');}},500);
  window.addEventListener('pagehide',()=>{clearInterval(watchdog);channel.close();},{once:true});
}else clear(session?'Browser does not support the local connection':'Overlay not enabled');
