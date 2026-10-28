import {drawCameraOverlay} from './matrix_view.mjs';
import {dropCaught,DROP_CATCH_HALF,DROP_FLOOR} from './drop_lanes.mjs';
import {projectCameraPoint,visiblePointToCanvas} from './camera_geometry.mjs';
import {COLORS,FONT_STACK,drawBackground,drawFeedback,drawHud,drawBanner,drawVignette,drawMosquito,strokedText,shakeOffset,stateFor,tween,easeOutBack} from './art.mjs';
export {drawHud,drawBanner,drawFeedback,drawMosquito};
export const FONT=FONT_STACK;

function roundBox(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
export function drawArena(ctx,snapshot,player,{now=0,lastEffect=null,banner=null,mosquito=null,biteAt=-Infinity,showMarker=false,tracking=true,geometry=null,backdrop=null,marker=false}={}) {
  const w=ctx.canvas.width,h=ctx.canvas.height;
  ctx.clearRect(0,0,w,h);drawBackground(ctx,w,h);
  if(!geometry){ctx.textAlign='center';strokedText(ctx,'CALIBRATION REQUIRED',w/2,h/2,32,COLORS.paper);ctx.textAlign='left';return {rect:null,cells:[]};}
  const rect=geometry.visible,store=stateFor(ctx);
  // A bomb shakes the whole picture for 300ms (the background is already drawn, so the shifted edge only shows background).
  const shake=lastEffect&&lastEffect.outcome==='BOMB'&&snapshot.mode==='PLAYING'?shakeOffset(now-lastEffect.at,rect.width):{x:0,y:0,amp:0};
  ctx.save();if(shake.amp>0)ctx.translate(shake.x,shake.y);
  ctx.fillStyle='rgba(15,22,15,.45)';ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
  if(backdrop)backdrop(ctx,geometry);
  const playing=snapshot.mode==='PLAYING';
  const overlay=drawCameraOverlay(ctx,geometry,playing?snapshot:{...snapshot,attacks:[]},{clear:false,now});
  const mapped=playing&&tracking&&player?projectCameraPoint({...player,visibility:1},geometry):null;
  const position=visiblePointToCanvas(mapped,geometry);
  if(position&&marker){
    ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();// While an item is falling, a catcher the width of the catch zone follows the streamer along the bottom; it turns gold when it covers the item.
    const drop=snapshot.attacks?.find(a=>a.kind==='DROP'),relX=(position.x-rect.x)/rect.width,inLane=Boolean(drop)&&dropCaught(relX,drop.cell-3)===true;
    const ringRadius=Math.max(10,Math.min(26,rect.width/40))*tween(store,'ring',inLane?1.35:1,now,120,easeOutBack);
    const danger=Boolean(drop)&&drop.variant==='BOMB';
    if(drop){
      const half=DROP_CATCH_HALF*rect.width,cy=rect.y+DROP_FLOOR*rect.height+Math.max(6,rect.height/60),h=Math.max(8,rect.height/36),cx=Math.max(rect.x+half,Math.min(rect.x+rect.width-half,position.x));
      ctx.save();ctx.globalAlpha=.9;ctx.lineWidth=Math.max(1.5,h/6);
      ctx.strokeStyle=inLane?(danger?'rgba(255,107,90,.7)':'rgba(255,210,63,.55)'):'rgba(231,241,220,.28)';ctx.beginPath();ctx.moveTo(position.x,position.y+ringRadius);ctx.lineTo(cx,cy-h);ctx.stroke();
      if(inLane){ctx.shadowColor=danger?'rgba(255,107,90,.9)':'rgba(255,210,63,.9)';ctx.shadowBlur=h*1.5;}
      ctx.fillStyle=inLane?(danger?COLORS.dangerWarm:COLORS.gold):'rgba(231,241,220,.85)';ctx.beginPath();ctx.roundRect(cx-half,cy-h/2,half*2,h,h/2);ctx.fill();
      ctx.shadowBlur=0;ctx.shadowColor='transparent';ctx.strokeStyle='rgba(10,16,10,.85)';ctx.lineWidth=2;ctx.stroke();
      ctx.strokeStyle='rgba(10,16,10,.6)';for(const ex of [cx-half,cx+half]){ctx.beginPath();ctx.arc(ex,cy,h*.7,0,2*Math.PI);ctx.stroke();}ctx.restore();
    }
    // The ring and dot on the face looked like a clown nose, so they are only drawn in debug mode (?debug=1); the catcher at the bottom is the control.
    if(showMarker){
      if(inLane){ctx.shadowColor=danger?'rgba(255,107,90,.9)':'rgba(255,210,63,.9)';ctx.shadowBlur=ringRadius;}
      ctx.strokeStyle=inLane?(danger?'#ff6b5a':'#ffd23f'):'#d9f965';ctx.lineWidth=inLane?6:4;ctx.beginPath();ctx.arc(position.x,position.y,ringRadius,0,2*Math.PI);ctx.stroke();ctx.shadowBlur=0;
      ctx.fillStyle='#00ffff';ctx.beginPath();ctx.arc(position.x,position.y,5,0,2*Math.PI);ctx.fill();
    }
    ctx.restore();
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
  const catcherX=position?clampRel((position.x-rect.x)/rect.width):.5;
  if(lastEffect&&snapshot.mode==='PLAYING')drawFeedback(ctx,rect,lastEffect,now,{catcherX,facePos:position});
  if(mosquito)drawMosquito(ctx,rect,mosquito,now);
  if(now-biteAt<500)drawVignette(ctx,rect,.45*(1-(now-biteAt)/500),{inner:.45});
  if(lastEffect&&lastEffect.outcome==='BOMB'&&snapshot.mode==='PLAYING'&&now-lastEffect.at<350)drawVignette(ctx,rect,.3*(1-(now-lastEffect.at)/350),{inner:.45});
  ctx.restore();
  // HUD and banner stay still while the picture shakes. combo / multiplier / roundLeftMs are optional extras on the snapshot.
  if(snapshot.mode!=='IDLE'&&Number.isFinite(snapshot.score))drawHud(ctx,rect,snapshot,now);
  if(banner)drawBanner(ctx,rect,banner,now);
  return {...overlay,position};
}

const clampRel=v=>Math.max(0,Math.min(1,v));
