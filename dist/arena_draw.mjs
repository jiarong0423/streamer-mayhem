import {drawCameraOverlay} from './matrix_view.mjs';
import {dropCaught,DROP_CATCH_HALF,DROP_FLOOR} from './drop_lanes.mjs';
import {projectCameraPoint,visiblePointToCanvas} from './camera_geometry.mjs';

function roundBox(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
export function drawArena(ctx,snapshot,player,{now=0,lastEffect=null,banner=null,mosquito=null,biteAt=-Infinity,tracking=true,geometry=null,backdrop=null,marker=false}={}) {
  const w=ctx.canvas.width,h=ctx.canvas.height;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#101610';ctx.fillRect(0,0,w,h);
  const gradient=ctx.createRadialGradient(w*.5,h*.45,30,w*.5,h*.45,w*.6);
  gradient.addColorStop(0,'#263a28');gradient.addColorStop(1,'#111711');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  ctx.save();ctx.globalAlpha=.16;ctx.strokeStyle='#99b391';ctx.lineWidth=1;
  for(let i=-h;i<w;i+=48){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i+h,h);ctx.stroke();}ctx.restore();
  if(!geometry){ctx.textAlign='center';ctx.font='bold 32px sans-serif';ctx.fillStyle='#fff';ctx.fillText('CALIBRATION REQUIRED',w/2,h/2);ctx.textAlign='left';return {rect:null,cells:[]};}
  const rect=geometry.visible;
  ctx.fillStyle='rgba(15,22,15,.45)';ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
  if(backdrop)backdrop(ctx,geometry);
  const playing=snapshot.mode==='PLAYING';
  const overlay=drawCameraOverlay(ctx,geometry,playing?snapshot:{...snapshot,attacks:[]},{clear:false});
  const mapped=playing&&tracking&&player?projectCameraPoint({...player,visibility:1},geometry):null;
  const position=visiblePointToCanvas(mapped,geometry);
  if(position&&marker){
    ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();// While an item is falling, a catcher the width of the catch zone follows the streamer along the bottom; it turns gold when it covers the item.
    const drop=snapshot.attacks?.find(a=>a.kind==='DROP'),relX=(position.x-rect.x)/rect.width,inLane=Boolean(drop)&&dropCaught(relX,drop.cell-3)===true;
    const ringRadius=Math.max(10,Math.min(26,rect.width/40))*(inLane?1.35:1);
    const danger=Boolean(drop)&&drop.variant==='BOMB';
    if(drop){
      const half=DROP_CATCH_HALF*rect.width,cy=rect.y+DROP_FLOOR*rect.height+Math.max(6,rect.height/60),h=Math.max(8,rect.height/36),cx=Math.max(rect.x+half,Math.min(rect.x+rect.width-half,position.x));
      ctx.save();ctx.globalAlpha=.9;ctx.lineWidth=Math.max(1.5,h/6);
      ctx.strokeStyle=inLane?(danger?'rgba(255,107,90,.7)':'rgba(255,210,63,.55)'):'rgba(231,241,220,.28)';ctx.beginPath();ctx.moveTo(position.x,position.y+ringRadius);ctx.lineTo(cx,cy-h);ctx.stroke();
      if(inLane){ctx.shadowColor=danger?'rgba(255,107,90,.9)':'rgba(255,210,63,.9)';ctx.shadowBlur=h*1.5;}
      ctx.fillStyle=inLane?(danger?'#ff6b5a':'#ffd23f'):'rgba(231,241,220,.85)';ctx.beginPath();ctx.roundRect(cx-half,cy-h/2,half*2,h,h/2);ctx.fill();ctx.restore();
    }
    if(inLane){ctx.shadowColor=danger?'rgba(255,107,90,.9)':'rgba(255,210,63,.9)';ctx.shadowBlur=ringRadius;}
    ctx.strokeStyle=inLane?(danger?'#ff6b5a':'#ffd23f'):'#d9f965';ctx.lineWidth=inLane?6:4;ctx.beginPath();ctx.arc(position.x,position.y,ringRadius,0,2*Math.PI);ctx.stroke();ctx.shadowBlur=0;
    ctx.fillStyle='#00ffff';ctx.beginPath();ctx.arc(position.x,position.y,5,0,2*Math.PI);ctx.fill();ctx.restore();
  } else if(position){
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
    // Short pop-in then fade; a catch shows the points it earned.
    const age=Math.max(0,now-lastEffect.at),pop=Math.min(1,age/160),scale=.7+.3*(1-Math.pow(1-pop,3)),alpha=age<800?1:1-(age-800)/400;
    const scored=['CATCH','BOMB','AVOID','SWAT','BITE'].includes(lastEffect.outcome)&&lastEffect.scoreDelta!==0;
    const label=scored?`${lastEffect.outcome} ${lastEffect.scoreDelta>0?'+':''}${lastEffect.scoreDelta}`:lastEffect.outcome;
    ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();ctx.textAlign='center';ctx.globalAlpha=Math.max(0,alpha);
    const size=Math.max(12,Math.min(48,rect.height/8)),cx=rect.x+rect.width/2,cy=rect.y+Math.min(72,rect.height/4);
    ctx.translate(cx,cy);ctx.scale(scale,scale);ctx.font=`900 ${size}px sans-serif`;
    ctx.lineWidth=Math.max(3,size/9);ctx.strokeStyle='rgba(8,14,8,.75)';ctx.lineJoin='round';ctx.strokeText(label,0,0);
    ctx.fillStyle=['HIT','BOMB','BITE'].includes(lastEffect.outcome)?'#ff8b70':lastEffect.outcome==='MISS'?'#c9d1c2':'#d9f965';ctx.fillText(label,0,0);ctx.restore();
  }
  if(mosquito)drawMosquito(ctx,rect,mosquito,now);
  if(now-biteAt<500){
    // A bite: a short red flush around the edges.
    const a=1-(now-biteAt)/500,g=ctx.createRadialGradient(rect.x+rect.width/2,rect.y+rect.height/2,rect.height*.35,rect.x+rect.width/2,rect.y+rect.height/2,rect.height*.9);
    g.addColorStop(0,'rgba(255,60,50,0)');g.addColorStop(1,`rgba(255,60,50,${(.45*a).toFixed(3)})`);
    ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();ctx.fillStyle=g;ctx.fillRect(rect.x,rect.y,rect.width,rect.height);ctx.restore();
  }
  if(banner && now-banner.at<6000){
    // Round summary: fades in, holds, fades out.
    const age=now-banner.at,alpha=Math.min(1,age/300)*(age>5200?Math.max(0,1-(age-5200)/800):1),size=Math.max(16,Math.min(72,rect.height/6));
    ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();ctx.globalAlpha=alpha;
    ctx.fillStyle='rgba(8,14,8,.55)';ctx.fillRect(rect.x,rect.y+rect.height*.38,rect.width,size*1.9);
    ctx.textAlign='center';ctx.font=`900 ${size}px sans-serif`;ctx.lineWidth=Math.max(3,size/10);ctx.lineJoin='round';ctx.strokeStyle='rgba(8,14,8,.8)';
    ctx.strokeText(banner.text,rect.x+rect.width/2,rect.y+rect.height*.38+size*1.3);ctx.fillStyle='#d9f965';ctx.fillText(banner.text,rect.x+rect.width/2,rect.y+rect.height*.38+size*1.3);ctx.restore();
  }
  return {...overlay,position};
}

// The face mosquito: dark body, two flapping wings, a few legs; on the face it gets a two-second ring and a prompt.
function drawMosquito(ctx,rect,m,now){
  const x=rect.x+m.x*rect.width,y=rect.y+m.y*rect.height,size=Math.max(7,rect.width/70)*(m.state==='LANDED'?1.25:1);
  ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
  if(m.state==='LANDED'){
    const rad=Math.max(size*3,m.probe.r*rect.width),left=1-m.landedProgress,danger=left<.35;
    ctx.lineWidth=Math.max(4,size*.7);ctx.lineCap='round';ctx.strokeStyle='rgba(255,255,255,.18)';ctx.beginPath();ctx.arc(x,y,rad,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle=danger?'#ff6b4a':'#d9f965';ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=size*1.2;
    ctx.beginPath();ctx.arc(x,y,rad,-Math.PI/2,-Math.PI/2+Math.PI*2*left);ctx.stroke();ctx.shadowBlur=0;
    const pulse=1+.06*Math.sin(now/90),fs=Math.max(14,rect.height/16)*pulse;
    ctx.textAlign='center';ctx.font=`900 ${fs}px sans-serif`;ctx.lineWidth=Math.max(3,fs/9);ctx.lineJoin='round';ctx.strokeStyle='rgba(8,14,8,.8)';
    ctx.strokeText('SLAP YOUR FACE!',x,y-rad-size*1.6);ctx.fillStyle=danger?'#ff8b70':'#d9f965';ctx.fillText('SLAP YOUR FACE!',x,y-rad-size*1.6);
  }
  ctx.translate(x,y);ctx.rotate(m.state==='LANDED'?0:m.angle+Math.PI/2);
  const flap=m.state==='LANDED'?.35:.55+.45*Math.sin(now/22);
  ctx.fillStyle='rgba(220,235,255,.55)';ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=1;
  for(const side of [-1,1]){ctx.save();ctx.scale(side,1);ctx.rotate(-.5-.35*flap);ctx.beginPath();ctx.ellipse(size*.9,-size*.2,size*1.3,size*.45*flap+size*.12,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
  ctx.strokeStyle='#1a1a1a';ctx.lineWidth=Math.max(1,size/5);ctx.lineCap='round';
  for(const k of [-1,0,1])for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(side*size*.2,k*size*.35);ctx.lineTo(side*size*1.1,k*size*.35+size*.5);ctx.stroke();}
  ctx.beginPath();ctx.moveTo(0,-size*.9);ctx.lineTo(0,-size*1.7);ctx.stroke();
  const body=ctx.createRadialGradient(-size*.2,-size*.2,size*.1,0,0,size);body.addColorStop(0,'#5a5a5a');body.addColorStop(1,'#111');
  ctx.fillStyle=body;ctx.beginPath();ctx.ellipse(0,0,size*.55,size*1.05,0,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
