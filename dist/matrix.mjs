import {PoseFreeze} from './pose_freeze.mjs';
import {ActionGames} from './action_games.mjs';
import {dropCaught} from './drop_lanes.mjs';
const finite = Number.isFinite;
export const CROSS_CELLS = Object.freeze([2,4,5,6,8]);

export function validPoint(point, threshold = 0.55) {
  return Boolean(point && finite(point.x) && finite(point.y) &&
    finite(point.visibility) && point.visibility >= threshold && point.visibility <= 1);
}

// Position used for judging: the shoulder midpoint (`torso`, steadier than the nose) when the producer supplies a usable one, else the nose.
export function anchorPoint(frame, threshold = 0.55) {
  return validPoint(frame?.torso, threshold) ? frame.torso : frame?.nose ?? null;
}

export function gridCell(point, threshold = 0.55) {
  if (!validPoint(point, threshold) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  return Math.min(2, Math.floor(point.y * 3)) * 3 + Math.min(2, Math.floor(point.x * 3)) + 1;
}

export function parseMatrixCommand(text) {
  if (typeof text !== 'string' || text.length > 100) return null;
  const match = /^!throw\s+([1-9])$/i.exec(text.trim());
  return match ? Number(match[1]) : null;
}

// Catch mode: `!drop 1|2|3` drops an item down the left, middle or right column; the streamer catches it by being in that column when it lands.
export function parseDropCommand(text) {
  if (typeof text !== 'string' || text.length > 100) return null;
  const match = /^!drop\s+([1-3])$/i.exec(text.trim());
  return match ? Number(match[1]) : null;
}
export const dropCells = column => [column, column + 3, column + 6];

export class MatrixGame {
  constructor({ clock = () => performance.now(), onEvent = () => {}, options = {} } = {}) {
    this.clock = clock;
    this.onEvent = onEvent;
    this.config = { maxAge: 250, confidence: .55, warning: 500, crossWarning: 1500, dropFall: 2500, dropScore: 25, recovery: 1000,
      actorCooldown: 3000, globalCooldown: 400, maxAttacks: 8, ringTime: 1000,
      ringDamage: 10, damage: 15, dodgeScore: 25, freezeDamage:12, freezeScore:100, freezeCooldown:8000,
      mosquitoDamage:5,mosquitoScore:50,lavaDamage:5,lavaScore:75,actionCooldown:8000,
      dedupeTtl: 600000, dedupeLimit: 2000, maxResults: 200,
      ring: { left: .04, right: .96, top: .04, bottom: .96 }, ...options };
    for (const key of ['maxAge','warning','crossWarning','dropFall','dropScore','recovery','actorCooldown','globalCooldown','ringTime','dedupeTtl']) {
      if (!finite(this.config[key]) || this.config[key] < 0) throw new RangeError(`Invalid ${key}`);
    }
    for (const key of ['maxAttacks','dedupeLimit','maxResults']) {
      if (!Number.isSafeInteger(this.config[key]) || this.config[key] < 1) throw new RangeError(`Invalid ${key}`);
    }
    if (!finite(this.config.confidence) || this.config.confidence < 0 || this.config.confidence > 1) throw new RangeError('Invalid confidence');
    for (const key of ['damage','dodgeScore','ringDamage','freezeDamage','freezeScore','freezeCooldown','mosquitoDamage','mosquitoScore','lavaDamage','lavaScore','actionCooldown']) if (!finite(this.config[key]) || this.config[key] < 0) throw new RangeError(`Invalid ${key}`);
    const ring = this.config.ring;
    if (!ring || ![ring.left,ring.right,ring.top,ring.bottom].every(finite) || ring.left > ring.right || ring.top > ring.bottom) throw new RangeError('Invalid ring');
    this.freeze=new PoseFreeze({maxAge:this.config.maxAge,confidence:this.config.confidence,...this.config.freeze});
    this.actionGame=new ActionGames({maxAge:this.config.maxAge,confidence:this.config.confidence,recovery:this.config.recovery});
    this.reset();
  }

  reset() {
    this.wall = this.clock();
    if (!finite(this.wall)) throw new RangeError('Clock must be finite');
    this.gameTime = 0; this.hp = 100; this.score = 0; this.mode = 'IDLE';
    this.connection = 'OFFLINE'; this.attacks = []; this.results = []; this.latestFrame = null;
    this.frames = []; this.seenFrameIds = new Set(); this.frameIdOrder = []; this.minCaptureTime = -Infinity;
    this.outSince = null; this.outPenalized = false; this.recoveryUntil = null;
    // Resetting a round must not make an already-delivered chat message new again.
    this.notifications ??= new Map(); this.messages ??= new Map(); this.actors = new Map();
    this.lastGlobal = -Infinity; this.lastFreeze=-Infinity;this.lastActions=new Map(); this.pausedFrom = null;this.freeze.reset();this.actionGame.reset();
  }

  emit(type, detail = {}) { this.onEvent({ type, wallTime: this.wall, gameTime: this.gameTime, ...detail,
    ...(detail.cells ? {cells:[...detail.cells]} : {}) }); }
  setConnection(online) { this.connection = online ? 'ONLINE' : 'OFFLINE'; this.emit('connection', { connection: this.connection }); }
  start() { if (this.mode === 'IDLE' && this.hp > 0) { this.mode = 'PLAYING'; this.wall = this.clock(); return true; } return false; }
  pause() {
    this.tick();
    if (this.mode !== 'PLAYING' && this.mode !== 'RECOVERING' && this.mode !== 'TRACKING_LOST') return false;
    this.pausedFrom = this.mode; this.mode = 'PAUSED'; this.recoveryUntil = null; this.outSince = null; this.outPenalized = false; this.advanceFreeze();this.emit('status', { status: 'PAUSED' }); return true;
  }
  resume() {
    if (this.mode !== 'PAUSED') return false;
    const now=this.clock();this.expireSource(now);this.wall = now; this.mode = 'TRACKING_LOST'; this.outSince = null;
    if (this.frameUsable(this.latestFrame, this.wall)) this.beginRecovery();
    else this.emit('status', { status: 'TRACKING_LOST' });
    this.advanceFreeze();return true;
  }
  invalidateTracking(reason='CALIBRATION_CHANGED',now=this.clock()) {
    if(!finite(now) || now<this.wall)throw new RangeError('Clock must be monotonic');
    this.wall=now;this.cancelPending(reason,now);this.latestFrame=null;this.frames=[];this.minCaptureTime=now;
    this.outSince=null;this.outPenalized=false;this.recoveryUntil=null;
    if(this.mode==='PLAYING'||this.mode==='RECOVERING'||this.mode==='TRACKING_LOST'){
      this.mode='TRACKING_LOST';this.emit('status',{status:'TRACKING_LOST'});
    }
  }

  loseLandmarks() {
    return this.tick({landmarksLost:true});
  }

  beginRecovery() { this.mode = 'RECOVERING'; this.recoveryUntil = this.wall + this.config.recovery; this.emit('status', { status: 'RECOVERING', until: this.recoveryUntil }); }

  frameUsable(frame, at) {
    return Boolean(frame && frame.captureTime <= at && at - frame.captureTime <= this.config.maxAge &&
      validPoint(anchorPoint(frame, this.config.confidence), this.config.confidence));
  }
  expireSource(now) {
    if (!finite(now) || now<this.wall) throw new RangeError('Clock must be monotonic');
    if (this.latestFrame && now-this.latestFrame.captureTime>this.config.maxAge && this.mode!=='IDLE' && this.mode!=='ROUND_END') {
      this.invalidateTracking('SOURCE_STALE',now);return true;
    }
    return false;
  }
  addFrame(frame) {
    const now = this.clock();
    if(this.expireSource(now))return false;
    if (!frame || typeof frame.frameId !== 'string' || !frame.frameId || !finite(frame.captureTime) ||
        frame.captureTime > now || now-frame.captureTime>this.config.maxAge || frame.captureTime <= this.minCaptureTime || (this.latestFrame && frame.captureTime <= this.latestFrame.captureTime) ||
        this.seenFrameIds.has(frame.frameId)) return false;
    // Snapshot the producer data so later caller mutation cannot change past outcomes.
    const point = p => p ? { x:p.x, y:p.y, visibility:p.visibility } : null;
    const copy = { frameId:frame.frameId, captureTime:frame.captureTime,
      nose:point(frame.nose), leftShoulder:point(frame.leftShoulder), rightShoulder:point(frame.rightShoulder) };
    for(const joint of ['leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip'])if(Object.hasOwn(frame,joint))copy[joint]=point(frame[joint]);
    if(Object.hasOwn(frame,'torso'))copy.torso=point(frame.torso);
    this.latestFrame = copy; this.frames.push(copy);
    if (this.frames.length > 64) this.frames.shift();
    this.seenFrameIds.add(frame.frameId); this.frameIdOrder.push(frame.frameId);
    if (this.frameIdOrder.length > 256) this.seenFrameIds.delete(this.frameIdOrder.shift());
    return true;
  }

  purge(map, now) {
    for (const [id, time] of map) if (now - time >= this.config.dedupeTtl) map.delete(id);
    while (map.size >= this.config.dedupeLimit) map.delete(map.keys().next().value);
  }
  receiveChat(event) {
    const drop = parseDropCommand(event?.text);
    if (drop !== null) return this.#receiveAttack(event, {cell:drop + 3, kind:'DROP', cells:dropCells(drop), warning:this.config.dropFall});
    const cell = parseMatrixCommand(event?.text);
    return this.#receiveAttack(event, cell === null ? null : {cell, warning:this.config.warning});
  }

  // Explicit local simulator action; chat/Bits transports never dispatch this method.
  receiveSyntheticCross(event) {
    return this.#receiveAttack(event, {cell:5, kind:'CROSS', cells:[...CROSS_CELLS], warning:this.config.crossWarning});
  }

  receiveSyntheticFreeze(event) {return this.#receiveAttack(event,{kind:'FREEZE'});}
  receiveSyntheticMosquito(event) {return this.#receiveAttack(event,{kind:'MOSQUITO'});}
  receiveSyntheticLava(event,{level=.45}={}) {return this.#receiveAttack(event,{kind:'LAVA',level});}

  #receiveAttack(event, target) {
    const now = this.clock();
    this.tick();
    if (!event || typeof event.notificationId !== 'string' || !event.notificationId ||
        typeof event.messageId !== 'string' || !event.messageId || typeof event.actorId !== 'string' || !event.actorId ||
        [event.notificationId,event.messageId,event.actorId].some(id=>id.length>128) ||
        !finite(event.receivedAt) || event.receivedAt > now) return { accepted:false, reason:'INVALID_EVENT' };
    if (target === null) return { accepted:false, reason:'INVALID_COMMAND' };
    const {cell} = target;
    // Expire before lookup, but evict for capacity only after checking existing IDs.
    for (const map of [this.notifications,this.messages]) for (const [id,time] of map) if (now-time >= this.config.dedupeTtl) map.delete(id);
    if (this.notifications.has(event.notificationId) || this.messages.has(event.messageId)) return { accepted:false, reason:'DUPLICATE' };
    for (const [map,id] of [[this.notifications,event.notificationId],[this.messages,event.messageId]]) { this.purge(map,now); map.set(id,now); }
    if (this.connection !== 'ONLINE') return { accepted:false, reason:'OFFLINE' };
    if (this.mode !== 'PLAYING') return { accepted:false, reason:'NOT_PLAYING' };
    const isFreeze=target.kind==='FREEZE';
    const isAction=['MOSQUITO','LAVA'].includes(target.kind),raising=target.kind==='LAVA'&&this.actionGame.active&&this.actionGame.kind==='LAVA';
    if(this.freeze.active||(this.actionGame.active&&!raising)||((isFreeze||isAction)&&this.attacks.length))return {accepted:false,reason:'MODE_BUSY'};
    if(target.kind==='LAVA'&&(!finite(target.level)||target.level<.1||target.level>.8))return {accepted:false,reason:'INVALID_LEVEL'};
    if(isFreeze&&!this.freeze.canStart(this.latestFrame,this.wall))return {accepted:false,reason:'POSE_UNKNOWN'};
    if(isFreeze&&this.gameTime-this.lastFreeze<this.config.freezeCooldown)return {accepted:false,reason:'FREEZE_COOLDOWN'};
    if(isAction&&!(raising?this.actionGame.canRaise(this.latestFrame,this.wall):this.actionGame.canStart(target.kind,this.latestFrame,this.wall)))return {accepted:false,reason:'POSE_UNKNOWN'};
    if(isAction&&!raising&&this.gameTime-(this.lastActions.get(target.kind)??-Infinity)<this.config.actionCooldown)return {accepted:false,reason:'GAME_COOLDOWN'};
    if (this.attacks.length >= this.config.maxAttacks) return { accepted:false, reason:'QUEUE_FULL' };
    if (this.gameTime - (this.actors.get(event.actorId) ?? -Infinity) < this.config.actorCooldown) return { accepted:false, reason:'ACTOR_COOLDOWN' };
    if (this.gameTime - this.lastGlobal < this.config.globalCooldown) return { accepted:false, reason:'GLOBAL_COOLDOWN' };
    this.actors.set(event.actorId,this.gameTime); this.lastGlobal = this.gameTime;
    // Bound actor state independently from untrusted chat volume.
    if (this.actors.size > this.config.dedupeLimit) this.actors.delete(this.actors.keys().next().value);
    if(isFreeze){
      this.freeze.start({eventId:event.messageId,now:this.wall,frame:this.latestFrame});
      this.lastFreeze=this.gameTime;this.outSince=null;this.outPenalized=false;
      const detail={eventId:event.messageId,kind:'FREEZE'};this.emit('freezeWarning',detail);return {accepted:true,...detail};
    }
    if(isAction){
      if(raising)this.actionGame.raise();
      else {this.actionGame.start({kind:target.kind,eventId:event.messageId,now:this.wall,frame:this.latestFrame,level:target.level});this.lastActions.set(target.kind,this.gameTime);}
      this.outSince=null;this.outPenalized=false;
      const detail={eventId:event.messageId,kind:target.kind,raised:raising};this.emit(raising?'lavaRaise':'challengeStart',detail);return {accepted:true,...detail};
    }
    const attack = { eventId:event.messageId, notificationId:event.notificationId, actorId:event.actorId,
      cell, start:this.gameTime, due:this.gameTime + target.warning,
      ...(target.cells ? {kind:target.kind,cells:[...target.cells]} : {}) };
    const detail = {eventId:attack.eventId,cell,...(target.cells ? {kind:target.kind,cells:[...target.cells]} : {})};
    this.attacks.push(attack); this.emit('warning', detail);
    return { accepted:true, ...detail };
  }

  resolve(attack, atWall) {
    const frame = [...this.frames].reverse().find(f => f.captureTime <= atWall) ?? null;
    const point = this.frameUsable(frame, atWall) ? anchorPoint(frame, this.config.confidence) : null;
    const current = gridCell(point, this.config.confidence);
    // A drop is the reverse of an attack: catching it scores, missing it costs nothing. Only the left/right position counts,
    // so leaving the window vertically does not make a drop unknown; only a missing or low-confidence point does.
    // The catcher follows the streamer's x; the drop is caught when the catcher covers the item's target x (see drop_lanes.mjs).
    const caught = attack.kind === 'DROP' && point ? dropCaught(point.x, attack.cell - 3) : null;
    const inCells = attack.kind === 'DROP' ? caught === true : current !== null && (attack.cells ?? [attack.cell]).includes(current);
    const known = attack.kind === 'DROP' ? caught !== null : current !== null;
    const outcome = !known ? 'UNKNOWN' : attack.kind === 'DROP' ? (inCells ? 'CATCH' : 'MISS') : inCells ? 'HIT' : 'DODGE';
    const hpBefore = this.hp, scoreBefore = this.score;
    if (outcome === 'HIT') this.hp = Math.max(0,this.hp-this.config.damage);
    if (outcome === 'DODGE') this.score += this.config.dodgeScore;
    if (outcome === 'CATCH') this.score += this.config.dropScore;
    const result = { eventId:attack.eventId, cell:attack.cell,
      ...(attack.cells ? {kind:attack.kind,cells:[...attack.cells]} : {}), outcome, sampledFrameId:frame?.frameId ?? null,
      sampledAt:atWall, hpDelta:this.hp-hpBefore, scoreDelta:this.score-scoreBefore,
      ...(attack.kind === 'DROP' ? {sampledX:point ? point.x : null, caught} : {}) };
    this.recordResult(result);
    if (this.hp === 0) { this.mode='ROUND_END'; this.emit('status',{status:'ROUND_END'}); }
    return result;
  }

  recordResult(result) {
    this.results.push(result);
    if (this.results.length > this.config.maxResults) this.results.shift();
    this.emit('result',result);
  }

  advanceFreeze() {
    this.freeze.update({now:this.wall,frame:this.latestFrame,mode:this.mode});this.settleFreeze();
    this.actionGame.update({now:this.wall,frame:this.latestFrame,mode:this.mode});this.settleActions();
  }
  settleActions(){
    for(const pulse of this.actionGame.takePulses()){
      const before=this.hp;this.hp=Math.max(0,this.hp-this.config.lavaDamage);this.emit('lavaBurn',{...pulse,hpDelta:this.hp-before});
    }
    if(this.hp===0&&this.mode!=='ROUND_END'){
      this.mode='ROUND_END';this.emit('status',{status:'ROUND_END'});
      if(this.actionGame.active)this.actionGame.cancel('ROUND_END',this.wall);
    }
    const result=this.actionGame.takeResult();
    if(result){
      const hpBefore=this.hp,scoreBefore=this.score;
      if(result.kind==='MOSQUITO'&&result.outcome==='HIT')this.hp=Math.max(0,this.hp-this.config.mosquitoDamage);
      if(result.outcome==='DODGE')this.score+=result.kind==='MOSQUITO'?this.config.mosquitoScore:this.config.lavaScore;
      this.outSince=null;this.outPenalized=false;
      this.recordResult({...result,hpDelta:this.hp-hpBefore,scoreDelta:this.score-scoreBefore});
      if(this.hp===0&&this.mode!=='ROUND_END'){this.mode='ROUND_END';this.emit('status',{status:'ROUND_END'});}
    }
    if(this.mode==='ROUND_END'&&this.attacks.length)this.cancelPending('ROUND_END',this.wall);
  }
  settleFreeze() {
    const result=this.freeze.takeResult();if(!result)return;
    const hpBefore=this.hp,scoreBefore=this.score;
    if(result.outcome==='HIT')this.hp=Math.max(0,this.hp-this.config.freezeDamage);
    if(result.outcome==='DODGE')this.score+=this.config.freezeScore;
    this.outSince=null;this.outPenalized=false;
    this.recordResult({...result,hpDelta:this.hp-hpBefore,scoreDelta:this.score-scoreBefore});
    if(this.hp===0&&this.mode!=='ROUND_END'){
      this.mode='ROUND_END';this.emit('status',{status:'ROUND_END'});this.cancelPending('ROUND_END',this.wall);
    }
  }

  cancelPending(reason, atWall) {
    if(this.freeze.active){this.freeze.cancel(reason,atWall);this.settleFreeze();}
    if(this.actionGame.active){this.actionGame.cancel(reason,atWall);this.settleActions();}
    for (const attack of this.attacks.splice(0)) this.recordResult({ eventId:attack.eventId, cell:attack.cell,
      ...(attack.cells ? {kind:attack.kind,cells:[...attack.cells]} : {}),
      outcome:'UNKNOWN', reason, sampledFrameId:null, sampledAt:atWall, hpDelta:0, scoreDelta:0 });
  }

  updateRing() {
    const frame = this.latestFrame;
    if (!frame || frame.captureTime > this.wall || this.wall-frame.captureTime > this.config.maxAge) { this.outSince=null; this.outPenalized=false; return; }
    const points = [frame.nose,frame.leftShoulder,frame.rightShoulder];
    const known = points.map(p=>validPoint(p,this.config.confidence));
    const r = this.config.ring;
    const inside = p => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    if (points.some((p,i)=>known[i] && inside(p))) { this.outSince=null; this.outPenalized=false; return; }
    if (!known.every(Boolean)) { this.outSince=null; this.outPenalized=false; return; }
    this.outSince ??= this.gameTime;
    if (!this.outPenalized && this.gameTime-this.outSince >= this.config.ringTime) {
      this.outPenalized=true; const before=this.hp; this.hp=Math.max(0,this.hp-this.config.ringDamage);
      this.emit('ringOut',{hpDelta:this.hp-before});
      if (!this.hp) { this.mode='ROUND_END'; this.emit('status',{status:'ROUND_END'}); this.cancelPending('ROUND_END',this.wall); }
    }
  }

  tick({landmarksLost=false}={}) {
    if(typeof this.beforeTick==='function')this.beforeTick();
    const now = this.clock();
    if (!finite(now) || now < this.wall) throw new RangeError('Clock must be monotonic');
    if(this.expireSource(now))return this.snapshot();
    let startWall = this.wall, elapsed = now-this.wall;
    if (this.mode === 'RECOVERING') {
      if (!this.frameUsable(this.latestFrame, now)) { this.mode='TRACKING_LOST'; this.recoveryUntil=null; this.emit('status',{status:'TRACKING_LOST'}); }
      else if (now >= this.recoveryUntil) { startWall=this.recoveryUntil; elapsed=now-this.recoveryUntil; this.mode='PLAYING'; this.recoveryUntil=null; this.emit('status',{status:'PLAYING'}); }
    }
    if (this.mode === 'PLAYING') {
      const before = this.gameTime, end = before+elapsed;
      for (const attack of [...this.attacks].sort((a,b)=>a.due-b.due)) {
        // At the exact loss instant, leave impacts pending until tracking recovers.
        // Impacts strictly before that instant retain their ordinary semantics.
        if (attack.due > end || (landmarksLost && attack.due === end) || this.mode !== 'PLAYING') continue;
        this.gameTime = attack.due;
        const atWall = startWall+(attack.due-before);
        this.wall=atWall;
        const result=this.resolve(attack,atWall);
        this.attacks.splice(this.attacks.indexOf(attack),1);
        if (this.mode === 'ROUND_END') { this.cancelPending('ROUND_END',atWall); break; }
        const sampled=this.frames.find(f=>f.frameId===result.sampledFrameId) ?? null;
        if (!this.frameUsable(sampled,atWall)) {
          this.mode='TRACKING_LOST'; this.outSince=null; this.outPenalized=false;
          this.emit('status',{status:'TRACKING_LOST'}); break;
        }
      }
      if (this.mode === 'PLAYING') this.gameTime=end;
    }
    this.wall=now;
    if (landmarksLost) {
      this.latestFrame=null;this.outSince=null;this.outPenalized=false;this.recoveryUntil=null;
      if(this.mode==='PLAYING'||this.mode==='RECOVERING'){
        this.mode='TRACKING_LOST';this.emit('status',{status:'TRACKING_LOST'});
      }
      this.advanceFreeze();
      return this.snapshot();
    }
    if (this.mode === 'PLAYING') {
      // At a deadline the result is resolved first; otherwise tracking loss freezes later game time.
      if (!this.frameUsable(this.latestFrame, now)) { this.mode='TRACKING_LOST'; this.outSince=null; this.outPenalized=false; this.emit('status',{status:'TRACKING_LOST'}); }
      else if(this.freeze.active||this.actionGame.active){this.outSince=null;this.outPenalized=false;}
      else this.updateRing();
    } else if (this.mode === 'TRACKING_LOST' && this.frameUsable(this.latestFrame,now)) this.beginRecovery();
    this.advanceFreeze();
    return this.snapshot();
  }

  snapshot() {
    return { mode:this.mode, connection:this.connection, wallTime:this.wall, gameTime:this.gameTime,
      hp:this.hp, score:this.score, attacks:this.attacks.map(a=>({...a,...(a.cells?{cells:[...a.cells]}:{}),
        ...(a.kind==='DROP'?{progress:Math.max(0,Math.min(1,a.due>a.start?(this.gameTime-a.start)/(a.due-a.start):1))}:{})})),
      lastResult:this.results.length ? {...this.results[this.results.length-1],
        ...(this.results.at(-1).cells?{cells:[...this.results.at(-1).cells]}:{})} : null,
      recoveryRemaining:this.mode==='RECOVERING' ? Math.max(0,this.recoveryUntil-this.wall) : 0,freeze:this.freeze.snapshot(),actionGame:this.actionGame.snapshot() };
  }
}
