// Pure five-joint challenge; the game owns admitted frames, time, scoring and IO.
export const FREEZE_JOINTS=Object.freeze(['nose','leftShoulder','rightShoulder','leftElbow','rightElbow']);
const finite=Number.isFinite;
const copyPose=pose=>pose?Object.fromEntries(FREEZE_JOINTS.map(name=>[name,{...pose[name]}])):null;

export class PoseFreeze {
  constructor(options={}) {
    const defaults={maxAge:250,confidence:.55,warning:1500,hold:2500,stable:150,recovery:1000,displacement:.04,
      box:{left:.35,right:.65,top:.04,bottom:.96}};
    const c={...defaults,...options,box:Object.hasOwn(options,'box')?options.box:{...defaults.box}};
    for(const name of ['warning','hold','stable'])if(!finite(c[name])||c[name]<=0||c[name]>60000)throw new RangeError(`Invalid freeze ${name}`);
    for(const name of ['maxAge','recovery'])if(!finite(c[name])||c[name]<0||c[name]>60000)throw new RangeError(`Invalid freeze ${name}`);
    if(!finite(c.confidence)||c.confidence<0||c.confidence>1||!finite(c.displacement)||c.displacement<0||c.displacement>Math.SQRT2)throw new RangeError('Invalid freeze threshold');
    const b=c.box;
    if(!b||![b.left,b.right,b.top,b.bottom].every(v=>finite(v)&&v>=0&&v<=1)||b.left>=b.right||b.top>=b.bottom)throw new RangeError('Invalid freeze box');
    this.config=Object.freeze({...c,box:Object.freeze({...b})});this.reset();
  }

  reset() {
    this.active=false;this.phase=null;this.status='IDLE';this.eventId=null;this.anchor=null;this.pose=null;
    this.warningRemaining=0;this.holdRemaining=0;this.recoveryRemaining=0;this.needsRecovery=false;
    this.lastNow=-Infinity;this.lastCapture=null;this.lastFrameId=null;this.parentMode=null;this.phaseTrusted=false;this.recoveryTrusted=false;this.admittedAt=-Infinity;
    this.phaseFloor=-Infinity;this.recoveryFloor=-Infinity;this.preparationComplete=false;
    this.badStart=null;this.pendingResult=null;
  }
  #clock(now) {if(!finite(now)||now<this.lastNow)throw new RangeError('Freeze clock must be monotonic');this.lastNow=now;}
  #fresh(frame,now) {
    return Boolean(frame&&typeof frame.frameId==='string'&&frame.frameId&&finite(frame.captureTime)&&frame.captureTime<=now&&now-frame.captureTime<=this.config.maxAge);
  }
  #knownPose(frame) {
    if(!frame)return null;
    const pose={};
    for(const name of FREEZE_JOINTS){
      const p=frame[name];
      if(!p||![p.x,p.y,p.visibility].every(finite)||p.x<0||p.x>1||p.y<0||p.y>1||p.visibility<this.config.confidence||p.visibility>1)return null;
      pose[name]={x:p.x,y:p.y,visibility:p.visibility};
    }
    return pose;
  }
  canStart(frame,now) {return !this.active&&finite(now)&&this.#fresh(frame,now)&&Boolean(this.#knownPose(frame));}
  start({eventId,now,frame}) {
    this.#clock(now);
    if(typeof eventId!=='string'||!eventId||!this.canStart(frame,now))return false;
    this.reset();this.lastNow=now;this.admittedAt=now;this.active=true;this.eventId=eventId;this.phase='YELLOW';this.status='YELLOW';
    this.warningRemaining=this.config.warning;this.holdRemaining=this.config.hold;
    this.pose=this.#knownPose(frame);this.lastCapture=frame.captureTime;this.lastFrameId=frame.frameId;
    this.parentMode='PLAYING';this.phaseFloor=now;this.recoveryFloor=now;
    this.phaseTrusted=frame.captureTime>=now;return true;
  }
  #suspend(status,now,boundary=false) {
    if(boundary||!this.needsRecovery){
      this.phaseFloor=Math.max(this.phaseFloor,this.admittedAt,now);
      this.recoveryFloor=Math.max(this.recoveryFloor,this.admittedAt,now);
      this.recoveryRemaining=this.config.recovery;this.preparationComplete=false;
    }
    this.status=status;this.needsRecovery=true;
    this.phaseTrusted=false;this.recoveryTrusted=false;this.badStart=null;this.pose=null;
  }
  #finish(outcome,reason,now,frame=null) {
    if(!this.active)return;
    this.pendingResult={eventId:this.eventId,kind:'FREEZE',outcome,reason,
      sampledFrameId:frame?.frameId??null,sampledAt:frame?.captureTime??now};
    this.active=false;this.phase=null;this.status='IDLE';this.anchor=null;this.pose=null;
    this.warningRemaining=0;this.holdRemaining=0;this.recoveryRemaining=0;this.needsRecovery=false;this.badStart=null;
  }
  cancel(reason,now) {this.#clock(now);this.#finish('UNKNOWN',reason,now);return this.snapshot();}
  takeResult(){const result=this.pendingResult;this.pendingResult=null;return result?{...result}:null;}
  #bad(pose) {
    const b=this.config.box;
    return FREEZE_JOINTS.some(name=>{const p=pose[name],a=this.anchor[name];return p.x<b.left||p.x>b.right||p.y<b.top||p.y>b.bottom||Math.hypot(p.x-a.x,p.y-a.y)>this.config.displacement;});
  }
  #advancePhase(delta,pose,frame,now) {
    if(this.phase==='YELLOW'){
      this.warningRemaining=Math.max(0,this.warningRemaining-delta);
      if(this.warningRemaining===0){
        this.phase='RED';this.status='RED';this.anchor=copyPose(pose);this.holdRemaining=this.config.hold;
        this.badStart=this.#bad(pose)?frame.captureTime:null;
      }
      return;
    }
    if(this.#bad(pose)){
      this.badStart??=frame.captureTime;
      if(frame.captureTime-this.badStart>=this.config.stable){this.#finish('HIT','FREEZE_BROKEN',now,frame);return;}
    } else this.badStart=null;
    this.holdRemaining=Math.max(0,this.holdRemaining-delta);
    if(this.holdRemaining===0)this.#finish('DODGE','PERFECT_FREEZE',now,frame);
  }

  update({now,frame,mode}) {
    this.#clock(now);if(!this.active)return this.snapshot();
    if(mode==='ROUND_END'||mode==='IDLE'){this.#finish('UNKNOWN','ROUND_END',now);return this.snapshot();}
    const previousMode=this.parentMode,previousPhaseTrusted=this.phaseTrusted,
      previousRecoveryTrusted=this.recoveryTrusted,previousCapture=this.lastCapture;
    this.parentMode=mode;
    // A control transition is observed at engine time, even with an older fresh frame.
    const resuming=previousMode==='PAUSED'&&(mode==='PLAYING'||mode==='RECOVERING');
    if(resuming)this.#suspend('RECOVERING',now,true);
    if(previousMode==='RECOVERING'&&mode==='PLAYING'){
      this.phaseFloor=Math.max(this.phaseFloor,this.admittedAt,now);
      this.phaseTrusted=false;this.badStart=null;
    }
    if(!this.#fresh(frame,now)){
      if(previousCapture!==null&&now-previousCapture>this.config.maxAge)this.#finish('UNKNOWN','SOURCE_STALE',now);
      else this.#suspend(mode==='PAUSED'?'PAUSED':'UNKNOWN',now,mode!==previousMode);
      return this.snapshot();
    }
    const isNew=frame.frameId!==this.lastFrameId&&frame.captureTime>previousCapture;
    if(isNew&&previousCapture!==null&&frame.captureTime-previousCapture>this.config.maxAge){
      this.#finish('UNKNOWN','SOURCE_STALE',now);return this.snapshot();
    }
    if(isNew){this.lastCapture=frame.captureTime;this.lastFrameId=frame.frameId;}
    const pose=this.#knownPose(frame);
    if(mode!=='PLAYING'&&mode!=='RECOVERING'){
      this.#suspend(mode==='PAUSED'?'PAUSED':'UNKNOWN',now,mode!==previousMode||(isNew&&!pose));
      return this.snapshot();
    }
    if(!pose){this.#suspend('UNKNOWN',now,isNew);return this.snapshot();}
    if(mode==='RECOVERING'&&!this.needsRecovery)this.#suspend('RECOVERING',now,true);
    this.pose=pose;
    if(!isNew){
      if(this.needsRecovery&&this.preparationComplete&&mode==='PLAYING')this.needsRecovery=false;
      this.status=this.needsRecovery||mode==='RECOVERING'?'RECOVERING':this.phase;
      return this.snapshot();
    }
    const delta=frame.captureTime-previousCapture;
    if(this.needsRecovery){
      const eligible=frame.captureTime>=this.recoveryFloor;
      // Recovery and phase have separate floors: return-to-PLAYING cannot reset preparation.
      if(eligible&&previousRecoveryTrusted&&!resuming&&(previousMode==='PLAYING'||previousMode==='RECOVERING')){
        this.recoveryRemaining=Math.max(0,this.recoveryRemaining-delta);
      }
      this.recoveryTrusted=eligible;
      if(eligible&&this.recoveryRemaining===0)this.preparationComplete=true;
      if(this.preparationComplete&&mode==='PLAYING')this.needsRecovery=false;
      this.phaseTrusted=!this.needsRecovery&&mode==='PLAYING'&&frame.captureTime>=this.phaseFloor;
      this.status=this.needsRecovery?'RECOVERING':this.phase;
      return this.snapshot();
    }
    const eligible=frame.captureTime>=this.phaseFloor;
    this.phaseTrusted=eligible&&mode==='PLAYING';this.recoveryTrusted=false;this.status=this.phase;
    if(eligible&&mode==='PLAYING'&&previousMode==='PLAYING'&&previousPhaseTrusted&&!resuming){
      this.#advancePhase(delta,pose,frame,now);
    }
    return this.snapshot();
  }

  snapshot() {
    return {active:this.active,phase:this.phase,status:this.status,
      remainingMs:this.active?(this.phase==='YELLOW'?this.warningRemaining:this.holdRemaining):0,
      recoveryRemaining:this.needsRecovery?this.recoveryRemaining:0,box:{...this.config.box},
      pose:copyPose(this.pose),anchor:copyPose(this.anchor)};
  }
}
