// Everything the transparent OBS page paints for one validated state, with no DOM access so tests can drive it with a fake canvas context.
// It reuses the game page's own drawing code (ticker strip, versus bar, hoop, HUD, banners); the protocol carries only game state, never pixels.
import {drawCameraOverlay} from './matrix_view.mjs';
import {drawHud,drawBanner,strokedText,COLORS,MIN_TEXT_PX} from './art.mjs';
import {drawHoop} from './arena_draw.mjs';
import {drawTicker,drawVersus,TICKER_H,VERSUS_H,TONE_COLORS} from './ticker.mjs';
import {projectCameraPoint,visiblePointToCanvas} from './camera_geometry.mjs';
import {gridCell,comboBonus} from './matrix.mjs';

export const OVERLAY_HINT='!drop 1 / 3 = 3PT  ·  !drop 2 = 2PT  ·  !pie 1-3 = pie';
export const PAUSED_TEXT='GAME PAUSED';
export const PAUSED_DETAIL='The game page is hidden or minimised; bring it back to continue';

// Top strip and versus bar take the same room as on the game page, and the score panel moves below them (see arena_draw.mjs).
export function hudRect(rect,{ticker=false,versus=false}={}) {
  const strip=ticker||versus?rect.height*(TICKER_H+(versus?VERSUS_H+.045:0)):0;
  return strip?{x:rect.x,y:rect.y+strip,width:rect.width,height:rect.height-strip}:rect;
}

export function tickerEntries(items,receivedAt) {
  return (items??[]).map(item=>({name:item.name,star:item.star===true,text:item.text,color:TONE_COLORS[item.tone],at:receivedAt-item.ageMs}));
}

// state: the result of readOverlayState (geometry non-null). Returns what the page puts in aria-label / data attributes.
export function drawOverlayScene(ctx,state,{now,receivedAt=now}={}) {
  const {geometry,sourcePoint}=state,raw=state.snapshot;
  const projected=projectCameraPoint(sourcePoint,geometry),projectedCell=gridCell(projected);
  const mode=raw.mode==='PLAYING'&&projectedCell===null?'TRACKING_LOST':raw.mode;
  const snapshot={...raw,mode,attacks:mode==='PLAYING'?raw.attacks:[]};
  drawCameraOverlay(ctx,geometry,snapshot,{now});
  const rect=geometry.visible;ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
  let cell=null;
  if(mode==='PLAYING'){
    const p=visiblePointToCanvas(projected,geometry);cell=projectedCell;
    if(p){
      const drop=snapshot.attacks.find(a=>a.kind==='DROP');
      if(drop)drawHoop(ctx,rect,p,drop);
      ctx.fillStyle='#00ffff';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,Math.min(5,rect.width/70)),0,2*Math.PI);ctx.fill();
    }
  }
  const hasStrip=Boolean(raw.ticker||raw.versus);
  if(Number.isFinite(snapshot.score)){
    const combo=Number.isFinite(raw.combo)?{combo:raw.combo,bonus:comboBonus(raw.combo)}:{};
    drawHud(ctx,hudRect(rect,{ticker:hasStrip,versus:Boolean(raw.versus)}),{...snapshot,...combo,roundLeftMs:raw.roundLeftMs},now,{panelAlpha:.72});
  }
  if(hasStrip){
    drawTicker(ctx,rect,tickerEntries(raw.ticker,receivedAt),now);
    if(raw.versus)drawVersus(ctx,rect,raw.versus.streamer,raw.versus.chat);
  }
  if(raw.banner){
    const b=raw.banner;
    drawBanner(ctx,rect,{text:b.text,at:receivedAt-b.ageMs,big:b.kind!=='ROUND_OVER',...(b.grade?{grade:b.grade}:{})},now);
  }
  if(mode==='PLAYING')drawHints(ctx,rect,snapshot.viewer);
  if(mode==='PAUSED'){
    const size=Math.max(MIN_TEXT_PX,rect.height/9);
    strokedText(ctx,PAUSED_TEXT,rect.x+rect.width/2,rect.y+rect.height*.52,size,COLORS.paper);
    strokedText(ctx,PAUSED_DETAIL,rect.x+rect.width/2,rect.y+rect.height*.52+size*.9,Math.max(MIN_TEXT_PX,size*.34),COLORS.paper,{alpha:.85});
  }
  ctx.restore();
  return {status:mode==='TRACKING_LOST'?'Tracking lost':`Overlay ${mode}`,cell};
}

// What chat can type, always on screen while playing, plus the name of whoever just triggered something.
function drawHints(ctx,rect,viewer) {
  const size=Math.max(MIN_TEXT_PX,rect.height/30);
  strokedText(ctx,OVERLAY_HINT,rect.x+rect.width/2,rect.y+rect.height-size*.8,size,COLORS.paper,{alpha:.85});
  if(viewer)strokedText(ctx,viewer,rect.x+rect.width/2,rect.y+rect.height-size*2.3,size*1.1,COLORS.gold);
}
