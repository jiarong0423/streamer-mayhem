// Standalone Browser Source page, synthetic channel only; no Twitch, OBS or camera APIs.
import {parseOverlayQuery,readOverlayState,OVERLAY_CLOSED_TYPE} from './overlay_protocol.mjs';
import {drawCameraOverlay} from './matrix_view.mjs';
import {projectCameraPoint,visiblePointToCanvas} from './camera_geometry.mjs';
import {gridCell} from './matrix.mjs';
const canvas=document.querySelector('#overlay'),ctx=canvas.getContext('2d');
let session=null,channel=null,lastSequence=-1,lastMessage=0,lastMessageData=null;
function clear(status){ctx.clearRect(0,0,canvas.width,canvas.height);canvas.setAttribute('aria-label',status);canvas.dataset.status=status;canvas.dataset.cell='';}
function resize(){canvas.width=Math.min(4096,Math.max(1,Math.round(innerWidth)));canvas.height=Math.min(2160,Math.max(1,Math.round(innerHeight)));if(lastMessageData)render(lastMessageData);else clear('合成疊圖尚未連接');}
function render(data){
  let state;try{state=readOverlayState(data,session,canvas.width,canvas.height);}catch{lastMessageData=null;clear('合成疊圖資料無效');return;}
  if(!state.geometry){clear('尚未校準');return;}
  const projected=projectCameraPoint(state.sourcePoint,state.geometry),projectedCell=gridCell(projected);
  const mode=state.snapshot.mode==='PLAYING'&&projectedCell===null?'TRACKING_LOST':state.snapshot.mode;
  const snapshot={...state.snapshot,mode,attacks:mode==='PLAYING'?state.snapshot.attacks:[]};
  drawCameraOverlay(ctx,state.geometry,snapshot);
  const rect=state.geometry.visible;ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
  const fontSize=Math.max(8,Math.min(20,rect.width/24,rect.height/15));ctx.fillStyle='#fff';ctx.font=`bold ${fontSize}px sans-serif`;ctx.textAlign='right';ctx.fillText('SIMULATED',rect.x+rect.width-4,rect.y+fontSize+3);
  let cell=null;
  if(snapshot.mode==='PLAYING'){const p=visiblePointToCanvas(projected,state.geometry);cell=projectedCell;if(p){ctx.fillStyle='#00ffff';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,Math.min(5,rect.width/70)),0,2*Math.PI);ctx.fill();}}
  ctx.restore();const status=snapshot.mode==='TRACKING_LOST'?'合成追蹤失效':`合成疊圖 ${snapshot.mode}`;canvas.setAttribute('aria-label',status);canvas.dataset.status=status;canvas.dataset.cell=cell===null?'':String(cell);
}
try{session=parseOverlayQuery(location.search);}catch{session=null;}
resize();window.addEventListener('resize',resize);
if(session && typeof EventSource==='function'){
  channel=new EventSource(`./__overlay/events?session=${encodeURIComponent(session)}`);
  channel.addEventListener('message',event=>{
    let message;try{message=JSON.parse(event.data);}catch{lastMessageData=null;lastMessage=0;clear('合成疊圖資料無效');return;}
    if(!message||message.session!==session)return;
    if(message.type===OVERLAY_CLOSED_TYPE){if(!Number.isSafeInteger(message.sequence)||message.sequence<=lastSequence)return;lastSequence=message.sequence;lastMessageData=null;lastMessage=0;clear('合成控制頁已關閉');return;}
    try{const checked=readOverlayState(message,session,canvas.width,canvas.height);if(checked.sequence<=lastSequence)return;
      lastSequence=checked.sequence;lastMessage=performance.now();lastMessageData=message;render(message);
    }catch{lastMessageData=null;lastMessage=0;clear('合成疊圖資料無效');}
  });
  const watchdog=setInterval(()=>{if(lastMessage && performance.now()-lastMessage>1500){lastMessageData=null;lastMessage=0;clear('合成控制頁已離線');}},500);
  window.addEventListener('pagehide',()=>{clearInterval(watchdog);channel.close();},{once:true});
}else clear(session?'瀏覽器不支援本機合成連線':'合成疊圖未啟用');
