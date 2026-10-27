// Coordinates a local OAuth popup without making network requests itself.
export class AuthPopupController {
  constructor({oauth,origin,openWindow,onState=()=>{},onSuccess=()=>{},setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}) {
    if(typeof oauth?.begin!=='function'||typeof oauth?.complete!=='function'||typeof oauth?.clear!=='function'||typeof openWindow!=='function')throw new TypeError('popup dependencies required');
    if(!['http://127.0.0.1:4173','http://localhost:4173'].includes(origin))throw new TypeError('local origin required');
    this.oauth=oauth;this.origin=origin;this.openWindow=openWindow;this.onState=onState;this.onSuccess=onSuccess;
    this.setInterval=(...args)=>setIntervalImpl(...args);this.clearInterval=(...args)=>clearIntervalImpl(...args);
    this.pending=false;this.phase='IDLE';this.popup=null;this.timer=null;this.generation=0;
  }
  start() {
    if(this.pending)return false;
    const generation=++this.generation;let popup;
    try {const url=this.oauth.begin();popup=this.openWindow(url);}catch {this.oauth.clear();this.onState('FAILED');return false;}
    if(!popup){this.oauth.clear();this.onState('BLOCKED');return false;}
    this.pending=true;this.phase='WAITING';this.popup=popup;this.onState('PENDING');
    this.timer=this.setInterval(()=>{
      if(!this.pending||this.phase!=='WAITING'||generation!==this.generation)return;
      let closed;try{closed=popup.closed;}catch{closed=true;}
      if(closed)this.cancel('CLOSED');
    },250);
    return true;
  }
  cancel(reason='CANCELLED') {
    if(!this.pending)return false;
    this.generation++;this.pending=false;this.phase='IDLE';this.clearTimer();
    const popup=this.popup;this.popup=null;this.oauth.clear();try{popup?.close();}catch{}
    this.onState(reason);return true;
  }
  clearTimer(){if(this.timer!==null){this.clearInterval(this.timer);this.timer=null;}}
  async handleMessage(event) {
    if(!this.pending||this.phase!=='WAITING'||event.origin!==this.origin||event.source!==this.popup||event.data?.type!=='streamer-mayhem-local-oauth')return false;
    try{if(this.popup.closed){this.cancel('CLOSED');return false;}}catch{this.cancel('CLOSED');return false;}
    // The callback waits for this acknowledgement before closing; a manual close
    // observed before this message wins and invalidates the pending state.
    const generation=this.generation,popup=this.popup;this.phase='VALIDATING';this.clearTimer();
    try{popup.postMessage({type:'streamer-mayhem-local-oauth-ack'},this.origin);}catch{}
    this.onState('VALIDATING');
    try {
      await this.oauth.complete(event.data.fragment,event.data.query);
      if(!this.pending||generation!==this.generation)return false;
      this.pending=false;this.phase='IDLE';this.popup=null;this.onState('SUCCESS');this.onSuccess();return true;
    } catch(error) {
      if(!this.pending||generation!==this.generation)return false;
      this.pending=false;this.phase='IDLE';this.popup=null;this.oauth.clear();this.onState(error?.message==='AUTH_DENIED'?'DENIED':'FAILED');return false;
    }
  }
  dispose(){if(!this.cancel('DISPOSED')){this.generation++;this.clearTimer();this.oauth.clear();}}
}
