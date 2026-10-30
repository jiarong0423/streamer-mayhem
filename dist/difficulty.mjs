// Difficulty = how wide the hoop's catch zone is and how fast balls and pies fall. It is picked with the head before the round starts:
// lean into the left, middle or right third of the picture and stay there for about a second.
export const BASE_DROP_FALL=2500,BASE_PIE_FALL=1700;   // the engine defaults (ms), used at speed 1
export const LEVELS=Object.freeze({
  EASY:Object.freeze({id:'EASY',label:'EASY',hint:'wide zone · slow',catchHalf:.075,speed:1,pieShare:[.16,.26],doublePie:0,grades:Object.freeze({S:160,A:115,B:75})}),
  NORMAL:Object.freeze({id:'NORMAL',label:'NORMAL',hint:'medium · medium',catchHalf:.062,speed:1.1,pieShare:[.24,.38],doublePie:.15,grades:Object.freeze({S:130,A:95,B:60})}),
  HARD:Object.freeze({id:'HARD',label:'HARD',hint:'narrow zone · fast',catchHalf:.05,speed:1.2,pieShare:[.3,.46],doublePie:.3,grades:Object.freeze({S:110,A:80,B:50})})
});
export const LEVEL_ORDER=Object.freeze(['EASY','NORMAL','HARD']);
export const DEFAULT_LEVEL='NORMAL';
export const MIN_FALL_MS=900;

// The level is chosen by how far the head has moved sideways from where it was when the picker opened (so nobody has to be centred first):
// about half a face width (0.07 of the picture) to the left is EASY, about the same to the right is HARD, anything in between is NORMAL.
export const SIDE_DEAD=.07,CALIBRATE_FRAMES=15;
export function zoneFor(dx,dead=SIDE_DEAD){
  if(!Number.isFinite(dx))return null;
  return dx<-dead?'EASY':dx>dead?'HARD':'NORMAL';
}
// state: {zone,base,n,sum}. The first CALIBRATE_FRAMES usable positions set the resting x (zone NORMAL meanwhile); after that the zone follows the head.
// It keeps the last good zone while the face is briefly lost; there is no timer and no automatic choice.
export function stepPicker(state,x,opts={}){
  const s={zone:null,base:null,n:0,sum:0,...(state??{})};   // a partly filled state (for example just {zone:null}) is completed, never turned into NaN
  if(!Number.isFinite(x))return {...s};
  if(s.base===null){
    const n=s.n+1,sum=s.sum+x;
    return n>=CALIBRATE_FRAMES?{zone:'NORMAL',base:sum/n,n,sum}:{zone:'NORMAL',base:null,n,sum};
  }
  return {...s,zone:zoneFor(x-s.base,opts.dead??SIDE_DEAD)};
}
// A nod: the nose dips below its resting height and comes back within a moment. A slow lean down is not a nod, and small tracking jitter is below the threshold.
// y is the nose height as a fraction of the visible window (0 = top, grows downwards).
export class NodDetector {
  constructor({dip=.03,backFrac=.4,maxDipMs=900,cooldownMs=700,alpha=.05,sideLimit=.035}={}) {
    this.sideLimit=sideLimit;this.dip=dip;this.backFrac=backFrac;this.maxDipMs=maxDipMs;this.cooldownMs=cooldownMs;this.alpha=alpha;this.reset();
  }
  reset(){this.base=null;this.dipAt=null;this.dipX=null;this.lastNod=-Infinity;}
  // x (optional) is the nose's sideways position: tilting the head sideways also lowers the nose and then raises it again, so a dip during which
  // x moves more than sideLimit is a tilt, not a nod.
  update(y,now,x=NaN){
    if(!Number.isFinite(y)){this.dipAt=null;return false;}
    if(this.base===null){this.base=y;return false;}
    const d=y-this.base;
    if(this.dipAt===null){
      if(d>=this.dip){this.dipAt=now;this.dipX=Number.isFinite(x)?x:null;return false;}
      this.base+=d*this.alpha;return false;   // the resting height follows slow drift
    }
    if(now-this.dipAt>this.maxDipMs){this.dipAt=null;this.base=y;return false;}   // too slow: a lean, not a nod
    if(this.dipX!==null&&Number.isFinite(x)&&Math.abs(x-this.dipX)>this.sideLimit){this.dipAt=null;this.base=y;return false;}   // moved sideways: a tilt
    if(d<=this.dip*this.backFrac){
      this.dipAt=null;
      if(now-this.lastNod>=this.cooldownMs){this.lastNod=now;return true;}
    }
    return false;
  }
}
// Fall time of a shot at this level (the engine times are the speed-1 values).
export const scaleFall=(fall,level)=>Math.max(MIN_FALL_MS,Math.round(fall/(level?.speed??1)));
// Puts a level into a running engine: the catch zone and the default ball and pie fall times (chat commands use these; waves are scaled where they are created).
export function applyLevel(game,level){
  const l=level??LEVELS[DEFAULT_LEVEL];
  game.config.catchHalf=l.catchHalf;game.config.dropFall=Math.round(BASE_DROP_FALL/l.speed);game.config.pieFall=Math.round(BASE_PIE_FALL/l.speed);
  return l;
}

// The wave generator's side of a level: how many of the auto drops are pies and how often two pies come together.
export function applyWaves(waves,level){
  const l=level??LEVELS[DEFAULT_LEVEL];
  waves.bombStart=l.pieShare[0];waves.bombEnd=l.pieShare[1];waves.doublePie=l.doublePie;waves.speed=l.speed;
  return l;
}

// Three pills near the top of the play area; the one the head leans into is lit. A nod confirms it (keys 1, 2, 3 also work).
export function drawPicker(ctx,rect,state){
  if(!rect)return;
  const w=rect.width*.27,h=rect.height*.2,y=rect.y+rect.height*.2,font=Math.max(12,rect.width/55);
  ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
  ctx.textAlign='center';
  ctx.fillStyle='rgba(0,0,0,.78)';ctx.fillRect(rect.x,rect.y+rect.height*.12,rect.width,rect.height*.4);   // dark enough to hide the score box behind it
  ctx.fillStyle='#fff';ctx.font=`700 ${font*1.05}px sans-serif`;ctx.fillText('TILT YOUR HEAD A LITTLE TO A SIDE, THEN NOD TO CONFIRM',rect.x+rect.width/2,rect.y+rect.height*.17);
  LEVEL_ORDER.forEach((id,i)=>{
    const level=LEVELS[id],x=rect.x+rect.width*(i/3+1/6)-w/2,on=state?.zone===id;
    ctx.fillStyle=on?'rgba(217,249,101,.92)':'rgba(255,255,255,.22)';ctx.beginPath();ctx.roundRect(x,y,w,h,h*.2);ctx.fill();
    ctx.fillStyle=on?'#1d2b0e':'#fff';ctx.font=`900 ${font*1.5}px sans-serif`;ctx.fillText(level.label,x+w/2,y+h*.45);
    ctx.font=`600 ${font*.95}px sans-serif`;ctx.fillText(level.hint,x+w/2,y+h*.72);
  });
  ctx.fillStyle='rgba(255,255,255,.85)';ctx.font=`600 ${font*.9}px sans-serif`;ctx.fillText(state?.zone?`${LEVELS[state.zone].label} · nod to confirm (or press Enter)`:'no face yet',rect.x+rect.width/2,rect.y+rect.height*.46);
  ctx.restore();
}
