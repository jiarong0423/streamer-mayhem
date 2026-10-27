import {drawCameraOverlay} from './matrix_view.mjs';
import {projectCameraPoint,visiblePointToCanvas} from './camera_geometry.mjs';

function roundBox(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
export function drawArena(ctx,snapshot,player,{now=0,lastEffect=null,tracking=true,geometry=null}={}) {
  const w=ctx.canvas.width,h=ctx.canvas.height;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#101610';ctx.fillRect(0,0,w,h);
  const gradient=ctx.createRadialGradient(w*.5,h*.45,30,w*.5,h*.45,w*.6);
  gradient.addColorStop(0,'#263a28');gradient.addColorStop(1,'#111711');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  ctx.save();ctx.globalAlpha=.16;ctx.strokeStyle='#99b391';ctx.lineWidth=1;
  for(let i=-h;i<w;i+=48){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i+h,h);ctx.stroke();}ctx.restore();
  if(!geometry){ctx.textAlign='center';ctx.font='bold 32px sans-serif';ctx.fillStyle='#fff';ctx.fillText('CALIBRATION REQUIRED',w/2,h/2);ctx.textAlign='left';return {rect:null,cells:[]};}
  const rect=geometry.visible;
  ctx.fillStyle='rgba(15,22,15,.45)';ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
  const playing=snapshot.mode==='PLAYING';
  const overlay=drawCameraOverlay(ctx,geometry,playing?snapshot:{...snapshot,attacks:[]},{clear:false});
  const mapped=playing&&tracking&&player?projectCameraPoint({...player,visibility:1},geometry):null;
  const position=visiblePointToCanvas(mapped,geometry);
  if(position){
    const size=Math.min(1,rect.width/650,rect.height/400);
    ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();ctx.translate(position.x,position.y);ctx.scale(size,size);
    ctx.fillStyle='rgba(4,9,4,.35)';ctx.beginPath();ctx.ellipse(0,103,74,18,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#e7f1dc';ctx.lineWidth=18;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-43,37);ctx.lineTo(-74,78);ctx.moveTo(43,37);ctx.lineTo(74,78);ctx.stroke();
    ctx.strokeStyle='#a5bb9d';ctx.lineWidth=21;ctx.beginPath();ctx.moveTo(-22,83);ctx.lineTo(-34,125);ctx.moveTo(22,83);ctx.lineTo(34,125);ctx.stroke();
    roundBox(ctx,-53,18,106,83,28);ctx.fillStyle='#d9f965';ctx.fill();roundBox(ctx,-29,-45,58,65,24);ctx.fillStyle='#eef2e3';ctx.fill();
    roundBox(ctx,-21,-29,42,24,10);ctx.fillStyle='#243b27';ctx.fill();ctx.fillStyle='#d9f965';ctx.beginPath();ctx.arc(-9,-18,3,0,Math.PI*2);ctx.arc(9,-18,3,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#d9f965';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,7,0,2*Math.PI);ctx.stroke();ctx.restore();
  }
  if(lastEffect && now-lastEffect.at<1200 && snapshot.mode==='PLAYING'){
    ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();ctx.textAlign='center';ctx.font=`900 ${Math.max(12,Math.min(48,rect.height/8))}px sans-serif`;
    ctx.fillStyle=lastEffect.outcome==='HIT'?'#ff8b70':'#d9f965';ctx.fillText(lastEffect.outcome,rect.x+rect.width/2,rect.y+Math.min(72,rect.height/4));ctx.restore();
  }
  return {...overlay,position};
}
