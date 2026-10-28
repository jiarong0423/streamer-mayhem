// A mosquito that goes for the streamer's face. Pure state machine in visible-window coordinates (x, y in 0..1, face width as a fraction of the width);
// no DOM, no timers, no camera. The caller feeds the face position and a "swat level" (how much motion there is where the mosquito is).
//
// Rules (from the design notes): the mosquito flies an irregular S-shaped, non-fixed path toward the face. It aims at where the face WAS a moment ago,
// so a quick lean can make it miss and loop back. If it reaches the face it lands, and the streamer has two seconds to slap their own face; a hand
// swat in flight also kills it. Results: SWAT (+), DODGE (it gave up), BITE (landed and not slapped in time), UNKNOWN (face lost, no penalty).
const finite=Number.isFinite;
const ASPECT=16/9;

function rng(seed){let x=(seed>>>0)||1;return()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}
// Distance in units of the window width (y is scaled by the 16:9 aspect so a circle stays a circle).
export const mosquitoDistance=(a,b)=>Math.hypot(a.x-b.x,(a.y-b.y)/ASPECT);

export class FaceMosquito {
  constructor({approachMs=3500,retryMs=1300,maxApproaches=3,landMs=2000,lostMs=1000,lagMs=450,amplitude=.12,landFactor=.45,swatLevel=.3,swatFrames=2,seed=1}={}) {
    if(![approachMs,retryMs,landMs,lostMs,lagMs].every(n=>finite(n)&&n>0)||!Number.isInteger(maxApproaches)||maxApproaches<1||!(amplitude>=0&&amplitude<=.4)||!(landFactor>0&&landFactor<=2)||!(swatLevel>0&&swatLevel<=1)||!Number.isInteger(swatFrames)||swatFrames<1)throw new RangeError('INVALID_MOSQUITO');
    Object.assign(this,{approachMs,retryMs,maxApproaches,landMs,lostMs,lagMs,amplitude,landFactor,swatLevel,swatFrames,seed});
    this.serial=0;this.#clear();
  }
  #clear(){this.state='IDLE';this.history=[];this.hits=0;this.lostSince=null;this.pos={x:0,y:0};this.angle=0;this.approach=0;}
  get active(){return this.state!=='IDLE';}

  // Starts a mosquito from a random edge. `face` = {x,y,w} in window coords. Returns false if one is already flying or the face is unusable.
  start(now,face){
    if(this.active||!finite(now)||!face||![face.x,face.y,face.w].every(finite)||!(face.w>0))return false;
    this.random=rng((this.seed*2654435761+(++this.serial)*40503)>>>0);
    const side=Math.floor(this.random()*3);
    const from=side===0?{x:.1+this.random()*.8,y:-.06}:side===1?{x:-.06,y:.05+this.random()*.5}:{x:1.06,y:.05+this.random()*.5};
    this.#clear();this.state='FLYING';this.startedAt=now;this.begin(now,from,this.approachMs);
    this.history=[{t:now,x:face.x,y:face.y}];this.face={...face};this.pos={...from};
    return true;
  }
  begin(now,from,duration){
    this.approach++;this.p0={...from};this.t0=now;this.duration=duration;
    this.phase=this.random()*Math.PI*2;this.freq=1.2+this.random()*.8;this.amp=this.amplitude*(.75+this.random()*.5);
    this.jitter=1;this.nextJitter=now+600;
  }
  // Where the mosquito aims: the face as it was `lagMs` ago.
  #aim(now){
    const target=now-this.lagMs;let a=this.history[0];
    for(const h of this.history){if(h.t<=target)a=h;else break;}
    return a;
  }
  #remember(now,face){this.history.push({t:now,x:face.x,y:face.y});while(this.history.length>2&&this.history[1].t<now-this.lagMs-200)this.history.shift();}

  // Advances the mosquito. `face` is {x,y,w} or null when not tracked; `level` is the fraction (0..1) of moving pixels around the mosquito/face.
  // Returns null while it is still going, or a result {outcome,reason,approaches,ms} exactly once.
  update(now,face,level=0){
    if(!this.active||!finite(now))return null;
    const usable=face&&[face.x,face.y,face.w].every(finite)&&face.w>0;
    if(!usable){
      if(this.lostSince===null)this.lostSince=now;
      if(now-this.lostSince>=this.lostMs)return this.#finish('UNKNOWN','FACE_LOST',now);
      face=this.face;                      // short gap: keep going with the last face
    }else{this.lostSince=null;this.face={...face};this.#remember(now,face);}

    if(this.state==='FLYING'){
      const aim=this.#aim(now),s=Math.max(0,Math.min(1,(now-this.t0)/this.duration));
      if(now>=this.nextJitter){this.jitter=.85+this.random()*.3;this.nextJitter=now+600;}
      const dx=aim.x-this.p0.x,dy=(aim.y-this.p0.y),len=Math.hypot(dx,dy/ASPECT)||1;
      // Perpendicular to the flight line in aspect-correct space; the sideways swing fades to zero on arrival, giving the S shape.
      const px=-(dy/ASPECT)/len,py=(dx/len)*ASPECT;
      const swing=this.amp*this.jitter*Math.sin(2*Math.PI*this.freq*s+this.phase)*(1-s);
      this.pos={x:this.p0.x+dx*s+px*swing,y:this.p0.y+dy*s+py*swing};
      this.angle=Math.atan2(dy,dx);
      if(this.#swatted(level))return this.#finish('SWAT','HAND_IN_FLIGHT',now);
      if(s>=1){
        if(mosquitoDistance(this.pos,face)<=face.w*this.landFactor){this.state='LANDED';this.landedAt=now;this.pos={x:face.x,y:face.y-face.w*.25*ASPECT};this.hits=0;}
        else if(this.approach>=this.maxApproaches)return this.#finish('DODGE','MISSED_FACE',now);
        else this.begin(now,this.pos,this.retryMs);          // missed: loop round and come back
      }
      return null;
    }
    // LANDED: it sits on the face; the streamer has landMs to slap it.
    this.pos={x:face.x,y:face.y-face.w*.25*ASPECT};
    if(this.#swatted(level))return this.#finish('SWAT','FACE_SLAP',now);
    if(now-this.landedAt>=this.landMs)return this.#finish('BITE','NOT_SLAPPED',now);
    return null;
  }
  #swatted(level){
    if(finite(level)&&level>=this.swatLevel)this.hits++;else this.hits=0;
    return this.hits>=this.swatFrames;
  }
  #finish(outcome,reason,now){const result={outcome,reason,approaches:this.approach,ms:Math.round(now-this.startedAt)};this.#clear();return result;}
  // Stops without a verdict (round ended, game paused): no score, no penalty.
  cancel(now){if(!this.active)return null;return this.#finish('UNKNOWN','CANCELLED',finite(now)?now:this.startedAt);}
  // What to draw. `landedProgress` runs 0..1 over the two-second window; `probe` is where to look for a swat (window coords) and how big.
  snapshot(now){
    if(!this.active)return null;
    const landed=this.state==='LANDED';
    return {state:this.state,x:this.pos.x,y:this.pos.y,angle:this.angle,approach:this.approach,
      landedProgress:landed&&finite(now)?Math.max(0,Math.min(1,(now-this.landedAt)/this.landMs)):0,
      probe:{x:this.pos.x,y:this.pos.y,r:Math.max(.04,(this.face?.w??.12)*(landed?1:.7))}};
  }
}
