// Synthetic-only frame producer. No camera, video, network or model APIs.
export class SyntheticFrameSource {
  constructor({game,clock=()=>performance.now(),project=frame=>frame,maxAge=250}={}) {
    if(!game||typeof game.addFrame!=='function'||typeof game.invalidateTracking!=='function'||typeof clock!=='function'||typeof project!=='function'||!Number.isFinite(maxAge)||maxAge<0)throw new TypeError('Invalid synthetic source configuration');
    this.game=game;this.clock=clock;this.project=project;this.maxAge=maxAge;
    this.running=true;this.projecting=false;this.epoch=1;this.sequence=0;this.lastSequence=0;this.lastCapture=-Infinity;this.lastFrame=null;this.watermark=-Infinity;
  }
  now(){const t=this.clock();if(!Number.isFinite(t))throw new RangeError('Clock must be finite');return t;}
  invalidate(reason,now){this.epoch++;this.sequence=0;this.lastSequence=0;this.lastCapture=-Infinity;this.lastFrame=null;this.watermark=now;this.game.invalidateTracking(reason,now);}
  sync(){const now=this.now();if(this.running&&this.lastFrame&&(now<this.lastCapture||now-this.lastCapture>this.maxAge)){this.invalidate('SOURCE_STALE',now);return false;}return this.running;}
  stop(){if(!this.running)return false;this.running=false;this.invalidate('SOURCE_STOPPED',this.now());return true;}
  start(){if(this.running)return false;this.running=true;this.epoch++;this.sequence=0;this.lastSequence=0;this.lastCapture=-Infinity;this.lastFrame=null;return true;}
  reset(){this.epoch++;this.sequence=0;this.lastSequence=0;this.lastCapture=-Infinity;this.lastFrame=null;this.watermark=this.now();}
  accept(frame){
    if(this.projecting){this.running=false;this.invalidate('SOURCE_PROJECT_ERROR',this.now());return false;}
    if(!this.sync())return false;const now=this.now();
    if(!frame||frame.epoch!==this.epoch||!Number.isSafeInteger(frame.sequence)||frame.sequence<=this.lastSequence||!Number.isFinite(frame.captureTime)||frame.captureTime<=this.watermark||frame.captureTime<=this.lastCapture||frame.captureTime>now||now-frame.captureTime>this.maxAge)return false;
    const clone=p=>p?{x:p.x,y:p.y,visibility:p.visibility}:null;
    const accepted={frameId:`synthetic-${frame.epoch}-${frame.sequence}`,epoch:frame.epoch,sequence:frame.sequence,captureTime:frame.captureTime,nose:clone(frame.nose),leftShoulder:clone(frame.leftShoulder),rightShoulder:clone(frame.rightShoulder)};
    for(const joint of ['leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip'])if(Object.hasOwn(frame,joint))accepted[joint]=clone(frame[joint]);
    let projected;
    this.projecting=true;
    try{projected=this.project(accepted);}catch{this.running=false;this.invalidate('SOURCE_PROJECT_ERROR',this.now());return false;}finally{this.projecting=false;}
    if(!this.running||this.epoch!==accepted.epoch)return false;
    if(!this.game.addFrame(projected))return false;
    this.lastSequence=frame.sequence;this.sequence=Math.max(this.sequence,frame.sequence);this.lastCapture=frame.captureTime;this.lastFrame=accepted;return true;
  }
  capture(points){
    if(!this.sync())return false;const now=this.now();
    return this.accept({...points,epoch:this.epoch,sequence:this.sequence+1,captureTime:now});
  }
}
