// Standalone Browser Source page, synthetic channel only; no Twitch, OBS or camera APIs.
import {parseOverlayQuery,readOverlayState,OVERLAY_CLOSED_TYPE} from './overlay_protocol.mjs';
import {drawOverlayScene} from './overlay_scene.mjs';
const canvas=document.querySelector('#overlay'),ctx=canvas.getContext('2d');
// A stalled controller blanks the overlay after 1.5 s; a paused one (hidden game page) keeps saying GAME PAUSED for up to ten minutes, since it cannot publish faster.
const STALE_MS=1500,STALE_PAUSED_MS=600000;
let session=null,channel=null,lastSequence=-1,lastMessage=0,lastState=null,lastDrawn=0;
function clear(status){lastState=null;ctx.clearRect(0,0,canvas.width,canvas.height);canvas.setAttribute('aria-label',status);canvas.dataset.status=status;canvas.dataset.cell='';}
function draw(){
  if(!lastState)return;
  if(!lastState.geometry){clear('Not calibrated');return;}
  const result=drawOverlayScene(ctx,lastState,{now:performance.now(),receivedAt:lastMessage});
  canvas.setAttribute('aria-label',result.status);canvas.dataset.status=result.status;canvas.dataset.cell=result.cell===null?'':String(result.cell);
}
function resize(){canvas.width=Math.min(4096,Math.max(1,Math.round(innerWidth)));canvas.height=Math.min(2160,Math.max(1,Math.round(innerHeight)));lastState=null;if(lastMessageData)accept(lastMessageData);else clear('Overlay not connected');}
let lastMessageData=null;
// Validate a message against the current canvas size and keep the state; the animation loop redraws it (the marquee scrolls between messages).
function accept(message){
  let state;try{state=readOverlayState(message,session,canvas.width,canvas.height);}catch{lastMessageData=null;clear('Invalid overlay data');return false;}
  if(!state.geometry){lastState=null;clear('Not calibrated');return true;}
  lastState=state;draw();return true;
}
function frame(){
  const now=performance.now();
  if(lastMessage&&now-lastMessage>(lastState?.snapshot.mode==='PAUSED'?STALE_PAUSED_MS:STALE_MS)){lastMessageData=null;lastMessage=0;clear('Controller page offline');}
  else if(lastState&&now-lastDrawn>=16){lastDrawn=now;draw();}
  requestAnimationFrame(frame);
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
      lastSequence=checked.sequence;lastMessage=performance.now();lastMessageData=message;accept(message);
    }catch{lastMessageData=null;lastMessage=0;clear('Invalid overlay data');}
  });
  requestAnimationFrame(frame);
  window.addEventListener('pagehide',()=>{channel.close();},{once:true});
}else clear(session?'Browser does not support the local connection':'Overlay not enabled');
