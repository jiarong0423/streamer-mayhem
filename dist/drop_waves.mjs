// Automatic drop waves: irregular gaps, irregular fall times, a few bombs, and a difficulty that rises over a round.
// Pure scheduling (no timers, no DOM): the caller asks `update(now, active)` every frame and gets either null or one drop to start.
// Numbers follow the game-designer review: gap 0.7 s + exponential(0.9 s) clamped to 0.5-2.2 s, fall 1.6-2.8 s, bombs 12% rising to 28%.
const finite=Number.isFinite;

function rng(seed){let x=(seed>>>0)||1;return()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}

// Width of the clear space left in the middle of the picture (0.3..0.7, where a seated player can move) when two pies, each with a danger zone of +-0.1, land at a and b.
export const SAFE_GAP_MIN=.12,MIN_FALL_MS=900;
export function safeGapLeft(a,b,half=.1,lo=.3,hi=.7){
  const iv=[[a-half,a+half],[b-half,b+half]].map(([l,r])=>[Math.max(lo,l),Math.min(hi,r)]).filter(([l,r])=>r>l).sort((p,q)=>p[0]-q[0]);
  let covered=0,end=-Infinity;
  for(const [l,r] of iv){const from=Math.max(l,end);if(r>from)covered+=r-from;end=Math.max(end,r);}
  return (hi-lo)-covered>=SAFE_GAP_MIN;
}
export class DropWaves {
  constructor({seed=1,maxActive=3,roundMs=75000,gapMin=500,gapMax=2200,gapBase=700,gapMean=900,fallMin=1600,fallMax=2800,bombStart=.12,bombEnd=.28,doublePie=0,speed=1,gapFloor=450,fallFloor=1300,laneStepMs=350,mixedLaneMs=450,columnWeights=null,maxSame=2,speedFactor=null,landXFor=null,moveSpeed=.30,reactMs=250,minShift=.13}={}) {
    if(!Number.isInteger(maxActive)||maxActive<1||maxActive>8||!(roundMs>0)||!(gapMin>0&&gapMax>=gapMin)||!(fallMin>0&&fallMax>=fallMin)||!(bombStart>=0&&bombEnd<=1&&bombEnd>=bombStart)||!(doublePie>=0&&doublePie<=1)||!(speed>0)||(columnWeights!==null&&(!Array.isArray(columnWeights)||columnWeights.length!==3||columnWeights.some(v=>!(v>=0))||!(columnWeights[0]+columnWeights[1]+columnWeights[2]>0)))||!Number.isInteger(maxSame)||maxSame<1||(landXFor!==null&&typeof landXFor!=='function')||!(moveSpeed>0)||!(reactMs>=0)||!(minShift>=0&&minShift<1)||(speedFactor!==null&&(!Array.isArray(speedFactor)||speedFactor.length!==2||!(speedFactor[0]>0)||!(speedFactor[1]>=speedFactor[0])||!finite(speedFactor[1]))))throw new RangeError('INVALID_WAVES');
    Object.assign(this,{seed,maxActive,roundMs,gapMin,gapMax,gapBase,gapMean,fallMin,fallMax,bombStart,bombEnd,doublePie,speed,gapFloor,fallFloor,laneStepMs,mixedLaneMs,columnWeights,maxSame,speedFactor,landXFor,moveSpeed,reactMs,minShift});this.reset(0);
  }
  reset(now){this.random=rng(this.seed);this.startedAt=now;this.nextAt=now+800;this.lastColumn=0;this.sameColumn=0;this.count=0;this.landings=[];this.lastLandX=null;}
  // 0 at the start of a round, 1 at the end (and after it).
  difficulty(now){return Math.max(0,Math.min(1,(now-this.startedAt)/this.roundMs));}
  #gap(d){
    const exp=-Math.log(1-this.random()*.999)*this.gapMean;                 // exponential, mean gapMean
    let gap=Math.max(this.gapMin,Math.min(this.gapMax,this.gapBase+exp));
    if(this.random()<.15)gap=Math.max(this.gapMin*.5,gap*.35);                // now and then a quick follow-up, so the density is not regular
    return Math.max(this.gapFloor,gap*(1-.45*d));   // never below the game's global cooldown, or the drop would be refused and lost
  }
  #column(){
    const w=this.columnWeights;
    const draw=skip=>{   // weighted (or uniform) draw, optionally without lane `skip`
      const ws=[1,2,3].map(c=>c===skip?0:(w?w[c-1]:1)),total=ws[0]+ws[1]+ws[2];let r=this.random()*total;
      for(let c=1;c<=3;c++){r-=ws[c-1];if(r<0&&ws[c-1]>0)return c;}
      return ws.findIndex(v=>v>0)+1;
    };
    let c=draw(0);
    // Never the same lane more than `maxSame` times in a row (2 by default), so sitting still in one lane is not a strategy.
    if(c===this.lastColumn&&this.sameColumn>=this.maxSame)c=draw(c);
    return c;
  }
  // Can a streamer who leans from lane to lane (a lane step costs laneStepMs) reach this landing? Different lanes need enough time between landings,
  // and a gold item and a bomb must not land in the same lane almost together, or catching one means catching the other.
  // Theme (landXFor given): landings are staggered by their real landing x. Consecutive shots must land at least `minShift` apart (never two in the same place),
  // and two landings need dt >= |dx| / moveSpeed + reactMs: the time to lean across (moveSpeed in window widths per second) plus a reaction. A ball and a pie
  // never land within a hoop width of each other close in time (catching one would catch the other).
  #reachable(column,bomb,landAt,x){
    if(this.landXFor&&Number.isFinite(x)){
      if(this.lastLandX!==null&&Math.abs(x-this.lastLandX)<this.minShift)return false;
      for(const o of this.landings){
        const dt=Math.abs(landAt-o.at),dx=Math.abs(x-o.x);
        if(dt<dx/this.moveSpeed*1000+this.reactMs)return false;
        if(o.bomb!==bomb&&dx<.15&&dt<this.mixedLaneMs)return false;
      }
      return true;
    }
    for(const o of this.landings){
      const dt=Math.abs(landAt-o.at);
      if(o.column===column){if(o.bomb!==bomb&&dt<this.mixedLaneMs)return false;}
      else if(dt<Math.abs(column-o.column)*this.laneStepMs)return false;
    }
    return true;
  }
  // A second pie that comes together with the first. It is placed so that at least a gap of SAFE_GAP_MIN of the middle part of the picture is left clear of both
  // pies' danger zones, so the player can always dodge them (the pies cannot be caught for points). Returns {column,fall,tag} or null.
  #twin(column,x,now,fall) {
    const lane=c=>[.35,.5,.65][c-1],others=[1,2,3].filter(c=>c!==column),start=Math.floor(this.random()*others.length);
    for(let i=0;i<others.length;i++){
      const c2=others[(start+i)%others.length];
      for(let t=0;t<4;t++){
        const tag=100+t,x2=this.landXFor?this.landXFor(c2,tag):undefined,a=Number.isFinite(x)?x:lane(column),b=Number.isFinite(x2)?x2:lane(c2);
        if(!safeGapLeft(a,b))continue;
        const fall2=Math.max(MIN_FALL_MS,fall+(this.random()*300-150));
        this.landings.push({column:c2,bomb:true,at:now+fall2,x:x2});
        return {column:c2,fall:Math.round(fall2),...(x2!==undefined?{tag}:{})};
      }
    }
    return null;
  }
  // Returns {column,variant,fall} when a drop should start now, else null. `active` is how many auto or chat drops are on screen.
  update(now,active=0) {
    if(!finite(now)||!finite(active))return null;
    if(now<this.nextAt)return null;
    const d=this.difficulty(now);
    if(active>=this.maxActive){this.nextAt=now+250;return null;}              // full: look again shortly
    this.landings=this.landings.filter(o=>o.at>now-1000);
    const bomb=this.random()<this.bombStart+(this.bombEnd-this.bombStart)*d;
    for(let tries=0;tries<8;tries++){
      const column=this.#column();
      // speedFactor [lo,hi] (theme): every shot is made faster by its own factor, drawn uniformly (decimals, e.g. 1.27), so speeds are very varied; fallFloor is the ceiling.
      const factor=this.speedFactor?this.speedFactor[0]+this.random()*(this.speedFactor[1]-this.speedFactor[0]):1;
      // `speed` (the difficulty level) shortens every fall before the reachability check, so the check sees the real landing times.
      const fall=Math.max(MIN_FALL_MS,Math.max(this.fallFloor,(this.fallMin+this.random()*(this.fallMax-this.fallMin))*(1-.35*d)/factor)/this.speed);
      const x=this.landXFor?this.landXFor(column,tries):undefined;   // `tries` is part of the shot's id, so every retry can land on the other side
      if(!this.#reachable(column,bomb,now+fall,x))continue;
      this.sameColumn=column===this.lastColumn?this.sameColumn+1:1;this.lastColumn=column;
      this.landings.push({column,bomb,at:now+fall,x});if(x!==undefined)this.lastLandX=x;
      const twin=bomb&&this.doublePie>0&&this.random()<this.doublePie?this.#twin(column,x,now,fall):null;
      const drop={column,...(bomb?{variant:'BOMB'}:{}),fall:Math.round(fall),...(x!==undefined?{tag:tries}:{}),...(twin?{twin}:{})};
      this.nextAt=now+this.#gap(d);this.count++;
      return drop;
    }
    this.nextAt=now+200;return null;                                         // nothing fair right now: try again shortly
  }
}
