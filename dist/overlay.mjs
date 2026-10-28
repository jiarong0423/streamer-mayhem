// Standalone Browser Source page, synthetic channel only; no Twitch, OBS or camera APIs.
import {parseOverlayQuery,readOverlayState,OVERLAY_CLOSED_TYPE} from './overlay_protocol.mjs';
import {drawCameraOverlay} from './matrix_view.mjs';
import {projectCameraPoint,visiblePointToCanvas} from './camera_geometry.mjs';
import {gridCell} from './matrix.mjs';
const canvas=document.querySelector('#overlay'),ctx=canvas.getContext('2d');
let session=null,channel=null,lastSequence=-1,lastMessage=0,lastMessageData=null;
function clear(status){ctx.clearRect(0,0,canvas.width,canvas.height);canvas.setAttribute('aria-label',status);canvas.dataset.status=status;canvas.dataset.cell='';}
function resize(){canvas.width=Math.min(4096,Math.max(1,Math.round(innerWidth)));canvas.height=Math.min(2160,Math.max(1,Math.round(innerHeight)));if(lastMessageData)render(lastMessageData);else clear('Overlay not connected');}
// Score and health in the top-right corner of the camera window, so the stream shows the result without the game page.
function drawHud(snapshot,rect){
  if(!Number.isFinite(snapshot.score))return;
  const w=Math.max(150,Math.min(260,rect.width*.22)),h=Math.max(46,Math.min(64,rect.height*.1)),x=rect.x+rect.width-w-16,y=rect.y+16,r=Math.min(14,h/3);
  ctx.save();ctx.fillStyle='rgba(12,16,12,.72)';ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();ctx.stroke();
  ctx.textAlign='left';ctx.fillStyle='rgba(217,249,101,.9)';ctx.font=`800 ${Math.max(9,h*.2)}px sans-serif`;ctx.fillText('SCORE',x+14,y+h*.34);
  ctx.fillStyle='#fff';ctx.font=`900 ${Math.max(16,h*.46)}px sans-serif`;ctx.fillText(String(Math.round(snapshot.score)).padStart(3,'0'),x+14,y+h*.82);
  if(Number.isFinite(snapshot.hp)){const bw=w*.38,bh=Math.max(6,h*.14),bx=x+w-bw-14,by=y+h*.62,f=Math.max(0,Math.min(1,snapshot.hp/100));
    ctx.fillStyle='rgba(255,255,255,.14)';ctx.beginPath();ctx.roundRect(bx,by,bw,bh,bh/2);ctx.fill();
    ctx.fillStyle=snapshot.hp<=30?'#ff6b4a':'#d9f965';ctx.beginPath();ctx.roundRect(bx,by,Math.max(bh,bw*f),bh,bh/2);ctx.fill();}
  ctx.restore();
}
function render(data){
  let state;try{state=readOverlayState(data,session,canvas.width,canvas.height);}catch{lastMessageData=null;clear('Invalid overlay data');return;}
  if(!state.geometry){clear('Not calibrated');return;}
  const projected=projectCameraPoint(state.sourcePoint,state.geometry),projectedCell=gridCell(projected);
  const mode=state.snapshot.mode==='PLAYING'&&projectedCell===null?'TRACKING_LOST':state.snapshot.mode;
  const snapshot={...state.snapshot,mode,attacks:mode==='PLAYING'?state.snapshot.attacks:[]};
  drawCameraOverlay(ctx,state.geometry,snapshot);
  const rect=state.geometry.visible;ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
  const fontSize=Math.max(8,Math.min(20,rect.width/24,rect.height/15));ctx.fillStyle='#fff';ctx.font=`bold ${fontSize}px sans-serif`;ctx.textAlign='right';
  let cell=null;
  if(snapshot.mode==='PLAYING'){const p=visiblePointToCanvas(projected,state.geometry);cell=projectedCell;if(p){ctx.fillStyle='#00ffff';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,Math.min(5,rect.width/70)),0,2*Math.PI);ctx.fill();}}
  drawHud(snapshot,rect);
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
