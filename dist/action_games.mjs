// Synthetic wrist/hip challenges. Input, evidence time and outcomes belong to the engine.
const finite=Number.isFinite;
const copy=points=>points?Object.fromEntries(Object.entries(points).map(([k,p])=>[k,p?{...p}:null])):null;
const distance=(a,b)=>Math.hypot((a.x-b.x)*1280,(a.y-b.y)*720);
export class ActionGames {
  constructor({maxAge=250,confidence=.55,recovery=1000}={}){
    if(!finite(maxAge)||maxAge<0||maxAge>60000||!finite(confidence)||confidence<0||confidence>1||!finite(recovery)||recovery<0||recovery>60000)throw new RangeError('Invalid action game configuration');
    this.config=Object.freeze({maxAge,confidence,recovery});this.reset();
  }
  reset(){
    this.active=false;this.kind=null;this.status='IDLE';this.eventId=null;this.pose=null;this.motionPose=null;
    this.remainingMs=0;this.elapsed=0;this.level=0;this.targetLevel=0;this.belowMs=0;this.burns=0;
    this.lastNow=-Infinity;this.lastCapture=null;this.lastFrameId=null;this.mode=null;this.floor=-Infinity;this.phaseFloor=-Infinity;
    this.trusted=false;this.phaseTrusted=false;this.needsRecovery=false;this.recoveryRemaining=0;this.prepared=false;
    this.result=null;this.pulses=[];this.mosquito=null;this.seed=1;
  }
  #clock(now){if(!finite(now)||now<this.lastNow)throw new RangeError('Action clock must be monotonic');this.lastNow=now;}
  #point(p){return p&&[p.x,p.y,p.visibility].every(finite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&p.visibility>=this.config.confidence&&p.visibility<=1?{x:p.x,y:p.y,visibility:p.visibility}:null;}
  #pose(frame,kind=this.kind){
    if(!frame)return null;
    if(kind==='LAVA'){const leftHip=this.#point(frame.leftHip);return leftHip?{leftHip}:null;}
    const leftWrist=this.#point(frame.leftWrist),rightWrist=this.#point(frame.rightWrist);
    return leftWrist||rightWrist?{leftWrist,rightWrist}:null;
  }
  #fresh(frame,now){return frame&&typeof frame.frameId==='string'&&frame.frameId&&finite(frame.captureTime)&&frame.captureTime<=now&&now-frame.captureTime<=this.config.maxAge;}
  canStart(kind,frame,now){return !this.active&&['MOSQUITO','LAVA'].includes(kind)&&this.#fresh(frame,now)&&Boolean(this.#pose(frame,kind));}
  canRaise(frame,now){return this.active&&this.kind==='LAVA'&&this.targetLevel<.8&&this.#fresh(frame,now)&&Boolean(this.#pose(frame,'LAVA'));}
  start({kind,eventId,now,frame,level=.45}){
    this.#clock(now);
    if(typeof eventId!=='string'||!eventId||!this.canStart(kind,frame,now)||!finite(level)||level<.1||level>.8)return false;
    this.reset();this.lastNow=now;this.active=true;this.kind=kind;this.eventId=eventId;this.status='ACTIVE';
    this.remainingMs=kind==='MOSQUITO'?10000:8000;this.targetLevel=level;this.level=kind==='LAVA'?.1:0;
    this.pose=this.#pose(frame);this.motionPose=copy(this.pose);this.lastCapture=frame.captureTime;this.lastFrameId=frame.frameId;
    this.floor=now;this.phaseFloor=now;this.trusted=frame.captureTime>=now;this.phaseTrusted=this.trusted;this.mode='PLAYING';
    for(const char of eventId)this.seed=(Math.imul(this.seed,31)+char.charCodeAt(0))>>>0;
    this.mosquito=kind==='MOSQUITO'?{x:640,y:252,vx:100,vy:-55}:null;return true;
  }
  raise(){if(!this.active||this.kind!=='LAVA'||this.targetLevel>=.8)return false;this.targetLevel=Math.min(.8,Math.round((this.targetLevel+.1)*100)/100);return true;}
  #suspend(now,status,boundary=false){
    if(boundary||!this.needsRecovery){this.floor=Math.max(this.floor,now);this.phaseFloor=Math.max(this.phaseFloor,now);this.recoveryRemaining=this.config.recovery;this.prepared=false;}
    this.needsRecovery=true;this.trusted=false;this.phaseTrusted=false;this.motionPose=null;this.pose=null;this.belowMs=0;this.status=status;
  }
  #finish(outcome,reason,now,frame=null){
    if(!this.active)return;
    this.result={eventId:this.eventId,kind:this.kind,outcome,reason,burns:this.burns,sampledFrameId:frame?.frameId??null,sampledAt:frame?.captureTime??now};
    this.active=false;this.status='IDLE';this.pose=null;this.motionPose=null;this.mosquito=null;this.remainingMs=0;this.needsRecovery=false;this.belowMs=0;
  }
  cancel(reason,now){this.#clock(now);this.#finish('UNKNOWN',reason,now);}
  takeResult(){const result=this.result;this.result=null;return result?{...result}:null;}
  takePulses(){return this.pulses.splice(0);}
  #random(){let x=this.seed;x^=x<<13;x^=x>>>17;x^=x<<5;this.seed=x>>>0;return this.seed/4294967296;}
  #fly(delta){
    const m=this.mosquito;
    for(let remaining=delta;remaining>0;){
      const ms=Math.min(16,remaining),dt=ms/1000;remaining-=ms;
      m.vx+=(this.#random()-.5)*1200*dt;m.vy+=(this.#random()-.5)*1200*dt;
      const speed=Math.hypot(m.vx,m.vy);if(speed>220){m.vx*=220/speed;m.vy*=220/speed;}
      m.x+=m.vx*dt;m.y+=m.vy*dt;
      if(m.x<36||m.x>1244){m.x=Math.max(36,Math.min(1244,m.x));m.vx=-m.vx;}
      if(m.y<44||m.y>676){m.y=Math.max(44,Math.min(676,m.y));m.vy=-m.vy;}
    }
  }
  #advance(delta,pose,now,frame){
    const applied=Math.min(delta,this.remainingMs);this.elapsed+=applied;this.remainingMs-=applied;
    if(this.kind==='MOSQUITO'){
      this.#fly(applied);const target={x:this.mosquito.x/1280,y:this.mosquito.y/720};
      const swat=['leftWrist','rightWrist'].some(name=>pose[name]&&this.motionPose?.[name]&&distance(pose[name],target)<=36&&distance(pose[name],this.motionPose[name])/delta*1000>=900);
      const a=pose.leftWrist,b=pose.rightWrist,pa=this.motionPose?.leftWrist,pb=this.motionPose?.rightWrist;
      const clap=a&&b&&pa&&pb&&distance(pa,pb)>=120&&distance(a,b)<=80&&distance({x:(a.x+b.x)/2,y:(a.y+b.y)/2},target)<=50;
      if(swat||clap){this.#finish('DODGE',clap?'CLAP':'SWAT',now,frame);return;}
      if(this.remainingMs===0)this.#finish('HIT','MOSQUITO_TIMEOUT',now,frame);
    }else{
      const previousLevel=this.level,wasBelow=this.motionPose?.leftHip&&this.motionPose.leftHip.y>1-previousLevel;
      this.level=.1+(this.targetLevel-.1)*Math.min(1,this.elapsed/8000);
      if(pose.leftHip.y>1-this.level){
        this.belowMs=wasBelow?this.belowMs+applied:0;
        while(this.belowMs>=1000){this.belowMs-=1000;this.burns++;this.pulses.push({kind:'LAVA',eventId:this.eventId,sampledAt:frame.captureTime});}
      }else this.belowMs=0;
      if(this.remainingMs===0)this.#finish(this.burns?'HIT':'DODGE',this.burns?'LAVA_SURVIVED_BURN':'LAVA_CLEAR',now,frame);
    }
  }
  update({now,frame,mode}){
    this.#clock(now);if(!this.active)return this.snapshot();
    if(mode==='IDLE'||mode==='ROUND_END'){this.#finish('UNKNOWN','ROUND_END',now);return this.snapshot();}
    const previousMode=this.mode,previousCapture=this.lastCapture,wasTrusted=this.trusted,wasPhaseTrusted=this.phaseTrusted;
    this.mode=mode;const resuming=previousMode==='PAUSED'&&['PLAYING','RECOVERING'].includes(mode);
    if(resuming)this.#suspend(now,'RECOVERING',true);
    if(previousMode==='RECOVERING'&&mode==='PLAYING'){this.phaseFloor=Math.max(this.phaseFloor,now);this.phaseTrusted=false;this.motionPose=null;}
    if(!this.#fresh(frame,now)){
      if(previousCapture!==null&&now-previousCapture>this.config.maxAge)this.#finish('UNKNOWN','SOURCE_STALE',now);
      else this.#suspend(now,mode==='PAUSED'?'PAUSED':'UNKNOWN',mode!==previousMode);
      return this.snapshot();
    }
    const isNew=frame.frameId!==this.lastFrameId&&frame.captureTime>previousCapture;
    if(isNew&&frame.captureTime-previousCapture>this.config.maxAge){this.#finish('UNKNOWN','SOURCE_STALE',now);return this.snapshot();}
    if(isNew){this.lastFrameId=frame.frameId;this.lastCapture=frame.captureTime;}
    const pose=this.#pose(frame);
    if(!['PLAYING','RECOVERING'].includes(mode)){this.#suspend(now,mode==='PAUSED'?'PAUSED':'UNKNOWN',mode!==previousMode||(isNew&&!pose));return this.snapshot();}
    if(!pose){this.#suspend(now,'UNKNOWN',isNew);return this.snapshot();}
    if(mode==='RECOVERING'&&!this.needsRecovery)this.#suspend(now,'RECOVERING',true);
    this.pose=pose;
    if(!isNew){if(this.needsRecovery&&this.prepared&&mode==='PLAYING')this.needsRecovery=false;this.status=this.needsRecovery||mode==='RECOVERING'?'RECOVERING':'ACTIVE';return this.snapshot();}
    const delta=frame.captureTime-previousCapture;
    if(this.needsRecovery){
      const eligible=frame.captureTime>=this.floor;
      if(eligible&&wasTrusted&&!resuming&&['PLAYING','RECOVERING'].includes(previousMode))this.recoveryRemaining=Math.max(0,this.recoveryRemaining-delta);
      this.trusted=eligible;if(eligible&&this.recoveryRemaining===0)this.prepared=true;
      if(this.prepared&&mode==='PLAYING')this.needsRecovery=false;
      this.phaseTrusted=!this.needsRecovery&&mode==='PLAYING'&&frame.captureTime>=this.phaseFloor;
      this.motionPose=this.phaseTrusted?copy(pose):null;this.status=this.needsRecovery?'RECOVERING':'ACTIVE';return this.snapshot();
    }
    const eligible=frame.captureTime>=this.phaseFloor;this.phaseTrusted=eligible&&mode==='PLAYING';this.trusted=false;this.status='ACTIVE';
    if(eligible&&mode==='PLAYING'&&previousMode==='PLAYING'&&wasPhaseTrusted&&!resuming)this.#advance(delta,pose,now,frame);
    if(this.active)this.motionPose=this.phaseTrusted?copy(pose):null;return this.snapshot();
  }
  snapshot(){return {active:this.active,kind:this.kind,status:this.status,remainingMs:this.remainingMs,recoveryRemaining:this.needsRecovery?this.recoveryRemaining:0,pose:copy(this.pose),mosquito:this.active&&this.status==='ACTIVE'&&this.mosquito?{x:this.mosquito.x/1280,y:this.mosquito.y/720}:null,level:this.active&&this.kind==='LAVA'?this.level:0,targetLevel:this.active&&this.kind==='LAVA'?this.targetLevel:0,burns:this.burns};}
}
