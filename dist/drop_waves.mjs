// Automatic drop waves: irregular gaps, irregular fall times, a few bombs, and a difficulty that rises over a round.
// Pure scheduling (no timers, no DOM): the caller asks `update(now, active)` every frame and gets either null or one drop to start.
// Numbers follow the game-designer review: gap 0.7 s + exponential(0.9 s) clamped to 0.5-2.2 s, fall 1.6-2.8 s, bombs 12% rising to 28%.
const finite=Number.isFinite;

function rng(seed){let x=(seed>>>0)||1;return()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}

export class DropWaves {
  constructor({seed=1,maxActive=3,roundMs=75000,gapMin=500,gapMax=2200,gapBase=700,gapMean=900,fallMin=1600,fallMax=2800,bombStart=.12,bombEnd=.28,gapFloor=450}={}) {
    if(!Number.isInteger(maxActive)||maxActive<1||maxActive>8||!(roundMs>0)||!(gapMin>0&&gapMax>=gapMin)||!(fallMin>0&&fallMax>=fallMin)||!(bombStart>=0&&bombEnd<=1&&bombEnd>=bombStart))throw new RangeError('INVALID_WAVES');
    Object.assign(this,{seed,maxActive,roundMs,gapMin,gapMax,gapBase,gapMean,fallMin,fallMax,bombStart,bombEnd,gapFloor});this.reset(0);
  }
  reset(now){this.random=rng(this.seed);this.startedAt=now;this.nextAt=now+800;this.lastColumn=0;this.sameColumn=0;this.count=0;}
  // 0 at the start of a round, 1 at the end (and after it).
  difficulty(now){return Math.max(0,Math.min(1,(now-this.startedAt)/this.roundMs));}
  #gap(d){
    const exp=-Math.log(1-this.random()*.999)*this.gapMean;                 // exponential, mean gapMean
    let gap=Math.max(this.gapMin,Math.min(this.gapMax,this.gapBase+exp));
    if(this.random()<.15)gap=Math.max(this.gapMin*.5,gap*.35);                // now and then a quick follow-up, so the density is not regular
    return Math.max(this.gapFloor,gap*(1-.45*d));   // never below the game's global cooldown, or the drop would be refused and lost
  }
  #column(){
    let c=1+Math.floor(this.random()*3);
    // Never the same lane more than twice in a row, so sitting still in the middle is not a strategy.
    if(c===this.lastColumn&&this.sameColumn>=2)c=1+((c-1+1+Math.floor(this.random()*2))%3);
    this.sameColumn=c===this.lastColumn?this.sameColumn+1:1;this.lastColumn=c;return c;
  }
  // Returns {column,variant,fall} when a drop should start now, else null. `active` is how many auto or chat drops are on screen.
  update(now,active=0) {
    if(!finite(now)||!finite(active))return null;
    if(now<this.nextAt)return null;
    const d=this.difficulty(now);
    if(active>=this.maxActive){this.nextAt=now+250;return null;}              // full: look again shortly
    const bomb=this.random()<this.bombStart+(this.bombEnd-this.bombStart)*d;
    const fall=(this.fallMin+this.random()*(this.fallMax-this.fallMin))*(1-.35*d);
    const drop={column:this.#column(),...(bomb?{variant:'BOMB'}:{}),fall:Math.round(fall)};
    this.nextAt=now+this.#gap(d);this.count++;
    return drop;
  }
}
