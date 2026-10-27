export const CROSS = [2, 4, 5, 6, 8];
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const good = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.visibility) && p.visibility >= .55;
export function cellOf(p) {
  if (!good(p) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
  return Math.min(2, Math.floor(p.y * 3)) * 3 + Math.min(2, Math.floor(p.x * 3)) + 1;
}
export function parseCommand(text) {
  if (typeof text !== 'string' || text.length > 100) return null;
  const m = /^!throw\s+([1-9])$/i.exec(text.trim());
  if (m) return { type: 'throw', cell: Number(m[1]) };
  const type = /^!(freeze|lava|mosquito|cross)$/i.exec(text.trim())?.[1]?.toLowerCase();
  return type ? { type } : null;
}
export function demoPose(x = .5, y = .35, narrow = false, hands = null) {
  const p = Array.from({ length: 33 }, () => ({ x, y, visibility: 0 }));
  const put = (i, a, b) => p[i] = { x: a, y: b, visibility: 1 };
  const w = narrow ? .045 : .11;
  put(0, x, y); put(11, x-w, y+.13); put(12, x+w, y+.13);
  put(13, x-w, y+.27); put(14, x+w, y+.27);
  put(15, hands?.[0]?.x ?? x-w, hands?.[0]?.y ?? y+.39);
  put(16, hands?.[1]?.x ?? x+w, hands?.[1]?.y ?? y+.39);
  put(23, x-.06, y+.4); put(24, x+.06, y+.4);
  put(25, x-.07, y+.58); put(26, x+.07, y+.58);
  put(27, x-.09, y+.75); put(28, x+.09, y+.75);
  return p;
}
const distance = (a,b) => Math.hypot((a.x-b.x)*1280, (a.y-b.y)*720);
const inside = p => good(p) && p.x >= .04 && p.x <= .96 && p.y >= .04 && p.y <= .96;

// The earlier multi-mode prototype is retained for future work, not the Matrix entry point.
export class ExperimentalGame {
  constructor({ random = Math.random, onEvent = () => {} } = {}) {
    this.random = random; this.onEvent = onEvent; this.reset();
  }
  reset() {
    this.time = 0; this.hp = 100; this.score = 0; this.dodged = 0; this.hits = 0;
    this.attacks = []; this.bugs = []; this.freeze = null; this.lava = 0;
    this.lavaBaseline = .75; this.calibrated = false; this.lavaTick = 0;
    this.charge = 0; this.outSince = null; this.lastRing = -10; this.lastDamage = -10;
    this.pose = []; this.poseAt = -10; this.previousSample = null; this.samples = 0;
    this.running = false; this.users = new Map(); this.lastCommand = -10;
    this.modeCooldown = new Map(); this.wasClapping = false;
  }
  emit(type, message, extra = {}) { this.onEvent({ type, message, time: this.time, ...extra }); }
  start() { if (this.hp > 0) this.running = true; }
  pause() { this.running = false; }
  damage(amount, reason) {
    if (this.time - this.lastDamage < .65 || this.hp <= 0) return;
    this.lastDamage = this.time; this.hp = Math.max(0, this.hp-amount); this.hits++;
    this.emit('hit', reason, { amount });
    if (!this.hp) { this.running = false; this.emit('over', 'ROUND OVER'); }
  }
  setPose(pose, hands = [], timestamp = this.time) {
    const p = Array.isArray(pose) ? pose : [];
    // A distinct source sample is required; render FPS must not alter hand speed.
    if (!Number.isFinite(timestamp) || timestamp <= (this.previousSample?.timestamp ?? -Infinity)) return;
    const handPoints = hands.flatMap(h => [h[0], h[8]].filter(good));
    const wrists = handPoints.length ? handPoints : [p[15], p[16]].filter(good);
    const palms = hands.length >= 2 ? hands.map(h => h[9]).filter(good) : [p[15],p[16]].filter(good);
    const prev = this.previousSample;
    const dt = prev ? timestamp - prev.timestamp : 0;
    if (this.running && dt > 0 && dt <= .25) {
      for (let i = 0; i < wrists.length; i++) {
        if (!prev.wrists[i]) continue;
        if (distance(wrists[i],prev.wrists[i])/dt > 450) {
          this.bugs = this.bugs.filter(b => {
            if (distance(b,wrists[i]) > 65) return true;
            this.score += 50; this.emit('slap','MOSQUITO DOWN', { x:b.x, y:b.y }); return false;
          });
        }
      }
      const clapping = palms.length === 2 && distance(palms[0],palms[1]) < 100;
      if (clapping && !this.wasClapping && prev.palms.length === 2 && distance(prev.palms[0],prev.palms[1]) > 130) {
        const mid = { x:(palms[0].x+palms[1].x)/2, y:(palms[0].y+palms[1].y)/2 };
        this.bugs = this.bugs.filter(b => {
          if (distance(b,mid)>85) return true;
          this.score+=75; this.emit('slap','CLAP COMBO', {x:b.x,y:b.y}); return false;
        });
      }
      this.wasClapping = clapping;
    } else this.wasClapping = false;
    this.previousSample = { timestamp, wrists, palms };
    this.pose = p; this.poseAt = this.time; this.samples++;
  }
  calibrate() {
    const hips = [this.pose[23], this.pose[24]];
    if (!hips.every(good) || this.time-this.poseAt > .25) return false;
    this.lavaBaseline = clamp((hips[0].y+hips[1].y)/2, .3, .85);
    this.calibrated = true; this.emit('info','STANDING HEIGHT SAVED'); return true;
  }
  command(command, user = 'local', { trusted = false } = {}) {
    if (!this.running || !command) return false;
    const {type,cell} = command;
    // Matrix attacks must use MatrixGame's event IDs and tracking contract.
    if (type === 'throw') return false;
    if (!['throw','cross','freeze','mosquito','lava'].includes(type)) return false;
    if (type === 'throw' && (!Number.isInteger(cell) || cell<1 || cell>9)) return false;
    if (!trusted && (this.time-(this.users.get(user)??-10)<3 || this.time-this.lastCommand<.4)) return false;
    if (type==='throw' && this.attacks.length>=8) return false;
    if (type!=='throw' && this.time-(this.modeCooldown.get(type)??-30)<(type==='mosquito'?2:8)) return false;
    if (type==='freeze' && this.freeze) return false;
    if (type==='lava' && !this.calibrated) { this.emit('info','CALIBRATE STANDING HEIGHT FIRST'); return false; }
    this.users.set(user,this.time); this.lastCommand=this.time;
    if (this.users.size>500) this.users.delete(this.users.keys().next().value);
    if (type==='throw') this.attacks.push({cells:[cell], at:this.time+.5, until:this.time+.95, resolved:false});
    if (type==='cross') this.attacks.push({cells:CROSS, at:this.time+1.5, until:this.time+2.1, resolved:false});
    if (type==='freeze') this.freeze={start:this.time+1.5,end:this.time+4,center:.5,width:.3,anchor:null};
    if (type==='mosquito') for(let i=0;i<Math.min(3,8-this.bugs.length);i++) this.bugs.push({x:.15+this.random()*.7,y:.15+this.random()*.6,vx:(this.random()-.5)*.4,vy:(this.random()-.5)*.4,until:this.time+15});
    if (type==='lava') this.lava=clamp(this.lava+.12,0,.55);
    if (type!=='throw') this.modeCooldown.set(type,this.time);
    this.emit('attack',type==='throw'?`INCOMING · CELL ${cell}`:type.toUpperCase(),{command,user}); return true;
  }
  cheer(bits) {
    if (!this.running || !Number.isFinite(bits) || bits<=0) return false;
    this.charge += Math.min(10000,Math.floor(bits));
    if (this.charge>=500 && this.command({type:'cross'},'community',{trusted:true})) this.charge%=500;
    else this.command({type:'throw',cell:1+Math.floor(this.random()*9)},'cheer',{trusted:true});
    return true;
  }
  get lavaLine() { return Math.max(this.lavaBaseline+.025,1-this.lava); }
  step(delta) {
    if (!this.running || !Number.isFinite(delta) || delta<=0) return;
    const dt=Math.min(delta,.1); this.time+=dt;
    const fresh=this.time-this.poseAt<=.25;
    const p=fresh?this.pose:[];
    if ([0,11,12].every(i=>good(p[i]) && !inside(p[i]))) {
      this.outSince ??= this.time;
      if(this.time-this.outSince>=1 && this.time-this.lastRing>=1) {this.damage(10,'OUT OF BOUNDS');this.lastRing=this.time;}
    } else this.outSince=null;
    for(const a of this.attacks) if(!a.resolved && this.time>=a.at) {
      a.resolved=true; const cell=cellOf(p[0]);
      if(cell && a.cells.includes(cell)) this.damage(15,a.cells.length>1?'CROSS INFERNO':'DIRECT HIT');
      else if(cell) {this.dodged++;this.score+=25;this.emit('dodge','CLEAN DODGE');}
    }
    this.attacks=this.attacks.filter(a=>a.until>this.time);
    const f=this.freeze;
    if(f && this.time>=f.start) {
      const joints=[0,11,12,13,14].map(i=>p[i]);
      let fail=!joints.every(good);
      if(!fail) {
        f.anchor ??= joints.map(a=>({...a}));
        fail=joints.some((a,i)=>Math.abs(a.x-f.center)>f.width/2 || distance(a,f.anchor[i])>24);
      }
      if(fail) {this.damage(12,'FREEZE BROKEN');this.freeze=null;}
      else if(this.time>=f.end) {this.score+=100;this.freeze=null;this.emit('dodge','PERFECT FREEZE');}
    }
    if(this.lava>0) {
      this.lava=Math.max(0,this.lava-dt*.012);
      if([p[23],p[24]].every(good) && Math.max(p[23].y,p[24].y)>this.lavaLine) {
        this.lavaTick+=dt;
        if(this.lavaTick>=1) {this.damage(5,'LAVA BURN');this.lavaTick%=1;}
      } else this.lavaTick=0;
    }
    for(const b of this.bugs) {
      b.vx=clamp(b.vx+(this.random()-.5)*.4*Math.sqrt(dt),-.25,.25);
      b.vy=clamp(b.vy+(this.random()-.5)*.4*Math.sqrt(dt),-.35,.35);
      b.x+=b.vx*dt; b.y+=b.vy*dt;
      if(b.x<.04||b.x>.96) {b.vx*=-1;b.x=clamp(b.x,.04,.96);}
      if(b.y<.06||b.y>.94) {b.vy*=-1;b.y=clamp(b.y,.06,.94);}
    }
    this.bugs=this.bugs.filter(b=>b.until>this.time);
  }
}

// Matrix is the only supported game entry point in the current synthetic stage.
export { MatrixGame, MatrixGame as Game } from './matrix.mjs';
